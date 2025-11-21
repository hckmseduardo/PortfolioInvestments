"""
Plaid Transaction Sync Background Task

Handles asynchronous transaction syncing from Plaid.
"""
import logging
from typing import Optional
from datetime import datetime, timedelta
from pathlib import Path
import uuid
import json

from rq import get_current_job

from app.database.postgres_db import get_db_context
from app.database.models import PlaidItem, PlaidAccount, PlaidSyncCursor, Transaction, Expense, Account, Dividend
from app.services.plaid_client import plaid_client
from app.services.plaid_transaction_mapper import create_mapper
from app.services.encryption import encryption_service
from app.services.transaction_classifier import transaction_classifier
from app.services.plaid_audit_logger import PlaidAuditLogger
from app.services import plaid_replay
from app.config import settings

logger = logging.getLogger(__name__)

# Create debug directory for Plaid payloads
PLAID_DEBUG_DIR = Path("/app/logs/plaid_debug")
PLAID_DEBUG_DIR.mkdir(parents=True, exist_ok=True)


def run_plaid_sync_job(user_id: str, plaid_item_id: str, full_resync: bool = False, replay_mode: bool = False):
    """
    Background job to sync transactions from Plaid

    Args:
        user_id: User ID
        plaid_item_id: Plaid item ID to sync
        full_resync: If True, fetch all available historical transactions
        replay_mode: If True, use saved debug data instead of calling Plaid API

    Returns:
        Dictionary with sync results
    """
    job = get_current_job()

    def update_stage(stage: str, progress: dict = None):
        if job:
            job.meta["stage"] = stage
            if progress:
                job.meta["progress"] = progress
            job.meta["user_id"] = user_id  # For access control
            job.save_meta()
            logger.info(f"Plaid sync job {job.id} stage: {stage} progress: {progress}")

    try:
        # Determine sync mode and load replay data if needed
        replay_data = None
        if replay_mode:
            sync_mode = "REPLAY from saved data"
            update_stage("starting", {"message": f"Initializing Plaid {sync_mode}...", "current": 0, "total": 0})
            logger.info(f"Starting Plaid REPLAY job - user: {user_id}, item: {plaid_item_id}")

            # Load saved debug data
            replay_data = plaid_replay.get_latest_sync_data(user_id, plaid_item_id)
            if not replay_data:
                raise ValueError(f"No replay data found for user {user_id}, item {plaid_item_id}. Make sure PLAID_DEBUG_MODE was enabled during the original sync.")

            logger.info(f"[REPLAY] Loaded replay data with: {list(replay_data.keys())}")
        else:
            sync_mode = "FULL RESYNC" if full_resync else "incremental sync"
            update_stage("starting", {"message": f"Initializing Plaid {sync_mode}...", "current": 0, "total": 0})
            logger.info(f"Starting Plaid sync job - mode: {sync_mode}, user: {user_id}, item: {plaid_item_id}")

        with get_db_context() as db:
            # Get Plaid item
            plaid_item = db.query(PlaidItem).filter(
                PlaidItem.id == plaid_item_id,
                PlaidItem.user_id == user_id
            ).first()

            if not plaid_item:
                raise ValueError(f"Plaid item {plaid_item_id} not found for user {user_id}")

            # Security: Decrypt access token before using
            access_token = encryption_service.decrypt(plaid_item.access_token)

            # Handle full resync vs incremental sync vs replay
            if replay_mode and replay_data and 'transactions' in replay_data:
                # REPLAY MODE: Use saved transaction data
                logger.info(f"[REPLAY] Using saved transaction data instead of calling Plaid API")

                transaction_debug_data = replay_data['transactions']
                sync_result = plaid_replay.extract_transactions_from_debug_data(transaction_debug_data)

                logger.info(
                    f"[REPLAY] Extracted {len(sync_result['added'])} added, "
                    f"{len(sync_result['modified'])} modified, "
                    f"{len(sync_result['removed'])} removed transactions from debug data"
                )

            elif full_resync:
                logger.info(f"[FULL RESYNC] Fetching historical transactions for item {plaid_item_id}")
                update_stage("fetching_historical", {
                    "message": f"Fetching all transaction history from {plaid_item.institution_name}...",
                    "current": 0,
                    "total": 0
                })

                # Fetch historical transactions (2 years back)
                end_date = datetime.now().date()
                start_date = end_date - timedelta(days=730)  # 2 years

                logger.info(f"[FULL RESYNC] Date range: {start_date} to {end_date}")

                # Use historical transaction fetch
                historical_result = plaid_client.get_historical_transactions(
                    access_token=access_token,
                    start_date=start_date.strftime('%Y-%m-%d'),
                    end_date=end_date.strftime('%Y-%m-%d'),
                    count=500,
                    offset=0
                )

                if not historical_result:
                    raise Exception("Failed to fetch historical transactions from Plaid")

                # Collect raw Plaid API responses for debug logging
                all_raw_responses = [historical_result.get('raw_response', {})]

                # Convert to sync_result format (added transactions)
                sync_result = {
                    "added": historical_result.get('transactions', []),
                    "modified": [],
                    "removed": [],
                    "next_cursor": None,  # We'll get a cursor later from sync API
                    "has_more": len(historical_result.get('transactions', [])) < historical_result.get('total_transactions', 0),
                }

                # If there are more transactions, fetch them
                total_fetched = len(sync_result["added"])
                total_available = historical_result.get('total_transactions', 0)

                while sync_result["has_more"]:
                    logger.info(f"[FULL RESYNC] Fetching more transactions (offset: {total_fetched}/{total_available})")
                    update_stage("fetching_historical", {
                        "message": f"Fetching transaction history... ({total_fetched}/{total_available})",
                        "current": total_fetched,
                        "total": total_available
                    })

                    historical_result = plaid_client.get_historical_transactions(
                        access_token=access_token,
                        start_date=start_date.strftime('%Y-%m-%d'),
                        end_date=end_date.strftime('%Y-%m-%d'),
                        count=500,
                        offset=total_fetched
                    )

                    if not historical_result:
                        break

                    # Collect raw response from this page
                    all_raw_responses.append(historical_result.get('raw_response', {}))

                    new_transactions = historical_result.get('transactions', [])
                    sync_result["added"].extend(new_transactions)
                    total_fetched = len(sync_result["added"])
                    sync_result["has_more"] = total_fetched < total_available

                logger.info(f"[FULL RESYNC] Fetched {len(sync_result['added'])} historical transactions")

                # Security: Save Plaid full sync payload for debugging only if debug mode is enabled
                if settings.PLAID_DEBUG_MODE:
                    try:
                        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
                        debug_file = PLAID_DEBUG_DIR / f"full_sync_{user_id}_{plaid_item_id}_{timestamp}.json"
                        debug_data = {
                            "timestamp": datetime.utcnow().isoformat(),
                            "user_id": user_id,
                            "plaid_item_id": plaid_item_id,
                            "institution_name": plaid_item.institution_name,
                            "sync_type": "full_resync",
                            "date_range": {
                                "start": start_date.isoformat(),
                                "end": end_date.isoformat()
                            },
                            "pagination_info": {
                                "total_api_calls": len(all_raw_responses),
                                "total_transactions_fetched": len(sync_result['added'])
                            },
                            "raw_plaid_responses": all_raw_responses  # Save ALL raw Plaid API responses (one per page)
                        }
                        with open(debug_file, 'w') as f:
                            json.dump(debug_data, f, indent=2, default=str)
                        logger.info(
                            f"[FULL RESYNC] Saved {len(all_raw_responses)} raw Plaid API responses "
                            f"({len(sync_result['added'])} total transactions) to {debug_file}"
                        )
                    except Exception as debug_error:
                        logger.warning(f"Failed to save debug payload: {debug_error}")

                # IMPORTANT: For full resync, we DO NOT delete existing Plaid transactions
                # Instead, we upsert them during processing (update if exists, insert if new)
                # This preserves older transactions that Plaid's historical API no longer returns
                # but were previously synced via the incremental sync API
                logger.info(
                    f"[FULL RESYNC] Will upsert transactions (update existing, insert new) "
                    f"to preserve older Plaid transactions that may not be returned by historical API"
                )
            else:
                # Regular incremental sync using cursor
                cursor_record = db.query(PlaidSyncCursor).filter(
                    PlaidSyncCursor.plaid_item_id == plaid_item_id
                ).first()
                cursor = cursor_record.cursor if cursor_record else None

                sync_type = "incremental" if cursor else "initial"
                update_stage("fetching", {
                    "message": f"Fetching transactions from {plaid_item.institution_name} ({sync_type} sync)...",
                    "current": 0,
                    "total": 0
                })

                # Sync transactions from Plaid
                sync_result = plaid_client.sync_transactions(
                    access_token=access_token,
                    cursor=cursor,
                    count=500
                )

                if not sync_result:
                    raise Exception("Failed to sync transactions from Plaid")

                # Check if login is required (credentials expired or changed)
                if sync_result.get('login_required'):
                    error_msg = sync_result.get('error_message', 'Login required - please re-link your account')
                    logger.error(f"[PLAID SYNC] {error_msg}")

                    # Update PlaidItem status
                    plaid_item.status = "login_required"
                    plaid_item.error_message = error_msg
                    db.commit()

                    raise Exception(error_msg)

                # Check if cursor reset is required (transaction data changed during pagination)
                if sync_result.get('cursor_reset_required'):
                    logger.warning(f"[PLAID SYNC] Cursor reset required - transaction data changed during pagination")
                    logger.info(f"[PLAID SYNC] Resetting cursor and retrying sync from the beginning...")

                    # Delete the old cursor to force a fresh sync
                    sync_cursor = db.query(PlaidSyncCursor).filter(
                        PlaidSyncCursor.plaid_item_id == plaid_item_id
                    ).first()

                    if sync_cursor:
                        db.delete(sync_cursor)
                        db.commit()
                        logger.info(f"[PLAID SYNC] Deleted old cursor, will restart from beginning")

                    # Retry the sync with null cursor
                    sync_result = plaid_client.sync_transactions(
                        access_token=access_token,
                        cursor=None,  # Start fresh
                        count=500
                    )

                    if not sync_result:
                        raise Exception("Failed to sync transactions from Plaid after cursor reset")

                    if sync_result.get('cursor_reset_required'):
                        # If it fails again, give up
                        raise Exception("Transaction data keeps changing - please try again later")

                # Security: Save Plaid incremental sync payload for debugging only if debug mode is enabled
                if settings.PLAID_DEBUG_MODE:
                    try:
                        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
                        debug_file = PLAID_DEBUG_DIR / f"incremental_sync_{user_id}_{plaid_item_id}_{timestamp}.json"
                        debug_data = {
                            "timestamp": datetime.utcnow().isoformat(),
                            "user_id": user_id,
                            "plaid_item_id": plaid_item_id,
                            "institution_name": plaid_item.institution_name,
                            "sync_type": sync_type,
                            "had_cursor": cursor is not None,
                            "raw_plaid_response": sync_result.get('raw_response', {})  # Save raw Plaid API response
                        }
                        with open(debug_file, 'w') as f:
                            json.dump(debug_data, f, indent=2, default=str)
                        logger.info(
                            f"[INCREMENTAL SYNC] Saved raw Plaid API response to {debug_file}: "
                            f"{len(sync_result.get('added', []))} added, "
                            f"{len(sync_result.get('modified', []))} modified, "
                            f"{len(sync_result.get('removed', []))} removed"
                        )
                    except Exception as debug_error:
                        logger.warning(f"Failed to save debug payload: {debug_error}")

            # Get PlaidAccount mappings
            plaid_accounts = db.query(PlaidAccount).filter(
                PlaidAccount.plaid_item_id == plaid_item_id
            ).all()

            plaid_account_map = {
                pa.plaid_account_id: pa.account_id
                for pa in plaid_accounts
            }

            # Create transaction mapper
            mapper = create_mapper(db)

            # Process transactions
            added_count = 0
            modified_count = 0
            removed_count = 0
            duplicate_count = 0
            expense_count = 0

            total_transactions = len(sync_result['added']) + len(sync_result['modified']) + len(sync_result['removed'])

            update_stage("processing", {
                "message": f"Processing {total_transactions} transactions...",
                "current": 0,
                "total": total_transactions,
                "added": 0,
                "modified": 0,
                "removed": 0,
                "duplicates": 0
            })

            # Process added transactions
            for idx, plaid_txn in enumerate(sync_result['added'], 1):
                plaid_account_id = plaid_txn['account_id']
                account_id = plaid_account_map.get(plaid_account_id)

                if not account_id:
                    logger.warning(f"Account not found for Plaid account {plaid_account_id}")
                    continue

                # Get account details
                account = db.query(Account).filter(Account.id == account_id).first()
                if not account:
                    continue

                account_type = account.account_type.value

                # Map to our transaction format
                txn_data = mapper.map_transaction(plaid_txn, account_id, account_type)

                # Check if transaction already exists by plaid_transaction_id (upsert logic)
                existing_txn = db.query(Transaction).filter(
                    Transaction.plaid_transaction_id == txn_data['plaid_transaction_id']
                ).first()

                if existing_txn:
                    # Update existing transaction
                    existing_txn.date = txn_data['date']
                    existing_txn.type = txn_data['type']
                    existing_txn.total = txn_data['total']
                    existing_txn.description = txn_data.get('description')
                    existing_txn.pfc_primary = txn_data.get('pfc_primary')
                    existing_txn.pfc_detailed = txn_data.get('pfc_detailed')
                    existing_txn.pfc_confidence = txn_data.get('pfc_confidence')
                    existing_txn.import_sequence = idx
                    transaction = existing_txn
                    modified_count += 1
                    logger.debug(f"Updated existing transaction: {plaid_txn['transaction_id']}")
                else:
                    # No duplicate detection - use upsert with plaid_transaction_id as unique key
                    # Cleanup overlapping logic will handle removing non-Plaid duplicates

                    # Create new transaction
                    transaction = Transaction(
                        id=str(uuid.uuid4()),
                        account_id=account_id,
                        date=txn_data['date'],
                        type=txn_data['type'],
                        total=txn_data['total'],
                        description=txn_data.get('description'),
                        source=txn_data['source'],
                        plaid_transaction_id=txn_data['plaid_transaction_id'],
                        pfc_primary=txn_data.get('pfc_primary'),
                        pfc_detailed=txn_data.get('pfc_detailed'),
                        pfc_confidence=txn_data.get('pfc_confidence'),
                        import_sequence=idx  # Preserve order from Plaid API
                    )
                    db.add(transaction)
                    added_count += 1
                    logger.debug(f"Created new transaction: {plaid_txn['transaction_id']}")

                # Create or update expense records only for checking and credit card accounts
                # These appear in the Cashflow section for expense/income tracking
                expense_account_types = ['checking', 'credit_card']
                if account_type in expense_account_types:
                    expense_data = mapper.map_to_expense(
                        plaid_txn,
                        account_id,
                        transaction.id,
                        txn_data['type']  # Pass transaction type
                    )

                    if expense_data:
                        # Check if expense already exists for this transaction
                        existing_expense = db.query(Expense).filter(
                            Expense.transaction_id == transaction.id
                        ).first()

                        if existing_expense:
                            # Update existing expense
                            existing_expense.date = expense_data['date']
                            existing_expense.type = expense_data['type']
                            existing_expense.description = expense_data['description']
                            existing_expense.amount = expense_data['amount']
                            # Don't overwrite category if user has manually set it
                            if not existing_expense.category or existing_expense.category == 'Uncategorized':
                                existing_expense.category = expense_data.get('category')
                            existing_expense.pfc_primary = expense_data.get('pfc_primary')
                            existing_expense.pfc_detailed = expense_data.get('pfc_detailed')
                            existing_expense.pfc_confidence = expense_data.get('pfc_confidence')
                        else:
                            # Create new expense
                            expense = Expense(
                                id=str(uuid.uuid4()),
                                account_id=account_id,
                                transaction_id=transaction.id,
                                date=expense_data['date'],
                                type=expense_data['type'],  # Store transaction type
                                description=expense_data['description'],
                                amount=expense_data['amount'],
                                category=expense_data.get('category'),
                                notes=None,
                                pfc_primary=expense_data.get('pfc_primary'),
                                pfc_detailed=expense_data.get('pfc_detailed'),
                                pfc_confidence=expense_data.get('pfc_confidence')
                            )
                            db.add(expense)
                            expense_count += 1

                # Update progress every 10 transactions or at milestones
                if idx % 10 == 0 or idx == len(sync_result['added']):
                    update_stage("processing", {
                        "message": f"Processing transactions ({idx + modified_count}/{total_transactions})...",
                        "current": idx + modified_count,
                        "total": total_transactions,
                        "added": added_count,
                        "modified": modified_count,
                        "removed": removed_count,
                        "duplicates": duplicate_count
                    })

            # Process modified transactions
            for idx, plaid_txn in enumerate(sync_result['modified'], 1):
                # Find existing transaction by Plaid ID
                existing_txn = db.query(Transaction).filter(
                    Transaction.plaid_transaction_id == plaid_txn['transaction_id']
                ).first()

                if existing_txn:
                    plaid_account_id = plaid_txn['account_id']
                    account_id = plaid_account_map.get(plaid_account_id)

                    if not account_id:
                        continue

                    account = db.query(Account).filter(Account.id == account_id).first()
                    if not account:
                        continue

                    # Map updated transaction
                    txn_data = mapper.map_transaction(
                        plaid_txn,
                        account_id,
                        account.account_type.value
                    )

                    # Update transaction fields
                    existing_txn.date = txn_data['date']
                    existing_txn.type = txn_data['type']
                    existing_txn.total = txn_data['total']
                    existing_txn.description = txn_data.get('description')

                    modified_count += 1

                # Update progress every 10 transactions
                if idx % 10 == 0 or idx == len(sync_result['modified']):
                    current = len(sync_result['added']) + idx
                    update_stage("processing", {
                        "message": f"Processing transactions ({current}/{total_transactions})...",
                        "current": current,
                        "total": total_transactions,
                        "added": added_count,
                        "modified": modified_count,
                        "removed": removed_count,
                        "duplicates": duplicate_count
                    })

            # Process removed transactions
            for idx, removed in enumerate(sync_result['removed'], 1):
                plaid_txn_id = removed['transaction_id']

                # Find and delete transaction
                existing_txn = db.query(Transaction).filter(
                    Transaction.plaid_transaction_id == plaid_txn_id
                ).first()

                if existing_txn:
                    # Delete associated expense if exists
                    db.query(Expense).filter(
                        Expense.transaction_id == existing_txn.id
                    ).delete()

                    # Delete transaction
                    db.delete(existing_txn)
                    removed_count += 1

                # Update progress every 10 transactions
                if idx % 10 == 0 or idx == len(sync_result['removed']):
                    current = len(sync_result['added']) + len(sync_result['modified']) + idx
                    update_stage("processing", {
                        "message": f"Processing transactions ({current}/{total_transactions})...",
                        "current": current,
                        "total": total_transactions,
                        "added": added_count,
                        "modified": modified_count,
                        "removed": removed_count,
                        "duplicates": duplicate_count
                    })

            # Update or create cursor
            update_stage("finalizing", {
                "message": "Saving sync state...",
                "current": total_transactions,
                "total": total_transactions
            })

            # For full resync, establish a new cursor from current state
            if full_resync:
                logger.info(f"[FULL RESYNC] Establishing new sync cursor")
                # Call sync API once without cursor to establish new cursor position
                fresh_sync = plaid_client.sync_transactions(
                    access_token=access_token,
                    cursor=None,  # No cursor = establish new one
                    count=1  # Just need the cursor, not more transactions
                )

                if fresh_sync and fresh_sync.get('next_cursor'):
                    next_cursor = fresh_sync['next_cursor']
                    logger.info(f"[FULL RESYNC] New cursor established: {next_cursor[:50]}...")
                else:
                    logger.warning("[FULL RESYNC] Failed to establish new cursor, will use incremental sync next time")
                    next_cursor = None
            else:
                next_cursor = sync_result['next_cursor']

            # Re-fetch cursor_record in case it was deleted during full resync
            cursor_record = db.query(PlaidSyncCursor).filter(
                PlaidSyncCursor.plaid_item_id == plaid_item_id
            ).first()

            if next_cursor:
                if cursor_record:
                    cursor_record.cursor = next_cursor
                    cursor_record.last_sync = datetime.utcnow()
                else:
                    new_cursor = PlaidSyncCursor(
                        id=str(uuid.uuid4()),
                        plaid_item_id=plaid_item_id,
                        cursor=next_cursor,
                        last_sync=datetime.utcnow()
                    )
                    db.add(new_cursor)
            else:
                logger.warning("No cursor to save - this may cause issues on next sync")

            # Update PlaidItem last_synced
            plaid_item.last_synced = datetime.utcnow()
            plaid_item.status = "active"
            plaid_item.error_message = None

            # Commit regular transaction changes
            db.commit()

            # Check if there are more regular transactions to fetch
            has_more = sync_result.get('has_more', False)
            if has_more:
                update_stage("fetching", {
                    "message": "Fetching additional transactions...",
                    "current": total_transactions,
                    "total": total_transactions
                })
                logger.info(f"More transactions available for item {plaid_item_id}, continuing sync...")
                # Recursively call to get more transactions
                # In production, you might want to limit recursion depth
                return run_plaid_sync_job(user_id, plaid_item_id)

            # Sync investment transactions for investment accounts
            update_stage("fetching_investments", {
                "message": "Checking for investment transactions...",
                "current": 0,
                "total": 0
            })

            # Pass replay data if available
            investment_replay_data = None
            if replay_mode and replay_data and 'investment_transactions' in replay_data:
                investment_replay_data = replay_data['investment_transactions']

            investment_added = _sync_investment_transactions(
                db=db,
                plaid_item=plaid_item,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map,
                mapper=mapper,
                update_stage=update_stage,
                full_resync=full_resync,
                replay_data=investment_replay_data
            )

            # Commit investment transaction changes
            db.commit()

            added_count += investment_added

            # Fetch investment holdings once and reuse for multiple operations
            # This avoids making 3 separate API calls to Plaid
            # In replay mode, use saved data instead
            if replay_mode and replay_data and 'holdings' in replay_data:
                logger.info("[REPLAY] Using saved holdings data instead of calling Plaid API")
                holdings_debug_data = replay_data['holdings']
                holdings_data = plaid_replay.extract_holdings_from_debug_data(holdings_debug_data)
            else:
                logger.info("[HOLDINGS] Fetching investment holdings data (will be reused for sync, validation, and balance updates)")
                access_token = encryption_service.decrypt(plaid_item.access_token)
                holdings_data = plaid_client.get_investment_holdings(access_token)

            # Sync investment holdings/positions for investment accounts
            update_stage("syncing_holdings", {
                "message": "Syncing investment positions...",
                "current": 0,
                "total": 0
            })

            holdings_synced = _sync_investment_holdings(
                db=db,
                plaid_item=plaid_item,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map,
                update_stage=update_stage,
                holdings_data=holdings_data  # Pass pre-fetched data
            )

            # Commit holdings changes
            db.commit()

            logger.info(f"Synced {holdings_synced} investment holdings")

            # Update opening balances for accounts (only on first sync)
            update_stage("updating_balances", {
                "message": "Updating account opening balances...",
                "current": 0,
                "total": len(plaid_accounts)
            })

            _update_opening_balances(
                db=db,
                plaid_item=plaid_item,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map,
                holdings_data=holdings_data  # Pass pre-fetched data
            )

            # Update first Plaid transaction date for accounts
            # This runs on every sync to ensure the field is up-to-date
            _update_first_plaid_transaction_date(
                db=db,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map
            )

            # Clean up overlapping non-Plaid transactions after updating first Plaid transaction date
            # This ensures Plaid data takes precedence over statement imports for the covered period
            _cleanup_overlapping_transactions(
                db=db,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map
            )

            # Expire all objects in session to prevent StaleDataError
            # after cleanup deleted transactions
            db.expire_all()

            db.commit()

            update_stage("completed", {
                "message": "Sync completed successfully!",
                "added": added_count,
                "modified": modified_count,
                "removed": removed_count,
                "duplicates_skipped": duplicate_count,
                "expenses_created": expense_count,
                "holdings_synced": holdings_synced
            })

            result = {
                "status": "success",
                "added": added_count,
                "modified": modified_count,
                "removed": removed_count,
                "duplicates_skipped": duplicate_count,
                "expenses_created": expense_count,
                "holdings_synced": holdings_synced,
                "has_more": has_more
            }

            logger.info(
                f"Plaid sync completed for item {plaid_item_id}: "
                f"{added_count} added, {modified_count} modified, "
                f"{removed_count} removed, {duplicate_count} duplicates skipped, "
                f"{expense_count} expenses created, {holdings_synced} holdings synced"
            )

            return result

    except Exception as exc:
        update_stage("failed", {"message": f"Sync failed: {str(exc)}"})
        logger.exception(f"Plaid sync job failed for item {plaid_item_id}")

        # Update PlaidItem status (unless already set by specific error handler)
        try:
            with get_db_context() as db:
                plaid_item = db.query(PlaidItem).filter(
                    PlaidItem.id == plaid_item_id
                ).first()

                if plaid_item:
                    # Only update if status hasn't been set to a specific error state
                    if plaid_item.status not in ["login_required"]:
                        plaid_item.status = "error"
                        plaid_item.error_message = str(exc)
                        db.commit()
        except Exception as update_exc:
            logger.error(f"Failed to update PlaidItem status: {update_exc}")

        raise exc


