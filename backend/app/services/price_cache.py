import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple, Dict, Any, List
import uuid
from sqlalchemy import text
from redis import Redis

from app.database.models import StockPrice as StockPriceModel
from app.config import settings
logger = logging.getLogger(__name__)

_COLLECTION = "price_cache"
_CURRENT_PRICE_CACHE_MINUTES = 15  # Cache current prices for 15 minutes
_PRICE_SCHEMA_PREPARED = False
_retry_client: Optional[Redis] = None


def _ensure_collection():
    """Ensure the price cache collection exists (JSON mode only)."""
    try:
        from app.database.json_db import get_db
        db = get_db()
        if _COLLECTION not in db.collections:
            db.collections[_COLLECTION] = db.db_path / f"{_COLLECTION}.json"
            if not db.collections[_COLLECTION].exists():
                db.collections[_COLLECTION].write_text("[]")
    except Exception as e:
        logger.debug(f"Could not ensure collection (may be using PostgreSQL): {e}")


def get_db_service():
    """Get the appropriate database service based on settings."""
    from app.config import settings

    if settings.use_postgres:
        from app.database.postgres_db import get_db as get_pg_db
        from app.database.db_service import get_db_service as get_service

        db_session = next(get_pg_db())
        return get_service(db_session), db_session
    else:
        from app.database.json_db import get_db
        _ensure_collection()
        return get_db(), None


def _ensure_price_cache_schema(session) -> None:
    """Ensure Postgres price cache table has optional columns like source."""
    global _PRICE_SCHEMA_PREPARED
    if _PRICE_SCHEMA_PREPARED or session is None:
        return

    try:
        session.execute(text("ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS source VARCHAR(255)"))
        session.commit()
    except Exception as e:
        if session:
            session.rollback()
        logger.debug(f"Could not ensure price cache schema: {e}")
    finally:
        _PRICE_SCHEMA_PREPARED = True


def _get_retry_client() -> Redis:
    global _retry_client
    if _retry_client is None:
        _retry_client = Redis.from_url(settings.REDIS_URL)
    return _retry_client


def _retry_key(ticker: str, as_of: Optional[datetime]) -> str:
    if as_of:
        suffix = _normalize_date(as_of)
    else:
        suffix = "current"
    return f"price_retry:{suffix}:{ticker.upper()}"


def get_historical_price(ticker: str, as_of: datetime) -> Tuple[Optional[float], Optional[Dict[str, Any]]]:
    """
    Get cached price for a historical (closed) day.
    Returns None if not found in cache.
    """
    db, session = get_db_service()
    normalized_date = _normalize_date(as_of)
    ticker_key = ticker.upper()

    try:
        records = get_cached_prices([ticker], as_of)
        record = records.get(ticker_key)
        if record:
            return record.get("price"), {
                "source": record.get("source"),
                "cached_at": record.get("cached_at"),
                "date": record.get("date")
            }
        return None, None
    except Exception as e:
        logger.error(f"Error getting historical price for {ticker_key}: {e}")
        return None, None
    finally:
        if session:
            session.close()


