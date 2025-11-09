"""
NBC (National Bank of Canada) Statement Parser

Supports:
- CSV format (checking/savings accounts)
"""

import csv
import re
from datetime import datetime
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class NBCParser:
    """Parser for NBC (National Bank of Canada) bank statements in CSV format."""

    def __init__(self, file_path: str):
        """
        Initialize the parser.

        Args:
            file_path: Path to the statement file
        """
        self.file_path = file_path
        self.file_extension = file_path.lower().split('.')[-1]

    def parse(self) -> Dict[str, Any]:
        """
        Parse the statement file.

        Returns:
            Dictionary containing account info, transactions, and metadata
        """
        if self.file_extension == 'csv':
            return self._parse_csv()
        else:
            raise ValueError(f"Unsupported file format: {self.file_extension}")

    def _parse_csv(self) -> Dict[str, Any]:
        """
        Parse NBC CSV statement.

        CSV Formats:
        Checking: Date;Description;Category;Debit;Credit;Balance
        Credit Card: Date;card Number;Description;Category;Debit;Credit
        """
        transactions = []

        try:
            with open(self.file_path, 'r', encoding='utf-8') as file:
                # NBC uses semicolon as delimiter
                reader = csv.DictReader(file, delimiter=';')

                # Detect account type from headers
                headers = reader.fieldnames
                is_credit_card = 'card Number' in headers or 'Card Number' in headers

                account_info = {
                    "institution": "NBC",
                    "account_type": "credit_card" if is_credit_card else "checking",
                    "currency": "CAD"
                }

                for row in reader:
                    try:
                        transaction = self._parse_csv_row(row, is_credit_card)
                        if transaction:
                            transactions.append(transaction)
                    except Exception as e:
                        logger.warning(f"Error parsing CSV row: {row}. Error: {e}")
                        continue

        except Exception as e:
            logger.error(f"Error reading CSV file: {e}")
            raise

        return {
            "account": account_info,
            "transactions": transactions,
            "positions": [],
            "dividends": []
        }

    def _parse_csv_row(self, row: Dict[str, str], is_credit_card: bool = False) -> Optional[Dict[str, Any]]:
        """Parse a single CSV row into a transaction."""
        try:
            # Parse date (YYYY-MM-DD format)
            date_str = row.get('Date', '').strip().strip('"')
            if not date_str:
                return None

            date = datetime.strptime(date_str, '%Y-%m-%d')

            # Parse debit and credit amounts
            debit_str = row.get('Debit', '').strip().strip('"')
            credit_str = row.get('Credit', '').strip().strip('"')

            if not debit_str and not credit_str:
                return None

            debit = float(debit_str.replace(',', '')) if debit_str and debit_str != '0' else 0.0
            credit = float(credit_str.replace(',', '')) if credit_str and credit_str != '0' else 0.0

            # Calculate net amount (credit is positive, debit is negative)
            amount = credit - debit

            # Get transaction details
            description = row.get('Description', '').strip().strip('"')
            category = row.get('Category', '').strip().strip('"')

            # Build full description with category
            full_description = description
            if category and category != description:
                full_description += f" ({category})"

            # Map NBC transaction to our system
            mapped_type = self._map_transaction_type(description, category, amount, is_credit_card)

            return {
                "date": date,
                "type": mapped_type,
                "description": full_description,
                "ticker": "",
                "quantity": 0,
                "price": 0.0,
                "fees": 0.0,
                "total": amount
            }

        except Exception as e:
            logger.warning(f"Error parsing row: {row}. Error: {e}")
            return None

    def _map_transaction_type(self, description: str, category: str, amount: float, is_credit_card: bool = False) -> str:
        """
        Map NBC transaction to our system.

        Args:
            description: Transaction description
            category: NBC category
            amount: Transaction amount (positive = credit, negative = debit)
            is_credit_card: Whether this is from a credit card statement

        Returns:
            Mapped transaction type
        """
        desc_lower = description.lower()
        cat_lower = category.lower() if category else ""

        # Check for specific patterns - order matters!
        # More specific patterns should come before generic ones

        # Credit card specific handling
        if is_credit_card:
            # Payment received on credit card
            if 'payment received' in desc_lower or 'credit card payment' in cat_lower:
                return 'deposit'  # Payment to credit card (reduces balance)
            # All other credit card transactions are purchases (withdrawals)
            else:
                return 'withdrawal'

        # Salary/Income
        if 'paie' in desc_lower or 'paycheck' in desc_lower or 'salary' in cat_lower:
            return 'deposit'
        elif 'government' in desc_lower or 'gouv' in desc_lower:
            return 'deposit'
        elif 'revenue' in cat_lower or 'mobile deposit' in desc_lower:
            return 'deposit'

        # INTERAC e-Transfer
        if 'interac e-transfer' in desc_lower:
            if amount > 0:
                return 'deposit'
            else:
                return 'withdrawal'

        # Investments
        if 'investment' in desc_lower or 'investments' in cat_lower:
            return 'transfer'

        # Transfers to/from other banks
        if 'tangerine' in desc_lower:
            return 'transfer'

        # Insurance
        if 'insurance' in cat_lower or 'assurance' in desc_lower:
            return 'withdrawal'

        # Mortgage and rent
        if 'mortgage' in desc_lower or 'mortgage' in cat_lower:
            return 'withdrawal'

        # Credit card payments
        if 'mastercard' in desc_lower or 'credit card' in cat_lower:
            return 'withdrawal'

        # Bills and utilities
        if 'bill' in desc_lower or 'bill' in cat_lower or 'utilities' in cat_lower:
            return 'withdrawal'

        # Fees
        if 'fee' in desc_lower or 'fees' in cat_lower or 'frais' in desc_lower:
            return 'fee'
        elif 'service charge' in desc_lower or 'bank fee' in cat_lower:
            return 'fee'

        # Bonus/interest
        if 'interest' in desc_lower or 'bonus' in desc_lower:
            return 'bonus'

        # General transfers
        if 'transfer' in desc_lower or 'transfer' in cat_lower:
            if amount > 0:
                return 'deposit'
            else:
                return 'withdrawal'

        # Online payments
        if 'online' in desc_lower or 'mobile' in desc_lower:
            return 'withdrawal'

        # Restaurants and shopping
        if any(keyword in cat_lower for keyword in ['restaurant', 'hairdresser', 'miscellaneous']):
            return 'withdrawal'

        # Default based on amount
        return 'deposit' if amount > 0 else 'withdrawal'


def parse_nbc_statement(file_path: str) -> Dict[str, Any]:
    """
    Convenience function to parse an NBC statement.

    Args:
        file_path: Path to the statement file

    Returns:
        Dictionary containing parsed statement data
    """
    parser = NBCParser(file_path)
    return parser.parse()