def _sync_investment_transactions(db, plaid_item, plaid_accounts, plaid_account_map, mapper, update_stage, full_resync=False, replay_data=None):
    """
    Sync investment transactions for investment accounts

    Args:
        db: Database session
        plaid_item: PlaidItem record
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
        mapper: Transaction mapper
        update_stage: Function to update job stage
        full_resync: If True, fetch 2 years of historical data instead of 90 days
        replay_data: Optional debug data for replay mode (if provided, won't call Plaid API)

    Returns:
        Number of investment transactions added
    """
    logger.info(f"[INVESTMENT SYNC] Starting investment sync for item {plaid_item.id}")
    logger.info(f"[INVESTMENT SYNC] Total plaid_accounts to check: {len(plaid_accounts)}")
    for pa in plaid_accounts:
        logger.info(f"[INVESTMENT SYNC]   Account: {pa.name}, type: {pa.type}, subtype: {pa.subtype}")

    # Filter to only investment accounts
    investment_accounts = [
        pa for pa in plaid_accounts
        if pa.type == 'investment'
    ]

    logger.info(f"[INVESTMENT SYNC] Filtered to {len(investment_accounts)} investment accounts")

    if not investment_accounts:
        logger.warning("[INVESTMENT SYNC] No investment accounts found, skipping investment sync")
        return 0

    logger.info(f"[INVESTMENT SYNC DEBUG] Found {len(investment_accounts)} investment accounts to sync")
    for inv_acc in investment_accounts:
        logger.info(f"  - {inv_acc.name} ({inv_acc.type}/{inv_acc.subtype})")

    # Get investment transactions - either from replay data or from Plaid API
    if replay_data:
        # REPLAY MODE: Use saved data
        logger.info(f"[REPLAY] Using saved investment transaction data instead of calling Plaid API")

        investment_result = plaid_replay.extract_investment_transactions_from_debug_data(replay_data)

        transactions = investment_result.get('transactions', [])
        securities = {sec['security_id']: sec for sec in investment_result.get('securities', [])}
        investment_accounts_data = investment_result.get('accounts', [])

        logger.info(
            f"[REPLAY] Extracted {len(transactions)} investment transactions, "
            f"{len(securities)} securities, {len(investment_accounts_data)} accounts from debug data"
        )

        # Skip to processing transactions
        all_transactions = transactions
        all_securities = securities
        all_raw_responses = []  # No raw responses in replay mode

    else:
        # NORMAL MODE: Fetch from Plaid API
        # For full resync: fetch 2 years of history (matching regular transaction behavior)
        # For incremental: fetch last 90 days to avoid API timeouts
        end_date = datetime.now().date()
        if full_resync:
            start_date = end_date - timedelta(days=730)  # 2 years for full resync
            logger.info(f"[INVESTMENT SYNC] Full resync mode - fetching 2 years of investment transactions")
        else:
            start_date = end_date - timedelta(days=90)  # 90 days for incremental sync
            logger.info(f"[INVESTMENT SYNC] Incremental mode - fetching 90 days of investment transactions")

        start_date_str = start_date.strftime('%Y-%m-%d')
        end_date_str = end_date.strftime('%Y-%m-%d')

        logger.info(f"[INVESTMENT SYNC DEBUG] Fetching investment transactions from {start_date_str} to {end_date_str}")
        logger.info(f"[INVESTMENT SYNC] Calling plaid_client.get_investment_transactions()...")

        # Fetch investment transactions with pagination
        # Security: Decrypt access token before using
        access_token = encryption_service.decrypt(plaid_item.access_token)

        # Fetch first batch
        investment_result = plaid_client.get_investment_transactions(
            access_token=access_token,
            start_date=start_date_str,
            end_date=end_date_str,
            count=500,
            offset=0
        )

        logger.info(f"[INVESTMENT SYNC] API call completed, result is: {type(investment_result).__name__ if investment_result else 'None'}")

        if not investment_result:
            logger.error("[INVESTMENT SYNC] Failed to fetch investment transactions - result is None!")
            logger.error("[INVESTMENT SYNC] This usually means the Plaid API call failed. Check logs above for Plaid API errors.")
            return 0

        # Collect all transactions, securities, and accounts
        # Store BOTH raw Plaid responses AND formatted data
        all_transactions = investment_result.get('transactions', [])
        all_securities = {sec['security_id']: sec for sec in investment_result.get('securities', [])}
        investment_accounts_data = investment_result.get('accounts', [])
        total_available = investment_result.get('total_transactions', 0)

        # Collect raw Plaid API responses for debug logging
        all_raw_responses = [investment_result.get('raw_response', {})]

        # Fetch remaining pages if there are more transactions
        total_fetched = len(all_transactions)

        while total_fetched < total_available:
            logger.info(f"[INVESTMENT SYNC] Fetching more investment transactions (offset: {total_fetched}/{total_available})")

            investment_result = plaid_client.get_investment_transactions(
                access_token=access_token,
                start_date=start_date_str,
                end_date=end_date_str,
                count=500,
                offset=total_fetched
            )

            if not investment_result:
                logger.warning(f"[INVESTMENT SYNC] Failed to fetch page at offset {total_fetched}, stopping pagination")
                break

            new_transactions = investment_result.get('transactions', [])
            if not new_transactions:
                logger.warning(f"[INVESTMENT SYNC] No more transactions returned at offset {total_fetched}, stopping pagination")
                break

            all_transactions.extend(new_transactions)

            # Merge securities (new ones might appear in later pages)
            new_securities = {sec['security_id']: sec for sec in investment_result.get('securities', [])}
            all_securities.update(new_securities)

            # Collect raw response from this page
            all_raw_responses.append(investment_result.get('raw_response', {}))

            total_fetched = len(all_transactions)
            logger.info(f"[INVESTMENT SYNC] Fetched {len(new_transactions)} more transactions, total so far: {total_fetched}/{total_available}")

    # Common processing for both replay and normal mode
    transactions = all_transactions
    securities = all_securities

    logger.info(f"[INVESTMENT SYNC DEBUG] Retrieved {len(transactions)} investment transactions")
    logger.info(f"[INVESTMENT SYNC DEBUG] Retrieved {len(securities)} securities")
    logger.info(f"[INVESTMENT SYNC DEBUG] Retrieved {len(investment_accounts_data)} accounts from investment API")

    # Log account balances from investment API
    for inv_acc in investment_accounts_data:
        if inv_acc.get('type') in ['investment', 'brokerage']:
            logger.info(f"[INVESTMENT API ACCOUNT] {inv_acc.get('name')}: balances = {inv_acc.get('balances')}")

    # Security: Save Plaid investment sync payload for debugging only if debug mode is enabled
    if settings.PLAID_DEBUG_MODE:
        try:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            debug_file = PLAID_DEBUG_DIR / f"investment_sync_{plaid_item.user_id}_{plaid_item.id}_{timestamp}.json"
            debug_data = {
                "timestamp": datetime.utcnow().isoformat(),
                "user_id": plaid_item.user_id,
                "plaid_item_id": plaid_item.id,
                "institution_name": plaid_item.institution_name,
                "sync_type": "investment",
                "sync_mode": "full_resync" if full_resync else "incremental",
                "date_range": {
                    "start": start_date_str,
                    "end": end_date_str
                },
                "pagination_info": {
                    "total_api_calls": len(all_raw_responses),
                    "total_transactions_fetched": len(transactions)
                },
                "raw_plaid_responses": all_raw_responses  # Save ALL raw Plaid API responses (one per page)
            }
            with open(debug_file, 'w') as f:
                json.dump(debug_data, f, indent=2, default=str)
            logger.info(
                f"[INVESTMENT SYNC] Saved {len(all_raw_responses)} raw Plaid API responses "
                f"({len(transactions)} total transactions) to {debug_file}"
            )
        except Exception as debug_error:
            logger.warning(f"Failed to save investment sync debug payload: {debug_error}")

    # Log sample of transactions if any
    if transactions:
        sample = transactions[:3]
        logger.info(f"[INVESTMENT SYNC DEBUG] Sample transactions:")
        for txn in sample:
            logger.info(f"  - {txn.get('date')} {txn.get('type')} {txn.get('name')} ${txn.get('amount')}")

    added_count = 0

    for idx, inv_txn in enumerate(transactions, 1):
        plaid_account_id = inv_txn['account_id']
        account_id = plaid_account_map.get(plaid_account_id)

        if not account_id:
            logger.warning(f"Account not found for Plaid account {plaid_account_id}")
            continue

        # Get security info
        security = securities.get(inv_txn.get('security_id'))
        ticker = None
        if security:
            ticker = security.get('ticker_symbol')

        # Parse date - Plaid SDK may return string or date object
        txn_date = inv_txn['date']
        if isinstance(txn_date, str):
            txn_date = datetime.strptime(txn_date, '%Y-%m-%d').date()
        elif not isinstance(txn_date, type(datetime.now().date())):
            # If it's some other type, convert to string first then parse
            txn_date = datetime.strptime(str(txn_date), '%Y-%m-%d').date()

        # Get the raw amount from Plaid and determine transaction type
        # Plaid uses positive for debits (buys/withdrawals), negative for credits (sells/deposits)
        # We convert to our convention: positive = money in, negative = money out
        raw_amount = inv_txn.get('amount', 0)
        plaid_type = str(inv_txn.get('type', '')).lower()
        plaid_subtype = str(inv_txn.get('subtype', '')).lower()

        # Investment transaction amount handling depends on type and subtype:
        # Plaid often sends deposits/earnings with negative amounts, but we need to trust the subtype
        #
        # IMPORTANT: For cash transactions, trust the subtype field, not the amount sign:
        # - subtype "deposit" or contains earnings/income keywords → always POSITIVE (money IN)
        # - subtype "withdrawal" → keep as-is or make NEGATIVE (money OUT)
        # - Other types (buy/sell/dividend/interest) → negate the amount

        if plaid_type == 'cash':
            # Check subtype to determine if it's money in or out
            income_keywords = ['deposit', 'earning', 'income', 'interest', 'dividend', 'refund', 'rebate']
            is_income = any(keyword in plaid_subtype for keyword in income_keywords)

            if is_income:
                # Deposits, earnings, dividends, interest should always be positive (money IN)
                # If Plaid sends negative amount, negate it to make positive
                transaction_amount = abs(raw_amount)
            else:
                # Withdrawals, fees should always be negative (money OUT)
                # If Plaid sends positive amount, negate it to make negative
                transaction_amount = -abs(raw_amount)
        else:
            # For buy, sell, transfer, etc., negate the amount
            # Plaid: buy=positive (debit), sell=negative (credit)
            # Ours: money out=negative, money in=positive
            transaction_amount = -raw_amount

        # Determine transaction type based on amount using transaction_classifier
        from app.services.transaction_classifier import transaction_classifier
        txn_type = transaction_classifier.classify_transaction(transaction_amount)

        # Check if transaction already exists (upsert logic)
        existing_txn = db.query(Transaction).filter(
            Transaction.plaid_transaction_id == inv_txn['transaction_id']
        ).first()

        if existing_txn:
            # Update existing transaction
            existing_txn.date = txn_date
            existing_txn.type = txn_type
            existing_txn.total = transaction_amount
            existing_txn.description = inv_txn.get('name')
            existing_txn.import_sequence = idx
            transaction = existing_txn
            logger.debug(f"Updated existing investment transaction: {inv_txn['transaction_id']}")
        else:
            # Create new transaction
            transaction = Transaction(
                id=str(uuid.uuid4()),
                account_id=account_id,
                date=txn_date,
                type=txn_type,
                total=transaction_amount,
                description=inv_txn.get('name'),
                source='plaid',
                plaid_transaction_id=inv_txn['transaction_id'],
                import_sequence=idx  # Preserve order from Plaid API
            )
            db.add(transaction)
            added_count += 1
            logger.debug(f"Created new investment transaction: {inv_txn['transaction_id']}")

        # If this is a dividend or cash distribution (Money In with ticker), create a record in the dividends table
        # Dividends from ETFs/stocks appear as Money In transactions with a ticker symbol
        if txn_type == 'Money In' and ticker and plaid_type in ['dividend', 'cash']:
            # Check if dividend already exists (by plaid_transaction_id or unique combination)
            # We use ticker+date+amount+account_id as a unique identifier since dividends don't have plaid_transaction_id field
            existing_dividend = db.query(Dividend).filter(
                Dividend.account_id == account_id,
                Dividend.ticker == ticker,
                Dividend.date == datetime.combine(txn_date, datetime.min.time()),
                Dividend.amount == transaction_amount
            ).first()

            if not existing_dividend:
                dividend = Dividend(
                    id=str(uuid.uuid4()),
                    account_id=account_id,
                    ticker=ticker,
                    date=datetime.combine(txn_date, datetime.min.time()),
                    amount=transaction_amount,  # Use the corrected (positive) amount
                    currency='CAD',  # Default to CAD, could be extracted from security if available
                    statement_id=None  # Plaid imports don't have statements
                )
                db.add(dividend)
                logger.debug(f"Created dividend record for {ticker}: ${transaction_amount:.2f} on {txn_date}")

        # Update progress every 10 transactions
        if idx % 10 == 0 or idx == len(transactions):
            update_stage("processing_investments", {
                "message": f"Processing investment transactions ({idx}/{len(transactions)})...",
                "current": idx,
                "total": len(transactions),
                "added": added_count
            })

    logger.info(f"Added {added_count} investment transactions")
    return added_count


