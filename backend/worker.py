import logging

from redis import Redis
from rq import Worker, Queue, Connection

from app.config import settings

logging.basicConfig(level=logging.INFO)


def main():
    redis_conn = Redis.from_url(settings.REDIS_URL)
    listen = [settings.EXPENSE_QUEUE_NAME, settings.PRICE_QUEUE_NAME]

    with Connection(redis_conn):
        worker = Worker(list(map(Queue, listen)))
        worker.work()


if __name__ == "__main__":
    main()