def get_current_price(ticker: str) -> Tuple[Optional[float], bool, Optional[Dict[str, Any]]]:
    """
    Get cached current price if it's not expired (less than 15 minutes old).

    Returns:
        Tuple of (price, is_expired)
        - price: The cached price or None if not found
        - is_expired: True if cache is expired or doesn't exist, False otherwise
    """
    db, session = get_db_service()

    try:
        records = get_cached_prices([ticker], None)
        record = records.get(ticker.upper())
        if not record:
            return None, True, None

        cached_at_str = record.get("cached_at")
        if not cached_at_str:
            return None, True, record

        try:
            cached_at = datetime.fromisoformat(cached_at_str.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            return None, True, record

        now = datetime.now(timezone.utc)
        age = now - cached_at.replace(tzinfo=timezone.utc)
        is_expired = age > timedelta(minutes=_CURRENT_PRICE_CACHE_MINUTES)

        return record.get("price"), is_expired, record

    finally:
        if session:
            session.close()


def set_historical_price(ticker: str, as_of: datetime, price: float, source: Optional[str] = None) -> None:
    """
    Cache a historical (closed day) price.
    Historical prices are permanent (never expire).
    """
    db, session = get_db_service()
    _ensure_price_cache_schema(session)
    normalized_date = _normalize_date(as_of)
    normalized_dt = datetime.fromisoformat(normalized_date)
    ticker_key = ticker.upper()
    is_postgres = session is not None

    try:
        existing = db.find_one(_COLLECTION, {
            "ticker": ticker_key,
            "date": normalized_dt if is_postgres else normalized_date,
            "is_current": 0
        })

        if existing:
            db.update(_COLLECTION, existing["id"], {
                "price": price,
                "cached_at": datetime.now(timezone.utc).isoformat(),
                "source": source
            })
        else:
            db.insert(_COLLECTION, {
                "id": str(uuid.uuid4()),
                "ticker": ticker_key,
                "date": normalized_dt if is_postgres else normalized_date,
                "price": price,
                "is_current": 0,
                "cached_at": datetime.now(timezone.utc).isoformat(),
                "source": source
            })

        if session:
            session.commit()
    except Exception as e:
        if session:
            session.rollback()
        logger.error(f"Failed to cache historical price for {ticker_key}: {e}")
        raise
    finally:
        if session:
            session.close()


def set_current_price(ticker: str, price: float, source: Optional[str] = None) -> None:
    """
    Cache a current price with timestamp.
    Current prices expire after 15 minutes.
    """
    db, session = get_db_service()
    _ensure_price_cache_schema(session)
    ticker_key = ticker.upper()
    now = datetime.now(timezone.utc)
    is_postgres = session is not None

    try:
        # For current prices, we store with the current timestamp
        # and mark is_current=1
        existing = db.find_one(_COLLECTION, {
            "ticker": ticker_key,
            "is_current": 1
        })

        if existing:
            db.update(_COLLECTION, existing["id"], {
                "price": price,
                "date": now if is_postgres else now.isoformat(),
                "cached_at": now.isoformat(),
                "source": source
            })
        else:
            db.insert(_COLLECTION, {
                "id": str(uuid.uuid4()),
                "ticker": ticker_key,
                "date": now if is_postgres else now.isoformat(),
                "price": price,
                "is_current": 1,
                "cached_at": now.isoformat(),
                "source": source
            })

        if session:
            session.commit()
    except Exception as e:
        if session:
            session.rollback()
        logger.error(f"Failed to cache current price for {ticker_key}: {e}")
        raise
    finally:
        if session:
            session.close()


def invalidate_current_price(ticker: str) -> None:
    """
    Invalidate (delete) the current price cache for a ticker.
    This forces a fresh fetch from the market on next request.
    """
    db, session = get_db_service()
    ticker_key = ticker.upper()

    try:
        db.delete(_COLLECTION, {
            "ticker": ticker_key,
            "is_current": 1
        })

        if session:
            session.commit()
    except Exception as e:
        if session:
            session.rollback()
        logger.error(f"Failed to invalidate current price for {ticker_key}: {e}")
        raise
    finally:
        if session:
            session.close()


def _normalize_date(as_of: datetime) -> str:
    """Normalize a datetime to midnight UTC for historical price lookups."""
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    midnight = as_of.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.isoformat()


def get_cached_prices(tickers: List[str], as_of: Optional[datetime]) -> Dict[str, Dict[str, Any]]:
    """
    Fetch cached prices for multiple tickers in a single query.
    """
    tickers = [t for t in (tickers or []) if t]
    if not tickers:
        return {}

    ticker_keys = [t.upper() for t in tickers]
    db, session = get_db_service()
    results: Dict[str, Dict[str, Any]] = {}

    try:
        if session:
            _ensure_price_cache_schema(session)
            query = session.query(StockPriceModel).filter(StockPriceModel.ticker.in_(ticker_keys))
            if as_of:
                normalized = datetime.fromisoformat(_normalize_date(as_of))
                query = query.filter(StockPriceModel.is_current == 0, StockPriceModel.date == normalized)
            else:
                query = query.filter(StockPriceModel.is_current == 1)

            for row in query.all():
                results[row.ticker.upper()] = {
                    "price": row.price,
                    "cached_at": row.cached_at.isoformat() if row.cached_at else None,
                    "source": row.source,
                    "date": row.date.isoformat() if row.date else None,
                    "is_current": bool(row.is_current)
                }
        else:
            _ensure_collection()
            all_records = db.find(_COLLECTION, None)
            normalized = _normalize_date(as_of) if as_of else None
            for rec in all_records:
                ticker = (rec.get("ticker") or "").upper()
                if ticker not in ticker_keys:
                    continue
                is_current = rec.get("is_current", 0)
                if as_of and is_current != 0:
                    continue
                if not as_of and is_current != 1:
                    continue
                if as_of and rec.get("date") != normalized:
                    continue
                results[ticker] = {
                    "price": rec.get("price"),
                    "cached_at": rec.get("cached_at"),
                    "source": rec.get("source"),
                    "date": rec.get("date"),
                    "is_current": bool(rec.get("is_current", 0))
                }
    finally:
        if session:
            session.close()

    return results


def get_price_retry_count(ticker: str, as_of: Optional[datetime]) -> int:
    client = _get_retry_client()
    key = _retry_key(ticker, as_of)
    value = client.get(key)
    if not value:
        return 0
    try:
        return int(value)
    except ValueError:
        return 0


def increment_price_retry_count(ticker: str, as_of: Optional[datetime]) -> int:
    client = _get_retry_client()
    key = _retry_key(ticker, as_of)
    new_value = client.incr(key)
    client.expire(key, 86400)
    return int(new_value)


def reset_price_retry_count(ticker: str, as_of: Optional[datetime]) -> None:
    client = _get_retry_client()
    key = _retry_key(ticker, as_of)
    client.delete(key)


# Legacy compatibility functions
def get_price(ticker: str, as_of: datetime) -> Optional[float]:
    """Legacy function for backward compatibility. Use get_historical_price instead."""
    price, _ = get_historical_price(ticker, as_of)
    return price


def set_price(ticker: str, as_of: datetime, price: float, source: Optional[str] = None) -> None:
    """Legacy function for backward compatibility. Use set_historical_price instead."""
    set_historical_price(ticker, as_of, price, source)
