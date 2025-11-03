from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from app.models.schemas import Position, PositionCreate, User, PortfolioSummary
from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.services.market_data import market_service

router = APIRouter(prefix="/positions", tags=["positions"])

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
