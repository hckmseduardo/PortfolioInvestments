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

            # Delete cashflow/expenses associated with Plaid transactions
            expenses_deleted = 0
            for idx, txn in enumerate(plaid_transactions):
                expenses = db.find("cashflow", {"transaction_id": txn["id"]})
                for expense in expenses:
                    db.delete("cashflow", expense["id"])
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

            # Get all remaining transactions sorted by date
            from app.database.models import Transaction
            from sqlalchemy import cast, Date
            remaining_transactions = session.query(Transaction).filter(
                Transaction.account_id == account_id
            ).order_by(
                cast(Transaction.date, Date).asc(),
                Transaction.total.desc(),
                Transaction.id.asc()
            ).all()

            # Update account balance based on remaining transactions
            if remaining_transactions:
                # Set account balance to the last transaction's expected_balance
                last_transaction = remaining_transactions[-1]
                new_balance = last_transaction.expected_balance if last_transaction.expected_balance is not None else 0.0
                logger.info(f"Setting balance to last transaction's expected_balance: {new_balance}")
            else:
                # No transactions remain, set balance to 0
                new_balance = 0.0
                logger.info(f"No transactions remain, setting balance to 0")

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
