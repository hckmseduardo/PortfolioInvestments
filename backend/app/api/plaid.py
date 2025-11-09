"""
Plaid API Routes

Handles Plaid integration endpoints for account linking and transaction syncing.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Body
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime
import logging
import uuid

from app.models.schemas import User
from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.services.plaid_client import plaid_client
from app.services.job_queue import enqueue_plaid_sync_job, get_job_info
from app.database.models import AccountTypeEnum

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
    current_user: User = Depends(get_current_user)
):
    """
    Exchange public token from Plaid Link for access token and create accounts
    """
    db = get_db()

    # Exchange public token for access token
    exchange_result = plaid_client.exchange_public_token(request.public_token)
    if not exchange_result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to exchange public token"
        )

    access_token = exchange_result['access_token']
    item_id = exchange_result['item_id']

    # Get institution info from metadata
    institution = request.metadata.get('institution', {})
    institution_id = institution.get('institution_id', 'unknown')
    institution_name = institution.get('name', 'Unknown Institution')

    # Get accounts from Plaid
    accounts_result = plaid_client.get_accounts(access_token)
    if not accounts_result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve accounts from Plaid"
        )

    # Create PlaidItem record
    plaid_item_id = str(uuid.uuid4())
    plaid_item = {
        "id": plaid_item_id,
        "user_id": current_user.id,
        "access_token": access_token,  # In production, encrypt this
        "item_id": item_id,
        "institution_id": institution_id,
        "institution_name": institution_name,
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
        "last_synced": None,
        "error_message": None,
    }
    db.insert("plaid_items", plaid_item)

    # Create accounts and PlaidAccount mappings
    created_accounts = []
    for plaid_acc in accounts_result['accounts']:
        # Map Plaid account type to our AccountTypeEnum
        acc_type = _map_plaid_account_type(
            plaid_acc['type'],
            plaid_acc.get('subtype')
        )

        # Create Account record
        account_id = str(uuid.uuid4())
        account = {
            "id": account_id,
            "user_id": current_user.id,
            "account_type": acc_type,
            "account_number": plaid_acc.get('mask', 'XXXX'),
            "institution": institution_name,
            "balance": plaid_acc['balances'].get('current', 0.0) or 0.0,
            "label": plaid_acc['name'],
            "is_plaid_linked": 1,
            "created_at": datetime.utcnow().isoformat(),
        }
        db.insert("accounts", account)

        # Create PlaidAccount mapping
        plaid_account_mapping = {
            "id": str(uuid.uuid4()),
            "plaid_item_id": plaid_item_id,
            "account_id": account_id,
            "plaid_account_id": plaid_acc['account_id'],
            "mask": plaid_acc.get('mask'),
            "name": plaid_acc['name'],
            "official_name": plaid_acc.get('official_name'),
            "type": plaid_acc['type'],
            "subtype": plaid_acc.get('subtype'),
            "created_at": datetime.utcnow().isoformat(),
        }
        db.insert("plaid_accounts", plaid_account_mapping)

        created_accounts.append({
            "account_id": account_id,
            "plaid_account_id": plaid_acc['account_id'],
            "name": plaid_acc['name'],
            "mask": plaid_acc.get('mask'),
            "type": plaid_acc['type'],
            "subtype": plaid_acc.get('subtype'),
        })

    logger.info(
        f"Created Plaid item {plaid_item_id} with {len(created_accounts)} accounts "
        f"for user {current_user.id}"
    )

    return {
        "message": "Successfully linked accounts",
        "plaid_item_id": plaid_item_id,
        "institution_name": institution_name,
        "accounts": created_accounts,
    }


@router.get("/items", response_model=List[PlaidItemResponse])
async def get_plaid_items(current_user: User = Depends(get_current_user)):
    """
    Get all Plaid items (bank connections) for the current user
    """
    db = get_db()

    plaid_items = db.find("plaid_items", {"user_id": current_user.id})

    result = []
    for item in plaid_items:
        # Get associated accounts
        plaid_accounts = db.find("plaid_accounts", {"plaid_item_id": item['id']})

        accounts = []
        for plaid_acc in plaid_accounts:
            account = db.find_one("accounts", {"id": plaid_acc['account_id']})
            if account:
                accounts.append({
                    "id": plaid_acc['id'],
                    "plaid_account_id": plaid_acc['plaid_account_id'],
                    "account_id": plaid_acc['account_id'],
                    "name": plaid_acc['name'],
                    "mask": plaid_acc.get('mask'),
                    "type": plaid_acc['type'],
                    "subtype": plaid_acc.get('subtype'),
                    "balance": account.get('balance', 0.0),
                })

        result.append(PlaidItemResponse(
            id=item['id'],
            institution_id=item['institution_id'],
            institution_name=item['institution_name'],
            status=item['status'],
            created_at=item['created_at'],
            last_synced=item.get('last_synced'),
            accounts=accounts
        ))

    return result


@router.post("/sync/{plaid_item_id}", response_model=SyncResponse)
async def sync_transactions(
    plaid_item_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Trigger asynchronous transaction sync for a Plaid item
    """
    db = get_db()

    # Verify the item belongs to the user
    plaid_item = db.find_one("plaid_items", {
        "id": plaid_item_id,
        "user_id": current_user.id
    })

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


@router.delete("/disconnect/{plaid_item_id}")
async def disconnect_plaid_item(
    plaid_item_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Disconnect a Plaid item and optionally delete associated accounts
    """
    db = get_db()

    # Verify the item belongs to the user
    plaid_item = db.find_one("plaid_items", {
        "id": plaid_item_id,
        "user_id": current_user.id
    })

    if not plaid_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plaid item not found"
        )

    # Remove from Plaid
    access_token = plaid_item['access_token']
    success = plaid_client.remove_item(access_token)

    if not success:
        logger.warning(f"Failed to remove item from Plaid, continuing with local deletion")

    # Get associated accounts
    plaid_accounts = db.find("plaid_accounts", {"plaid_item_id": plaid_item_id})

    # Update accounts to mark as not Plaid-linked
    for plaid_acc in plaid_accounts:
        db.update(
            "accounts",
            {"id": plaid_acc['account_id']},
            {"is_plaid_linked": 0}
        )

    # Delete PlaidAccount mappings
    db.delete("plaid_accounts", {"plaid_item_id": plaid_item_id})

    # Delete sync cursor
    db.delete("plaid_sync_cursors", {"plaid_item_id": plaid_item_id})

    # Delete PlaidItem
    db.delete("plaid_items", {"id": plaid_item_id})

    logger.info(f"Disconnected Plaid item {plaid_item_id} for user {current_user.id}")

    return {
        "message": "Plaid item disconnected successfully",
        "accounts_updated": len(plaid_accounts)
    }


def _map_plaid_account_type(plaid_type: str, plaid_subtype: Optional[str]) -> str:
    """
    Map Plaid account type/subtype to our AccountTypeEnum

    Args:
        plaid_type: Plaid account type (depository, credit, investment, loan)
        plaid_subtype: Plaid account subtype

    Returns:
        Our account type string
    """
    # Map based on type and subtype
    if plaid_type == "depository":
        if plaid_subtype in ["checking", "prepaid"]:
            return "checking"
        elif plaid_subtype in ["savings", "money market", "cd"]:
            return "savings"
        else:
            return "checking"  # Default for depository

    elif plaid_type == "credit":
        return "credit_card"

    elif plaid_type == "investment":
        return "investment"

    else:
        # Default for unknown types
        return "checking"
