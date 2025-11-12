import logging
from datetime import datetime
from typing import List, Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.models.schemas import (
    Position,
    PositionCreate,
    User,
    PortfolioSummary,
    AggregatedPosition,
    IndustryBreakdownSlice,
    TypeBreakdownSlice,
)
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service
from app.config import settings
from app.services.market_data import market_service, PriceQuote
from app.services.job_queue import enqueue_price_fetch_job
from app.services import price_cache

router = APIRouter(prefix="/positions", tags=["positions"])
logger = logging.getLogger(__name__)
UNCLASSIFIED_LABEL = "Unclassified"
UNCLASSIFIED_COLOR = "#b0bec5"
UNCLASSIFIED_SENTINEL = "__unclassified__"

def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        if len(value) == 10:
            # Interpret YYYY-MM-DD as end of day for inclusive filtering
            return datetime.fromisoformat(f"{value}T23:59:59.999999")
        return datetime.fromisoformat(value)
    except ValueError:
        if value.endswith("Z"):
            try:
                return datetime.fromisoformat(value[:-1] + "+00:00")
            except ValueError:
                return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

def _safe_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0

def _infer_name(description: Optional[str], ticker: str, fallback: Optional[str] = None) -> str:
    if fallback:
        return fallback
    if not description:
        return ticker
    parts = description.split(':', 1)
    if len(parts) > 1 and parts[0]:
        candidate = parts[0].split('-', 1)[-1].strip()
        if candidate:
            return candidate
    dash_parts = description.split('-', 1)
    if len(dash_parts) > 1:
        candidate = dash_parts[1].strip()
        if candidate:
            return candidate
    return ticker


def _normalize_future_as_current(as_of: Optional[datetime]) -> Optional[datetime]:
    """
    Treat future valuation requests as current snapshot so we don't rebuild
    historical positions or schedule price jobs for unreal dates.
    """
    if not as_of:
        return None
    now = datetime.utcnow()
    if as_of >= now:
        return None
    return as_of

def _compute_account_positions_from_transactions(
    db,
    account_id: str,
    as_of: Optional[datetime],
    name_lookup: Optional[Dict[str, str]] = None
):
    transactions = db.find("transactions", {"account_id": account_id})
    if not transactions:
        # Still return cash placeholder so downstream aggregation has a consistent shape
        return {
            "CASH": {
                "ticker": "CASH",
                "name": "Cash",
                "quantity": 0.0,
                "book_value": 0.0,
                "market_value": 0.0
            }
        }

    transactions = sorted(transactions, key=lambda x: x.get('date', ''))

    positions_map: Dict[str, Dict[str, float]] = {}
    cash_position = {
        "ticker": "CASH",
        "name": "Cash",
        "quantity": 0.0,
        "book_value": 0.0,
        "market_value": 0.0
    }

    for txn in transactions:
        txn_dt = _parse_iso_datetime(txn.get('date')) or datetime.now()
        if as_of and txn_dt > as_of:
            continue

        txn_type = (txn.get('type') or '').lower()
        ticker = (txn.get('ticker') or '').strip()
        quantity = _safe_float(txn.get('quantity'))
        total = _safe_float(txn.get('total'))
        description = txn.get('description')

        if txn_type in ['deposit', 'bonus']:
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total
            continue

        if txn_type in ['withdrawal', 'fee', 'tax']:
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total
            continue

        if txn_type == 'dividend':
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total
            continue

        if not ticker:
            continue

        name_fallback = name_lookup.get(ticker) if name_lookup else None
        position = positions_map.setdefault(
            ticker,
            {
                "ticker": ticker,
                "name": _infer_name(description, ticker, name_fallback),
                "quantity": 0.0,
                "book_value": 0.0,
                "market_value": 0.0
            }
        )

        if (not position["name"] or position["name"] == ticker) and (name_fallback or description):
            position["name"] = _infer_name(description, ticker, name_fallback)

        if txn_type == 'buy':
            if quantity == 0:
                continue
            position['quantity'] += quantity
            position['book_value'] += abs(total)
            cash_position['quantity'] -= abs(total)
            cash_position['book_value'] -= abs(total)
            cash_position['market_value'] -= abs(total)
        elif txn_type == 'sell':
            if quantity == 0:
                continue
            if position['quantity'] > 0:
                avg_cost = position['book_value'] / position['quantity'] if position['quantity'] else 0.0
            else:
                avg_cost = 0.0
            position['quantity'] -= quantity
            position['book_value'] -= quantity * avg_cost
            if position['book_value'] < 0:
                position['book_value'] = 0.0
            cash_position['quantity'] += abs(total)
            cash_position['book_value'] += abs(total)
            cash_position['market_value'] += abs(total)
        elif txn_type == 'transfer':
            position['quantity'] += quantity
        # Ignore other transaction types for position calculations

    cash_position['market_value'] = cash_position['quantity']
    positions_map['CASH'] = cash_position

    for data in positions_map.values():
        data['quantity'] = float(data.get('quantity', 0.0))
        data['book_value'] = float(data.get('book_value', 0.0))
        if data['ticker'] != 'CASH':
            data['market_value'] = float(data.get('market_value', 0.0) or 0.0)
        else:
            data['market_value'] = float(data.get('market_value', 0.0))

    return positions_map

