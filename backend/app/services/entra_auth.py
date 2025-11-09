"""
Microsoft Entra ID Authentication Service

Handles OAuth 2.0 authentication flow with Microsoft Entra ID (formerly Azure AD)
using the Microsoft Authentication Library (MSAL).
"""
import logging
from typing import Dict, Optional, Tuple
from datetime import datetime
import msal
import requests
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import User

logger = logging.getLogger(__name__)


class EntraAuthService:
    """Service for handling Microsoft Entra ID authentication."""

    def __init__(self):
        """Initialize the Entra Auth Service."""
        self.client_id = settings.ENTRA_CLIENT_ID
        self.client_secret = settings.ENTRA_CLIENT_SECRET
        self.tenant_id = settings.ENTRA_TENANT_ID
        self.authority = settings.entra_authority_url
        self.redirect_uri = settings.ENTRA_REDIRECT_URI
        self.scopes = settings.entra_scopes_list

    def _get_msal_app(self) -> msal.ConfidentialClientApplication:
        """
        Create and return an MSAL Confidential Client Application.

        Returns:
            MSAL application instance

        Raises:
            ValueError: If Entra ID is not properly configured
        """
        if not settings.is_entra_configured:
            raise ValueError(
                "Microsoft Entra ID is not properly configured. "
                "Please set ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and ENTRA_TENANT_ID."
            )

        return msal.ConfidentialClientApplication(
            self.client_id,
            authority=self.authority,
            client_credential=self.client_secret,
        )

    def get_authorization_url(self, state: Optional[str] = None) -> Tuple[str, str]:
        """
        Generate the authorization URL for Entra ID login.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Tuple of (authorization_url, state)
        """
        app = self._get_msal_app()

        auth_url = app.get_authorization_request_url(
            scopes=self.scopes,
            state=state,
            redirect_uri=self.redirect_uri,
        )

        logger.info(f"Generated authorization URL for Entra ID login")
        return auth_url, state or ""

    def exchange_code_for_token(self, code: str) -> Optional[Dict]:
        """
        Exchange authorization code for access token.

        Args:
            code: Authorization code from the OAuth callback

        Returns:
            Token response dict or None if failed
        """
        app = self._get_msal_app()

        try:
            result = app.acquire_token_by_authorization_code(
                code,
                scopes=self.scopes,
                redirect_uri=self.redirect_uri,
            )

            if "error" in result:
                logger.error(
                    f"Error exchanging code for token: {result.get('error')} - "
                    f"{result.get('error_description')}"
                )
                return None

            logger.info("Successfully exchanged authorization code for token")
            return result

        except Exception as e:
            logger.error(f"Exception exchanging code for token: {str(e)}")
            return None

    def get_user_info_from_token(self, access_token: str) -> Optional[Dict]:
        """
        Fetch user information from Microsoft Graph API.

        Args:
            access_token: Access token from Entra ID

        Returns:
            User info dict or None if failed
        """
        graph_endpoint = "https://graph.microsoft.com/v1.0/me"

        try:
            headers = {"Authorization": f"Bearer {access_token}"}
            response = requests.get(graph_endpoint, headers=headers)
            response.raise_for_status()

            user_info = response.json()
            logger.info(f"Retrieved user info from Graph API: {user_info.get('mail') or user_info.get('userPrincipalName')}")
            return user_info

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching user info from Graph API: {str(e)}")
            return None

    def parse_id_token(self, token_response: Dict) -> Dict:
        """
        Parse and extract claims from the ID token.

        Args:
            token_response: Token response from MSAL

        Returns:
            Dict with parsed claims
        """
        id_token_claims = token_response.get("id_token_claims", {})

        return {
            "entra_id": id_token_claims.get("oid"),  # Object ID (unique user ID)
            "email": id_token_claims.get("preferred_username") or id_token_claims.get("email"),
            "name": id_token_claims.get("name"),
            "given_name": id_token_claims.get("given_name"),
            "family_name": id_token_claims.get("family_name"),
            "tenant_id": id_token_claims.get("tid"),
            "email_verified": id_token_claims.get("email_verified", False),
        }

    def find_user_by_entra_id(self, db: Session, entra_id: str) -> Optional[User]:
        """
        Find a user by their Entra ID.

        Args:
            db: Database session
            entra_id: Microsoft Entra ID (Object ID)

        Returns:
            User object or None
        """
        return db.query(User).filter(User.entra_id == entra_id).first()

    def find_user_by_email(self, db: Session, email: str) -> Optional[User]:
        """
        Find a user by their email address.

        Args:
            db: Database session
            email: Email address

        Returns:
            User object or None
        """
        return db.query(User).filter(User.email == email.lower()).first()

    def link_entra_to_existing_user(
        self,
        db: Session,
        user: User,
        entra_claims: Dict,
    ) -> User:
        """
        Link Entra ID to an existing user account.

        Args:
            db: Database session
            user: Existing user object
            entra_claims: Claims from Entra ID token

        Returns:
            Updated user object
        """
        user.entra_id = entra_claims["entra_id"]
        user.entra_tenant_id = entra_claims["tenant_id"]
        user.entra_email_verified = entra_claims["email_verified"]
        user.entra_linked_at = datetime.utcnow()
        user.account_linked = True
        user.linked_at = datetime.utcnow()

        # Update auth provider
        if user.hashed_password:
            user.auth_provider = "hybrid"  # Has both local and Entra auth
        else:
            user.auth_provider = "entra"  # Entra only

        db.commit()
        db.refresh(user)

        logger.info(f"Linked Entra ID to existing user: {user.email}")
        return user

    def create_entra_user(
        self,
        db: Session,
        entra_claims: Dict,
    ) -> User:
        """
        Create a new user from Entra ID authentication.

        Args:
            db: Database session
            entra_claims: Claims from Entra ID token

        Returns:
            New user object
        """
        import uuid

        new_user = User(
            id=str(uuid.uuid4()),
            email=entra_claims["email"].lower(),
            hashed_password=None,  # No local password
            created_at=datetime.utcnow(),
            auth_provider="entra",
            entra_id=entra_claims["entra_id"],
            entra_tenant_id=entra_claims["tenant_id"],
            entra_email_verified=entra_claims["email_verified"],
            entra_linked_at=datetime.utcnow(),
            account_linked=False,
            two_factor_enabled=False,
        )

        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        logger.info(f"Created new Entra ID user: {new_user.email}")
        return new_user

    def unlink_entra_from_user(self, db: Session, user: User) -> User:
        """
        Unlink Entra ID from a user account.

        Args:
            db: Database session
            user: User object

        Returns:
            Updated user object

        Raises:
            ValueError: If user has no local password (can't unlink)
        """
        if not user.hashed_password:
            raise ValueError(
                "Cannot unlink Entra ID: User has no local password set. "
                "Please set a password before unlinking."
            )

        user.entra_id = None
        user.entra_tenant_id = None
        user.entra_email_verified = False
        user.entra_linked_at = None
        user.account_linked = False
        user.linked_at = None
        user.auth_provider = "local"

        db.commit()
        db.refresh(user)

        logger.info(f"Unlinked Entra ID from user: {user.email}")
        return user

    def validate_email_match(self, entra_email: str, user_email: str) -> bool:
        """
        Validate that Entra ID email matches user email.

        Args:
            entra_email: Email from Entra ID
            user_email: Email from user account

        Returns:
            True if emails match (case-insensitive)
        """
        return entra_email.lower() == user_email.lower()


# Singleton instance
entra_auth_service = EntraAuthService()
