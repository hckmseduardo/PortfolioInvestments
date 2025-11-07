import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
import uuid

logger = logging.getLogger(__name__)

_COLLECTION = "price_cache"
_CURRENT_PRICE_CACHE_MINUTES = 15  # Cache current prices for 15 minutes


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


def get_historical_price(ticker: str, as_of: datetime) -> Optional[float]:
    """
    Get cached price for a historical (closed) day.
    Returns None if not found in cache.
    """
    db, session = get_db_service()
    normalized_date = _normalize_date(as_of)

    try:
        record = db.find_one(_COLLECTION, {
            "ticker": ticker.upper(),
            "date": normalized_date,
            "is_current": 0  # Only fetch historical prices
        })
        if record:
            return record.get("price")
        return None
    finally:
        if session:
            session.close()


def get_current_price(ticker: str) -> Tuple[Optional[float], bool]:
    """
    Get cached current price if it's not expired (less than 15 minutes old).

    Returns:
        Tuple of (price, is_expired)
        - price: The cached price or None if not found
        - is_expired: True if cache is expired or doesn't exist, False otherwise
    """
    db, session = get_db_service()

    try:
        record = db.find_one(_COLLECTION, {
            "ticker": ticker.upper(),
            "is_current": 1  # Only fetch current prices
        })

        if not record:
            return None, True

        # Check if cache is expired (older than 15 minutes)
        cached_at_str = record.get("cached_at")
        if not cached_at_str:
            return None, True

        try:
            cached_at = datetime.fromisoformat(cached_at_str.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            return None, True

        now = datetime.now(timezone.utc)
        age = now - cached_at.replace(tzinfo=timezone.utc)
        is_expired = age > timedelta(minutes=_CURRENT_PRICE_CACHE_MINUTES)

        price = record.get("price")
        return price, is_expired

    finally:
        if session:
            session.close()


def set_historical_price(ticker: str, as_of: datetime, price: float) -> None:
    """
    Cache a historical (closed day) price.
    Historical prices are permanent (never expire).
    """
    db, session = get_db_service()
    normalized_date = _normalize_date(as_of)
    ticker_key = ticker.upper()

    try:
        existing = db.find_one(_COLLECTION, {
            "ticker": ticker_key,
            "date": normalized_date,
            "is_current": 0
        })

        if existing:
            db.update(_COLLECTION, existing["id"], {
                "price": price,
                "cached_at": datetime.now(timezone.utc).isoformat()
            })
        else:
            db.insert(_COLLECTION, {
                "id": str(uuid.uuid4()),
                "ticker": ticker_key,
                "date": normalized_date,
                "price": price,
                "is_current": 0,
                "cached_at": datetime.now(timezone.utc).isoformat()
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


def set_current_price(ticker: str, price: float) -> None:
    """
    Cache a current price with timestamp.
    Current prices expire after 15 minutes.
    """
    db, session = get_db_service()
    ticker_key = ticker.upper()
    now = datetime.now(timezone.utc)

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
                "date": now.isoformat(),
                "cached_at": now.isoformat()
            })
        else:
            db.insert(_COLLECTION, {
                "id": str(uuid.uuid4()),
                "ticker": ticker_key,
                "date": now.isoformat(),
                "price": price,
                "is_current": 1,
                "cached_at": now.isoformat()
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


# Legacy compatibility functions
def get_price(ticker: str, as_of: datetime) -> Optional[float]:
    """Legacy function for backward compatibility. Use get_historical_price instead."""
    return get_historical_price(ticker, as_of)


def set_price(ticker: str, as_of: datetime, price: float) -> None:
    """Legacy function for backward compatibility. Use set_historical_price instead."""
    set_historical_price(ticker, as_of, price)
