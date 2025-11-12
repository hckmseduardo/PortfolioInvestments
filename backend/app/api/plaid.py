"""
Plaid API Routes

Handles Plaid integration endpoints for account linking and transaction syncing.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime
from sqlalchemy.orm import Session
import logging
import uuid

from app.models.schemas import User
from app.api.auth import get_current_user
from app.database.postgres_db import get_db
from app.database.models import PlaidItem, PlaidAccount, Account, AccountTypeEnum
from app.services.plaid_client import plaid_client
from app.services.job_queue import enqueue_plaid_sync_job, get_job_info

router = APIRouter(prefix="/plaid", tags=["plaid"])
logger = logging.getLogger(__name__)


# Pydantic models for request/response
class LinkTokenResponse(BaseModel):
    link_token: str
    expiration: str


class ExchangeTokenRequest(BaseModel):
    public_token: str
    metadata: Dict[str, Any]


class PlaidItemResponse(BaseModel):
    id: str
    institution_id: str
    institution_name: str
    status: str
    created_at: str
    last_synced: Optional[str]
    accounts: List[Dict[str, Any]]


class PlaidAccountResponse(BaseModel):
    id: str
    plaid_account_id: str
    account_id: str
    name: str
    mask: Optional[str]
    type: str
    subtype: Optional[str]


class SyncResponse(BaseModel):
    job_id: str
    status: str


@router.post("/create-link-token", response_model=LinkTokenResponse)
async def create_link_token(current_user: User = Depends(get_current_user)):
    """
    Create a Plaid Link token for initializing Plaid Link in the frontend
    """
    if not plaid_client._is_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Plaid is not configured. Please set PLAID_CLIENT_ID and PLAID_SECRET."
        )

    result = plaid_client.create_link_token(
        user_id=current_user.id,
        client_name="Portfolio Investments"
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create link token"
        )

    return LinkTokenResponse(**result)


@router.post("/exchange-token")
async def exchange_public_token(
    request: ExchangeTokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Exchange public token from Plaid Link for access token and create accounts
    """
    logger.info(f"Starting Plaid token exchange for user {current_user.id}")

    try:
        # Exchange public token for access token
        exchange_result = plaid_client.exchange_public_token(request.public_token)
        if not exchange_result:
            logger.error("Failed to exchange public token - no result returned")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to exchange public token"
            )

        access_token = exchange_result['access_token']
        item_id = exchange_result['item_id']
        logger.info(f"Successfully exchanged token, item_id: {item_id}")

        # Get institution info from metadata
        institution = request.metadata.get('institution', {})
        institution_id = institution.get('institution_id', 'unknown')
        institution_name = institution.get('name', 'Unknown Institution')
        logger.info(f"Institution: {institution_name} ({institution_id})")

        # Get accounts from Plaid
        accounts_result = plaid_client.get_accounts(access_token)
        if not accounts_result:
            logger.error("Failed to retrieve accounts from Plaid - no result returned")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve accounts from Plaid"
            )

        logger.info(f"Retrieved {len(accounts_result['accounts'])} accounts from Plaid")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in Plaid token exchange: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error during Plaid token exchange: {str(e)}"
        )

    # Create PlaidItem record
    plaid_item = PlaidItem(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        access_token=access_token,  # In production, encrypt this
        item_id=item_id,
        institution_id=institution_id,
        institution_name=institution_name,
        status="active",
        created_at=datetime.utcnow(),
        last_synced=None,
        error_message=None
    )
    db.add(plaid_item)

    # Create accounts and PlaidAccount mappings
    created_accounts = []
    try:
        for idx, plaid_acc in enumerate(accounts_result['accounts']):
            logger.info(f"Processing account {idx + 1}/{len(accounts_result['accounts'])}: {plaid_acc['name']}")
            logger.info(f"  Account ID: {plaid_acc['account_id']}")
            logger.info(f"  Type: {plaid_acc['type']} (Python type: {type(plaid_acc['type']).__name__})")
            logger.info(f"  Subtype: {plaid_acc.get('subtype')} (Python type: {type(plaid_acc.get('subtype')).__name__ if plaid_acc.get('subtype') else 'None'})")

            # Map Plaid account type to our AccountTypeEnum
            acc_type = _map_plaid_account_type(
                plaid_acc['type'],
                plaid_acc.get('subtype')
            )
            logger.info(f"  Mapped to AccountTypeEnum: {acc_type}")

            # Create Account record
            current_balance = plaid_acc['balances'].get('current', 0.0) or 0.0
            account = Account(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                account_type=acc_type,
                account_number=plaid_acc.get('mask', 'XXXX'),
                institution=institution_name,
                balance=current_balance,
                label=plaid_acc['name'],
                is_plaid_linked=1,
                opening_balance=current_balance,  # Set opening balance to current Plaid balance
                opening_balance_date=datetime.utcnow(),  # Balance is as of now
                created_at=datetime.utcnow()
            )
            db.add(account)
            logger.info(f"  Created Account record with ID: {account.id}, opening balance: {current_balance}")

            # Create PlaidAccount mapping
            # Note: type/subtype should already be converted to strings in plaid_client._format_account()
            logger.info(f"  Creating PlaidAccount mapping with type={plaid_acc['type']}, subtype={plaid_acc.get('subtype')}")
            plaid_account_mapping = PlaidAccount(
                id=str(uuid.uuid4()),
                plaid_item_id=plaid_item.id,
                account_id=account.id,
                plaid_account_id=plaid_acc['account_id'],
                mask=plaid_acc.get('mask'),
                name=plaid_acc['name'],
                official_name=plaid_acc.get('official_name'),
                type=plaid_acc['type'],
                subtype=plaid_acc.get('subtype'),
                created_at=datetime.utcnow()
            )
            db.add(plaid_account_mapping)
            logger.info(f"  Created PlaidAccount mapping")

            created_accounts.append({
                "account_id": account.id,
                "plaid_account_id": plaid_acc['account_id'],
                "name": plaid_acc['name'],
                "mask": plaid_acc.get('mask'),
                "type": plaid_acc['type'],
                "subtype": plaid_acc.get('subtype'),
            })

        # Commit all changes
        logger.info(f"Committing {len(created_accounts)} accounts to database")
        db.commit()
        logger.info("Successfully committed all accounts")
    except Exception as e:
        logger.error(f"Error creating accounts: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create accounts: {str(e)}"
        )

    logger.info(
        f"Created Plaid item {plaid_item.id} with {len(created_accounts)} accounts "
        f"for user {current_user.id}"
    )

    return {
        "message": "Successfully linked accounts",
        "plaid_item_id": plaid_item.id,
        "institution_name": institution_name,
        "accounts": created_accounts,
    }


