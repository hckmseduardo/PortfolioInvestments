from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from typing import List, Optional, Dict
from datetime import datetime, timezone, date
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.models.schemas import Transaction, TransactionCreate, User
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _get_date_only(txn: Dict) -> date:
    """Extract date part from transaction's date field."""
    txn_date = txn.get('date', '')
    if isinstance(txn_date, datetime):
        return txn_date.date()
    elif isinstance(txn_date, date):
        return txn_date
    elif isinstance(txn_date, str):
        try:
            parsed = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))
            return parsed.date()
        except (ValueError, AttributeError):
            return date.min
    return date.min


class BalanceFixRequest(BaseModel):
    """Request model for fixing transaction balance"""
    corrected_balance: float


def _calculate_running_balances(
    db,
    transactions: List[Dict],
    account_id: Optional[str],
    start_date: Optional[datetime],
    user_id: str
) -> List[Dict]:
    """
    Calculate running balance for each transaction, respecting stored balances.

    Priority order for balance calculation:
    1. Use stored expected_balance (from validation during import)
    2. Use actual_balance as anchor point (from statement imports)
    3. Calculate from previous balance + transaction total (for manual entries)

    For single account: Calculate running balance starting from opening_balance
    For multiple accounts: Calculate separate running balances per account
    With date filters: Start from balance as of start_date
    """
    if not transactions:
        return transactions

    # Group transactions by account for multi-account scenarios
    if account_id:
        # Single account - simpler calculation
        account = db.find_one("accounts", {"id": account_id})
        starting_balance = _get_starting_balance(db, account, start_date)

        # Sort transactions by date ASC (oldest first, date part only), then by value DESC (credits before debits), then by ID
        sorted_txns = sorted(transactions, key=lambda x: (
            _get_date_only(x),
            -x.get('total', 0.0),  # Negative for descending order
            x.get('id', '')
        ))

        # Calculate running balance, respecting stored balances
        running_balance = starting_balance
        for txn in sorted_txns:
            # Priority 1: Use stored expected_balance (from validation)
            if txn.get('expected_balance') is not None:
                running_balance = txn['expected_balance']
            # Priority 2: Use actual_balance as anchor (from statement imports)
            elif txn.get('actual_balance') is not None:
                running_balance = txn['actual_balance']
            # Priority 3: Calculate from previous balance
            else:
                running_balance += txn.get('total', 0.0)

            txn['running_balance'] = round(running_balance, 2)
    else:
        # Multiple accounts - calculate per-account balances
        accounts_map = {}
        user_accounts = db.find("accounts", {"user_id": user_id})
        for acc in user_accounts:
            acc_id = acc['id']
            accounts_map[acc_id] = {
                'account': acc,
                'balance': _get_starting_balance(db, acc, start_date),
                'transactions': []
            }

        # Group transactions by account
        for txn in transactions:
            acc_id = txn.get('account_id')
            if acc_id in accounts_map:
                accounts_map[acc_id]['transactions'].append(txn)

        # Calculate running balance for each account, respecting stored balances
        for acc_id, acc_data in accounts_map.items():
            # Sort transactions by date ASC (oldest first, date part only), then by value DESC (credits before debits), then by ID
            sorted_txns = sorted(acc_data['transactions'], key=lambda x: (
                _get_date_only(x),
                -x.get('total', 0.0),  # Negative for descending order
                x.get('id', '')
            ))

            running_balance = acc_data['balance']
            for txn in sorted_txns:
                # Priority 1: Use stored expected_balance (from validation)
                if txn.get('expected_balance') is not None:
                    running_balance = txn['expected_balance']
                # Priority 2: Use actual_balance as anchor (from statement imports)
                elif txn.get('actual_balance') is not None:
                    running_balance = txn['actual_balance']
                # Priority 3: Calculate from previous balance
                else:
                    running_balance += txn.get('total', 0.0)

                txn['running_balance'] = round(running_balance, 2)

    return transactions