def _aggregate_position_maps(position_maps: List[Dict[str, Dict[str, float]]]) -> List[Dict[str, float]]:
    aggregated: Dict[str, Dict[str, float]] = {}

    for position_map in position_maps:
        for ticker, data in position_map.items():
            entry = aggregated.setdefault(
                ticker,
                {
                    "ticker": ticker,
                    "name": data.get('name') or ticker,
                    "quantity": 0.0,
                    "book_value": 0.0,
                    "market_value": 0.0
                }
            )
            entry['quantity'] += _safe_float(data.get('quantity'))
            entry['book_value'] += _safe_float(data.get('book_value'))
            if entry['name'] == ticker and data.get('name'):
                entry['name'] = data['name']

    result = []
    for ticker, entry in aggregated.items():
        if ticker != 'CASH' and abs(entry['quantity']) < 1e-9:
            continue
        if ticker == 'CASH' and abs(entry['quantity']) < 1e-9 and abs(entry['book_value']) < 1e-9:
            continue
        result.append({
            "ticker": ticker,
            "name": entry.get('name') or ticker,
            "quantity": float(entry['quantity']),
            "book_value": float(entry['book_value']),
            "market_value": float(entry['market_value'])
        })

    result.sort(key=lambda item: (item['ticker'] != 'CASH', item['ticker']))
    return result


