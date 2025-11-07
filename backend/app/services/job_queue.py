import logging
from typing import Optional, Dict, Any, List

from redis import Redis
from rq import Queue
from rq.job import Job
from rq.exceptions import NoSuchJobError

from app.config import settings

logger = logging.getLogger(__name__)

_redis_connection: Optional[Redis] = None
_expense_queue: Optional[Queue] = None
_price_queue: Optional[Queue] = None
_statement_queue: Optional[Queue] = None


def _get_redis_connection() -> Redis:
    global _redis_connection
    if _redis_connection is None:
        _redis_connection = Redis.from_url(settings.REDIS_URL)
    return _redis_connection


def get_expense_queue() -> Queue:
    global _expense_queue
    if _expense_queue is None:
        _expense_queue = Queue(
            settings.EXPENSE_QUEUE_NAME,
            connection=_get_redis_connection(),
            default_timeout=settings.EXPENSE_JOB_TIMEOUT,
        )
    return _expense_queue


def enqueue_expense_conversion_job(user_id: str, account_id: Optional[str] = None) -> Job:
    from app.tasks.expenses import run_expense_conversion_job

    queue = get_expense_queue()
    job = queue.enqueue(
        run_expense_conversion_job,
        user_id,
        account_id,
        job_timeout=settings.EXPENSE_JOB_TIMEOUT,
    )
    logger.info("Enqueued expense conversion job %s for user %s", job.id, user_id)
    return job


def get_price_queue() -> Queue:
    global _price_queue
    if _price_queue is None:
        _price_queue = Queue(
            settings.PRICE_QUEUE_NAME,
            connection=_get_redis_connection(),
            default_timeout=settings.PRICE_JOB_TIMEOUT,
        )
    return _price_queue


def enqueue_price_fetch_job(tickers: List[str], as_of_date: Optional[str] = None) -> Optional[Job]:
    if not tickers:
        return None

    from app.tasks.prices import run_price_fetch_job

    queue = get_price_queue()
    job = queue.enqueue(
        run_price_fetch_job,
        tickers,
        as_of_date,
        job_timeout=settings.PRICE_JOB_TIMEOUT,
    )
    logger.info("Enqueued price fetch job %s for %s tickers", job.id, len(tickers))
    return job


def get_statement_queue() -> Queue:
    global _statement_queue
    if _statement_queue is None:
        _statement_queue = Queue(
            settings.STATEMENT_QUEUE_NAME,
            connection=_get_redis_connection(),
            default_timeout=settings.STATEMENT_JOB_TIMEOUT,
        )
    return _statement_queue


def enqueue_statement_job(
    user_id: str,
    statement_id: Optional[str],
    action: str,
    target_account_id: Optional[str] = None,
    account_scope: Optional[str] = None,
) -> Job:
    from app.tasks.statements import run_statement_job

    queue = get_statement_queue()
    job = queue.enqueue(
        run_statement_job,
        action,
        user_id,
        statement_id,
        target_account_id,
        account_scope,
        job_timeout=settings.STATEMENT_JOB_TIMEOUT,
    )
    job.meta = job.meta or {}
    job.meta.update(
        {
            "user_id": user_id,
            "statement_id": statement_id,
            "action": action,
            "target_account_id": target_account_id,
            "account_scope": account_scope,
        }
    )
    job.save_meta()
    logger.info(
        "Enqueued statement job %s for user %s (action=%s, statement=%s)",
        job.id,
        user_id,
        action,
        statement_id,
    )
    return job


def get_job_info(job_id: str) -> Dict[str, Any]:
    job = Job.fetch(job_id, connection=_get_redis_connection())
    info = {
        "job_id": job.id,
        "status": job.get_status(),
        "enqueued_at": job.enqueued_at.isoformat() if job.enqueued_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "ended_at": job.ended_at.isoformat() if job.ended_at else None,
        "meta": job.meta or {},
    }

    if job.is_finished:
        info["result"] = job.result
    elif job.is_failed:
        info["error"] = job.exc_info

    return info