def _get_starting_balance(db, account: Dict, start_date: Optional[datetime]) -> float:
    """
    Get the starting balance for an account as of the start_date.

    If start_date is provided, calculate balance up to that date.
    Otherwise, use opening_balance if available.
    """
    opening_balance = account.get('opening_balance', 0.0) or 0.0
    opening_balance_date = account.get('opening_balance_date')

    # Ensure opening_balance_date is timezone-aware if it exists
    if opening_balance_date:
        if isinstance(opening_balance_date, str):
            opening_balance_date = datetime.fromisoformat(opening_balance_date.replace('Z', '+00:00'))
        if not opening_balance_date.tzinfo:
            opening_balance_date = opening_balance_date.replace(tzinfo=timezone.utc)

    # If no start_date filter, return opening_balance
    if not start_date:
        return opening_balance

    # If start_date is before or equal to opening_balance_date, return opening_balance
    if opening_balance_date and start_date <= opening_balance_date:
        return opening_balance

    # Calculate balance as of start_date
    # Get all transactions from opening_balance_date to start_date (exclusive)
    account_id = account['id']
    all_transactions = db.find("transactions", {"account_id": account_id})

    balance = opening_balance
    for txn in all_transactions:
        txn_date = txn.get('date')
        if isinstance(txn_date, str):
            txn_date = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))
        if not txn_date.tzinfo:
            txn_date = txn_date.replace(tzinfo=timezone.utc)

        # Skip transactions before opening balance date
        if opening_balance_date and txn_date < opening_balance_date:
            continue

        # Only include transactions before start_date
        if txn_date < start_date:
            balance += txn.get('total', 0.0)

    return balance

@router.get("", response_model=List[Transaction])
async def get_transactions(
    account_id: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    include_balance: bool = Query(False),
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

    # Ensure start_date and end_date are timezone-aware
    if start_date and not start_date.tzinfo:
        start_date = start_date.replace(tzinfo=timezone.utc)
    if end_date and not end_date.tzinfo:
        end_date = end_date.replace(tzinfo=timezone.utc)

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

    # Calculate running balance if requested
    if include_balance:
        transactions = _calculate_running_balances(
            db, transactions, account_id, start_date, current_user.id
        )

    # Sort by date DESC (newest first), then by value ASC (debits before credits for display)
    # Balance was calculated with credits first, but display shows debits first
    transactions.sort(
        key=lambda x: (
            -_get_date_only(x).toordinal() if _get_date_only(x) != date.min else float('-inf'),  # Negative for DESC date
            x.get('total', 0.0),  # ASC value (most negative/debits first, then credits)
            x.get('id', '')  # ASC by ID
        )
    )

    return [Transaction(**txn) for txn in transactions]

@router.get("/balance")
async def get_account_balance(
    account_id: Optional[str] = Query(None),
    as_of_date: Optional[datetime] = Query(None),
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
        transactions = db.find("transactions", {"account_id": account_id})

        # Start with opening balance if available
        balance = account.get('opening_balance', 0.0) or 0.0
        opening_balance_date = account.get('opening_balance_date')
    else:
        accounts = db.find("accounts", {"user_id": current_user.id})
        account_ids = [acc['id'] for acc in accounts]
        all_transactions = db.find("transactions", {})
        transactions = [txn for txn in all_transactions if txn.get('account_id') in account_ids]

        # Start with sum of all opening balances
        balance = sum(acc.get('opening_balance', 0.0) or 0.0 for acc in accounts)
        opening_balance_date = None  # Multiple accounts may have different dates

    # Ensure as_of_date is timezone-aware for accurate comparisons
    if as_of_date and not as_of_date.tzinfo:
        as_of_date = as_of_date.replace(tzinfo=timezone.utc)

    # Ensure opening_balance_date is timezone-aware if it exists
    if opening_balance_date:
        if isinstance(opening_balance_date, str):
            opening_balance_date = datetime.fromisoformat(opening_balance_date.replace('Z', '+00:00'))
        if not opening_balance_date.tzinfo:
            opening_balance_date = opening_balance_date.replace(tzinfo=timezone.utc)

    for txn in transactions:
        txn_date = txn.get('date')
        if isinstance(txn_date, str):
            txn_date = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))

        if not txn_date.tzinfo:
            txn_date = txn_date.replace(tzinfo=timezone.utc)

        # Skip transactions before opening balance date (they're already included in opening balance)
        if opening_balance_date and txn_date < opening_balance_date:
            continue

        if as_of_date and txn_date > as_of_date:
            continue

        txn_type = txn.get('type', '')
        total = txn.get('total', 0.0)

        # Simply add the total - it's already signed correctly
        # (positive for credits, negative for debits)
        balance += total

    return {
        "account_id": account_id,
        "balance": round(balance, 2),
        "as_of_date": as_of_date or datetime.now()
    }