def _sync_investment_holdings(db, plaid_item, plaid_accounts, plaid_account_map, update_stage, holdings_data=None):
    """
    Sync investment holdings (positions) for investment accounts

    Args:
        db: Database session
        plaid_item: PlaidItem record
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
        update_stage: Function to update job stage
        holdings_data: Optional pre-fetched holdings data from Plaid (if None, will fetch)

    Returns:
        Number of holdings synced
    """
    logger.info(f"[HOLDINGS SYNC] Starting holdings sync for item {plaid_item.id}")

    # Filter to only investment accounts
    investment_accounts = [
        pa for pa in plaid_accounts
        if pa.type == 'investment'
    ]

    logger.info(f"[HOLDINGS SYNC] Filtered to {len(investment_accounts)} investment accounts")

    if not investment_accounts:
        logger.warning("[HOLDINGS SYNC] No investment accounts found, skipping holdings sync")
        return 0

    # Fetch investment holdings from Plaid if not already provided
    if holdings_data is None:
        logger.info(f"[HOLDINGS SYNC] Calling plaid_client.get_investment_holdings()...")
        access_token = encryption_service.decrypt(plaid_item.access_token)
        try:
            holdings_data = plaid_client.get_investment_holdings(access_token)
        except Exception as e:
            logger.warning(f"[HOLDINGS SYNC] Could not fetch investment holdings: {e}")
            logger.info("[HOLDINGS SYNC] This is normal if the institution doesn't support investments product")
            return 0
    else:
        logger.info(f"[HOLDINGS SYNC] Using pre-fetched holdings data (avoiding redundant API call)")

    if not holdings_data:
        logger.warning("[HOLDINGS SYNC] No holdings data returned from Plaid")
        logger.info("[HOLDINGS SYNC] This is normal if the institution doesn't support investments product")
        return 0

    holdings = holdings_data.get('holdings', [])
    securities = {sec['security_id']: sec for sec in holdings_data.get('securities', [])}
    accounts = holdings_data.get('accounts', [])

    logger.info(f"[HOLDINGS SYNC] Retrieved {len(holdings)} holdings")
    logger.info(f"[HOLDINGS SYNC] Retrieved {len(securities)} securities")
    logger.info(f"[HOLDINGS SYNC] Retrieved {len(accounts)} accounts from holdings API")

    # Delete existing snapshots for today to avoid duplicates (keep only one snapshot per day)
    from app.database.models import PositionSnapshot
    from sqlalchemy import func, and_

    sync_timestamp = datetime.utcnow()
    today_start = sync_timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    # Get all account IDs being synced
    account_ids_to_sync = list(plaid_account_map.values())

    # Delete snapshots from today for these accounts
    deleted_count = db.query(PositionSnapshot).filter(
        and_(
            PositionSnapshot.account_id.in_(account_ids_to_sync),
            PositionSnapshot.snapshot_date >= today_start,
            PositionSnapshot.snapshot_date < today_end
        )
    ).delete(synchronize_session=False)

    if deleted_count > 0:
        logger.info(f"[HOLDINGS SYNC] Deleted {deleted_count} existing snapshots from today to avoid duplicates")
        db.commit()

    synced_count = 0

    # Track metadata added in this sync to avoid duplicates
    added_types = set()
    added_subtypes = set()
    added_sectors = set()
    added_industries = set()

    # Process each holding
    for idx, holding in enumerate(holdings):
        plaid_account_id = holding.get('account_id')
        security_id = holding.get('security_id')

        # Get the corresponding account_id from our mapping
        account_id = plaid_account_map.get(plaid_account_id)
        if not account_id:
            logger.warning(f"[HOLDINGS SYNC] No account mapping for plaid_account_id: {plaid_account_id}")
            continue

        # Get security information
        security = securities.get(security_id)
        if not security:
            logger.warning(f"[HOLDINGS SYNC] No security info for security_id: {security_id}")
            continue

        ticker = security.get('ticker_symbol') or security.get('security_id')
        name = security.get('name', ticker)
        quantity = holding.get('quantity', 0)

        # Skip cash and currency positions
        # These represent account cash balances, not actual investment positions
        is_cash_equivalent = holding.get('is_cash_equivalent', False)
        is_currency = ticker and ticker.startswith('CUR:')
        security_type_raw = security.get('type', '')
        is_cash_type = str(security_type_raw).lower() in ['cash', 'currency']

        if is_cash_equivalent or is_currency or is_cash_type:
            logger.debug(
                f"[HOLDINGS SYNC] Skipping cash/currency position: {ticker} ({name}), "
                f"is_cash_equivalent={is_cash_equivalent}, is_currency={is_currency}, "
                f"type={security_type_raw}, quantity={quantity}, value=${quantity * holding.get('institution_price', 0):.2f}"
            )
            continue

        # Get prices
        institution_price = holding.get('institution_price', 0) or 0
        close_price = security.get('close_price') or institution_price
        # Use institution_price first to respect the holding's currency
        # close_price from security metadata may be in a different currency
        price = institution_price or close_price

        # Calculate values
        cost_basis = holding.get('cost_basis') or (quantity * price)
        market_value = quantity * price

        # Extract Plaid security metadata
        security_type = security.get('type')  # equity, etf, cryptocurrency, etc.
        security_subtype = security.get('subtype')  # common stock, preferred, etc.
        sector = security.get('sector')  # Finance, Communications, etc.
        industry = security.get('industry')  # Major Banks, Major Telecommunications, etc.

        # Auto-add new metadata to our managed lists
        from app.database.models import SecurityType, SecuritySubtype, Sector, Industry
        import uuid

        if security_type and security_type not in added_types:
            existing_type = db.query(SecurityType).filter(SecurityType.name == security_type).first()
            if not existing_type:
                new_type = SecurityType(id=str(uuid.uuid4()), name=security_type)
                db.add(new_type)
                added_types.add(security_type)
                logger.info(f"[HOLDINGS SYNC] Auto-added new security type: {security_type}")
            else:
                added_types.add(security_type)

        if security_subtype and security_subtype not in added_subtypes:
            existing_subtype = db.query(SecuritySubtype).filter(SecuritySubtype.name == security_subtype).first()
            if not existing_subtype:
                new_subtype = SecuritySubtype(id=str(uuid.uuid4()), name=security_subtype)
                db.add(new_subtype)
                added_subtypes.add(security_subtype)
                logger.info(f"[HOLDINGS SYNC] Auto-added new security subtype: {security_subtype}")
            else:
                added_subtypes.add(security_subtype)

        if sector and sector not in added_sectors:
            existing_sector = db.query(Sector).filter(Sector.name == sector).first()
            if not existing_sector:
                new_sector = Sector(id=str(uuid.uuid4()), name=sector)
                db.add(new_sector)
                added_sectors.add(sector)
                logger.info(f"[HOLDINGS SYNC] Auto-added new sector: {sector}")
            else:
                added_sectors.add(sector)

        if industry and industry not in added_industries:
            existing_industry = db.query(Industry).filter(Industry.name == industry).first()
            if not existing_industry:
                new_industry = Industry(id=str(uuid.uuid4()), name=industry)
                db.add(new_industry)
                added_industries.add(industry)
                logger.info(f"[HOLDINGS SYNC] Auto-added new industry: {industry}")
            else:
                added_industries.add(industry)

        # Check for user-defined overrides
        from app.database.models import SecurityMetadataOverride
        override = db.query(SecurityMetadataOverride).filter(
            SecurityMetadataOverride.ticker == ticker,
            SecurityMetadataOverride.security_name == name
        ).first()

        if override:
            if override.custom_type:
                security_type = override.custom_type
                logger.debug(f"[HOLDINGS SYNC] Applied custom type override: {security_type}")
            if override.custom_subtype:
                security_subtype = override.custom_subtype
                logger.debug(f"[HOLDINGS SYNC] Applied custom subtype override: {security_subtype}")
            if override.custom_sector:
                sector = override.custom_sector
                logger.debug(f"[HOLDINGS SYNC] Applied custom sector override: {sector}")
            if override.custom_industry:
                industry = override.custom_industry
                logger.debug(f"[HOLDINGS SYNC] Applied custom industry override: {industry}")

        # Get price date from security or holding
        price_as_of = None
        if security.get('close_price_as_of'):
            try:
                # Convert date to datetime
                close_date = security.get('close_price_as_of')
                if isinstance(close_date, str):
                    price_as_of = datetime.strptime(close_date, '%Y-%m-%d')
                elif hasattr(close_date, 'year'):  # date object
                    price_as_of = datetime.combine(close_date, datetime.min.time())
            except Exception as e:
                logger.warning(f"[HOLDINGS SYNC] Failed to parse close_price_as_of: {e}")

        if not price_as_of and holding.get('institution_price_as_of'):
            try:
                inst_date = holding.get('institution_price_as_of')
                if isinstance(inst_date, str):
                    price_as_of = datetime.strptime(inst_date, '%Y-%m-%d')
                elif hasattr(inst_date, 'year'):  # date object
                    price_as_of = datetime.combine(inst_date, datetime.min.time())
            except Exception as e:
                logger.warning(f"[HOLDINGS SYNC] Failed to parse institution_price_as_of: {e}")

        logger.debug(f"[HOLDINGS SYNC] Processing: {ticker} - {name}, Qty: {quantity}, Price: ${price:.2f}")
        logger.debug(f"[HOLDINGS SYNC]   Type: {security_type}, Subtype: {security_subtype}, Sector: {sector}, Industry: {industry}")

        # Check if position already exists for this account and ticker
        from app.database.models import Position
        existing_position = db.query(Position).filter(
            Position.account_id == account_id,
            Position.ticker == ticker
        ).first()

        if existing_position:
            # Update existing position
            existing_position.name = name
            existing_position.quantity = quantity
            existing_position.book_value = cost_basis
            existing_position.market_value = market_value
            existing_position.last_updated = sync_timestamp
            # Update Plaid metadata
            existing_position.security_type = security_type
            existing_position.security_subtype = security_subtype
            existing_position.sector = sector
            existing_position.industry = industry
            existing_position.institution_price = institution_price
            existing_position.price_as_of = price_as_of
            existing_position.sync_date = sync_timestamp
            # Frontend compatibility fields
            existing_position.price = institution_price
            existing_position.has_live_price = institution_price is not None and institution_price > 0
            existing_position.price_source = 'plaid' if institution_price else None
            position_id = existing_position.id
            logger.debug(f"[HOLDINGS SYNC] Updated position: {ticker}")
        else:
            # Create new position
            position_id = str(uuid.uuid4())
            new_position = Position(
                id=position_id,
                account_id=account_id,
                ticker=ticker,
                name=name,
                quantity=quantity,
                book_value=cost_basis,
                market_value=market_value,
                last_updated=sync_timestamp,
                # Plaid metadata
                security_type=security_type,
                security_subtype=security_subtype,
                sector=sector,
                industry=industry,
                institution_price=institution_price,
                price_as_of=price_as_of,
                sync_date=sync_timestamp,
                # Frontend compatibility fields
                price=institution_price,
                has_live_price=institution_price is not None and institution_price > 0,
                price_source='plaid' if institution_price else None
            )
            db.add(new_position)
            logger.debug(f"[HOLDINGS SYNC] Created new position: {ticker}")

        # Create snapshot for historical tracking
        snapshot = PositionSnapshot(
            id=str(uuid.uuid4()),
            position_id=position_id,
            account_id=account_id,
            ticker=ticker,
            name=name,
            quantity=quantity,
            book_value=cost_basis,
            market_value=market_value,
            security_type=security_type,
            security_subtype=security_subtype,
            sector=sector,
            industry=industry,
            institution_price=institution_price,
            price_as_of=price_as_of,
            snapshot_date=sync_timestamp,
            created_at=sync_timestamp
        )
        db.add(snapshot)
        logger.debug(f"[HOLDINGS SYNC] Created snapshot for {ticker}")

        synced_count += 1

        if (idx + 1) % 10 == 0:
            update_stage("syncing_holdings", {
                "message": f"Syncing investment positions ({idx + 1}/{len(holdings)})...",
                "current": idx + 1,
                "total": len(holdings)
            })

    logger.info(f"[HOLDINGS SYNC] Synced {synced_count} holdings")
    return synced_count


