import logging
import os
import signal
import sys

from redis import Redis
from rq import Worker, Queue, Connection

from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    logger.info(f"Received signal {signum}, shutting down worker gracefully...")
    sys.exit(0)


def main():
    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    redis_conn = Redis.from_url(settings.REDIS_URL)
    queue_list = os.getenv("QUEUE_LIST")
    if queue_list:
        listen = [q.strip() for q in queue_list.split(",") if q.strip()]
    else:
        listen = [
            settings.EXPENSE_QUEUE_NAME,
            settings.PRICE_QUEUE_NAME,
            settings.STATEMENT_QUEUE_NAME,
        ]

    # Deduplicate while preserving order so a queue configured twice does not spawn
    # duplicate workers for the same channel.
    seen = set()
    listen = [q for q in listen if not (q in seen or seen.add(q))]

    logger.info(f"Worker starting, listening to queues: {', '.join(listen)}")

    with Connection(redis_conn):
        worker = Worker(
            list(map(Queue, listen)),
            log_job_description=True,
            # More responsive worker settings
            job_monitoring_interval=5,  # Check for new jobs every 5 seconds
        )

        logger.info("Worker started and ready to process jobs")

        # Start working with better responsiveness
        worker.work(
            logging_level=logging.INFO,
            max_jobs=None,  # Process jobs indefinitely
            with_scheduler=True,  # Enable job scheduling
        )


if __name__ == "__main__":
    main()
