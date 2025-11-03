from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from datetime import datetime
from collections import defaultdict
from app.models.schemas import Dividend, DividendCreate, DividendSummary, User
from app.api.auth import get_current_user
from app.database.json_db import get_db

router = APIRouter(prefix="/dividends", tags=["dividends"])

@router.post("", response_model=Dividend)
async def create_dividend(
    dividend: DividendCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    account = db.find_one("accounts", {"id": dividend.account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    dividend_doc = dividend.model_dump()
    created_dividend = db.insert("dividends", dividend_doc)
    
    return Dividend(**created_dividend)

@router.get("", response_model=List[Dividend])
async def get_dividends(
    account_id: str = None,
    ticker: str = None,
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
        
        query = {"account_id": account_id}
        if ticker:
            query["ticker"] = ticker
        
        dividends = db.find("dividends", query)
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]
        
        dividends = []
        for acc_id in account_ids:
            query = {"account_id": acc_id}
            if ticker:
                query["ticker"] = ticker
            dividends.extend(db.find("dividends", query))
    
    return [Dividend(**div) for div in dividends]

@router.get("/summary", response_model=DividendSummary)
async def get_dividend_summary(
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
        dividends = db.find("dividends", {"account_id": account_id})
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]
        
        dividends = []
        for acc_id in account_ids:
            dividends.extend(db.find("dividends", {"account_id": acc_id}))
    
    total_dividends = sum(div.get("amount", 0) for div in dividends)
    
    by_month = defaultdict(float)
    by_ticker = defaultdict(float)
    
    for div in dividends:
        ticker = div.get("ticker", "Unknown")
        by_ticker[ticker] += div.get("amount", 0)
        
        date_str = div.get("date", "")
        if date_str:
            try:
                date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                month_key = date.strftime("%Y-%m")
                by_month[month_key] += div.get("amount", 0)
            except:
                pass
    
    return DividendSummary(
        total_dividends=total_dividends,
        dividends_by_month=dict(by_month),
        dividends_by_ticker=dict(by_ticker)
    )

@router.delete("/{dividend_id}")
async def delete_dividend(
    dividend_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    existing_dividend = db.find_one("dividends", {"id": dividend_id})
    if not existing_dividend:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dividend not found"
        )
    
    account = db.find_one("accounts", {"id": existing_dividend["account_id"], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this dividend"
        )
    
    db.delete("dividends", {"id": dividend_id})
    
    return {"message": "Dividend deleted successfully"}
