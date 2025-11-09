"""
Plaid Transaction Mapper Service

Maps Plaid transactions to our Transaction and Expense models.
Handles duplicate detection and categorization.
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.database.models import Transaction, Expense, Account

logger = logging.getLogger(__name__)


class PlaidTransactionMapper:
    """Maps Plaid transactions to our database models"""

    # Plaid category to our transaction type mapping
    CATEGORY_TO_TYPE = {
        # Income
        "INCOME": "deposit",
        "TRANSFER_IN": "transfer",

        # Expenses
        "TRANSFER_OUT": "transfer",
        "PAYMENT": "withdrawal",
        "BANK_FEES": "fee",
        "INTEREST": "deposit",  # Interest earned

        # Investment-related (for investment accounts)
        "SECURITIES_BUY": "buy",
        "SECURITIES_SELL": "sell",
        "DIVIDEND": "dividend",
    }

    # Plaid payment channels
    PAYMENT_CHANNELS = {
        "online": "Online",
        "in store": "In Store",
        "other": "Other"
    }

    def __init__(self, db: Session):
        """
        Initialize the mapper

        Args:
            db: Database session for duplicate checking
        """
        self.db = db

    def map_transaction(
        self,
        plaid_txn: Dict[str, Any],
        account_id: str,
        account_type: str
    ) -> Dict[str, Any]:
        """
        Map a Plaid transaction to our Transaction model format

        Args:
            plaid_txn: Plaid transaction object
            account_id: Our account ID
            account_type: Account type (checking, savings, investment, credit_card)

        Returns:
            Dictionary ready for Transaction model creation
        """
        # Parse date
        date = datetime.strptime(plaid_txn['date'], '%Y-%m-%d')

        # Amount in Plaid is positive for debits, negative for credits
        # We store amounts as positive, type determines direction
        amount = abs(plaid_txn['amount'])
        is_debit = plaid_txn['amount'] > 0

        # Determine transaction type based on categories and account type
        txn_type = self._determine_transaction_type(
            plaid_txn,
            account_type,
            is_debit
        )

        # Build description from available fields
        description = self._build_description(plaid_txn)

        # For deposits (credits), amount should be positive
        # For withdrawals (debits), amount should be negative in total
        if txn_type in ['withdrawal', 'fee', 'transfer'] and is_debit:
            total = -amount
        else:
            total = amount

        return {
            "date": date,
            "type": txn_type,
            "ticker": None,
            "quantity": None,
            "price": None,
            "fees": 0.0,
            "total": total,
            "description": description,
            "source": "plaid",
            "plaid_transaction_id": plaid_txn['transaction_id'],
        }

    def map_to_expense(
        self,
        plaid_txn: Dict[str, Any],
        account_id: str,
        transaction_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Map a Plaid transaction to an Expense if applicable

        Args:
            plaid_txn: Plaid transaction object
            account_id: Our account ID
            transaction_id: Associated transaction ID

        Returns:
            Dictionary for Expense model creation, or None if not an expense
        """
        # Only create expenses for debits (positive amounts in Plaid)
        if plaid_txn['amount'] <= 0:
            return None

        # Parse date
        date = datetime.strptime(plaid_txn['date'], '%Y-%m-%d')

        # Build description
        description = self._build_description(plaid_txn)

        # Get category from Plaid
        category = self._map_plaid_category(plaid_txn.get('category', []))

        # Amount is always positive for expenses
        amount = abs(plaid_txn['amount'])

        return {
            "date": date,
            "description": description,
            "amount": amount,
            "category": category,
            "transaction_id": transaction_id,
        }

    def is_duplicate(
        self,
        plaid_txn: Dict[str, Any],
        account_id: str,
        window_hours: int = 24
    ) -> bool:
        """
        Check if a Plaid transaction is a duplicate of an existing transaction

        Args:
            plaid_txn: Plaid transaction object
            account_id: Our account ID
            window_hours: Time window to check for duplicates (default 24 hours)

        Returns:
            True if duplicate found, False otherwise
        """
        # First check by Plaid transaction ID (most reliable)
        plaid_txn_id = plaid_txn['transaction_id']
        existing = self.db.query(Transaction).filter(
            Transaction.plaid_transaction_id == plaid_txn_id
        ).first()

        if existing:
            logger.debug(f"Found duplicate by Plaid ID: {plaid_txn_id}")
            return True

        # Check by date, amount, and description (fuzzy match)
        date = datetime.strptime(plaid_txn['date'], '%Y-%m-%d')
        amount = abs(plaid_txn['amount'])
        description = self._build_description(plaid_txn)

        # Define time window
        start_date = date - timedelta(hours=window_hours)
        end_date = date + timedelta(hours=window_hours)

        # Query for similar transactions
        similar_txns = self.db.query(Transaction).filter(
            Transaction.account_id == account_id,
            Transaction.date >= start_date,
            Transaction.date <= end_date,
            Transaction.total == amount or Transaction.total == -amount
        ).all()

        # Check description similarity
        for txn in similar_txns:
            # Skip if source is also Plaid (already checked by ID)
            if txn.source == 'plaid':
                continue

            if self._descriptions_match(description, txn.description or ''):
                logger.debug(
                    f"Found duplicate by fuzzy match: date={date}, "
                    f"amount={amount}, desc={description[:50]}"
                )
                return True

        return False

    def _determine_transaction_type(
        self,
        plaid_txn: Dict[str, Any],
        account_type: str,
        is_debit: bool
    ) -> str:
        """Determine our transaction type from Plaid transaction"""
        categories = plaid_txn.get('category', [])

        # Check primary category
        if categories:
            primary_category = categories[0].upper().replace(' ', '_')

            # Map known categories
            if 'TRANSFER' in primary_category:
                return 'transfer'
            elif primary_category in ['INTEREST', 'INTEREST_EARNED']:
                return 'deposit'
            elif primary_category in ['BANK_FEES', 'FEE']:
                return 'fee'
            elif 'DIVIDEND' in primary_category:
                return 'dividend'

        # For investment accounts, check for securities transactions
        if account_type == 'investment':
            payment_channel = plaid_txn.get('payment_channel', '').lower()
            if 'securities' in str(categories).lower():
                return 'buy' if is_debit else 'sell'

        # Default based on debit/credit
        if is_debit:
            return 'withdrawal'
        else:
            return 'deposit'

    def _build_description(self, plaid_txn: Dict[str, Any]) -> str:
        """Build a description from Plaid transaction fields"""
        parts = []

        # Prefer merchant name if available
        if plaid_txn.get('merchant_name'):
            parts.append(plaid_txn['merchant_name'])
        elif plaid_txn.get('name'):
            parts.append(plaid_txn['name'])

        # Add payment channel if available
        payment_channel = plaid_txn.get('payment_channel')
        if payment_channel and payment_channel in self.PAYMENT_CHANNELS:
            parts.append(f"({self.PAYMENT_CHANNELS[payment_channel]})")

        return ' '.join(parts) if parts else 'Unknown Transaction'

    def _map_plaid_category(self, categories: List[str]) -> str:
        """
        Map Plaid category hierarchy to our expense categories

        Args:
            categories: Plaid category array (e.g., ['Food and Drink', 'Restaurants'])

        Returns:
            Our category name
        """
        if not categories:
            return "Uncategorized"

        # Plaid category mapping to our categories
        # This should match the default categories in your system
        category_map = {
            "Food and Drink": "Groceries",
            "Restaurants": "Dining",
            "Coffee Shop": "Dining",
            "Fast Food": "Dining",
            "Gas": "Transportation",
            "Gas Stations": "Transportation",
            "Public Transportation": "Transportation",
            "Ride Share": "Transportation",
            "Taxi": "Transportation",
            "Parking": "Transportation",
            "Travel": "Travel",
            "Airlines": "Travel",
            "Lodging": "Travel",
            "Hotels": "Travel",
            "Shopping": "Shopping",
            "Supermarkets and Groceries": "Groceries",
            "Grocery": "Groceries",
            "Healthcare": "Healthcare",
            "Pharmacies": "Healthcare",
            "Entertainment": "Entertainment",
            "Recreation": "Entertainment",
            "Gyms and Fitness Centers": "Entertainment",
            "Transfer": "Transfer",
            "Payment": "Payment",
            "Credit Card": "Payment",
            "Utilities": "Utilities",
            "Internet": "Utilities",
            "Phone": "Utilities",
            "Cable": "Utilities",
            "Rent": "Housing",
            "Home Improvement": "Housing",
        }

        # Check each category in the hierarchy
        for category in categories:
            if category in category_map:
                return category_map[category]

        # If no match, use the primary category or default
        return categories[0] if categories else "Uncategorized"

    def _descriptions_match(self, desc1: str, desc2: str, threshold: float = 0.7) -> bool:
        """
        Check if two descriptions are similar enough to be considered duplicates

        Args:
            desc1: First description
            desc2: Second description
            threshold: Similarity threshold (0-1)

        Returns:
            True if descriptions match
        """
        # Normalize descriptions
        desc1 = desc1.lower().strip()
        desc2 = desc2.lower().strip()

        # Exact match
        if desc1 == desc2:
            return True

        # Check if one contains the other (for cases like "Starbucks" vs "Starbucks #1234")
        if desc1 in desc2 or desc2 in desc1:
            return True

        # Simple word-based similarity
        words1 = set(desc1.split())
        words2 = set(desc2.split())

        if not words1 or not words2:
            return False

        intersection = len(words1 & words2)
        union = len(words1 | words2)

        similarity = intersection / union if union > 0 else 0

        return similarity >= threshold


# Helper function for easy access
def create_mapper(db: Session) -> PlaidTransactionMapper:
    """Create a transaction mapper instance"""
    return PlaidTransactionMapper(db)
