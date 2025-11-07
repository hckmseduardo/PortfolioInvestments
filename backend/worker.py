import logging
import os

from redis import Redis
from rq import Worker, Queue, Connection

from app.config import settings

logging.basicConfig(level=logging.INFO)


def main():
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

    with Connection(redis_conn):
        worker = Worker(list(map(Queue, listen)))
        worker.work()


if __name__ == "__main__":
    main()
