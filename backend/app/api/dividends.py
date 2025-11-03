from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from datetime import datetime
from collections import defaultdict
from app.models.schemas import Dividend, DividendCreate, DividendSummary, User
from app.api.auth import get_current_user
from app.database.json_db import get_db

router = APIRouter(prefix="/dividends", tags=["dividends"])

def _parse_date(value: Optional[str], *, end_of_day: bool = False) -> Optional[datetime]:
    if not value:
        return None

    try:
        if len(value) == 10:
            suffix = "T23:59:59.999999" if end_of_day else "T00:00:00"
            return datetime.fromisoformat(f"{value}{suffix}")
        return datetime.fromisoformat(value)
    except ValueError:
        try:
            if value.endswith("Z"):
                adjusted = value[:-1] + "+00:00"
                dt = datetime.fromisoformat(adjusted)
            else:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt
        except ValueError:
            return None

def _filter_dividends_by_date(dividends, start_dt: Optional[datetime], end_dt: Optional[datetime]):
    if not start_dt and not end_dt:
        return dividends

    filtered = []
    for div in dividends:
        date_raw = div.get("date")
        if not date_raw:
            continue
        try:
            date_obj = datetime.fromisoformat(str(date_raw).replace('Z', '+00:00'))
        except ValueError:
            if isinstance(date_raw, datetime):
                date_obj = date_raw
            else:
                continue

        if start_dt and date_obj < start_dt:
            continue
        if end_dt and date_obj > end_dt:
            continue
        filtered.append(div)

    return filtered

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
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    start_dt = _parse_date(start_date, end_of_day=False)
    end_dt = _parse_date(end_date, end_of_day=True)
    
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

    dividends = _filter_dividends_by_date(dividends, start_dt, end_dt)
    dividends = sorted(dividends, key=lambda item: item.get("date", ""), reverse=True)
    
    return [Dividend(**div) for div in dividends]

@router.get("/summary", response_model=DividendSummary)
async def get_dividend_summary(
    account_id: str = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    start_dt = _parse_date(start_date, end_of_day=False)
    end_dt = _parse_date(end_date, end_of_day=True)
    
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

    dividends = _filter_dividends_by_date(dividends, start_dt, end_dt)
    
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
        dividends_by_ticker=dict(by_ticker),
        period_start=start_dt.isoformat() if start_dt else None,
        period_end=end_dt.isoformat() if end_dt else None
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
