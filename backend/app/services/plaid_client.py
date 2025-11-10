"""
Plaid API Client Service

Handles all interactions with Plaid API for account linking and transaction syncing.
"""
import logging
from typing import Optional, Dict, List, Any
from datetime import datetime

import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.item_get_request import ItemGetRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.exceptions import ApiException

from app.config import settings

logger = logging.getLogger(__name__)


class PlaidClient:
    """Client for interacting with Plaid API"""

    def __init__(self):
        self.client_id = settings.PLAID_CLIENT_ID
        self.secret = settings.PLAID_SECRET
        self.environment = self._get_environment()
        self.client = None

        if self._is_enabled():
            self._initialize_client()

    def _is_enabled(self) -> bool:
        """Check if Plaid is properly configured"""
        return bool(self.client_id and self.secret)

    def _get_environment(self) -> plaid.Environment:
        """Map environment string to Plaid Environment enum"""
        env_map = {
            "sandbox": plaid.Environment.Sandbox,
            "development": plaid.Environment.Development,
            "production": plaid.Environment.Production,
        }
        env_name = settings.PLAID_ENVIRONMENT.lower()
        return env_map.get(env_name, plaid.Environment.Sandbox)

    def _initialize_client(self):
        """Initialize Plaid API client"""
        try:
            configuration = plaid.Configuration(
                host=self.environment,
                api_key={
                    'clientId': self.client_id,
                    'secret': self.secret,
                }
            )
            api_client = plaid.ApiClient(configuration)
            self.client = plaid_api.PlaidApi(api_client)
            logger.info(f"Plaid client initialized with environment: {settings.PLAID_ENVIRONMENT}")
        except Exception as e:
            logger.error(f"Failed to initialize Plaid client: {e}")
            raise

    def create_link_token(self, user_id: str, client_name: str = "Portfolio Investments") -> Optional[Dict[str, Any]]:
        """
        Create a link token for Plaid Link initialization

        Args:
            user_id: Your application's user ID
            client_name: Display name for your application

        Returns:
            Dictionary with link_token and expiration
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            request = LinkTokenCreateRequest(
                user=LinkTokenCreateRequestUser(client_user_id=str(user_id)),
                client_name=client_name,
                products=[Products("transactions"), Products("auth")],
                country_codes=[CountryCode("US"), CountryCode("CA")],
                language="en",
            )

            response = self.client.link_token_create(request)

            # Convert expiration datetime to ISO string format
            expiration = response['expiration']
            if isinstance(expiration, datetime):
                expiration = expiration.isoformat()

            return {
                "link_token": response['link_token'],
                "expiration": expiration,
            }
        except ApiException as e:
            logger.error(f"Failed to create link token for user {user_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error creating link token: {e}")
            return None

    def exchange_public_token(self, public_token: str) -> Optional[Dict[str, Any]]:
        """
        Exchange public token for access token and item ID

        Args:
            public_token: The public token from Plaid Link

        Returns:
            Dictionary with access_token and item_id
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            request = ItemPublicTokenExchangeRequest(public_token=public_token)
            response = self.client.item_public_token_exchange(request)

            return {
                "access_token": response['access_token'],
                "item_id": response['item_id'],
            }
        except ApiException as e:
            logger.error(f"Failed to exchange public token: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error exchanging public token: {e}")
            return None

    def get_accounts(self, access_token: str) -> Optional[Dict[str, Any]]:
        """
        Get accounts associated with an access token

        Args:
            access_token: Plaid access token

        Returns:
            Dictionary with accounts and item information
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            request = AccountsGetRequest(access_token=access_token)
            response = self.client.accounts_get(request)

            return {
                "accounts": [self._format_account(acc) for acc in response['accounts']],
                "item": response.get('item'),
            }
        except ApiException as e:
            logger.error(f"Failed to get accounts: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting accounts: {e}")
            return None

    def get_item(self, access_token: str) -> Optional[Dict[str, Any]]:
        """
        Get item (institution connection) information

        Args:
            access_token: Plaid access token

        Returns:
            Dictionary with item information
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            request = ItemGetRequest(access_token=access_token)
            response = self.client.item_get(request)

            return response['item']
        except ApiException as e:
            logger.error(f"Failed to get item: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting item: {e}")
            return None

    def sync_transactions(
        self,
        access_token: str,
        cursor: Optional[str] = None,
        count: int = 500
    ) -> Optional[Dict[str, Any]]:
        """
        Sync transactions using cursor-based pagination

        Args:
            access_token: Plaid access token
            cursor: Cursor for incremental updates (None for initial sync)
            count: Number of transactions to fetch (max 500)

        Returns:
            Dictionary with added, modified, removed transactions and next cursor
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            request_args = {
                "access_token": access_token,
                "count": min(count, 500),
            }

            if cursor:
                request_args["cursor"] = cursor

            request = TransactionsSyncRequest(**request_args)
            response = self.client.transactions_sync(request)

            return {
                "added": [self._format_transaction(txn) for txn in response.get('added', [])],
                "modified": [self._format_transaction(txn) for txn in response.get('modified', [])],
                "removed": [self._format_removed_transaction(txn) for txn in response.get('removed', [])],
                "next_cursor": response['next_cursor'],
                "has_more": response['has_more'],
            }
        except ApiException as e:
            logger.error(f"Failed to sync transactions: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error syncing transactions: {e}")
            return None

    def remove_item(self, access_token: str) -> bool:
        """
        Remove (disconnect) a Plaid item

        Args:
            access_token: Plaid access token

        Returns:
            True if successful, False otherwise
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return False

        try:
            request = ItemRemoveRequest(access_token=access_token)
            self.client.item_remove(request)
            logger.info("Successfully removed Plaid item")
            return True
        except ApiException as e:
            logger.error(f"Failed to remove item: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error removing item: {e}")
            return False

    def _format_account(self, account: Dict[str, Any]) -> Dict[str, Any]:
        """Format Plaid account object for our use"""
        # Convert type/subtype to strings (Plaid SDK returns enum objects)
        # Need to access the .value attribute for Plaid enums
        acc_type = account['type']
        acc_subtype = account.get('subtype')

        # Try to extract string value from enum-like objects
        if acc_type and hasattr(acc_type, 'value'):
            acc_type = acc_type.value
        elif acc_type:
            acc_type = str(acc_type)

        if acc_subtype and hasattr(acc_subtype, 'value'):
            acc_subtype = acc_subtype.value
        elif acc_subtype:
            acc_subtype = str(acc_subtype)

        logger.debug(f"Formatted account type: {acc_type} (type: {type(acc_type).__name__})")
        logger.debug(f"Formatted account subtype: {acc_subtype} (type: {type(acc_subtype).__name__})")

        return {
            "account_id": account['account_id'],
            "name": account['name'],
            "official_name": account.get('official_name'),
            "mask": account.get('mask'),
            "type": acc_type,
            "subtype": acc_subtype,
            "balances": {
                "available": account['balances'].get('available'),
                "current": account['balances'].get('current'),
                "limit": account['balances'].get('limit'),
                "currency": account['balances'].get('iso_currency_code', 'USD'),
            }
        }

    def _format_transaction(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Format Plaid transaction object for our use"""
        return {
            "transaction_id": transaction['transaction_id'],
            "account_id": transaction['account_id'],
            "amount": transaction['amount'],
            "date": transaction['date'],
            "name": transaction.get('name'),
            "merchant_name": transaction.get('merchant_name'),
            "payment_channel": transaction.get('payment_channel'),
            "category": transaction.get('category', []),
            "category_id": transaction.get('category_id'),
            "pending": transaction.get('pending', False),
            "iso_currency_code": transaction.get('iso_currency_code', 'USD'),
            "unofficial_currency_code": transaction.get('unofficial_currency_code'),
        }

    def _format_removed_transaction(self, removed: Dict[str, Any]) -> Dict[str, Any]:
        """Format removed transaction object"""
        return {
            "transaction_id": removed['transaction_id']
        }


# Singleton instance
plaid_client = PlaidClient()
