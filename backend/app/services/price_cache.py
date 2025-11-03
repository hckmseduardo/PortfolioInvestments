import logging
from datetime import datetime, timezone
from typing import Optional

from app.database.json_db import get_db

logger = logging.getLogger(__name__)

_COLLECTION = "price_cache"


def _ensure_collection():
    db = get_db()
    if _COLLECTION not in db.collections:
        db.collections[_COLLECTION] = db.db_path / f"{_COLLECTION}.json"
        if not db.collections[_COLLECTION].exists():
            db.collections[_COLLECTION].write_text("[]")


def get_price(ticker: str, as_of: datetime) -> Optional[float]:
    _ensure_collection()
    db = get_db()
    normalized_date = _normalize_date(as_of)
    record = db.find_one(_COLLECTION, {
        "ticker": ticker.upper(),
        "date": normalized_date
    })
    if record:
        return record.get("price")
    return None


def set_price(ticker: str, as_of: datetime, price: float) -> None:
    _ensure_collection()
    db = get_db()
    normalized_date = _normalize_date(as_of)
    ticker_key = ticker.upper()
    existing = db.find_one(_COLLECTION, {
        "ticker": ticker_key,
        "date": normalized_date
    })
    if existing:
        db.update(_COLLECTION, existing["id"], {"price": price})
    else:
        db.insert(_COLLECTION, {
            "ticker": ticker_key,
            "date": normalized_date,
            "price": price
        })


def _normalize_date(as_of: datetime) -> str:
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    midnight = as_of.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.isoformat()