def _build_aggregated_positions(
    db,
    account_ids: List[str],
    as_of: Optional[datetime],
    user_id: Optional[str] = None
) -> List[Dict[str, float]]:
    position_maps: List[Dict[str, Dict[str, float]]] = []

    if as_of:
        name_lookup: Dict[str, str] = {}
        for acc_id in account_ids:
            for pos in db.find("positions", {"account_id": acc_id}):
                ticker = pos.get("ticker")
                name = pos.get("name")
                if ticker and name and ticker not in name_lookup:
                    name_lookup[ticker] = name

        for acc_id in account_ids:
            position_maps.append(
                _compute_account_positions_from_transactions(db, acc_id, as_of, name_lookup)
            )
    else:
        for acc_id in account_ids:
            account_positions = db.find("positions", {"account_id": acc_id})
            position_map: Dict[str, Dict[str, float]] = {}
            for pos in account_positions:
                ticker = pos.get("ticker")
                if not ticker:
                    continue
                position_map[ticker] = {
                    "ticker": ticker,
                    "name": pos.get("name", ticker),
                    "quantity": _safe_float(pos.get("quantity")),
                    "book_value": _safe_float(pos.get("book_value")),
                    "market_value": _safe_float(pos.get("market_value"))
                }
            if position_map:
                position_maps.append(position_map)

    if not position_maps:
        return []

    aggregated = _aggregate_position_maps(position_maps)

    tickers_for_quote = [pos['ticker'] for pos in aggregated if pos['ticker'] != 'CASH']
    quote_cache: Dict[str, PriceQuote] = {
        key.upper(): value for key, value in market_service.get_cached_quotes(tickers_for_quote, as_of).items()
    }
    missing_tickers: List[str] = []
    max_attempts = settings.PRICE_FETCH_MAX_ATTEMPTS

    for position in aggregated:
        ticker = position['ticker']
        if ticker == 'CASH':
            position['price'] = 1.0
            position['market_value'] = float(position['quantity'])
            position['price_source'] = 'cash'
            position['price_fetched_at'] = datetime.utcnow().isoformat()
            position['has_live_price'] = True
            position['price_pending'] = False
            position['price_failed'] = False
            continue

        quote = quote_cache.get(ticker.upper())

        position['price_source'] = getattr(quote, "source", None)
        fetched_at = getattr(quote, "fetched_at", None)
        position['price_fetched_at'] = fetched_at.isoformat() if fetched_at else None
        has_live = bool(getattr(quote, "price", None) is not None and getattr(quote, "is_live", False))
        position['has_live_price'] = has_live

        if has_live:
            price_value = float(quote.price)
            position['price'] = price_value
            position['market_value'] = price_value * float(position['quantity'])
            position['price_pending'] = False
            position['price_failed'] = False
            price_cache.reset_price_retry_count(ticker, as_of)
        else:
            position['price'] = None
            position['market_value'] = 0.0
            retry_count = price_cache.get_price_retry_count(ticker, as_of)
            position['price_failed'] = retry_count >= max_attempts
            position['price_pending'] = not position['price_failed']
            if not position['price_failed']:
                missing_tickers.append(ticker)

    metadata_lookup: Dict[str, Dict] = {}
    type_lookup: Dict[str, Dict] = {}
    industry_lookup: Dict[str, Dict] = {}

    if user_id:
        for record in db.find("instrument_types", {"user_id": user_id}):
            type_lookup[record["id"]] = record
        for record in db.find("instrument_industries", {"user_id": user_id}):
            industry_lookup[record["id"]] = record
        for record in db.find("instrument_metadata", {"user_id": user_id}):
            ticker_key = (record.get("ticker") or "").upper()
            if ticker_key:
                metadata_lookup[ticker_key] = record

    for position in aggregated:
        ticker_key = (position.get("ticker") or "").upper()
        meta = metadata_lookup.get(ticker_key)
        type_id = meta.get("instrument_type_id") if meta else None
        industry_id = meta.get("instrument_industry_id") if meta else None
        type_info = type_lookup.get(type_id) if type_id else None
        industry_info = industry_lookup.get(industry_id) if industry_id else None

        position["instrument_type_id"] = type_id
        position["instrument_type_name"] = type_info.get("name") if type_info else None
        position["instrument_type_color"] = type_info.get("color") if type_info else None
        position["instrument_industry_id"] = industry_id
        position["instrument_industry_name"] = industry_info.get("name") if industry_info else None
        position["instrument_industry_color"] = industry_info.get("color") if industry_info else None

    if missing_tickers:
        unique = sorted({t.upper() for t in missing_tickers})
        enqueue_price_fetch_job(unique, as_of.isoformat() if as_of else None)

    return aggregated


def _matches_classification(value: Optional[str], target: Optional[str]) -> bool:
    if not target:
        return True
    if target == UNCLASSIFIED_SENTINEL:
        return not value
    return value == target


def _filter_positions_by_classification(
    positions: List[Dict[str, float]],
    instrument_type_id: Optional[str],
    instrument_industry_id: Optional[str]
) -> List[Dict[str, float]]:
    if not instrument_type_id and not instrument_industry_id:
        return positions

    filtered: List[Dict[str, float]] = []
    for position in positions:
        if not _matches_classification(position.get("instrument_type_id"), instrument_type_id):
            continue
        if not _matches_classification(position.get("instrument_industry_id"), instrument_industry_id):
            continue
        filtered.append(position)
    return filtered


def _build_breakdown_slices(
    positions: List[Dict[str, float]],
    key_id: str,
    key_name: str,
    key_color: str,
) -> List[Dict[str, float]]:
    slices: Dict[str, Dict] = {}
    total_market_value = 0.0

    for position in positions:
        if position.get("ticker") == "CASH":
            continue
        market_value = float(position.get("market_value") or 0.0)
        if market_value == 0:
            continue
        total_market_value += market_value
        slice_id = position.get(key_id) or UNCLASSIFIED_SENTINEL
        entry = slices.setdefault(slice_id, {
            "id": position.get(key_id),
            "name": position.get(key_name) or UNCLASSIFIED_LABEL,
            "color": position.get(key_color) or UNCLASSIFIED_COLOR,
            "market_value": 0.0,
            "percentage": 0.0,
            "position_count": 0
        })
        entry["market_value"] += market_value
        entry["position_count"] += 1

    if total_market_value <= 0:
        return []

    for entry in slices.values():
        entry["percentage"] = (entry["market_value"] / total_market_value) * 100

    ordered = sorted(slices.values(), key=lambda item: item["market_value"], reverse=True)
    return ordered