@router.post("", response_model=Transaction)
async def create_transaction(
    transaction: TransactionCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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
    session.commit()
    return Transaction(**created_transaction)

@router.delete("/{transaction_id}")
async def delete_transaction(
    transaction_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

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
    session.commit()

    return {"message": "Transaction deleted successfully"}


@router.patch("/{transaction_id}/fix-balance")
async def fix_transaction_balance(
    transaction_id: str,
    request: BalanceFixRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Fix balance inconsistency for a transaction by setting the actual balance.
    This will recalculate expected balances for all subsequent transactions.

    Args:
        transaction_id: ID of the transaction to fix
        request: Request containing the corrected balance
        current_user: Authenticated user
        session: Database session

    Returns:
        Dictionary with success status and count of revalidated transactions
    """
    from app.database.models import Transaction as TransactionModel, Account as AccountModel

    TOLERANCE = 1.00  # $1.00 tolerance for balance inconsistencies

    # Get the transaction
    transaction = session.query(TransactionModel).filter(
        TransactionModel.id == transaction_id
    ).first()

    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found"
        )

    # Verify user owns this transaction's account
    account = session.query(AccountModel).filter(
        AccountModel.id == transaction.account_id,
        AccountModel.user_id == current_user.id
    ).first()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to modify this transaction"
        )

    # Update the transaction's actual balance
    corrected_balance = request.corrected_balance
    transaction.actual_balance = corrected_balance

    # Get all transactions for this account, ordered chronologically
    # Sort by date (date part only), then by value DESC (credits before debits), then by ID
    from sqlalchemy import cast, Date
    all_transactions = session.query(TransactionModel).filter(
        TransactionModel.account_id == transaction.account_id
    ).order_by(
        cast(TransactionModel.date, Date).asc(),
        TransactionModel.total.desc(),
        TransactionModel.id.asc()
    ).all()

    # Find the index of the corrected transaction
    corrected_index = next(
        (i for i, txn in enumerate(all_transactions) if txn.id == transaction_id),
        None
    )

    if corrected_index is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not find transaction in account history"
        )

    # Recalculate balances starting from the corrected transaction
    # Use the corrected actual_balance as the new starting point
    revalidated_count = 0

    # For the corrected transaction itself
    transaction.has_balance_inconsistency = False
    transaction.balance_discrepancy = None
    revalidated_count += 1

    # Recalculate for all subsequent transactions
    running_balance = corrected_balance

    for txn in all_transactions[corrected_index + 1:]:
        running_balance += txn.total
        txn.expected_balance = round(running_balance, 2)

        # Check if this transaction has an actual_balance to validate against
        if txn.actual_balance is not None:
            discrepancy = abs(txn.expected_balance - txn.actual_balance)
            if discrepancy > TOLERANCE:
                txn.has_balance_inconsistency = True
                txn.balance_discrepancy = round(txn.expected_balance - txn.actual_balance, 2)
            else:
                txn.has_balance_inconsistency = False
                txn.balance_discrepancy = None
                # Use actual_balance as the new reference point
                running_balance = txn.actual_balance
        else:
            # No actual balance to compare against, assume it's correct
            txn.has_balance_inconsistency = False
            txn.balance_discrepancy = None

        revalidated_count += 1

    session.commit()

    return {
        "message": "Balance corrected successfully",
        "transaction_id": transaction_id,
        "corrected_balance": corrected_balance,
        "revalidated_transactions": revalidated_count
    }
