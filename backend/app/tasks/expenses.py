import logging
from typing import Optional

from rq import get_current_job

from app.api.expenses import run_expense_conversion
from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service

logger = logging.getLogger(__name__)


def run_expense_conversion_job(user_id: str, account_id: Optional[str] = None):
    job = get_current_job()

    def update_stage(stage: str):
        if job:
            job.meta["stage"] = stage
            job.save_meta()
            logger.info("Expense job %s stage: %s", job.id, stage)

    try:
        update_stage("starting")
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
        update_stage("completed")
        return result
    except Exception as exc:  # pragma: no cover - logged for visibility
        update_stage("failed")
        logger.exception("Expense conversion job failed for user %s", user_id)
        raise exc
