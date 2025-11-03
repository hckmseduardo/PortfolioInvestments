from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from datetime import datetime, timezone
from app.models.schemas import Transaction, TransactionCreate, User
from app.api.auth import get_current_user
from app.database.json_db import get_db

router = APIRouter(prefix="/transactions", tags=["transactions"])

@router.get("", response_model=List[Transaction])
async def get_transactions(
    account_id: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
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
    else:
        user_accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc['id'] for acc in user_accounts]
        if not account_ids:
            return []

        all_transactions = db.find("transactions", {})
        transactions = [txn for txn in all_transactions if txn.get('account_id') in account_ids]

    if account_id:
        transactions = db.find("transactions", query)

    if start_date or end_date:
        filtered_transactions = []
        for txn in transactions:
            txn_date = txn.get('date')
            if isinstance(txn_date, str):
                txn_date = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))

            if not txn_date.tzinfo:
                txn_date = txn_date.replace(tzinfo=timezone.utc)

            if start_date and txn_date < start_date:
                continue
            if end_date and txn_date > end_date:
                continue

            filtered_transactions.append(txn)
        transactions = filtered_transactions

    transactions.sort(key=lambda x: x.get('date', ''), reverse=True)

    return [Transaction(**txn) for txn in transactions]

@router.get("/balance")
async def get_account_balance(
    account_id: Optional[str] = Query(None),
    as_of_date: Optional[datetime] = Query(None),
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
        transactions = db.find("transactions", {"account_id": account_id})
    else:
        accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc['id'] for acc in accounts]
        all_transactions = db.find("transactions", {})
        transactions = [txn for txn in all_transactions if txn.get('account_id') in account_ids]

    # Ensure as_of_date is timezone-aware for accurate comparisons
    if as_of_date and not as_of_date.tzinfo:
        as_of_date = as_of_date.replace(tzinfo=timezone.utc)

    balance = 0.0
    for txn in transactions:
        txn_date = txn.get('date')
        if isinstance(txn_date, str):
            txn_date = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))

        if not txn_date.tzinfo:
            txn_date = txn_date.replace(tzinfo=timezone.utc)

        if as_of_date and txn_date > as_of_date:
            continue

        txn_type = txn.get('type', '')
        total = txn.get('total', 0.0)

        if txn_type in ['deposit', 'dividend', 'bonus']:
            balance += total
        elif txn_type in ['withdrawal', 'fee']:
            balance -= total
        elif txn_type == 'buy':
            balance += total
        elif txn_type == 'sell':
            balance += total

    return {
        "account_id": account_id,
        "balance": round(balance, 2),
        "as_of_date": as_of_date or datetime.now()
    }

@router.post("", response_model=Transaction)
async def create_transaction(
    transaction: TransactionCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    account = db.find_one("accounts", {"id": transaction.account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    transaction_doc = {
        **transaction.model_dump(),
        "user_id": current_user.id
    }
    
    created_transaction = db.insert("transactions", transaction_doc)
    return Transaction(**created_transaction)

@router.delete("/{transaction_id}")
async def delete_transaction(
    transaction_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    
    existing_transaction = db.find_one("transactions", {"id": transaction_id})
    if not existing_transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )
    
    account = db.find_one("accounts", {"id": existing_transaction['account_id'], "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this transaction"
        )
    
    db.delete("transactions", {"id": transaction_id})
    
    return {"message": "Transaction deleted successfully"}
