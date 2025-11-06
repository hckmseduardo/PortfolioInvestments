"""
Tangerine Bank Statement Parser

Supports:
- CSV format (checking/savings accounts)
- QFX/OFX format (Open Financial Exchange)
"""

import csv
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class TangerineParser:
    """Parser for Tangerine bank statements in CSV and QFX formats."""

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
        elif self.file_extension in ['qfx', 'ofx']:
            return self._parse_qfx()
        else:
            raise ValueError(f"Unsupported file format: {self.file_extension}")

    def _parse_csv(self) -> Dict[str, Any]:
        """
        Parse Tangerine CSV statement.

        CSV Format:
        Date,Transaction,Nom,Description,Montant
        08/26/2021,OTHER,EFT Deposit from EDWARD JONES,From EDWARD JONES,10000.00
        """
        transactions = []
        account_info = {
            "institution": "Tangerine",
            "account_type": "checking",
            "currency": "CAD"
        }

        try:
            with open(self.file_path, 'r', encoding='utf-8') as file:
                reader = csv.DictReader(file)

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
            # Parse date (MM/DD/YYYY format)
            date_str = row.get('Date', '').strip()
            if not date_str:
                return None

            date = datetime.strptime(date_str, '%m/%d/%Y')

            # Parse amount
            amount_str = row.get('Montant', '').strip()
            if not amount_str:
                return None

            amount = float(amount_str.replace(',', ''))

            # Get transaction details
            transaction_type = row.get('Transaction', '').strip()
            name = row.get('Nom', '').strip()
            description = row.get('Description', '').strip()

            # Build full description
            full_description = name
            if description:
                full_description += f" - {description}"

            # Map Tangerine transaction type to our system
            mapped_type = self._map_transaction_type(transaction_type, name, amount)

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

    def _parse_qfx(self) -> Dict[str, Any]:
        """
        Parse Tangerine QFX/OFX statement.

        QFX is an OFX (Open Financial Exchange) format used by financial institutions.
        """
        transactions = []
        account_info = {
            "institution": "Tangerine",
            "account_type": "checking",
            "currency": "CAD"
        }

        try:
            with open(self.file_path, 'r', encoding='utf-8') as file:
                content = file.read()

            # Extract SGML/XML content (OFX uses SGML-like format)
            # Find the <OFX> tag and parse from there
            ofx_start = content.find('<OFX>')
            if ofx_start == -1:
                raise ValueError("Invalid QFX file: No <OFX> tag found")

            ofx_content = content[ofx_start:]

            # Parse account information
            account_id_match = re.search(r'<ACCTID>(\d+)', ofx_content)
            if account_id_match:
                account_info["account_number"] = account_id_match.group(1)

            account_type_match = re.search(r'<ACCTTYPE>(\w+)', ofx_content)
            if account_type_match:
                ofx_account_type = account_type_match.group(1).lower()
                account_info["account_type"] = "savings" if ofx_account_type == "savings" else "checking"

            # Extract transactions using regex (OFX/SGML doesn't have closing tags)
            transaction_pattern = r'<STMTTRN>(.*?)</STMTTRN>'
            transaction_matches = re.finditer(transaction_pattern, ofx_content, re.DOTALL)

            for match in transaction_matches:
                try:
                    transaction_data = match.group(1)
                    transaction = self._parse_ofx_transaction(transaction_data)
                    if transaction:
                        transactions.append(transaction)
                except Exception as e:
                    logger.warning(f"Error parsing QFX transaction: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error reading QFX file: {e}")
            raise

        return {
            "account": account_info,
            "transactions": transactions,
            "positions": [],
            "dividends": []
        }

    def _parse_ofx_transaction(self, transaction_data: str) -> Optional[Dict[str, Any]]:
        """Parse a single OFX transaction."""
        try:
            # Extract fields using regex
            trntype = re.search(r'<TRNTYPE>(\w+)', transaction_data)
            dtposted = re.search(r'<DTPOSTED>(\d{8})', transaction_data)
            trnamt = re.search(r'<TRNAMT>([-\d.]+)', transaction_data)
            name = re.search(r'<NAME>([^<]+)', transaction_data)
            memo = re.search(r'<MEMO>([^<]+)', transaction_data)

            if not (dtposted and trnamt):
                return None

            # Parse date (YYYYMMDD format)
            date_str = dtposted.group(1)
            date = datetime.strptime(date_str, '%Y%m%d')

            # Parse amount
            amount = float(trnamt.group(1))

            # Build description
            description = name.group(1) if name else "Unknown Transaction"
            if memo:
                memo_text = memo.group(1)
                if memo_text and memo_text != description:
                    description += f" - {memo_text}"

            # Map transaction type
            ofx_type = trntype.group(1) if trntype else "OTHER"
            mapped_type = self._map_ofx_transaction_type(ofx_type, description, amount)

            return {
                "date": date,
                "type": mapped_type,
                "description": description,
                "amount": abs(amount),
                "is_credit": amount > 0,
                "ticker": "",
                "quantity": 0,
                "price": 0.0,
                "fees": 0.0,
                "total": amount
            }

        except Exception as e:
            logger.warning(f"Error parsing OFX transaction data: {e}")
            return None

    def _map_transaction_type(self, transaction_type: str, name: str, amount: float) -> str:
        """
        Map Tangerine CSV transaction type to our system.

        Args:
            transaction_type: Tangerine transaction type (OTHER, CREDIT, DEBIT, etc.)
            name: Transaction name/description
            amount: Transaction amount

        Returns:
            Mapped transaction type
        """
        name_lower = name.lower()

        # Check for specific patterns first - order matters!
        # More specific patterns should come before generic ones
        if 'interac e-transfer' in name_lower:
            if amount > 0:
                return 'deposit'
            else:
                return 'withdrawal'
        elif 'interest' in name_lower:
            return 'bonus'
        elif 'bonus' in name_lower or 'reward' in name_lower:
            return 'bonus'
        elif 'paie' in name_lower or 'payroll' in name_lower or 'salary' in name_lower:
            return 'deposit'
        elif 'eft deposit' in name_lower or 'deposit from' in name_lower or 'internet deposit' in name_lower:
            return 'deposit'
        elif 'withdrawal' in name_lower or 'internet withdrawal' in name_lower:
            return 'withdrawal'
        elif 'bill payment' in name_lower or 'payment for' in name_lower or 'payment to' in name_lower:
            return 'withdrawal'
        elif 'transfer' in name_lower:
            return 'transfer'
        elif 'nsf' in name_lower or 'service charge' in name_lower or ' fee' in name_lower or name_lower.endswith('fee'):
            return 'fee'

        # Fall back to transaction type
        if transaction_type == 'CREDIT':
            return 'deposit'
        elif transaction_type == 'DEBIT':
            return 'withdrawal'
        elif transaction_type == 'OTHER':
            return 'withdrawal' if amount < 0 else 'deposit'
        else:
            return 'withdrawal' if amount < 0 else 'deposit'

    def _map_ofx_transaction_type(self, ofx_type: str, description: str, amount: float) -> str:
        """
        Map OFX transaction type to our system.

        Args:
            ofx_type: OFX transaction type (OTHER, CREDIT, DEBIT, etc.)
            description: Transaction description
            amount: Transaction amount

        Returns:
            Mapped transaction type
        """
        # Use the same logic as CSV mapping
        return self._map_transaction_type(ofx_type, description, amount)


def parse_tangerine_statement(file_path: str) -> Dict[str, Any]:
    """
    Convenience function to parse a Tangerine statement.

    Args:
        file_path: Path to the statement file

    Returns:
        Dictionary containing parsed statement data
    """
    parser = TangerineParser(file_path)
    return parser.parse()
