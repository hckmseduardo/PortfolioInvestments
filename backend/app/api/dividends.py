from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from datetime import datetime
from collections import defaultdict
from sqlalchemy.orm import Session
import re
from app.models.schemas import Dividend, DividendCreate, DividendSummary, User
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service

router = APIRouter(prefix="/dividends", tags=["dividends"])

def _extract_ticker_from_description(description: str) -> Optional[str]:
    """
    Extract stock ticker from transaction description.
    Common patterns:
    - "AAPL DIVIDEND"
    - "Dividend - MSFT"
    - "DIV GOOGL"
    - "TSLA DIV PAYMENT"
    """
    if not description:
        return None

    # Common ticker patterns (2-5 uppercase letters)
    # Look for standalone uppercase words that could be tickers
    words = description.upper().split()

    # Filter out common non-ticker words
    excluded_words = {
        'DIV', 'DIVIDEND', 'DIVIDENDS', 'PAYMENT', 'INCOME', 'DISTRIBUTION',
        'DIST', 'REINVEST', 'REINVESTMENT', 'STOCK', 'EQUITY', 'QUARTERLY',
        'ANNUAL', 'MONTHLY', 'ETF', 'FUND', 'FROM', 'TO', 'AT', 'THE', 'A',
        'AN', 'IN', 'ON', 'FOR', 'WITH', 'AND', 'OR'
    }

    for word in words:
        # Remove punctuation
        clean_word = re.sub(r'[^\w]', '', word)

        # Check if it's a potential ticker (2-5 uppercase letters, not in excluded list)
        if (2 <= len(clean_word) <= 5 and
            clean_word.isalpha() and
            clean_word.isupper() and
            clean_word not in excluded_words):
            return clean_word

    return None

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
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Dividends are now automatically tracked from cashflow transactions.
    This endpoint is deprecated. To add a dividend, categorize a cashflow transaction as 'Dividends'.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Dividends are now tracked from cashflow transactions. Categorize transactions as 'Dividends' in the Cashflow section."
    )