@router.get("/items", response_model=List[PlaidItemResponse])
async def get_plaid_items(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all Plaid items (bank connections) for the current user
    """
    plaid_items = db.query(PlaidItem).filter(
        PlaidItem.user_id == current_user.id
    ).all()

    result = []
    for item in plaid_items:
        # Get associated accounts
        plaid_accounts = db.query(PlaidAccount).filter(
            PlaidAccount.plaid_item_id == item.id
        ).all()

        accounts = []
        for plaid_acc in plaid_accounts:
            account = db.query(Account).filter(
                Account.id == plaid_acc.account_id
            ).first()

            if account:
                accounts.append({
                    "id": plaid_acc.id,
                    "plaid_account_id": plaid_acc.plaid_account_id,
                    "account_id": plaid_acc.account_id,
                    "name": plaid_acc.name,
                    "mask": plaid_acc.mask,
                    "type": plaid_acc.type,
                    "subtype": plaid_acc.subtype,
                    "balance": account.balance,
                })

        result.append(PlaidItemResponse(
            id=item.id,
            institution_id=item.institution_id,
            institution_name=item.institution_name,
            status=item.status,
            created_at=item.created_at.isoformat() if item.created_at else "",
            last_synced=item.last_synced.isoformat() if item.last_synced else None,
            accounts=accounts
        ))

    return result


@router.post("/sync/{plaid_item_id}", response_model=SyncResponse)
async def sync_transactions(
    plaid_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Trigger asynchronous transaction sync for a Plaid item
    """
    # Verify the item belongs to the user
    plaid_item = db.query(PlaidItem).filter(
        PlaidItem.id == plaid_item_id,
        PlaidItem.user_id == current_user.id
    ).first()

    if not plaid_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plaid item not found"
        )

    # Enqueue sync job
    job = enqueue_plaid_sync_job(current_user.id, plaid_item_id)

    return SyncResponse(
        job_id=job.id,
        status="queued"
    )


