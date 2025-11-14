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
from app.database.models import PlaidItem, PlaidAccount, PlaidSyncCursor, Transaction, Expense, Account
from app.services.plaid_client import plaid_client
from app.services.plaid_transaction_mapper import create_mapper

logger = logging.getLogger(__name__)

# Create debug directory for Plaid payloads
PLAID_DEBUG_DIR = Path("/app/logs/plaid_debug")
PLAID_DEBUG_DIR.mkdir(parents=True, exist_ok=True)


def run_plaid_sync_job(user_id: str, plaid_item_id: str, full_resync: bool = False):
    """
    Background job to sync transactions from Plaid

    Args:
        user_id: User ID
        plaid_item_id: Plaid item ID to sync
        full_resync: If True, fetch all available historical transactions

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

            access_token = plaid_item.access_token

            # Handle full resync vs incremental sync
            if full_resync:
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

                    new_transactions = historical_result.get('transactions', [])
                    sync_result["added"].extend(new_transactions)
                    total_fetched = len(sync_result["added"])
                    sync_result["has_more"] = total_fetched < total_available

                logger.info(f"[FULL RESYNC] Fetched {len(sync_result['added'])} historical transactions")

                # Save Plaid full sync payload for debugging
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
                        "transaction_count": len(sync_result['added']),
                        "transactions": sync_result['added'][:10],  # Save only first 10 for brevity
                        "total_transactions": len(sync_result['added'])
                    }
                    with open(debug_file, 'w') as f:
                        json.dump(debug_data, f, indent=2, default=str)
                    logger.info(f"Saved Plaid full sync payload to {debug_file}")
                except Exception as debug_error:
                    logger.warning(f"Failed to save debug payload: {debug_error}")

                # Delete existing transactions and expenses for this Plaid item's accounts
                plaid_accounts = db.query(PlaidAccount).filter(
                    PlaidAccount.plaid_item_id == plaid_item_id
                ).all()
                account_ids = [pa.account_id for pa in plaid_accounts]

                if account_ids:
                    update_stage("cleaning", {
                        "message": f"Removing old transactions for {len(account_ids)} accounts...",
                        "current": 0,
                        "total": len(account_ids)
                    })

                    # Delete expenses first (they reference transactions)
                    deleted_expenses = db.query(Expense).filter(
                        Expense.account_id.in_(account_ids)
                    ).delete(synchronize_session=False)

                    # Delete transactions
                    deleted_transactions = db.query(Transaction).filter(
                        Transaction.account_id.in_(account_ids)
                    ).delete(synchronize_session=False)

                    db.commit()
                    logger.info(
                        f"[FULL RESYNC] Deleted {deleted_transactions} transactions and "
                        f"{deleted_expenses} expenses for {len(account_ids)} accounts"
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

                # Save Plaid incremental sync payload for debugging
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
                        "added_count": len(sync_result.get('added', [])),
                        "modified_count": len(sync_result.get('modified', [])),
                        "removed_count": len(sync_result.get('removed', [])),
                        "added_sample": sync_result.get('added', [])[:5],  # First 5 for sample
                        "modified_sample": sync_result.get('modified', [])[:5],
                        "removed_sample": sync_result.get('removed', [])[:5],
                        "has_more": sync_result.get('has_more', False)
                    }
                    with open(debug_file, 'w') as f:
                        json.dump(debug_data, f, indent=2, default=str)
                    logger.info(f"Saved Plaid incremental sync payload to {debug_file}")
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

                # Check for duplicates
                if mapper.is_duplicate(plaid_txn, account_id):
                    duplicate_count += 1
                    logger.debug(f"Skipping duplicate transaction: {plaid_txn['transaction_id']}")
                    continue

                # Map to our transaction format
                txn_data = mapper.map_transaction(plaid_txn, account_id, account_type)

                # Create transaction
                transaction = Transaction(
                    id=str(uuid.uuid4()),
                    account_id=account_id,
                    date=txn_data['date'],
                    type=txn_data['type'],
                    ticker=txn_data.get('ticker'),
                    quantity=txn_data.get('quantity'),
                    price=txn_data.get('price'),
                    fees=txn_data.get('fees', 0.0),
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

                # Create expense if applicable (for depository, credit, and loan accounts)
                # These account types typically have trackable expenses/payments
                expense_account_types = [
                    # Depository accounts
                    'checking', 'savings', 'money_market', 'cd', 'cash_management',
                    'prepaid', 'paypal', 'hsa', 'ebt',
                    # Credit accounts
                    'credit_card',
                    # Loan accounts (track payments)
                    'mortgage', 'auto_loan', 'student_loan', 'home_equity',
                    'personal_loan', 'business_loan', 'line_of_credit'
                ]
                if account_type in expense_account_types:
                    expense_data = mapper.map_to_expense(
                        plaid_txn,
                        account_id,
                        transaction.id
                    )

                    if expense_data:
                        expense = Expense(
                            id=str(uuid.uuid4()),
                            account_id=account_id,
                            transaction_id=transaction.id,
                            date=expense_data['date'],
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

            investment_added = _sync_investment_transactions(
                db=db,
                plaid_item=plaid_item,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map,
                mapper=mapper,
                update_stage=update_stage
            )

            # Commit investment transaction changes
            db.commit()

            added_count += investment_added

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
                plaid_account_map=plaid_account_map
            )

            # Validate transaction balances and flag inconsistencies
            _validate_transaction_balances(
                db=db,
                plaid_item=plaid_item,
                plaid_accounts=plaid_accounts,
                plaid_account_map=plaid_account_map,
                update_stage=update_stage
            )

            db.commit()

            update_stage("completed", {
                "message": "Sync completed successfully!",
                "added": added_count,
                "modified": modified_count,
                "removed": removed_count,
                "duplicates_skipped": duplicate_count,
                "expenses_created": expense_count
            })

            result = {
                "status": "success",
                "added": added_count,
                "modified": modified_count,
                "removed": removed_count,
                "duplicates_skipped": duplicate_count,
                "expenses_created": expense_count,
                "has_more": has_more
            }

            logger.info(
                f"Plaid sync completed for item {plaid_item_id}: "
                f"{added_count} added, {modified_count} modified, "
                f"{removed_count} removed, {duplicate_count} duplicates skipped, "
                f"{expense_count} expenses created"
            )

            return result

    except Exception as exc:
        update_stage("failed", {"message": f"Sync failed: {str(exc)}"})
        logger.exception(f"Plaid sync job failed for item {plaid_item_id}")

        # Update PlaidItem status
        try:
            with get_db_context() as db:
                plaid_item = db.query(PlaidItem).filter(
                    PlaidItem.id == plaid_item_id
                ).first()

                if plaid_item:
                    plaid_item.status = "error"
                    plaid_item.error_message = str(exc)
                    db.commit()
        except Exception as update_exc:
            logger.error(f"Failed to update PlaidItem status: {update_exc}")

        raise exc


def _sync_investment_transactions(db, plaid_item, plaid_accounts, plaid_account_map, mapper, update_stage):
    """
    Sync investment transactions for investment accounts

    Args:
        db: Database session
        plaid_item: PlaidItem record
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
        mapper: Transaction mapper
        update_stage: Function to update job stage

    Returns:
        Number of investment transactions added
    """
    # Filter to only investment accounts
    investment_accounts = [
        pa for pa in plaid_accounts
        if pa.type == 'investment'
    ]

    if not investment_accounts:
        logger.info("No investment accounts found, skipping investment sync")
        return 0

    logger.info(f"[INVESTMENT SYNC DEBUG] Found {len(investment_accounts)} investment accounts to sync")
    for inv_acc in investment_accounts:
        logger.info(f"  - {inv_acc.name} ({inv_acc.type}/{inv_acc.subtype})")

    # Get investment transactions for the last 5 years (maximum history available)
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=1825)  # 5 years

    start_date_str = start_date.strftime('%Y-%m-%d')
    end_date_str = end_date.strftime('%Y-%m-%d')

    logger.info(f"[INVESTMENT SYNC DEBUG] Fetching investment transactions from {start_date_str} to {end_date_str}")

    # Fetch investment transactions
    investment_result = plaid_client.get_investment_transactions(
        access_token=plaid_item.access_token,
        start_date=start_date_str,
        end_date=end_date_str
    )

    if not investment_result:
        logger.warning("[INVESTMENT SYNC DEBUG] Failed to fetch investment transactions - result is None")
        return 0

    transactions = investment_result.get('transactions', [])
    securities = {sec['security_id']: sec for sec in investment_result.get('securities', [])}

    logger.info(f"[INVESTMENT SYNC DEBUG] Retrieved {len(transactions)} investment transactions")
    logger.info(f"[INVESTMENT SYNC DEBUG] Retrieved {len(securities)} securities")

    # Save Plaid investment sync payload for debugging
    try:
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        debug_file = PLAID_DEBUG_DIR / f"investment_sync_{plaid_item.user_id}_{plaid_item.id}_{timestamp}.json"
        debug_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": plaid_item.user_id,
            "plaid_item_id": plaid_item.id,
            "institution_name": plaid_item.institution_name,
            "sync_type": "investment",
            "date_range": {
                "start": start_date_str,
                "end": end_date_str
            },
            "transaction_count": len(transactions),
            "security_count": len(securities),
            "transactions": transactions[:10],  # Save first 10 for sample
            "securities": list(securities.values())[:10]  # First 10 securities
        }
        with open(debug_file, 'w') as f:
            json.dump(debug_data, f, indent=2, default=str)
        logger.info(f"Saved Plaid investment sync payload to {debug_file}")
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

        # Check for duplicates using the investment_transaction_id
        existing = db.query(Transaction).filter(
            Transaction.plaid_transaction_id == inv_txn['transaction_id']
        ).first()

        if existing:
            logger.debug(f"Skipping duplicate investment transaction: {inv_txn['transaction_id']}")
            continue

        # Get security info
        security = securities.get(inv_txn.get('security_id'))
        ticker = None
        if security:
            ticker = security.get('ticker_symbol')

        # Map investment transaction type to our transaction type
        txn_type = _map_investment_type(inv_txn['type'])

        # Create transaction
        transaction = Transaction(
            id=str(uuid.uuid4()),
            account_id=account_id,
            date=datetime.strptime(inv_txn['date'], '%Y-%m-%d').date(),
            type=txn_type,
            ticker=ticker,
            quantity=abs(inv_txn.get('quantity', 0)),
            price=inv_txn.get('price', 0),
            fees=inv_txn.get('fees', 0),
            total=inv_txn.get('amount', 0),
            description=inv_txn.get('name'),
            source='plaid',
            plaid_transaction_id=inv_txn['transaction_id'],
            import_sequence=idx  # Preserve order from Plaid API
        )
        db.add(transaction)
        added_count += 1

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


def _map_investment_type(plaid_type: str) -> str:
    """
    Map Plaid investment transaction type to our transaction type

    Args:
        plaid_type: Plaid investment transaction type

    Returns:
        Our transaction type
    """
    type_mapping = {
        'buy': 'buy',
        'sell': 'sell',
        'cash': 'deposit',
        'fee': 'fee',
        'transfer': 'transfer',
        'dividend': 'dividend',
        'interest': 'deposit',
    }

    return type_mapping.get(plaid_type.lower(), 'other')


def _validate_transaction_balances(db, plaid_item, plaid_accounts, plaid_account_map, update_stage):
    """
    Validate transaction balances after import by calculating expected balances
    and comparing with Plaid current balance.

    This function:
    1. Calculates expected balance for each transaction chronologically
    2. Stores expected_balance in each transaction record
    3. Compares final calculated balance with Plaid current balance
    4. Flags inconsistencies if discrepancy > $1.00

    Args:
        db: Database session
        plaid_item: PlaidItem record
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
        update_stage: Function to update job stage
    """
    try:
        update_stage("validating_balances", {
            "message": "Validating transaction balances...",
            "current": 0,
            "total": len(plaid_accounts)
        })

        # Get fresh account data from Plaid
        accounts_data = plaid_client.get_accounts(plaid_item.access_token)
        if not accounts_data:
            logger.warning("Could not fetch account data for balance validation")
            return

        # Create mapping of plaid_account_id to current balance
        plaid_balances = {
            acc['account_id']: acc['balances'].get('current', 0.0) or 0.0
            for acc in accounts_data['accounts']
        }

        TOLERANCE = 1.00  # $1.00 tolerance for balance inconsistencies

        # Validate each account
        for idx, plaid_account in enumerate(plaid_accounts, 1):
            account_id = plaid_account_map.get(plaid_account.plaid_account_id)
            if not account_id:
                continue

            # Get our Account record
            account = db.query(Account).filter(Account.id == account_id).first()
            if not account:
                continue

            # Get all transactions for this account, ordered chronologically
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
                logger.info(f"Account {account.label} has no transactions, skipping validation")
                continue

            # Get opening balance
            opening_balance = account.opening_balance or 0.0

            # Calculate expected balance for each transaction
            running_balance = opening_balance
            for txn in transactions:
                running_balance += txn.total
                txn.expected_balance = round(running_balance, 2)
                # Note: actual_balance will be None for Plaid imports (Plaid doesn't provide it)
                # It will only be populated for statement imports if available
                txn.has_balance_inconsistency = False
                txn.balance_discrepancy = None

            # Get current balance from Plaid
            current_plaid_balance = plaid_balances.get(plaid_account.plaid_account_id, 0.0)

            # For credit cards and loans, Plaid returns positive balance = amount owed
            # We need to negate it so owing money = negative balance in our system
            liability_account_types = ['credit_card', 'mortgage', 'auto_loan', 'student_loan',
                                      'home_equity', 'personal_loan', 'business_loan', 'line_of_credit']
            if account.account_type.value in liability_account_types:
                current_plaid_balance = -current_plaid_balance

            # Compare final calculated balance with Plaid current balance
            final_expected_balance = running_balance
            discrepancy = abs(final_expected_balance - current_plaid_balance)

            if discrepancy > TOLERANCE:
                logger.warning(
                    f"Balance inconsistency detected for {account.label}: "
                    f"Expected: ${final_expected_balance:.2f}, "
                    f"Plaid current: ${current_plaid_balance:.2f}, "
                    f"Discrepancy: ${discrepancy:.2f}"
                )
                # Flag the last transaction as inconsistent since we can't pinpoint which one
                if transactions:
                    last_txn = transactions[-1]
                    last_txn.has_balance_inconsistency = True
                    last_txn.balance_discrepancy = round(final_expected_balance - current_plaid_balance, 2)
                    logger.info(
                        f"Flagged transaction {last_txn.id} as inconsistent "
                        f"(expected: ${last_txn.expected_balance:.2f}, discrepancy: ${last_txn.balance_discrepancy:.2f})"
                    )
            else:
                logger.info(
                    f"Balance validation passed for {account.label}: "
                    f"Expected: ${final_expected_balance:.2f}, "
                    f"Plaid: ${current_plaid_balance:.2f}, "
                    f"Discrepancy: ${discrepancy:.2f} (within tolerance)"
                )

            update_stage("validating_balances", {
                "message": f"Validating balances ({idx}/{len(plaid_accounts)})...",
                "current": idx,
                "total": len(plaid_accounts)
            })

    except Exception as e:
        logger.error(f"Error validating transaction balances: {e}", exc_info=True)
        # Don't raise - this is not critical enough to fail the entire sync


def _update_opening_balances(db, plaid_item, plaid_accounts, plaid_account_map):
    """
    Update opening balances for accounts after first sync

    The opening balance is calculated by working backwards from the current Plaid balance:
    opening_balance = current_plaid_balance - sum(all_transactions)

    Args:
        db: Database session
        plaid_item: PlaidItem record
        plaid_accounts: List of PlaidAccount records
        plaid_account_map: Mapping of plaid_account_id to account_id
    """
    try:
        # Get fresh account data from Plaid
        accounts_data = plaid_client.get_accounts(plaid_item.access_token)
        if not accounts_data:
            logger.warning("Could not fetch account data for opening balance update")
            return

        # Create mapping of plaid_account_id to current balance
        plaid_balances = {
            acc['account_id']: acc['balances'].get('current', 0.0) or 0.0
            for acc in accounts_data['accounts']
        }

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

            # Get current balance from Plaid
            current_plaid_balance = plaid_balances.get(plaid_account.plaid_account_id, 0.0)

            # For credit cards and loans, Plaid returns positive balance = amount owed
            # We need to negate it so owing money = negative balance in our system
            liability_account_types = ['credit_card', 'mortgage', 'auto_loan', 'student_loan',
                                      'home_equity', 'personal_loan', 'business_loan', 'line_of_credit']
            if account.account_type.value in liability_account_types:
                logger.info(f"Liability account {account.label} ({account.account_type.value}): negating Plaid balance ${current_plaid_balance:.2f} -> ${-current_plaid_balance:.2f}")
                current_plaid_balance = -current_plaid_balance

            # Calculate sum of all transactions
            transaction_sum = sum(txn.total for txn in transactions)

            # Calculate opening balance: current - all transactions
            opening_balance = current_plaid_balance - transaction_sum

            # Get the oldest transaction date
            oldest_transaction_date = transactions[0].date

            # Update the account's opening balance
            account.opening_balance = opening_balance
            account.opening_balance_date = datetime.combine(oldest_transaction_date, datetime.min.time())

            logger.info(
                f"Updated opening balance for {account.label}: "
                f"${opening_balance:.2f} as of {oldest_transaction_date}, "
                f"current Plaid balance: ${current_plaid_balance:.2f}, "
                f"sum of {len(transactions)} transactions: ${transaction_sum:.2f}"
            )

    except Exception as e:
        logger.error(f"Error updating opening balances: {e}", exc_info=True)
        # Don't raise - this is not critical enough to fail the entire sync