@router.post("", response_model=Position)
async def create_position(
    position: PositionCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    account = db.find_one("accounts", {"id": position.account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    position_doc = position.model_dump()
    created_position = db.insert("positions", position_doc)
    session.commit()

    return Position(**created_position)

@router.get("/aggregated", response_model=List[AggregatedPosition])
async def get_aggregated_positions(
    account_id: Optional[str] = None,
    as_of_date: Optional[str] = None,
    instrument_type_id: Optional[str] = None,
    instrument_industry_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )
        account_ids = [account_id]
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]

    if not account_ids:
        return []

    as_of: Optional[datetime] = None
    if as_of_date:
        as_of = _parse_iso_datetime(as_of_date)
        if not as_of:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid as_of_date format. Use YYYY-MM-DD or ISO 8601 datetime."
            )
        as_of = _normalize_future_as_current(as_of)
        as_of = _normalize_future_as_current(as_of)
        as_of = _normalize_future_as_current(as_of)
        as_of = _normalize_future_as_current(as_of)

    aggregated = _build_aggregated_positions(db, account_ids, as_of, current_user.id)
    filtered = _filter_positions_by_classification(aggregated, instrument_type_id, instrument_industry_id)
    return [AggregatedPosition(**position) for position in filtered]

@router.get("", response_model=List[Position])
async def get_positions(
    account_id: str = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )
        positions = db.find("positions", {"account_id": account_id})
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]

        positions = []
        for acc_id in account_ids:
            positions.extend(db.find("positions", {"account_id": acc_id}))

    return [Position(**pos) for pos in positions]

@router.get("/summary", response_model=PortfolioSummary)
async def get_portfolio_summary(
    account_id: Optional[str] = None,
    as_of_date: Optional[str] = None,
    instrument_type_id: Optional[str] = None,
    instrument_industry_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
        user_accounts = [account]
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})

    account_ids = [acc["id"] for acc in user_accounts]

    if not account_ids:
        return PortfolioSummary(
            total_market_value=0.0,
            total_book_value=0.0,
            total_gain_loss=0.0,
            total_gain_loss_percent=0.0,
            positions_count=0,
            accounts_count=0
        )

    as_of: Optional[datetime] = None
    if as_of_date:
        as_of = _parse_iso_datetime(as_of_date)
        if not as_of:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid as_of_date format. Use YYYY-MM-DD or ISO 8601 datetime."
            )

    aggregated = _build_aggregated_positions(db, account_ids, as_of, current_user.id)
    filtered = _filter_positions_by_classification(aggregated, instrument_type_id, instrument_industry_id)

    total_market_value = sum((pos.get("market_value") or 0) for pos in filtered)
    total_book_value = sum((pos.get("book_value") or 0) for pos in filtered)
    total_gain_loss = total_market_value - total_book_value
    total_gain_loss_percent = (total_gain_loss / total_book_value * 100) if total_book_value > 0 else 0
    positions_count = len([pos for pos in filtered if pos.get("ticker") != "CASH"])

    return PortfolioSummary(
        total_market_value=total_market_value,
        total_book_value=total_book_value,
        total_gain_loss=total_gain_loss,
        total_gain_loss_percent=total_gain_loss_percent,
        positions_count=positions_count,
        accounts_count=len(user_accounts)
    )


