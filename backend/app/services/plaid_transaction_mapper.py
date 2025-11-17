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
    # Simplified category to type mapping
    # All transactions are now either Money In or Money Out based on amount
    CATEGORY_TO_TYPE = {
        # Income/Credits - Money In
        "INCOME": "Money In",
        "TRANSFER_IN": "Money In",
        "INTEREST": "Money In",
        "DIVIDEND": "Money In",
        "SECURITIES_SELL": "Money In",

        # Expenses/Debits - Money Out
        "TRANSFER_OUT": "Money Out",
        "PAYMENT": "Money Out",
        "BANK_FEES": "Money Out",
        "SECURITIES_BUY": "Money Out",
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

    def _parse_plaid_date(self, date_value: Any) -> datetime:
        """
        Parse Plaid date which can be a string, datetime, or datetime.date object

        Args:
            date_value: Date from Plaid transaction (str, datetime, or datetime.date)

        Returns:
            datetime object
        """
        if isinstance(date_value, str):
            return datetime.strptime(date_value, '%Y-%m-%d')
        elif isinstance(date_value, datetime):
            return date_value
        else:
            # datetime.date object
            return datetime.combine(date_value, datetime.min.time())

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
        date = self._parse_plaid_date(plaid_txn['date'])

        # Amount in Plaid is positive for debits, negative for credits
        # We convert to our format: positive = money in, negative = money out
        amount = plaid_txn['amount']

        # Convert Plaid's convention (positive=debit) to ours (positive=credit)
        # For most accounts: debit (money out) should be negative, credit (money in) should be positive
        total = -amount

        # Build description from available fields
        description = self._build_description(plaid_txn)

        # Determine transaction type based on amount using transaction_classifier
        from app.services.transaction_classifier import transaction_classifier
        txn_type = transaction_classifier.classify_transaction(total)

        # Extract Plaid Personal Finance Category (PFC) if available
        pfc_data = self._extract_pfc(plaid_txn)

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
            "pfc_primary": pfc_data.get('primary'),
            "pfc_detailed": pfc_data.get('detailed'),
            "pfc_confidence": pfc_data.get('confidence_level'),
        }

    def map_to_expense(
        self,
        plaid_txn: Dict[str, Any],
        account_id: str,
        transaction_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Map a Plaid transaction to an Expense for tracking in the Cashflow page

        Creates expense records for both Money In and Money Out transactions so they
        can be categorized and tracked in the Cashflow section.

        Args:
            plaid_txn: Plaid transaction object
            account_id: Our account ID
            transaction_id: Associated transaction ID

        Returns:
            Dictionary for Expense model creation
        """
        # Parse date
        date = self._parse_plaid_date(plaid_txn['date'])

        # Build description
        description = self._build_description(plaid_txn)

        # Get category from Plaid (legacy mapping for backward compatibility)
        category = self._map_plaid_category(plaid_txn.get('category', []))

        # Extract Plaid Personal Finance Category (PFC) if available
        pfc_data = self._extract_pfc(plaid_txn)

        # If we have PFC data but no legacy category, try to map PFC to a category
        if not category and pfc_data.get('detailed'):
            category = self._map_pfc_to_category(pfc_data['detailed'])

        # Amount is always positive for expense records
        amount = abs(plaid_txn['amount'])

        return {
            "date": date,
            "description": description,
            "amount": amount,
            "category": category,
            "transaction_id": transaction_id,
            "pfc_primary": pfc_data.get('primary'),
            "pfc_detailed": pfc_data.get('detailed'),
            "pfc_confidence": pfc_data.get('confidence_level'),
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
        date = self._parse_plaid_date(plaid_txn['date'])

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
        # Simplified transaction types: Money In or Money Out
        # Based on Definitions.MD - transaction types are now simplified to:
        # - Money In: positive values (credits)
        # - Money Out: negative values (debits)

        # Default based on debit/credit
        if is_debit:
            return 'Money Out'
        else:
            return 'Money In'

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

    def _extract_pfc(self, plaid_txn: Dict[str, Any]) -> Dict[str, Optional[str]]:
        """
        Extract Plaid Personal Finance Category (PFC) from transaction

        Args:
            plaid_txn: Plaid transaction object

        Returns:
            Dictionary with primary, detailed, and confidence_level keys
        """
        pfc = plaid_txn.get('personal_finance_category')

        if not pfc:
            return {
                'primary': None,
                'detailed': None,
                'confidence_level': None
            }

        return {
            'primary': pfc.get('primary'),
            'detailed': pfc.get('detailed'),
            'confidence_level': pfc.get('confidence_level')
        }

    def _map_pfc_to_category(self, pfc_detailed: str) -> str:
        """
        Map Plaid Personal Finance Category (detailed) to our expense categories

        Args:
            pfc_detailed: Plaid PFC detailed category (e.g., FOOD_AND_DRINK_GROCERIES)

        Returns:
            Our category name
        """
        # Mapping from PFC detailed categories to our categories
        pfc_map = {
            # Food & Drink
            'FOOD_AND_DRINK_GROCERIES': 'Groceries',
            'FOOD_AND_DRINK_RESTAURANT': 'Dining',
            'FOOD_AND_DRINK_FAST_FOOD': 'Dining',
            'FOOD_AND_DRINK_COFFEE': 'Dining',
            'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR': 'Dining',
            'FOOD_AND_DRINK_VENDING_MACHINES': 'Dining',
            'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK': 'Dining',

            # Transportation
            'TRANSPORTATION_GAS': 'Transportation',
            'TRANSPORTATION_PUBLIC_TRANSIT': 'Transportation',
            'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': 'Transportation',
            'TRANSPORTATION_PARKING': 'Transportation',
            'TRANSPORTATION_TOLLS': 'Transportation',
            'TRANSPORTATION_BIKES_AND_SCOOTERS': 'Transportation',
            'TRANSPORTATION_OTHER_TRANSPORTATION': 'Transportation',

            # Travel
            'TRAVEL_FLIGHTS': 'Travel',
            'TRAVEL_LODGING': 'Travel',
            'TRAVEL_RENTAL_CARS': 'Travel',
            'TRAVEL_OTHER_TRAVEL': 'Travel',

            # Shopping
            'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS': 'Shopping',
            'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES': 'Shopping',
            'GENERAL_MERCHANDISE_CONVENIENCE_STORES': 'Shopping',
            'GENERAL_MERCHANDISE_DEPARTMENT_STORES': 'Shopping',
            'GENERAL_MERCHANDISE_DISCOUNT_STORES': 'Shopping',
            'GENERAL_MERCHANDISE_ELECTRONICS': 'Shopping',
            'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES': 'Shopping',
            'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': 'Shopping',
            'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES': 'Shopping',
            'GENERAL_MERCHANDISE_PET_SUPPLIES': 'Shopping',
            'GENERAL_MERCHANDISE_SPORTING_GOODS': 'Shopping',
            'GENERAL_MERCHANDISE_SUPERSTORES': 'Shopping',
            'GENERAL_MERCHANDISE_TOBACCO_AND_VAPE': 'Shopping',
            'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': 'Shopping',

            # Entertainment
            'ENTERTAINMENT_CASINOS_AND_GAMBLING': 'Entertainment',
            'ENTERTAINMENT_MUSIC_AND_AUDIO': 'Entertainment',
            'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS': 'Entertainment',
            'ENTERTAINMENT_TV_AND_MOVIES': 'Entertainment',
            'ENTERTAINMENT_VIDEO_GAMES': 'Entertainment',
            'ENTERTAINMENT_OTHER_ENTERTAINMENT': 'Entertainment',

            # Healthcare
            'MEDICAL_DENTAL_CARE': 'Healthcare',
            'MEDICAL_EYE_CARE': 'Healthcare',
            'MEDICAL_NURSING_CARE': 'Healthcare',
            'MEDICAL_PHARMACIES_AND_SUPPLEMENTS': 'Healthcare',
            'MEDICAL_PRIMARY_CARE': 'Healthcare',
            'MEDICAL_VETERINARY_SERVICES': 'Healthcare',
            'MEDICAL_OTHER_MEDICAL': 'Healthcare',

            # Personal Care
            'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': 'Entertainment',
            'PERSONAL_CARE_HAIR_AND_BEAUTY': 'Personal Care',
            'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING': 'Personal Care',
            'PERSONAL_CARE_OTHER_PERSONAL_CARE': 'Personal Care',

            # Housing
            'HOME_IMPROVEMENT_FURNITURE': 'Housing',
            'HOME_IMPROVEMENT_HARDWARE': 'Housing',
            'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE': 'Housing',
            'HOME_IMPROVEMENT_SECURITY': 'Housing',
            'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT': 'Housing',
            'RENT_AND_UTILITIES_RENT': 'Housing',
            'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY': 'Utilities',
            'RENT_AND_UTILITIES_INTERNET_AND_CABLE': 'Utilities',
            'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT': 'Utilities',
            'RENT_AND_UTILITIES_TELEPHONE': 'Utilities',
            'RENT_AND_UTILITIES_WATER': 'Utilities',
            'RENT_AND_UTILITIES_OTHER_UTILITIES': 'Utilities',

            # Income & Transfers In
            'INCOME_WAGES': 'Salary',
            'INCOME_DIVIDENDS': 'Dividends',
            'INCOME_INTEREST_EARNED': 'Interest',
            'INCOME_RETIREMENT_PENSION': 'Retirement Income',
            'INCOME_TAX_REFUND': 'Tax Refund',
            'INCOME_UNEMPLOYMENT': 'Unemployment',
            'INCOME_OTHER_INCOME': 'Other Income',
            'TRANSFER_IN_DEPOSIT': 'Deposit',
            'TRANSFER_IN_CASH_ADVANCES_AND_LOANS': 'Transfer',
            'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS': 'Investment Transfer',
            'TRANSFER_IN_SAVINGS': 'Savings Transfer',
            'TRANSFER_IN_ACCOUNT_TRANSFER': 'Transfer',
            'TRANSFER_IN_OTHER_TRANSFER_IN': 'Transfer',
            'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS': 'Transfer',
            'TRANSFER_OUT_SAVINGS': 'Transfer',
            'TRANSFER_OUT_WITHDRAWAL': 'Transfer',
            'TRANSFER_OUT_ACCOUNT_TRANSFER': 'Transfer',
            'TRANSFER_OUT_OTHER_TRANSFER_OUT': 'Transfer',
            'LOAN_PAYMENTS_CAR_PAYMENT': 'Payment',
            'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT': 'Payment',
            'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT': 'Payment',
            'LOAN_PAYMENTS_MORTGAGE_PAYMENT': 'Payment',
            'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT': 'Payment',
            'LOAN_PAYMENTS_OTHER_PAYMENT': 'Payment',

            # Services
            'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING': 'Services',
            'GENERAL_SERVICES_AUTOMOTIVE': 'Transportation',
            'GENERAL_SERVICES_CHILDCARE': 'Services',
            'GENERAL_SERVICES_CONSULTING_AND_LEGAL': 'Services',
            'GENERAL_SERVICES_EDUCATION': 'Education',
            'GENERAL_SERVICES_INSURANCE': 'Insurance',
            'GENERAL_SERVICES_POSTAGE_AND_SHIPPING': 'Services',
            'GENERAL_SERVICES_STORAGE': 'Services',
            'GENERAL_SERVICES_OTHER_GENERAL_SERVICES': 'Services',
        }

        return pfc_map.get(pfc_detailed, 'Uncategorized')


# Helper function for easy access
def create_mapper(db: Session) -> PlaidTransactionMapper:
    """Create a transaction mapper instance"""
    return PlaidTransactionMapper(db)