@router.post("/full-resync/{plaid_item_id}", response_model=SyncResponse)
async def full_resync_transactions(
    plaid_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Trigger a full resync of all transaction history for a Plaid item.
    This deletes the sync cursor to force reimporting all available history.
    """
    # Verify the item belongs to the user
    plaid_item = db.query(PlaidItem).filter(
        PlaidItem.id == plaid_item_id,
        PlaidItem.user_id == current_user.id
    ).first()

    if not plaid_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plaid item not found"
        )

    # Delete sync cursor so we can establish a new cursor after historical fetch
    from app.database.models import PlaidSyncCursor
    cursor_record = db.query(PlaidSyncCursor).filter(
        PlaidSyncCursor.plaid_item_id == plaid_item_id
    ).first()

    if cursor_record:
        logger.info(f"Deleting sync cursor for Plaid item {plaid_item_id} to trigger full resync")
        db.delete(cursor_record)
        db.commit()
    else:
        logger.info(f"No sync cursor found for Plaid item {plaid_item_id}, will perform initial sync")

    # Enqueue full resync job (will fetch historical transactions and establish new cursor)
    job = enqueue_plaid_sync_job(current_user.id, plaid_item_id, full_resync=True)

    logger.info(f"Full resync job {job.id} enqueued for Plaid item {plaid_item_id}")

    return SyncResponse(
        job_id=job.id,
        status="queued"
    )


@router.get("/sync-status/{job_id}")
async def get_sync_status(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Get the status of a Plaid sync job
    """
    try:
        job_info = get_job_info(job_id)

        # Verify the job belongs to the user
        if job_info.get('meta', {}).get('user_id') != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )

        return job_info
    except Exception as e:
        logger.error(f"Error fetching job info: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )


@router.get("/test-sync/{plaid_item_id}")
async def test_sync_transactions(
    plaid_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Test endpoint to see what transactions Plaid returns for this item
    """
    # Verify the item belongs to the user
    plaid_item = db.query(PlaidItem).filter(
        PlaidItem.id == plaid_item_id,
        PlaidItem.user_id == current_user.id
    ).first()

    if not plaid_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plaid item not found"
        )

    # Get sync cursor
    from app.database.models import PlaidSyncCursor
    cursor_record = db.query(PlaidSyncCursor).filter(
        PlaidSyncCursor.plaid_item_id == plaid_item_id
    ).first()

    # Sync transactions from Plaid
    sync_result = plaid_client.sync_transactions(
        access_token=plaid_item.access_token,
        cursor=cursor_record.cursor if cursor_record else None,
        count=500
    )

    if not sync_result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch transactions from Plaid"
        )

    # Get account mappings
    plaid_accounts = db.query(PlaidAccount).filter(
        PlaidAccount.plaid_item_id == plaid_item_id
    ).all()

    account_map = {pa.plaid_account_id: {"name": pa.name, "type": pa.type, "subtype": pa.subtype}
                   for pa in plaid_accounts}

    # Group transactions by account
    transactions_by_account = {}
    for txn in sync_result['added']:
        plaid_acc_id = txn['account_id']
        acc_info = account_map.get(plaid_acc_id, {"name": "Unknown", "type": "unknown", "subtype": None})
        acc_key = f"{acc_info['name']} ({acc_info['type']}/{acc_info['subtype']})"

        if acc_key not in transactions_by_account:
            transactions_by_account[acc_key] = []

        transactions_by_account[acc_key].append({
            "date": txn['date'],
            "name": txn.get('name'),
            "amount": txn['amount'],
            "pending": txn.get('pending', False)
        })

    return {
        "institution": plaid_item.institution_name,
        "total_accounts": len(plaid_accounts),
        "total_added": len(sync_result['added']),
        "total_modified": len(sync_result['modified']),
        "total_removed": len(sync_result['removed']),
        "has_more": sync_result.get('has_more', False),
        "accounts": {name: len(txns) for name, txns in transactions_by_account.items()},
        "sample_transactions": {
            name: txns[:5] for name, txns in transactions_by_account.items()
        }
    }


@router.delete("/disconnect/{plaid_item_id}")
async def disconnect_plaid_item(
    plaid_item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Disconnect a Plaid item and optionally delete associated accounts
    """
    # Verify the item belongs to the user
    plaid_item = db.query(PlaidItem).filter(
        PlaidItem.id == plaid_item_id,
        PlaidItem.user_id == current_user.id
    ).first()

    if not plaid_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plaid item not found"
        )

    # Remove from Plaid
    access_token = plaid_item.access_token
    success = plaid_client.remove_item(access_token)

    if not success:
        logger.warning(f"Failed to remove item from Plaid, continuing with local deletion")

    # Get associated accounts
    plaid_accounts = db.query(PlaidAccount).filter(
        PlaidAccount.plaid_item_id == plaid_item_id
    ).all()

    # Update accounts to mark as not Plaid-linked
    for plaid_acc in plaid_accounts:
        account = db.query(Account).filter(
            Account.id == plaid_acc.account_id
        ).first()
        if account:
            account.is_plaid_linked = 0

    # Delete PlaidAccount mappings
    db.query(PlaidAccount).filter(
        PlaidAccount.plaid_item_id == plaid_item_id
    ).delete()

    # Delete sync cursor (imported here to avoid circular import)
    from app.database.models import PlaidSyncCursor
    db.query(PlaidSyncCursor).filter(
        PlaidSyncCursor.plaid_item_id == plaid_item_id
    ).delete()

    # Delete PlaidItem
    db.delete(plaid_item)

    # Commit all changes
    db.commit()

    logger.info(f"Disconnected Plaid item {plaid_item_id} for user {current_user.id}")

    return {
        "message": "Plaid item disconnected successfully",
        "accounts_updated": len(plaid_accounts)
    }


def _map_plaid_account_type(plaid_type: str, plaid_subtype: Optional[str]) -> AccountTypeEnum:
    """
    Map Plaid account type/subtype to our AccountTypeEnum

    Args:
        plaid_type: Plaid account type (depository, credit, investment, loan, other)
        plaid_subtype: Plaid account subtype

    Returns:
        Our account type enum
    """
    # Normalize subtype for easier matching
    subtype_lower = (plaid_subtype or "").lower().replace(" ", "_")

    # Map based on type and subtype
    if plaid_type == "depository":
        # Map depository subtypes
        subtype_map = {
            "checking": AccountTypeEnum.CHECKING,
            "savings": AccountTypeEnum.SAVINGS,
            "money_market": AccountTypeEnum.MONEY_MARKET,
            "cd": AccountTypeEnum.CD,
            "cash_management": AccountTypeEnum.CASH_MANAGEMENT,
            "prepaid": AccountTypeEnum.PREPAID,
            "paypal": AccountTypeEnum.PAYPAL,
            "hsa": AccountTypeEnum.HSA,
            "ebt": AccountTypeEnum.EBT,
        }
        return subtype_map.get(subtype_lower, AccountTypeEnum.CHECKING)

    elif plaid_type == "credit":
        # All credit types map to credit card
        return AccountTypeEnum.CREDIT_CARD

    elif plaid_type == "loan":
        # Map loan subtypes
        subtype_map = {
            "mortgage": AccountTypeEnum.MORTGAGE,
            "auto": AccountTypeEnum.AUTO_LOAN,
            "student": AccountTypeEnum.STUDENT_LOAN,
            "home_equity": AccountTypeEnum.HOME_EQUITY,
            "personal": AccountTypeEnum.PERSONAL_LOAN,
            "business": AccountTypeEnum.BUSINESS_LOAN,
            "commercial": AccountTypeEnum.BUSINESS_LOAN,
            "line_of_credit": AccountTypeEnum.LINE_OF_CREDIT,
            "overdraft": AccountTypeEnum.LINE_OF_CREDIT,
            "consumer": AccountTypeEnum.PERSONAL_LOAN,
            "construction": AccountTypeEnum.MORTGAGE,
        }
        return subtype_map.get(subtype_lower, AccountTypeEnum.PERSONAL_LOAN)

    elif plaid_type == "investment" or plaid_type == "brokerage":
        # Map investment/retirement subtypes
        subtype_map = {
            "401k": AccountTypeEnum.RETIREMENT_401K,
            "401a": AccountTypeEnum.RETIREMENT_401K,
            "403b": AccountTypeEnum.RETIREMENT_403B,
            "457b": AccountTypeEnum.RETIREMENT_457B,
            "529": AccountTypeEnum.RETIREMENT_529,
            "ira": AccountTypeEnum.IRA,
            "roth": AccountTypeEnum.ROTH_IRA,
            "roth_401k": AccountTypeEnum.ROTH_IRA,
            "sep_ira": AccountTypeEnum.SEP_IRA,
            "sarsep": AccountTypeEnum.SEP_IRA,
            "simple_ira": AccountTypeEnum.SIMPLE_IRA,
            "pension": AccountTypeEnum.PENSION,
            "profit_sharing_plan": AccountTypeEnum.PENSION,
            "stock_plan": AccountTypeEnum.STOCK_PLAN,
            "brokerage": AccountTypeEnum.BROKERAGE,
            "non-taxable_brokerage_account": AccountTypeEnum.BROKERAGE,
            "ugma": AccountTypeEnum.TRUST,
            "utma": AccountTypeEnum.TRUST,
            "trust": AccountTypeEnum.TRUST,
            # Canadian retirement accounts
            "tfsa": AccountTypeEnum.TFSA,
            "rrsp": AccountTypeEnum.RRSP,
            "rrif": AccountTypeEnum.RRIF,
            "resp": AccountTypeEnum.RESP,
            "rdsp": AccountTypeEnum.RDSP,
            "lira": AccountTypeEnum.LIRA,
            "lrsp": AccountTypeEnum.RRSP,
            "lrif": AccountTypeEnum.RRIF,
            "rlif": AccountTypeEnum.RRIF,
            "prif": AccountTypeEnum.RRIF,
            "lif": AccountTypeEnum.RRIF,
            # Specialized investment types
            "crypto_exchange": AccountTypeEnum.CRYPTO,
            "non-custodial_wallet": AccountTypeEnum.CRYPTO,
            "mutual_fund": AccountTypeEnum.MUTUAL_FUND,
            "fixed_annuity": AccountTypeEnum.ANNUITY,
            "variable_annuity": AccountTypeEnum.ANNUITY,
            "other_annuity": AccountTypeEnum.ANNUITY,
            "life_insurance": AccountTypeEnum.LIFE_INSURANCE,
            "other_insurance": AccountTypeEnum.LIFE_INSURANCE,
            "gic": AccountTypeEnum.CD,  # Canadian equivalent of CD
            "cash_isa": AccountTypeEnum.SAVINGS,
            "education_savings_account": AccountTypeEnum.RETIREMENT_529,
            "health_reimbursement_arrangement": AccountTypeEnum.HSA,
            "sipp": AccountTypeEnum.PENSION,
            "keogh": AccountTypeEnum.PENSION,
            "thrift_savings_plan": AccountTypeEnum.PENSION,
        }
        return subtype_map.get(subtype_lower, AccountTypeEnum.INVESTMENT)

    else:
        # Other or unknown types
        return AccountTypeEnum.OTHER