def _map_investment_type(plaid_type) -> str:
    """
    Map Plaid investment transaction type to our transaction type

    Args:
        plaid_type: Plaid investment transaction type (InvestmentTransactionType object or string)

    Returns:
        Our transaction type (uppercase to match database enum)
    """
    type_mapping = {
        'buy': 'BUY',
        'sell': 'SELL',
        'cash': 'DEPOSIT',
        'fee': 'FEE',
        'transfer': 'TRANSFER',
        'dividend': 'DIVIDEND',
        'interest': 'INTEREST',
    }

    # Convert Plaid SDK type object to string before processing
    type_str = str(plaid_type).lower() if plaid_type else 'other'
    return type_mapping.get(type_str, 'TRANSFER')  # Default to TRANSFER for unmapped types


def _update_opening_balances(db, plaid_item, plaid_accounts, plaid_account_map, holdings_data=None):
    """
    Update account balances and transaction expected_balances after Plaid sync

    Strategy:
    - If Plaid provides balance: use it as anchor, set account.balance, calculate backward for expected_balances
    - If Plaid doesn't provide balance: find last transaction before Plaid sync, calculate forward, set account.balance to last transaction

    Args:
        db: Database session
        plaid_item: PlaidItem record
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
        holdings_data: Optional pre-fetched holdings data from Plaid (if None, will fetch)
    """
    try:
        # Security: Decrypt access token before using
        access_token = encryption_service.decrypt(plaid_item.access_token)

        # Get fresh account data from Plaid
        accounts_data = plaid_client.get_accounts(access_token)
        if not accounts_data:
            logger.warning("Could not fetch account data for opening balance update")
            return

        # Get investment holdings to extract cash balances
        investment_cash_balances = {}
        if holdings_data is None:
            logger.info("[UPDATE BALANCES] Fetching investment holdings data...")
            holdings_data = plaid_client.get_investment_holdings(access_token)
        else:
            logger.info("[UPDATE BALANCES] Using pre-fetched holdings data (avoiding redundant API call)")

        if holdings_data:
            # Use calculated cash balances (Total Account Value - Holdings Value)
            investment_cash_balances = holdings_data.get('cash_balances', {})

        # Create mapping of plaid_account_id to balance
        # For investment accounts, use available balance (cash only, since holdings are shown in portfolio)
        # For other accounts, use current balance from accounts API
        plaid_balances = {}
        for acc in accounts_data['accounts']:
            acc_type = acc.get('type')
            # Extract string value from enum-like objects
            if acc_type and hasattr(acc_type, 'value'):
                acc_type = acc_type.value
            elif acc_type:
                acc_type = str(acc_type)

            # For investment accounts, use available balance (cash only)
            # This avoids double-counting holdings which are already shown in portfolio
            if acc_type == 'investment':
                balance = acc['balances'].get('available', 0.0) or 0.0
                total_value = acc['balances'].get('current', 0.0) or 0.0
                logger.info(
                    f"[BALANCE] Investment account {acc.get('name')}: "
                    f"Available (Cash)=${balance:.2f}, Total=${total_value:.2f}"
                )
            else:
                balance = acc['balances'].get('current', 0.0) or 0.0

            plaid_balances[acc['account_id']] = balance

        # Update each account
        for plaid_account in plaid_accounts:
            account_id = plaid_account_map.get(plaid_account.plaid_account_id)
            if not account_id:
                continue

            # Get our Account record
            account = db.query(Account).filter(Account.id == account_id).first()
            if not account:
                continue

            # Get all transactions for this account
            # Sort by date (date part only), then by value DESC (credits before debits), then by ID
            from sqlalchemy import cast, Date
            transactions = db.query(Transaction).filter(
                Transaction.account_id == account_id
            ).order_by(
                cast(Transaction.date, Date).asc(),
                Transaction.total.desc(),
                Transaction.id.asc()
            ).all()

            if not transactions:
                # No transactions yet, keep current opening balance
                logger.info(f"Account {account.label} has no transactions, keeping opening balance")
                continue

            # Get current balance from Plaid (may be None or 0 if unavailable)
            current_plaid_balance = plaid_balances.get(plaid_account.plaid_account_id)

            # For credit cards and loans, Plaid returns positive balance = amount owed
            # We need to negate it so owing money = negative balance in our system
            liability_account_types = ['credit_card', 'mortgage', 'auto_loan', 'student_loan',
                                      'home_equity', 'personal_loan', 'business_loan', 'line_of_credit']
            if current_plaid_balance and account.account_type.value in liability_account_types:
                logger.info(f"Liability account {account.label} ({account.account_type.value}): negating Plaid balance ${current_plaid_balance:.2f} -> ${-current_plaid_balance:.2f}")
                current_plaid_balance = -current_plaid_balance

            # Check if Plaid balance is available (not None and not 0 for investment accounts)
            is_investment = account.account_type.value in ['investment', 'brokerage', 'rrsp', 'tfsa']
            plaid_balance_unavailable = (
                current_plaid_balance is None or
                (is_investment and current_plaid_balance == 0.0)
            )

            if plaid_balance_unavailable:
                # Plaid balance is unavailable - use last statement transaction balance as anchor
                logger.info(
                    f"[BALANCE] Plaid balance unavailable for {account.label} "
                    f"(is_investment={is_investment}, balance={current_plaid_balance})"
                )

                # Find the last transaction BEFORE the first Plaid transaction
                # This would be a statement-imported transaction with balance info
                first_plaid_txn = next((txn for txn in transactions if txn.plaid_transaction_id is not None), None)

                if first_plaid_txn:
                    # Find last statement transaction before first Plaid transaction
                    last_statement_txn = None
                    for txn in reversed(transactions):
                        if txn.date < first_plaid_txn.date and txn.plaid_transaction_id is None:
                            last_statement_txn = txn
                            break

                    if last_statement_txn and (last_statement_txn.actual_balance or last_statement_txn.expected_balance):
                        # Use the balance from the last statement transaction as anchor
                        anchor_balance = last_statement_txn.actual_balance or last_statement_txn.expected_balance
                        logger.info(
                            f"[BALANCE] Using last statement transaction balance as anchor: "
                            f"${anchor_balance:.2f} from {last_statement_txn.date}"
                        )

                        # Calculate FORWARD from anchor for all newer transactions
                        running_balance = anchor_balance
                        for txn in transactions:
                            if txn.date < last_statement_txn.date:
                                # Keep existing expected_balance for transactions before anchor
                                continue
                            elif txn.id == last_statement_txn.id:
                                # Set anchor transaction expected_balance
                                txn.expected_balance = round(anchor_balance, 2)
                            else:
                                # Calculate forward for transactions after anchor
                                running_balance += txn.total
                                txn.expected_balance = round(running_balance, 2)

                        # Set account balance to the last transaction's expected_balance
                        last_txn = transactions[-1]
                        account.balance = last_txn.expected_balance

                        logger.info(
                            f"[BALANCE] Calculated forward from anchor ${anchor_balance:.2f}, "
                            f"final account balance: ${account.balance:.2f} "
                            f"({len([t for t in transactions if t.date >= last_statement_txn.date])} transactions processed)"
                        )
                        continue

                # No anchor found, calculate from first transaction with 0 starting balance
                logger.warning(
                    f"[BALANCE] No statement transaction anchor found for {account.label}, "
                    f"calculating from first transaction with 0 starting balance"
                )
                running_balance = 0.0
                for txn in transactions:
                    running_balance += txn.total
                    txn.expected_balance = round(running_balance, 2)

                # Set account balance to the last transaction's expected_balance
                account.balance = transactions[-1].expected_balance
                logger.info(f"[BALANCE] Set account balance to ${account.balance:.2f} from last transaction")
                continue

            # Plaid balance is available - use it as anchor and calculate backward
            # Set account balance to current Plaid balance
            account.balance = current_plaid_balance

            # Calculate BACKWARD from current balance to set expected_balance on all transactions
            running_balance = current_plaid_balance
            for txn in reversed(transactions):
                txn.expected_balance = round(running_balance, 2)
                running_balance -= txn.total

            logger.info(
                f"[BALANCE] Set account balance to ${account.balance:.2f} from Plaid, "
                f"calculated backward for {len(transactions)} transactions"
            )

    except Exception as e:
        logger.error(f"Error updating opening balances: {e}", exc_info=True)
        # Don't raise - this is not critical enough to fail the entire sync


