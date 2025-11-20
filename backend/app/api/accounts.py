from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.schemas import Account, AccountCreate, User
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service
from app.database.models import PlaidAccount as PlaidAccountModel, PlaidItem
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])


class PlaidItemInfo(BaseModel):
    """Information about a Plaid item and all accounts linked to it"""
    item_id: str
    institution_name: str
    linked_accounts: List[dict]  # List of accounts linked to this Plaid item

@router.post("", response_model=Account)
async def create_account(
    account: AccountCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    account_doc = {
        **account.model_dump(),
        "user_id": current_user.id
    }

    created_account = db.insert("accounts", account_doc)
    session.commit()
    return Account(**created_account)

@router.get("", response_model=List[Account])
async def get_accounts(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    accounts_data = db.find("accounts", {"user_id": current_user.id})

    # Enrich accounts with Plaid information
    enriched_accounts = []
    for acc in accounts_data:
        # Check if account is linked to Plaid
        plaid_account = session.query(PlaidAccountModel).filter(
            PlaidAccountModel.account_id == acc["id"]
        ).first()

        if plaid_account:
            # Get the Plaid item to fetch institution name
            plaid_item = session.query(PlaidItem).filter(
                PlaidItem.id == plaid_account.plaid_item_id
            ).first()

            acc["is_plaid_linked"] = True
            acc["plaid_item_id"] = plaid_account.plaid_item_id
            acc["plaid_institution_name"] = plaid_item.institution_name if plaid_item else None
        else:
            acc["is_plaid_linked"] = False
            acc["plaid_item_id"] = None
            acc["plaid_institution_name"] = None

        enriched_accounts.append(Account(**acc))

    return enriched_accounts

@router.get("/{account_id}", response_model=Account)
async def get_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    return Account(**account)

@router.put("/{account_id}", response_model=Account)
async def update_account(
    account_id: str,
    account_update: AccountCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    existing_account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not existing_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    db.update(
        "accounts",
        {"id": account_id},
        account_update.model_dump()
    )

    session.commit()
    updated_account = db.find_one("accounts", {"id": account_id})
    return Account(**updated_account)

@router.get("/{account_id}/plaid-item", response_model=PlaidItemInfo)
async def get_account_plaid_item(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Get Plaid item information for an account, including all accounts linked to the same item.
    This is useful for the disconnect flow to show users all accounts that will be affected.
    """
    db = get_db_service(session)

    # Verify account belongs to user
    account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Get Plaid account mapping
    plaid_account = session.query(PlaidAccountModel).filter(
        PlaidAccountModel.account_id == account_id
    ).first()

    if not plaid_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account is not linked to Plaid"
        )

    # Get Plaid item
    plaid_item = session.query(PlaidItem).filter(
        PlaidItem.id == plaid_account.plaid_item_id
    ).first()

    if not plaid_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plaid item not found"
        )

    # Get all accounts linked to this Plaid item
    all_plaid_accounts = session.query(PlaidAccountModel).filter(
        PlaidAccountModel.plaid_item_id == plaid_item.id
    ).all()

    # Fetch account details for each linked account
    linked_accounts = []
    for pa in all_plaid_accounts:
        acc = db.find_one("accounts", {"id": pa.account_id})
        if acc:
            linked_accounts.append({
                "id": acc["id"],
                "label": acc.get("label", ""),
                "account_type": acc["account_type"],
                "account_number": acc["account_number"],
                "institution": acc["institution"],
                "balance": acc["balance"]
            })

    return PlaidItemInfo(
        item_id=plaid_item.id,
        institution_name=plaid_item.institution_name,
        linked_accounts=linked_accounts
    )


@router.delete("/{account_id}/plaid-transactions")
async def delete_plaid_transactions(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Delete all Plaid-synced transactions for an account.
    This removes transactions that were imported via Plaid sync (have plaid_transaction_id).
    Statement-imported transactions are preserved.
    Runs as a background job.
    """
    from app.services.job_queue import enqueue_delete_plaid_transactions_job

    db = get_db_service(session)

    # Verify account belongs to user
    existing_account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not existing_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    logger.info(
        f"Enqueuing delete Plaid transactions job for account {account_id} ({existing_account.get('label')})"
    )

    # Enqueue the deletion as a background job
    job = enqueue_delete_plaid_transactions_job(current_user.id, account_id)

    return {
        "message": "Delete Plaid transactions job started",
        "job_id": job.id
    }


@router.delete("/{account_id}")
async def delete_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    existing_account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not existing_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    db.delete("accounts", {"id": account_id})
    db.delete("positions", {"account_id": account_id})
    db.delete("transactions", {"account_id": account_id})
    db.delete("dividends", {"account_id": account_id})
    db.delete("cashflow", {"account_id": account_id})

    session.commit()
    return {"message": "Account deleted successfully"}


class FixBalanceRequest(BaseModel):
    current_balance: float


@router.post("/{account_id}/fix-balance")
async def fix_account_balance(
    account_id: str,
    request: FixBalanceRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Fix account balance by setting the last transaction's balance and recalculating backward.

    This uses the current available balance from the institution as an anchor point
    and recalculates all transaction balances working backward chronologically.
    """
    from app.database.models import Transaction, Account as AccountModel
    from sqlalchemy import cast, Date

    db = get_db_service(session)

    # Verify account belongs to user
    account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Get all transactions for this account, ordered chronologically
    transactions = session.query(Transaction).filter(
        Transaction.account_id == account_id
    ).order_by(
        cast(Transaction.date, Date).asc(),
        Transaction.total.desc(),
        Transaction.id.asc()
    ).all()

    if not transactions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account has no transactions to fix"
        )

    # Set the last transaction's expected_balance to the current balance
    last_transaction = transactions[-1]
    last_transaction.expected_balance = round(request.current_balance, 2)

    # Calculate backward from the last transaction
    running_balance = request.current_balance
    for txn in reversed(transactions[:-1]):  # Skip the last one we already set
        running_balance -= txn.total
        txn.expected_balance = round(running_balance, 2)

    # Update the account's current balance to match the last transaction's expected_balance
    account_model = session.query(AccountModel).filter(AccountModel.id == account_id).first()
    if account_model:
        old_balance = account_model.balance
        # Set the account balance to the last transaction's expected_balance
        account_model.balance = last_transaction.expected_balance

        logger.info(
            f"Fix balance for account {account_id}: "
            f"Old balance: ${old_balance:.2f} -> New: ${account_model.balance:.2f}"
        )

    session.commit()

    # Verify the update was saved
    account_model = session.query(AccountModel).filter(AccountModel.id == account_id).first()
    logger.info(f"After commit - Account balance: ${account_model.balance:.2f}")

    return {
        "message": "Balance fixed successfully",
        "transactions_updated": len(transactions),
        "current_balance": round(request.current_balance, 2),
        "anchor_balance": round(request.current_balance, 2)
    }