@router.get("", response_model=List[Dividend])
async def get_dividends(
    account_id: str = None,
    ticker: str = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    instrument_type_id: Optional[str] = None,
    instrument_industry_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Get dividend transactions from cashflow classified as 'Dividends' category.
    """
    db = get_db_service(session)
    start_dt = _parse_date(start_date, end_of_day=False)
    end_dt = _parse_date(end_date, end_of_day=True)

    # Get filtered tickers based on instrument classification
    allowed_tickers = None
    if instrument_type_id or instrument_industry_id:
        classification_query = {"user_id": current_user.id}
        if instrument_type_id:
            classification_query["instrument_type_id"] = instrument_type_id
        if instrument_industry_id:
            classification_query["instrument_industry_id"] = instrument_industry_id

        classifications = db.find("instrument_metadata", classification_query)
        allowed_tickers = set(c.get("ticker") for c in classifications if c.get("ticker"))

        # If no classifications match, return empty list
        if not allowed_tickers:
            return []

    # Query cashflow transactions with category="Dividends"
    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )

        cashflow_transactions = db.find("cashflow", {
            "account_id": account_id,
            "category": "Dividends"
        })
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]

        cashflow_transactions = []
        for acc_id in account_ids:
            cashflow_transactions.extend(db.find("cashflow", {
                "account_id": acc_id,
                "category": "Dividends"
            }))

    # Transform cashflow transactions to dividend format
    dividends = []
    for txn in cashflow_transactions:
        # Extract ticker from description
        extracted_ticker = _extract_ticker_from_description(txn.get("description", ""))

        # Filter by ticker if specified
        if ticker and extracted_ticker != ticker:
            continue

        # Filter by instrument classification tickers
        if allowed_tickers is not None and extracted_ticker not in allowed_tickers:
            continue

        # Create dividend record from cashflow transaction
        dividend_record = {
            "id": txn.get("id"),
            "account_id": txn.get("account_id"),
            "date": txn.get("date"),
            "ticker": extracted_ticker or "UNKNOWN",
            "amount": txn.get("amount", 0),
            "currency": "CAD",  # Default currency, could be enhanced later
            "description": txn.get("description", "")
        }
        dividends.append(dividend_record)

    # Filter by date
    dividends = _filter_dividends_by_date(dividends, start_dt, end_dt)

    # Sort by date
    dividends = sorted(dividends, key=lambda item: item.get("date", ""), reverse=True)

    return [Dividend(**div) for div in dividends]

@router.get("/summary", response_model=DividendSummary)
async def get_dividend_summary(
    account_id: str = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    instrument_type_id: Optional[str] = None,
    instrument_industry_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Get dividend summary from cashflow transactions classified as 'Dividends' category.
    """
    db = get_db_service(session)
    start_dt = _parse_date(start_date, end_of_day=False)
    end_dt = _parse_date(end_date, end_of_day=True)

    # Get filtered tickers based on instrument classification
    allowed_tickers = None
    if instrument_type_id or instrument_industry_id:
        classification_query = {"user_id": current_user.id}
        if instrument_type_id:
            classification_query["instrument_type_id"] = instrument_type_id
        if instrument_industry_id:
            classification_query["instrument_industry_id"] = instrument_industry_id

        classifications = db.find("instrument_metadata", classification_query)
        allowed_tickers = set(c.get("ticker") for c in classifications if c.get("ticker"))

        # If no classifications match, return empty summary
        if not allowed_tickers:
            return DividendSummary(
                total_dividends=0,
                dividends_by_month={},
                dividends_by_ticker={},
                period_start=start_dt.isoformat() if start_dt else None,
                period_end=end_dt.isoformat() if end_dt else None
            )

    # Query cashflow transactions with category="Dividends"
    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )
        cashflow_transactions = db.find("cashflow", {
            "account_id": account_id,
            "category": "Dividends"
        })
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc["id"] for acc in user_accounts]

        cashflow_transactions = []
        for acc_id in account_ids:
            cashflow_transactions.extend(db.find("cashflow", {
                "account_id": acc_id,
                "category": "Dividends"
            }))

    # Transform cashflow transactions to dividend format
    dividends = []
    for txn in cashflow_transactions:
        extracted_ticker = _extract_ticker_from_description(txn.get("description", ""))

        # Filter by instrument classification tickers
        if allowed_tickers is not None and extracted_ticker not in allowed_tickers:
            continue

        dividend_record = {
            "ticker": extracted_ticker or "UNKNOWN",
            "amount": txn.get("amount", 0),
            "date": txn.get("date")
        }
        dividends.append(dividend_record)

    # Filter by date
    dividends = _filter_dividends_by_date(dividends, start_dt, end_dt)

    total_dividends = sum(div.get("amount", 0) for div in dividends)

    by_month = defaultdict(float)
    by_ticker = defaultdict(float)
    by_type = defaultdict(float)
    by_industry = defaultdict(float)

    # Get instrument metadata for classification
    all_metadata = db.find("instrument_metadata", {"user_id": current_user.id})
    metadata_lookup = {meta.get("ticker"): meta for meta in all_metadata if meta.get("ticker")}

    # Get type and industry names
    all_types = db.find("instrument_types", {"user_id": current_user.id})
    type_lookup = {t.get("id"): t.get("name", "Unknown") for t in all_types}

    all_industries = db.find("instrument_industries", {"user_id": current_user.id})
    industry_lookup = {i.get("id"): i.get("name", "Unknown") for i in all_industries}

    for div in dividends:
        ticker = div.get("ticker", "Unknown")
        amount = div.get("amount", 0)

        by_ticker[ticker] += amount

        # Aggregate by type
        metadata = metadata_lookup.get(ticker)
        if metadata:
            type_id = metadata.get("instrument_type_id")
            if type_id:
                type_name = type_lookup.get(type_id, "Unknown")
                by_type[type_name] += amount

            industry_id = metadata.get("instrument_industry_id")
            if industry_id:
                industry_name = industry_lookup.get(industry_id, "Unknown")
                by_industry[industry_name] += amount

        date_str = div.get("date", "")
        if date_str:
            try:
                date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                month_key = date.strftime("%Y-%m")
                by_month[month_key] += amount
            except:
                pass

    return DividendSummary(
        total_dividends=total_dividends,
        dividends_by_month=dict(by_month),
        dividends_by_ticker=dict(by_ticker),
        dividends_by_type=dict(by_type),
        dividends_by_industry=dict(by_industry),
        period_start=start_dt.isoformat() if start_dt else None,
        period_end=end_dt.isoformat() if end_dt else None
    )

@router.delete("/{dividend_id}")
async def delete_dividend(
    dividend_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Dividends are now automatically tracked from cashflow transactions.
    This endpoint is deprecated. To remove a dividend, recategorize the cashflow transaction.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Dividends are now tracked from cashflow transactions. To remove, recategorize the transaction in the Cashflow section."
    )