def _update_first_plaid_transaction_date(db, plaid_accounts, plaid_account_map):
    """
    Update first_plaid_transaction_date for accounts during full sync

    This tracks the earliest transaction date imported from Plaid, which helps
    understand the historical data coverage from Plaid for each account.

    Args:
        db: Database session
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
    """
    try:
        logger.info("[FIRST TXN DATE] Updating first Plaid transaction dates for accounts")

        for plaid_account in plaid_accounts:
            account_id = plaid_account_map.get(plaid_account.plaid_account_id)
            if not account_id:
                continue

            # Get our Account record
            account = db.query(Account).filter(Account.id == account_id).first()
            if not account:
                continue

            # Get the earliest Plaid transaction for this account
            # Only consider transactions with plaid_transaction_id (i.e., from Plaid)
            from sqlalchemy import cast, Date
            earliest_transaction = db.query(Transaction).filter(
                Transaction.account_id == account_id,
                Transaction.plaid_transaction_id.isnot(None)
            ).order_by(
                cast(Transaction.date, Date).asc()
            ).first()

            if earliest_transaction:
                first_date = datetime.combine(earliest_transaction.date, datetime.min.time())
                account.first_plaid_transaction_date = first_date
                logger.info(
                    f"[FIRST TXN DATE] Set first Plaid transaction date for {account.label}: "
                    f"{earliest_transaction.date}"
                )
            else:
                logger.info(
                    f"[FIRST TXN DATE] No Plaid transactions found for {account.label}, "
                    f"skipping first transaction date update"
                )

        logger.info("[FIRST TXN DATE] Completed updating first Plaid transaction dates")

    except Exception as e:
        logger.error(f"Error updating first Plaid transaction dates: {e}", exc_info=True)
        # Don't raise - this is not critical enough to fail the entire sync


