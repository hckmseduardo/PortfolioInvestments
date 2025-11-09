from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from sqlalchemy.orm import Session
from app.models.schemas import Account, AccountCreate, User
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service

router = APIRouter(prefix="/accounts", tags=["accounts"])

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
    accounts = db.find("accounts", {"user_id": current_user.id})
    return [Account(**acc) for acc in accounts]

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
    db.delete("expenses", {"account_id": account_id})

    session.commit()
    return {"message": "Account deleted successfully"}
