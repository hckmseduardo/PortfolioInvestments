from types import ModuleType, SimpleNamespace
from pathlib import Path
import sys

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
sys.modules.setdefault("app.services.price_cache", price_cache_stub)

from app.config import Settings
from app.services.market_data import MarketDataService


def test_price_source_priority_normalization():
    custom = Settings.model_validate(
        {
            "PRICE_SOURCE_PRIORITY": " yfinance , TradingView , alpha_vantage , yfinance ",
        }
    )
    assert custom.price_source_priority == ["yfinance", "tradingview", "alpha_vantage"]


def test_fetch_current_price_uses_configured_order(monkeypatch):
    stub_settings = SimpleNamespace(price_source_priority=["alpha_vantage", "yfinance"])
    monkeypatch.setattr("app.services.market_data.settings", stub_settings)
    service = MarketDataService()

    hits = []

    def fetcher(name, value):
        def _inner(*_args, **_kwargs):
            hits.append(name)
            return value
        return _inner

    service._current_fetchers = {
        "alpha_vantage": fetcher("alpha_vantage", 10.0),
        "yfinance": fetcher("yfinance", 11.0),
    }
    service._historical_fetchers = dict(service._current_fetchers)
    service._source_priority = service._resolve_source_priority()

    price, source = service._fetch_current_price_from_market("SHOP")

    assert price == 10.0
    assert source == "alpha_vantage"
    assert hits == ["alpha_vantage"]


def test_tradingview_sub_dollar_price_falls_back(monkeypatch):
    stub_settings = SimpleNamespace(price_source_priority=["tradingview", "yfinance"])
    monkeypatch.setattr("app.services.market_data.settings", stub_settings)
    service = MarketDataService()

    service._current_fetchers = {
        "tradingview": lambda *_: 0.5,
        "yfinance": lambda *_: 12.0,
    }
    service._historical_fetchers = dict(service._current_fetchers)
    service._source_priority = service._resolve_source_priority()

    price, source = service._fetch_current_price_from_market("CASH")

    assert price == 12.0
    assert source == "yfinance"
