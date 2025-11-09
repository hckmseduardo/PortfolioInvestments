"""
Microsoft Entra ID Authentication API Endpoints

Handles OAuth 2.0 authentication flow with Microsoft Entra ID,
account linking, and user management.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import timedelta
import secrets
import logging

from app.config import settings
from app.database.postgres_db import get_db
from app.services.entra_auth import entra_auth_service
from app.services.auth import create_access_token, decode_access_token
from app.models.schemas import Token, User
from app.database.models import User as UserModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/entra", tags=["entra-authentication"])


# In-memory state storage (use Redis in production for multi-instance deployments)
_auth_states = {}


def get_current_user_from_token(token: str, db: Session) -> UserModel:
    """
    Get current user from JWT token.

    Args:
        token: JWT token
        db: Database session

    Returns:
        User model instance

    Raises:
        HTTPException: If token is invalid or user not found
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = decode_access_token(token)
    if token_data is None or token_data.email is None:
        raise credentials_exception

    user = db.query(UserModel).filter(UserModel.email == token_data.email).first()
    if user is None:
        raise credentials_exception

    return user


@router.get("/login")
async def entra_login(
    link_account: bool = Query(False, description="Whether to link to existing account"),
):
    """
    Initiate Microsoft Entra ID OAuth login flow.

    Args:
        link_account: If True, link to existing authenticated user account

    Returns:
        Redirect to Microsoft login page

    Raises:
        HTTPException: If Entra ID is not configured or not enabled
    """
    if not settings.AUTH_ALLOW_ENTRA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Microsoft Entra ID authentication is not enabled"
        )

    if not settings.is_entra_configured:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Microsoft Entra ID is not properly configured"
        )

    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    _auth_states[state] = {
        "link_account": link_account,
        "created_at": timedelta(minutes=10)  # State expires in 10 minutes
    }

    # Get authorization URL
    auth_url, _ = entra_auth_service.get_authorization_url(state=state)

    logger.info(f"Redirecting to Entra ID login (link_account={link_account})")
    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def entra_callback(
    code: str = Query(..., description="Authorization code"),
    state: str = Query(..., description="State parameter for CSRF protection"),
    error: Optional[str] = Query(None, description="Error from OAuth provider"),
    error_description: Optional[str] = Query(None, description="Error description"),
    db: Session = Depends(get_db),
):
    """
    Handle OAuth callback from Microsoft Entra ID.

    Args:
        code: Authorization code from Entra ID
        state: State parameter for CSRF validation
        error: Error code if authentication failed
        error_description: Human-readable error description
        db: Database session

    Returns:
        JWT token for the user

    Raises:
        HTTPException: If authentication fails
    """
    # Check for OAuth errors
    if error:
        logger.error(f"Entra ID OAuth error: {error} - {error_description}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Authentication failed: {error_description or error}"
        )

    # Validate state (CSRF protection)
    state_data = _auth_states.pop(state, None)
    if state_data is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired state parameter"
        )

    link_account = state_data.get("link_account", False)

    # Exchange code for token
    token_response = entra_auth_service.exchange_code_for_token(code)
    if not token_response:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange authorization code for token"
        )

    # Parse ID token claims
    entra_claims = entra_auth_service.parse_id_token(token_response)

    if not entra_claims.get("entra_id") or not entra_claims.get("email"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token: missing required claims"
        )

    # Check if user already exists with this Entra ID
    existing_user = entra_auth_service.find_user_by_entra_id(db, entra_claims["entra_id"])

    if existing_user:
        # User already linked - just log them in
        access_token = create_access_token(
            data={"sub": existing_user.email},
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        logger.info(f"Existing Entra user logged in: {existing_user.email}")
        return Token(access_token=access_token, token_type="bearer", requires_2fa=False)

    # Check if email already exists
    email_user = entra_auth_service.find_user_by_email(db, entra_claims["email"])

    if email_user:
        if link_account:
            # Link Entra ID to existing account
            if email_user.entra_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This account is already linked to a different Entra ID"
                )

            # Validate email match
            if not entra_auth_service.validate_email_match(entra_claims["email"], email_user.email):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email mismatch: cannot link accounts"
                )

            # Link the accounts
            linked_user = entra_auth_service.link_entra_to_existing_user(db, email_user, entra_claims)

            access_token = create_access_token(
                data={"sub": linked_user.email},
                expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            )
            logger.info(f"Linked Entra ID to existing account: {linked_user.email}")
            return Token(access_token=access_token, token_type="bearer", requires_2fa=False)
        else:
            # Email exists but not linking - suggest linking
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists. Please log in with your password and link your Microsoft account from settings."
            )

    # Create new user with Entra ID
    new_user = entra_auth_service.create_entra_user(db, entra_claims)

    access_token = create_access_token(
        data={"sub": new_user.email},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    logger.info(f"New Entra user created and logged in: {new_user.email}")
    return Token(access_token=access_token, token_type="bearer", requires_2fa=False)


@router.post("/link-account", response_model=dict)
async def link_entra_account(
    token: str = Query(..., description="Current user's JWT token"),
    db: Session = Depends(get_db),
):
    """
    Initiate account linking for an authenticated user.

    This endpoint generates a special authorization URL that will link
    the user's Entra ID to their existing account.

    Args:
        token: Current user's JWT token
        db: Database session

    Returns:
        Authorization URL for linking

    Raises:
        HTTPException: If user is not authenticated or Entra not configured
    """
    if not settings.is_entra_configured:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Microsoft Entra ID is not properly configured"
        )

    # Validate user is authenticated
    user = get_current_user_from_token(token, db)

    if user.entra_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is already linked to Microsoft Entra ID"
        )

    # Generate state with link_account flag
    state = secrets.token_urlsafe(32)
    _auth_states[state] = {
        "link_account": True,
        "user_email": user.email,
        "created_at": timedelta(minutes=10)
    }

    # Get authorization URL
    auth_url, _ = entra_auth_service.get_authorization_url(state=state)

    return {
        "authorization_url": auth_url,
        "message": "Redirect user to this URL to link their Microsoft account"
    }


