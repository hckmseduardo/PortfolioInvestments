import logging
from typing import Optional

from rq import get_current_job

from app.api.cashflow import run_expense_conversion, detect_transfers, categorize_transaction
from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service

logger = logging.getLogger(__name__)


def run_cashflow_conversion_job(user_id: str, account_id: Optional[str] = None):
    job = get_current_job()

    def update_stage(stage: str, progress: dict = None):
        if job:
            job.meta["stage"] = stage
            if progress:
                job.meta["progress"] = progress
            job.save_meta()
            logger.info("Cashflow job %s stage: %s progress: %s", job.id, stage, progress)

    try:
        update_stage("starting", {"message": "Initializing transaction import...", "current": 0, "total": 0})
        # Use context manager to properly handle database session
        with get_db_context() as session:
            db = get_db_service(session)
            result = run_expense_conversion(
                user_id=user_id,
                account_id=account_id,
                progress_callback=update_stage,
                db=db
            )
            session.commit()

        # Include final results in progress
        update_stage("completed", {
            "message": "Import completed successfully!",
            "expenses_created": result.get("expenses_created", 0),
            "expenses_updated": result.get("expenses_updated", 0),
            "transfers_excluded": result.get("transfers_excluded", 0),
            "transactions_processed": result.get("transactions_processed", 0)
        })
        return result
    except Exception as exc:  # pragma: no cover - logged for visibility
        update_stage("failed", {"message": f"Import failed: {str(exc)}"})
        logger.exception("Cashflow conversion job failed for user %s", user_id)
        raise exc


def run_cashflow_recategorization_job(user_id: str):
    """
    Recategorize all cashflow transactions for a user.
    This resets all cashflow records to Uncategorized and reapplies categorization logic.
    """
    job = get_current_job()

    def update_stage(stage: str, progress: dict = None):
        if job:
            job.meta["stage"] = stage
            if progress:
                job.meta["progress"] = progress
            job.save_meta()
            logger.info("Recategorization job %s stage: %s progress: %s", job.id, stage, progress)

    try:
        update_stage("starting", {"message": "Starting recategorization...", "current": 0, "total": 0})

        with get_db_context() as session:
            db = get_db_service(session)

            # Step 1: Ensure special categories exist
            update_stage("ensuring_categories", {"message": "Ensuring special categories exist...", "current": 0, "total": 0})
            special_categories = [
                {"name": "Uncategorized", "type": "expense", "color": "#9E9E9E"},
                {"name": "Income", "type": "income", "color": "#4CAF50"},
                {"name": "Dividend", "type": "income", "color": "#8BC34A"},
                {"name": "Investment In", "type": "investment", "color": "#2196F3"},
                {"name": "Investment Out", "type": "investment", "color": "#0D47A1"},
                {"name": "Transfer", "type": "transfer", "color": "#607D8B"},
                {"name": "Credit Card Payment", "type": "transfer", "color": "#78909C"},
            ]

            for cat_data in special_categories:
                existing_cat = db.find_one("categories", {"user_id": user_id, "name": cat_data["name"]})
                if not existing_cat:
                    category_doc = {
                        "user_id": user_id,
                        "name": cat_data["name"],
                        "type": cat_data["type"],
                        "color": cat_data["color"],
                        "budget_limit": None
                    }
                    db.insert("categories", category_doc)

            # Step 2: Reset all cashflow records to Uncategorized
            update_stage("resetting_categories", {"message": "Resetting all cashflow records to Uncategorized...", "current": 0, "total": 0})
            user_accounts = db.find("accounts", {"user_id": user_id})
            all_account_ids = [acc["id"] for acc in user_accounts]

            reset_count = 0
            for account_id in all_account_ids:
                cashflow_records = db.find("cashflow", {"account_id": account_id})
                for record in cashflow_records:
                    db.update("cashflow", {"id": record["id"]}, {
                        "category": "Uncategorized",
                        "confidence": 0.0,
                        "suggested_category": None
                    })
                    reset_count += 1

            update_stage("resetting_categories", {
                "message": f"Reset {reset_count} cashflow records to Uncategorized",
                "current": reset_count,
                "total": reset_count
            })

            # Step 3: Detect transfers
            update_stage("detecting_transfers", {"message": "Detecting transfer transactions...", "current": 0, "total": 0})
            transfers = detect_transfers(user_id, db)
            transfer_transaction_ids = set()
            for tid1, tid2 in transfers:
                transfer_transaction_ids.add(tid1)
                transfer_transaction_ids.add(tid2)

            update_stage("detecting_transfers", {
                "message": f"Found {len(transfers)} transfer pairs",
                "current": len(transfers),
                "total": len(transfers)
            })

            # Step 4: Build account map and transaction map
            update_stage("building_maps", {"message": "Building account and transaction maps...", "current": 0, "total": 0})
            all_user_accounts = db.find("accounts", {"user_id": user_id})
            account_map = {acc["id"]: acc for acc in all_user_accounts}

            transaction_map = {}
            for account_id in all_account_ids:
                account_transactions = db.find("transactions", {"account_id": account_id})
                for txn in account_transactions:
                    transaction_map[txn["id"]] = txn

            # Step 5: Recategorize each cashflow record
            update_stage("recategorizing", {"message": "Recategorizing cashflow records...", "current": 0, "total": reset_count})
            recategorized_count = 0

            for account_id in all_account_ids:
                cashflow_records = list(db.find("cashflow", {"account_id": account_id}))

                for idx, record in enumerate(cashflow_records, 1):
                    txn_id = record.get("transaction_id")
                    if not txn_id or txn_id not in transaction_map:
                        continue

                    # Get the original transaction
                    txn = transaction_map[txn_id]

                    # Apply categorization using the shared function
                    category, confidence, categorization_source, paired_txn_id, paired_account_id = categorize_transaction(
                        txn, user_id, db, account_map, transfers, transfer_transaction_ids, use_llm=False
                    )

                    # Update the cashflow record with new categorization
                    db.update("cashflow", {"id": record["id"]}, {
                        "category": category,
                        "confidence": confidence,
                        "paired_transaction_id": paired_txn_id,
                        "paired_account_id": paired_account_id
                    })
                    recategorized_count += 1

                    # Update progress every 10 records or at the end
                    if recategorized_count % 10 == 0 or recategorized_count == reset_count:
                        update_stage("recategorizing", {
                            "message": f"Recategorizing ({recategorized_count}/{reset_count})...",
                            "current": recategorized_count,
                            "total": reset_count
                        })

            session.commit()

            result = {
                "message": f"Reset {reset_count} cashflow records to Uncategorized, then recategorized {recategorized_count} records",
                "reset": reset_count,
                "recategorized": recategorized_count,
                "user_id": user_id
            }

            update_stage("completed", {
                "message": "Recategorization completed successfully!",
                "reset": reset_count,
                "recategorized": recategorized_count
            })

            return result

    except Exception as exc:
        update_stage("failed", {"message": f"Recategorization failed: {str(exc)}"})
        logger.exception("Cashflow recategorization job failed for user %s", user_id)
        raise exc