def _cleanup_overlapping_transactions(db, plaid_accounts, plaid_account_map):
    """
    Delete non-Plaid transactions that overlap with Plaid transaction history during full sync

    When doing a full sync, we want to delete any manually imported or statement-imported
    transactions that fall on or after the first Plaid transaction date. This prevents
    duplicates and ensures Plaid data takes precedence for the covered period.

    Args:
        db: Database session
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
    """
    try:
        logger.info("[CLEANUP OVERLAP] Cleaning up overlapping non-Plaid transactions")

        total_deleted_transactions = 0
        total_deleted_expenses = 0

        for plaid_account in plaid_accounts:
            account_id = plaid_account_map.get(plaid_account.plaid_account_id)
            if not account_id:
                continue

            # Get our Account record
            account = db.query(Account).filter(Account.id == account_id).first()
            if not account or not account.first_plaid_transaction_date:
                continue

            first_plaid_date = account.first_plaid_transaction_date

            # Find all non-Plaid transactions on or after the first Plaid transaction date
            from sqlalchemy import cast, Date
            overlapping_transactions = db.query(Transaction).filter(
                Transaction.account_id == account_id,
                Transaction.plaid_transaction_id.is_(None),  # Non-Plaid transactions only
                cast(Transaction.date, Date) >= cast(first_plaid_date, Date)
            ).all()

            if overlapping_transactions:
                overlapping_transaction_ids = [txn.id for txn in overlapping_transactions]

                logger.info(
                    f"[CLEANUP OVERLAP] Found {len(overlapping_transactions)} non-Plaid transactions "
                    f"for {account.label} on or after {first_plaid_date.date()}"
                )

                # Delete associated expenses first
                deleted_expenses = db.query(Expense).filter(
                    Expense.transaction_id.in_(overlapping_transaction_ids)
                ).delete(synchronize_session=False)

                # Delete the overlapping transactions
                deleted_transactions = db.query(Transaction).filter(
                    Transaction.id.in_(overlapping_transaction_ids)
                ).delete(synchronize_session=False)

                total_deleted_transactions += deleted_transactions
                total_deleted_expenses += deleted_expenses

                logger.info(
                    f"[CLEANUP OVERLAP] Deleted {deleted_transactions} transactions and "
                    f"{deleted_expenses} expenses for {account.label}"
                )
            else:
                logger.info(
                    f"[CLEANUP OVERLAP] No overlapping non-Plaid transactions found for {account.label}"
                )

        if total_deleted_transactions > 0:
            logger.info(
                f"[CLEANUP OVERLAP] Total deleted: {total_deleted_transactions} transactions, "
                f"{total_deleted_expenses} expenses across all accounts"
            )
        else:
            logger.info("[CLEANUP OVERLAP] No overlapping transactions to delete")

    except Exception as e:
        logger.error(f"Error cleaning up overlapping transactions: {e}", exc_info=True)
        # Don't raise - this is not critical enough to fail the entire sync