@router.post("/unlink-account", response_model=dict)
async def unlink_entra_account(
    token: str = Query(..., description="Current user's JWT token"),
    db: Session = Depends(get_db),
):
    """
    Unlink Entra ID from user account.

    Requires that the user has a local password set.

    Args:
        token: Current user's JWT token
        db: Database session

    Returns:
        Success message

    Raises:
        HTTPException: If user cannot be unlinked
    """
    user = get_current_user_from_token(token, db)

    if not user.entra_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is not linked to Microsoft Entra ID"
        )

    try:
        entra_auth_service.unlink_entra_from_user(db, user)
        return {
            "message": "Microsoft Entra ID successfully unlinked from account",
            "auth_provider": "local"
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/status", response_model=dict)
async def get_entra_status(
    token: str = Query(..., description="Current user's JWT token"),
    db: Session = Depends(get_db),
):
    """
    Get Entra ID link status for current user.

    Args:
        token: Current user's JWT token
        db: Database session

    Returns:
        Entra ID status information
    """
    user = get_current_user_from_token(token, db)

    return {
        "email": user.email,
        "auth_provider": user.auth_provider,
        "entra_linked": user.entra_id is not None,
        "entra_email_verified": user.entra_email_verified if user.entra_id else False,
        "linked_at": user.entra_linked_at.isoformat() if user.entra_linked_at else None,
        "has_local_password": user.hashed_password is not None,
        "can_unlink": user.entra_id is not None and user.hashed_password is not None,
    }


@router.get("/config", response_model=dict)
async def get_entra_config():
    """
    Get public Entra ID configuration for frontend.

    Returns:
        Public configuration (no secrets)
    """
    return {
        "enabled": settings.AUTH_ALLOW_ENTRA,
        "configured": settings.is_entra_configured,
        "traditional_auth_allowed": settings.AUTH_ALLOW_TRADITIONAL,
        "entra_required": settings.AUTH_REQUIRE_ENTRA,
        "tenant_id": settings.ENTRA_TENANT_ID if settings.is_entra_configured else None,
    }
