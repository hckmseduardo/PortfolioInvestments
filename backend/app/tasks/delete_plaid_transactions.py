"""
Delete Plaid Transactions Background Task

Handles asynchronous deletion of Plaid-synced transactions.
"""
import logging
from typing import Optional
from rq import get_current_job

from app.database.postgres_db import get_db_context
from app.database.models import Account, Transaction, Expense
from app.database.db_service import get_db_service

logger = logging.getLogger(__name__)


def run_delete_plaid_transactions_job(user_id: str, account_id: str):
    """
    Background job to delete Plaid-synced transactions

    Args:
        user_id: User ID (for access control)
        account_id: Account ID to delete Plaid transactions from

    Returns:
        Dictionary with deletion results
    """
    job = get_current_job()

    def update_stage(stage: str, progress: dict = None):
        if job:
            job.meta["stage"] = stage
            if progress:
                job.meta["progress"] = progress
            job.meta["user_id"] = user_id  # For access control
            job.save_meta()
            logger.info(f"Delete Plaid transactions job {job.id} stage: {stage} progress: {progress}")

    try:
        update_stage("starting", {"message": "Getting ready to remove Plaid transactions...", "current": 0, "total": 0})
        logger.info(f"Starting delete Plaid transactions job - user: {user_id}, account: {account_id}")

        with get_db_context() as session:
            db = get_db_service(session)

            # Verify account belongs to user
            existing_account = db.find_one("accounts", {"id": account_id, "user_id": user_id})
            if not existing_account:
                raise ValueError(f"Account {account_id} not found for user {user_id}")

            update_stage("analyzing", {"message": "Checking which transactions to remove...", "current": 0, "total": 0})

            # Get all transactions for this account
            all_transactions = db.find("transactions", {"account_id": account_id})
            plaid_transactions = [
                txn for txn in all_transactions
                if txn.get('plaid_transaction_id') is not None
            ]

            total_plaid_txns = len(plaid_transactions)
            logger.info(f"Found {total_plaid_txns} Plaid transactions out of {len(all_transactions)} total")

            if total_plaid_txns == 0:
                update_stage("completed", {
                    "message": "No Plaid transactions to delete",
                    "current": 0,
                    "total": 0
                })
                return {
                    "message": "No Plaid transactions found",
                    "transactions_deleted": 0,
                    "expenses_deleted": 0,
                    "positions_recalculated": 0,
                    "remaining_transactions": len(all_transactions),
                    "new_balance": existing_account.get('balance', 0.0)
                }

            update_stage("deleting_expenses", {
                "message": f"Cleaning up expense records...",
                "current": 0,
                "total": total_plaid_txns
            })

            # Delete expenses associated with Plaid transactions
            expenses_deleted = 0
            for idx, txn in enumerate(plaid_transactions):
                expenses = db.find("expenses", {"transaction_id": txn["id"]})
                for expense in expenses:
                    db.delete("expenses", expense["id"])
                    expenses_deleted += 1

                if (idx + 1) % 10 == 0 or (idx + 1) == total_plaid_txns:
                    update_stage("deleting_expenses", {
                        "message": f"Cleaned up {expenses_deleted} expense records...",
                        "current": idx + 1,
                        "total": total_plaid_txns
                    })

            logger.info(f"Deleted {expenses_deleted} expenses")

            update_stage("deleting_transactions", {
                "message": f"Removing Plaid transactions...",
                "current": 0,
                "total": total_plaid_txns
            })

            # Delete Plaid transactions
            transactions_deleted = 0
            for idx, txn in enumerate(plaid_transactions):
                db.delete("transactions", txn["id"])
                transactions_deleted += 1

                if (idx + 1) % 10 == 0 or (idx + 1) == total_plaid_txns:
                    update_stage("deleting_transactions", {
                        "message": f"Removed {transactions_deleted} transactions...",
                        "current": idx + 1,
                        "total": total_plaid_txns
                    })

            logger.info(f"Deleted {transactions_deleted} Plaid transactions")

            update_stage("recalculating_positions", {
                "message": "Updating investment positions...",
                "current": 0,
                "total": 1
            })

            # Recalculate positions from remaining transactions
            from app.api.import_statements import recalculate_positions_from_transactions
            positions_created = recalculate_positions_from_transactions(account_id, db)

            logger.info(f"Recalculated positions: {positions_created}")

            update_stage("recalculating_balance", {
                "message": "Updating your account balance...",
                "current": 0,
                "total": 1
            })

            # Recalculate account balance from remaining transactions
            account = db.find_one("accounts", {"id": account_id})

            # Get all remaining transactions
            remaining_transactions = db.find("transactions", {"account_id": account_id})

            # Check if any remaining Plaid transactions exist
            remaining_plaid_txns = [txn for txn in remaining_transactions if txn.get('plaid_transaction_id')]

            # If NO Plaid transactions remain, reset opening_balance to 0
            # The opening_balance only makes sense when there are Plaid transactions
            if not remaining_plaid_txns:
                logger.info(f"No Plaid transactions remain, resetting opening_balance to 0")
                opening_balance = 0.0
                db.update("accounts", {"id": account_id}, {
                    "opening_balance": 0.0,
                    "opening_balance_date": None
                })
            else:
                opening_balance = account.get('opening_balance', 0.0) or 0.0

            # Calculate new balance: opening_balance + sum of all transactions
            new_balance = opening_balance + sum(txn.get('total', 0.0) for txn in remaining_transactions)
            new_balance = round(new_balance, 2)

            # Update account balance
            db.update("accounts", {"id": account_id}, {"balance": new_balance})

            logger.info(f"Updated balance to: {new_balance}")

            # Commit all changes
            session.commit()

            result = {
                "message": "Plaid transactions deleted successfully",
                "transactions_deleted": transactions_deleted,
                "expenses_deleted": expenses_deleted,
                "positions_recalculated": positions_created,
                "remaining_transactions": len(all_transactions) - transactions_deleted,
                "new_balance": new_balance
            }

            update_stage("completed", {
                "message": f"Successfully removed {transactions_deleted} transactions. Your new balance is ${new_balance:.2f}",
                "current": total_plaid_txns,
                "total": total_plaid_txns
            })

            logger.info(f"Delete Plaid transactions job completed: {result}")
            return result

    except Exception as e:
        logger.error(f"Delete Plaid transactions job failed: {str(e)}", exc_info=True)
        update_stage("failed", {"message": str(e), "current": 0, "total": 0})
        raise
