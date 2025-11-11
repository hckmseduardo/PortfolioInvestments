"""
Plaid Transaction Sync Background Task

Handles asynchronous transaction syncing from Plaid.
"""
import logging
from typing import Optional
from datetime import datetime
import uuid

from rq import get_current_job

from app.database.postgres_db import get_db_context
from app.database.models import PlaidItem, PlaidAccount, PlaidSyncCursor, Transaction, Expense, Account
from app.services.plaid_client import plaid_client
from app.services.plaid_transaction_mapper import create_mapper

logger = logging.getLogger(__name__)


def run_plaid_sync_job(user_id: str, plaid_item_id: str):
    """
    Background job to sync transactions from Plaid

    Args:
        user_id: User ID
        plaid_item_id: Plaid item ID to sync

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
        update_stage("starting", {"message": "Initializing Plaid sync...", "current": 0, "total": 0})

        with get_db_context() as db:
            # Get Plaid item
            plaid_item = db.query(PlaidItem).filter(
                PlaidItem.id == plaid_item_id,
                PlaidItem.user_id == user_id
            ).first()

            if not plaid_item:
                raise ValueError(f"Plaid item {plaid_item_id} not found for user {user_id}")

            access_token = plaid_item.access_token

            # Get existing cursor for incremental sync
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
                    plaid_transaction_id=txn_data['plaid_transaction_id']
                )
                db.add(transaction)
                added_count += 1

                # Create expense if applicable (for checking/credit card accounts)
                if account_type in ['checking', 'credit_card', 'savings']:
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
                            notes=None
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

            next_cursor = sync_result['next_cursor']
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

            # Update PlaidItem last_synced
            plaid_item.last_synced = datetime.utcnow()
            plaid_item.status = "active"
            plaid_item.error_message = None

            # Commit all changes
            db.commit()

            # Check if there are more transactions to fetch
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
