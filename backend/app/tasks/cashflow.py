import logging
from typing import Optional

from rq import get_current_job

from app.api.cashflow import run_expense_conversion
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
