from datetime import datetime, timedelta
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

BACKEND_PATH = Path(__file__).resolve().parents[2]
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

sqlalchemy_stub = ModuleType("sqlalchemy")
sqlalchemy_stub.text = lambda *args, **kwargs: None
sys.modules.setdefault("sqlalchemy", sqlalchemy_stub)

redis_stub = ModuleType("redis")


class _RedisStub:
    @classmethod
    def from_url(cls, *_args, **_kwargs):
        return cls()


redis_stub.Redis = _RedisStub
sys.modules.setdefault("redis", redis_stub)

price_cache_stub = ModuleType("app.services.price_cache")
price_cache_stub.get_current_price = lambda *_args, **_kwargs: (None, True, None)
price_cache_stub.set_current_price = lambda *_args, **_kwargs: None
price_cache_stub.get_historical_price = lambda *_args, **_kwargs: (None, None)
price_cache_stub.set_historical_price = lambda *_args, **_kwargs: None
price_cache_stub.get_cached_prices = lambda *_args, **_kwargs: {}
price_cache_stub.get_price_retry_count = lambda *_args, **_kwargs: 0
price_cache_stub.reset_price_retry_count = lambda *_args, **_kwargs: None
price_cache_stub.increment_price_retry_count = lambda *_args, **_kwargs: 0
sys.modules.setdefault("app.services.price_cache", price_cache_stub)

rq_stub = ModuleType("rq")


class _QueueStub:
    def enqueue(self, *_args, **_kwargs):
        return SimpleNamespace(id="stub-job")


rq_stub.Queue = _QueueStub
sys.modules.setdefault("rq", rq_stub)

rq_job_stub = ModuleType("rq.job")


class _JobStub:
    def __init__(self, *_args, **_kwargs):
        self.id = "stub-job"
        self.meta = {}
        self.is_finished = False
        self.is_failed = False
        self.enqueued_at = None
        self.started_at = None
        self.ended_at = None
        self.result = None
        self.exc_info = None

    @classmethod
    def fetch(cls, *_args, **_kwargs):
        return cls()

    def save_meta(self):
        return None

rq_job_stub.Job = _JobStub
sys.modules.setdefault("rq.job", rq_job_stub)

rq_exceptions_stub = ModuleType("rq.exceptions")


class _NoSuchJobError(Exception):
    pass


rq_exceptions_stub.NoSuchJobError = _NoSuchJobError
sys.modules.setdefault("rq.exceptions", rq_exceptions_stub)

from app.api import positions


def test_normalize_future_as_current_future_date():
    future = datetime.utcnow() + timedelta(days=1)
    assert positions._normalize_future_as_current(future) is None


def test_normalize_future_as_current_past_date():
    past = datetime.utcnow() - timedelta(days=1)
    normalized = positions._normalize_future_as_current(past)
    assert isinstance(normalized, datetime)
    assert normalized == past
