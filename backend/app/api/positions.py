import logging
from datetime import datetime
from typing import List, Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from app.models.schemas import (
    Position,
    PositionCreate,
    User,
    PortfolioSummary,
    AggregatedPosition
)
from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.services.market_data import market_service

router = APIRouter(prefix="/positions", tags=["positions"])
logger = logging.getLogger(__name__)

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

@router.post("", response_model=Position)
async def create_position(
    position: PositionCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    account = db.find_one("accounts", {"id": position.account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    position_doc = position.model_dump()
    created_position = db.insert("positions", position_doc)
    
    return Position(**created_position)

@router.get("/aggregated", response_model=List[AggregatedPosition])
async def get_aggregated_positions(
    account_id: Optional[str] = None,
    as_of_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()

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

    position_maps: List[Dict[str, Dict[str, float]]] = []

    if as_of_date:
        as_of = _parse_iso_datetime(as_of_date)
        if not as_of:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid as_of_date format. Use YYYY-MM-DD or ISO 8601 datetime."
            )
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
        as_of = None
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

    price_cache: Dict[str, Optional[float]] = {}

    for position in aggregated:
        ticker = position['ticker']
        if ticker == 'CASH':
            position['price'] = 1.0
            position['market_value'] = float(position['quantity'])
            continue

        if ticker in price_cache:
            price = price_cache[ticker]
        else:
            price = None
            try:
                if as_of:
                    price = market_service.get_historical_price(ticker, as_of)
                else:
                    price = market_service.get_current_price(ticker)
                price_cache[ticker] = price
            except Exception as exc:
                logger.warning("Failed to fetch market price for %s: %s", ticker, exc)
                price_cache[ticker] = None

        if price is not None:
            position['price'] = float(price)
            position['market_value'] = float(price) * float(position['quantity'])
        else:
            fallback_price = (
                (position['book_value'] / position['quantity'])
                if position['quantity']
                else 0.0
            )
            position['price'] = fallback_price
            position['market_value'] = fallback_price * float(position['quantity'])

    return [AggregatedPosition(**position) for position in aggregated]

@router.get("", response_model=List[Position])
async def get_positions(
    account_id: str = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
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
async def get_portfolio_summary(current_user: User = Depends(get_current_user)):
    db = get_db()
    
    user_accounts = db.find("accounts", {"user_id": current_user.id})
    account_ids = [acc["id"] for acc in user_accounts]
    
    all_positions = []
    for acc_id in account_ids:
        all_positions.extend(db.find("positions", {"account_id": acc_id}))
    
    total_market_value = sum(pos.get("market_value", 0) for pos in all_positions)
    total_book_value = sum(pos.get("book_value", 0) for pos in all_positions)
    total_gain_loss = total_market_value - total_book_value
    total_gain_loss_percent = (total_gain_loss / total_book_value * 100) if total_book_value > 0 else 0
    
    return PortfolioSummary(
        total_market_value=total_market_value,
        total_book_value=total_book_value,
        total_gain_loss=total_gain_loss,
        total_gain_loss_percent=total_gain_loss_percent,
        positions_count=len(all_positions),
        accounts_count=len(user_accounts)
    )

@router.put("/{position_id}", response_model=Position)
async def update_position(
    position_id: str,
    position_update: PositionCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
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
    
    updated_position = db.find_one("positions", {"id": position_id})
    return Position(**updated_position)

@router.post("/refresh-prices")
async def refresh_market_prices(current_user: User = Depends(get_current_user)):
    db = get_db()
    
    user_accounts = db.find("accounts", {"user_id": current_user.id})
    account_ids = [acc["id"] for acc in user_accounts]
    
    all_positions = []
    for acc_id in account_ids:
        all_positions.extend(db.find("positions", {"account_id": acc_id}))
    
    tickers = list(set(pos["ticker"] for pos in all_positions if pos.get("ticker")))
    
    prices = market_service.get_multiple_prices(tickers)
    
    updated_count = 0
    for position in all_positions:
        ticker = position.get("ticker")
        if ticker in prices:
            new_market_value = position["quantity"] * prices[ticker]
            db.update(
                "positions",
                {"id": position["id"]},
                {"market_value": new_market_value}
            )
            updated_count += 1
    
    return {"message": f"Updated {updated_count} positions", "prices": prices}

@router.delete("/{position_id}")
async def delete_position(
    position_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()

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

    return {"message": "Position deleted successfully"}

@router.post("/recalculate")
async def recalculate_positions(
    account_id: str,
    current_user: User = Depends(get_current_user)
):
    from app.api.import_statements import recalculate_positions_from_transactions

    db = get_db()

    account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    positions_created = recalculate_positions_from_transactions(account_id, db)

    return {
        "message": "Positions recalculated successfully",
        "positions_created": positions_created
    }