@router.get("/industry-breakdown", response_model=List[IndustryBreakdownSlice])
async def get_industry_breakdown(
    account_id: Optional[str] = None,
    as_of_date: Optional[str] = None,
    instrument_type_id: Optional[str] = None,
    instrument_industry_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
        account_ids = [account_id]
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]

    if not account_ids:
        return []

    as_of: Optional[datetime] = None
    if as_of_date:
        as_of = _parse_iso_datetime(as_of_date)
        if not as_of:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid as_of_date format. Use YYYY-MM-DD or ISO 8601 datetime."
            )

    aggregated = _build_aggregated_positions(db, account_ids, as_of, current_user.id)
    filtered = _filter_positions_by_classification(aggregated, instrument_type_id, instrument_industry_id)

    ordered = _build_breakdown_slices(
        filtered,
        "instrument_industry_id",
        "instrument_industry_name",
        "instrument_industry_color",
    )
    return [
        IndustryBreakdownSlice(
            industry_id=entry["id"],
            industry_name=entry["name"],
            color=entry["color"],
            market_value=entry["market_value"],
            percentage=entry["percentage"],
            position_count=entry["position_count"],
        )
        for entry in ordered
    ]


@router.get("/type-breakdown", response_model=List[TypeBreakdownSlice])
async def get_type_breakdown(
    account_id: Optional[str] = None,
    as_of_date: Optional[str] = None,
    instrument_type_id: Optional[str] = None,
    instrument_industry_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
        account_ids = [account_id]
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]

    if not account_ids:
        return []

    as_of: Optional[datetime] = None
    if as_of_date:
        as_of = _parse_iso_datetime(as_of_date)
        if not as_of:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid as_of_date format. Use YYYY-MM-DD or ISO 8601 datetime."
            )

    aggregated = _build_aggregated_positions(db, account_ids, as_of, current_user.id)
    filtered = _filter_positions_by_classification(aggregated, instrument_type_id, instrument_industry_id)

    ordered = _build_breakdown_slices(
        filtered,
        "instrument_type_id",
        "instrument_type_name",
        "instrument_type_color",
    )
    return [
        TypeBreakdownSlice(
            type_id=entry["id"],
            type_name=entry["name"],
            color=entry["color"],
            market_value=entry["market_value"],
            percentage=entry["percentage"],
            position_count=entry["position_count"],
        )
        for entry in ordered
    ]

@router.put("/{position_id}", response_model=Position)
async def update_position(
    position_id: str,
    position_update: PositionCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    existing_position = db.find_one("positions", {"id": position_id})
    if not existing_position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )

    account = db.find_one("accounts", {"id": existing_position["account_id"], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this position"
        )

    db.update(
        "positions",
        {"id": position_id},
        position_update.model_dump()
    )
    session.commit()

    updated_position = db.find_one("positions", {"id": position_id})
    return Position(**updated_position)

@router.post("/refresh-prices")
async def refresh_market_prices(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Queue a background job to refresh all market prices from data sources.
    Returns immediately with a job ID that can be used to check progress.
    """
    from app.services.job_queue import enqueue_price_fetch_job

    db = get_db_service(session)

    # Get all unique tickers for this user
    user_accounts = db.find("accounts", {"user_id": current_user.id})
    account_ids = [acc["id"] for acc in user_accounts]

    all_positions = []
    for acc_id in account_ids:
        all_positions.extend(db.find("positions", {"account_id": acc_id}))

    tickers = list(set(pos["ticker"] for pos in all_positions if pos.get("ticker") and pos.get("ticker") != "CASH"))

    if not tickers:
        return {
            "message": "No tickers to refresh",
            "ticker_count": 0
        }

    # Queue the price fetch job (will fetch with use_cache=False)
    job = enqueue_price_fetch_job(tickers, as_of_date=None)

    return {
        "message": f"Price refresh job queued for {len(tickers)} tickers",
        "job_id": job.id if job else None,
        "ticker_count": len(tickers),
        "tickers": tickers
    }

@router.delete("/{position_id}")
async def delete_position(
    position_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    existing_position = db.find_one("positions", {"id": position_id})
    if not existing_position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found"
        )

    account = db.find_one("accounts", {"id": existing_position["account_id"], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this position"
        )

    db.delete("positions", {"id": position_id})
    session.commit()

    return {"message": "Position deleted successfully"}

@router.post("/recalculate")
async def recalculate_positions(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    from app.api.import_statements import recalculate_positions_from_transactions

    db = get_db_service(session)

    account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    positions_created = recalculate_positions_from_transactions(account_id, db)
    session.commit()

    return {
        "message": "Positions recalculated successfully",
        "positions_created": positions_created
    }
