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
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.model.transactions_get_request_options import TransactionsGetRequestOptions
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.item_get_request import ItemGetRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.investments_transactions_get_request import InvestmentsTransactionsGetRequest
from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest
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

    def create_link_token(self, user_id: str, client_name: str = "Portfolio Investments", access_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Create a link token for Plaid Link initialization or update mode

        Args:
            user_id: Your application's user ID
            client_name: Display name for your application
            access_token: Optional - if provided, creates link token in update mode to add new products

        Returns:
            Dictionary with link_token and expiration
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            request_params = {
                "user": LinkTokenCreateRequestUser(client_user_id=str(user_id)),
                "client_name": client_name,
                "products": [Products("transactions"), Products("investments")],  # Request both transactions and investments
                "country_codes": [CountryCode("US"), CountryCode("CA")],
                "language": "en",
                "redirect_uri": "https://app.home/",  # Required for OAuth institutions like Wealthsimple
            }

            # If access_token provided, create in update mode to add products
            if access_token:
                logger.info(f"Creating link token in UPDATE mode to add investment product access")
                request_params["access_token"] = access_token
            else:
                logger.info(f"Creating link token in INITIAL mode for new connection")

            request = LinkTokenCreateRequest(**request_params)

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

            logger.info(f"[PLAID DEBUG] Syncing regular transactions:")
            # Security: Access token removed from logs
            logger.info(f"  Cursor: {cursor[:50] if cursor else 'None (initial sync)'}...")
            logger.info(f"  Count: {min(count, 500)}")

            request = TransactionsSyncRequest(**request_args)
            response = self.client.transactions_sync(request)

            logger.info(f"[PLAID DEBUG] Transaction sync response:")
            logger.info(f"  Added: {len(response.get('added', []))}")
            logger.info(f"  Modified: {len(response.get('modified', []))}")
            logger.info(f"  Removed: {len(response.get('removed', []))}")
            logger.info(f"  Has more: {response['has_more']}")

            # Log date range of transactions if any
            if response.get('added'):
                dates = [txn.get('date') for txn in response.get('added', []) if txn.get('date')]
                if dates:
                    logger.info(f"  Date range: {min(dates)} to {max(dates)}")

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

    def get_historical_transactions(
        self,
        access_token: str,
        start_date: str,
        end_date: str,
        count: int = 500,
        offset: int = 0
    ) -> Optional[Dict[str, Any]]:
        """
        Get historical transactions for a date range using /transactions/get
        This is used for full resync to fetch all available transaction history

        Args:
            access_token: Plaid access token
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            count: Number of transactions to fetch per request (max 500)
            offset: Offset for pagination

        Returns:
            Dictionary with transactions and pagination info
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            # Convert string dates to date objects for Plaid SDK
            from datetime import datetime as dt
            start_date_obj = dt.strptime(start_date, '%Y-%m-%d').date()
            end_date_obj = dt.strptime(end_date, '%Y-%m-%d').date()

            logger.info(f"[PLAID DEBUG - HISTORICAL] Fetching historical transactions:")
            # Security: Access token removed from logs
            logger.info(f"  Start date: {start_date_obj}")
            logger.info(f"  End date: {end_date_obj}")
            logger.info(f"  Count: {count}, Offset: {offset}")

            options = TransactionsGetRequestOptions(
                count=min(count, 500),
                offset=offset
            )

            request = TransactionsGetRequest(
                access_token=access_token,
                start_date=start_date_obj,
                end_date=end_date_obj,
                options=options
            )

            response = self.client.transactions_get(request)

            transactions = response.get('transactions', [])
            total_transactions = response.get('total_transactions', 0)

            logger.info(f"[PLAID DEBUG - HISTORICAL] Response:")
            logger.info(f"  Fetched: {len(transactions)} transactions")
            logger.info(f"  Total available: {total_transactions}")

            # Log date range of transactions if any
            if transactions:
                dates = [txn.get('date') for txn in transactions if txn.get('date')]
                if dates:
                    logger.info(f"  Date range: {min(dates)} to {max(dates)}")

            return {
                "transactions": [self._format_transaction(txn) for txn in transactions],
                "total_transactions": total_transactions,
                "accounts": response.get('accounts', []),
            }
        except ApiException as e:
            logger.error(f"[PLAID DEBUG - HISTORICAL] API exception: {e}")
            return None
        except Exception as e:
            logger.error(f"[PLAID DEBUG - HISTORICAL] Unexpected error: {e}")
            logger.exception("Full traceback:")
            return None

    def get_investment_transactions(
        self,
        access_token: str,
        start_date: str,
        end_date: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get investment transactions for a date range

        Args:
            access_token: Plaid access token
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format

        Returns:
            Dictionary with investment transactions
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            # Convert string dates to date objects for Plaid SDK
            from datetime import datetime as dt
            start_date_obj = dt.strptime(start_date, '%Y-%m-%d').date()
            end_date_obj = dt.strptime(end_date, '%Y-%m-%d').date()

            logger.info(f"[PLAID DEBUG] Fetching investment transactions:")
            # Security: Access token removed from logs
            logger.info(f"  Start date: {start_date_obj} (type: {type(start_date_obj).__name__})")
            logger.info(f"  End date: {end_date_obj} (type: {type(end_date_obj).__name__})")

            request = InvestmentsTransactionsGetRequest(
                access_token=access_token,
                start_date=start_date_obj,
                end_date=end_date_obj
            )

            logger.info(f"[PLAID DEBUG] Request object created, calling Plaid API...")

            response = self.client.investments_transactions_get(request)

            logger.info(f"[PLAID DEBUG] Investment transactions response:")
            logger.info(f"  Total transactions: {len(response.get('investment_transactions', []))}")
            logger.info(f"  Total securities: {len(response.get('securities', []))}")
            logger.info(f"  Total accounts: {len(response.get('accounts', []))}")

            return {
                "transactions": [self._format_investment_transaction(txn)
                                for txn in response.get('investment_transactions', [])],
                "accounts": response.get('accounts', []),
                "securities": response.get('securities', []),
                "total_transactions": response.get('total_investment_transactions', 0)
            }
        except ApiException as e:
            logger.error(f"[PLAID DEBUG] Plaid API exception getting investment transactions:")
            logger.error(f"  Status: {e.status if hasattr(e, 'status') else 'N/A'}")
            logger.error(f"  Message: {e}")
            logger.error(f"  Body: {e.body if hasattr(e, 'body') else 'N/A'}")
            return None
        except Exception as e:
            logger.error(f"[PLAID DEBUG] Unexpected error getting investment transactions: {e}")
            logger.exception("Full traceback:")
            return None

    def get_investment_holdings(self, access_token: str) -> Optional[Dict[str, Any]]:
        """
        Get current investment holdings including cash positions

        Args:
            access_token: Plaid access token

        Returns:
            Dictionary with holdings, securities, and accounts.
            Cash positions have is_cash_equivalent=True
        """
        if not self._is_enabled():
            logger.error("Plaid is not configured")
            return None

        try:
            logger.info(f"[PLAID HOLDINGS] Fetching investment holdings")

            request = InvestmentsHoldingsGetRequest(
                access_token=access_token
            )

            response = self.client.investments_holdings_get(request)

            # Convert Plaid response to dictionary
            response_dict = response.to_dict()
            holdings = response_dict.get('holdings', [])
            securities = response_dict.get('securities', [])
            accounts = response_dict.get('accounts', [])

            logger.info(f"[PLAID HOLDINGS] Retrieved {len(holdings)} holdings, {len(securities)} securities, {len(accounts)} accounts")

            # Save holdings debug data
            try:
                from pathlib import Path
                debug_dir = Path("/app/logs/plaid_debug")
                debug_dir.mkdir(parents=True, exist_ok=True)
                timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
                debug_file = debug_dir / f"holdings_{timestamp}.json"

                import json
                debug_data = {
                    "timestamp": datetime.utcnow().isoformat(),
                    "holdings_count": len(holdings),
                    "securities_count": len(securities),
                    "accounts_count": len(accounts),
                    "holdings": holdings,
                    "securities": securities,
                    "accounts": accounts
                }
                with open(debug_file, 'w') as f:
                    json.dump(debug_data, f, indent=2, default=str)
                logger.info(f"[PLAID HOLDINGS] Saved full holdings data to {debug_file}")
            except Exception as e:
                logger.warning(f"[PLAID HOLDINGS] Failed to save holdings debug data: {e}")

            # Calculate cash balances by subtracting holdings value from total account value
            # Cash = Total Account Value - Sum(Holding Values)
            account_cash_balances = {}

            for account in accounts:
                if account.get('type') == 'investment':
                    account_id = account.get('account_id')
                    # Get total account value from current balance
                    total_value = account.get('balances', {}).get('current', 0) or 0

                    # Calculate total value of holdings for this account
                    holdings_value = 0
                    for holding in holdings:
                        if holding.get('account_id') == account_id:
                            # Get security info to find current price
                            security_id = holding.get('security_id')
                            security = next((s for s in securities if s.get('security_id') == security_id), None)

                            if security:
                                # Use close_price from security, fall back to institution_price
                                price = security.get('close_price') or holding.get('institution_price', 0)
                                quantity = holding.get('quantity', 0)
                                holdings_value += (price * quantity)

                    # Cash = Total - Holdings
                    cash_balance = total_value - holdings_value
                    account_cash_balances[account_id] = cash_balance

                    account_name = account.get('name', 'Unknown')
                    logger.info(f"[PLAID HOLDINGS] {account_name}: Total=${total_value:.2f}, Holdings=${holdings_value:.2f}, Cash=${cash_balance:.2f}")

            logger.info(f"[PLAID HOLDINGS] Calculated cash for {len(account_cash_balances)} investment accounts")

            return {
                "holdings": holdings,
                "securities": securities,
                "accounts": accounts,
                "cash_balances": account_cash_balances
            }
        except ApiException as e:
            logger.error(f"[PLAID HOLDINGS] Plaid API exception getting investment holdings:")
            logger.error(f"  Status: {e.status if hasattr(e, 'status') else 'N/A'}")
            logger.error(f"  Message: {e}")
            logger.error(f"  Body: {e.body if hasattr(e, 'body') else 'N/A'}")
            return None
        except Exception as e:
            logger.error(f"[PLAID HOLDINGS] Unexpected error getting investment holdings: {e}")
            logger.exception("Full traceback:")
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

    def _format_investment_transaction(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Format Plaid investment transaction object for our use"""
        return {
            "transaction_id": transaction['investment_transaction_id'],
            "account_id": transaction['account_id'],
            "security_id": transaction.get('security_id'),
            "date": transaction['date'],
            "name": transaction.get('name'),
            "type": transaction['type'],  # buy, sell, cash, etc.
            "subtype": transaction.get('subtype'),
            "quantity": transaction.get('quantity', 0),
            "amount": transaction.get('amount', 0),
            "price": transaction.get('price', 0),
            "fees": transaction.get('fees', 0),
            "iso_currency_code": transaction.get('iso_currency_code', 'USD'),
            "unofficial_currency_code": transaction.get('unofficial_currency_code'),
        }


# Singleton instance
plaid_client = PlaidClient()
