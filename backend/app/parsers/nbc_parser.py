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

        CSV Format:
        Date;Description;Category;Debit;Credit;Balance
        "2025-11-06";"Mastercard payment";"Credit card payment";"2090.47";"0";"2300.95"
        """
        transactions = []
        account_info = {
            "institution": "NBC",
            "account_type": "checking",
            "currency": "CAD"
        }

        try:
            with open(self.file_path, 'r', encoding='utf-8') as file:
                # NBC uses semicolon as delimiter
                reader = csv.DictReader(file, delimiter=';')

                for row in reader:
                    try:
                        transaction = self._parse_csv_row(row)
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

    def _parse_csv_row(self, row: Dict[str, str]) -> Optional[Dict[str, Any]]:
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
            mapped_type = self._map_transaction_type(description, category, amount)

            return {
                "date": date,
                "type": mapped_type,
                "description": full_description,
                "amount": abs(amount),
                "is_credit": amount > 0,
                "ticker": "",
                "quantity": 0,
                "price": 0.0,
                "fees": 0.0,
                "total": amount
            }

        except Exception as e:
            logger.warning(f"Error parsing row: {row}. Error: {e}")
            return None

    def _map_transaction_type(self, description: str, category: str, amount: float) -> str:
        """
        Map NBC transaction to our system.

        Args:
            description: Transaction description
            category: NBC category
            amount: Transaction amount (positive = credit, negative = debit)

        Returns:
            Mapped transaction type
        """
        desc_lower = description.lower()
        cat_lower = category.lower() if category else ""

        # Check for specific patterns - order matters!
        # More specific patterns should come before generic ones

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
