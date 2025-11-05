import pdfplumber
import pandas as pd
from typing import List, Dict, Any
from datetime import datetime
import re

class WealthsimpleParser:
    def __init__(self):
        self.positions = []
        self.transactions = []
        self.dividends = []
        self.account_info = {}

    def parse_pdf(self, file_path: str) -> Dict[str, Any]:
        try:
            with pdfplumber.open(file_path) as pdf:
                text = ""
                for page in pdf.pages:
                    text += page.extract_text() + "\n"

                self._extract_account_info(text)
                self._extract_positions(text)
                self._extract_transactions(text)

                return {
                    'account_info': self.account_info,
                    'positions': self.positions,
                    'transactions': self.transactions,
                    'dividends': self.dividends
                }
        except Exception as e:
            raise Exception(f"Error parsing PDF: {str(e)}")

    def parse_csv(self, file_path: str) -> Dict[str, Any]:
        try:
            # Debug: Check file size and first few bytes
            import os
            file_size = os.path.getsize(file_path)
            print(f"DEBUG: File size: {file_size} bytes")

            with open(file_path, 'rb') as f:
                first_bytes = f.read(100)
                print(f"DEBUG: First 100 bytes (hex): {first_bytes.hex()}")
                print(f"DEBUG: First 100 bytes (repr): {repr(first_bytes)}")

            # Try different encodings to handle various CSV formats
            encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'iso-8859-1', 'cp1252']
            df = None
            last_error = None

            for encoding in encodings:
                try:
                    df = pd.read_csv(file_path, encoding=encoding)
                    print(f"DEBUG: Successfully read CSV with encoding: {encoding}")
                    print(f"DEBUG: Columns found: {df.columns.tolist()}")
                    print(f"DEBUG: Number of rows: {len(df)}")
                    break
                except Exception as e:
                    print(f"DEBUG: Failed with encoding {encoding}: {str(e)}")
                    last_error = e
                    continue

            if df is None:
                raise Exception(f"Could not read CSV with any encoding. Last error: {str(last_error)}")

            if 'Symbol' in df.columns or 'Ticker' in df.columns:
                self._extract_positions_from_csv(df)

            # Case-insensitive column check for transactions (also consider 'transaction' column)
            columns_lower = [col.lower() for col in df.columns]
            has_date = any(col in columns_lower for col in ['date', 'transaction date', 'trade date'])
            has_type = any(col in columns_lower for col in ['type', 'transaction', 'transaction type'])

            if has_date and has_type:
                self._extract_transactions_from_csv(df)

            return {
                'account_info': self.account_info,
                'positions': self.positions,
                'transactions': self.transactions,
                'dividends': self.dividends
            }
        except Exception as e:
            raise Exception(f"Error parsing CSV: {str(e)}")

    def parse_excel(self, file_path: str) -> Dict[str, Any]:
        try:
            xls = pd.ExcelFile(file_path)

            for sheet_name in xls.sheet_names:
                df = pd.read_excel(xls, sheet_name)

                if 'Symbol' in df.columns or 'Ticker' in df.columns:
                    self._extract_positions_from_csv(df)

                # Case-insensitive column check for transactions
                columns_lower = [col.lower() for col in df.columns]
                has_date = any(col in columns_lower for col in ['date', 'transaction date', 'trade date'])
                has_type = any(col in columns_lower for col in ['type', 'transaction', 'transaction type'])

                if has_date and has_type:
                    self._extract_transactions_from_csv(df)

            return {
                'account_info': self.account_info,
                'positions': self.positions,
                'transactions': self.transactions,
                'dividends': self.dividends
            }
        except Exception as e:
            raise Exception(f"Error parsing Excel: {str(e)}")

    def _extract_account_info(self, text: str):
        account_number_match = re.search(r'Account\s*(?:Number|#)?\s*:?\s*(\w+)', text, re.IGNORECASE)
        if account_number_match:
            self.account_info['account_number'] = account_number_match.group(1)

        balance_match = re.search(r'(?:Total|Balance|Market Value)\s*:?\s*\$?([\d,]+\.?\d*)', text, re.IGNORECASE)
        if balance_match:
            balance_str = balance_match.group(1).replace(',', '')
            self.account_info['balance'] = float(balance_str)

    def _extract_positions(self, text: str):
        pass

    def _extract_transactions(self, text: str):
        pass

    def _extract_positions_from_csv(self, df: pd.DataFrame):
        ticker_col = 'Symbol' if 'Symbol' in df.columns else 'Ticker'

        for _, row in df.iterrows():
            position = {
                'ticker': row.get(ticker_col, ''),
                'name': row.get('Name', row.get('Security', '')),
                'quantity': float(row.get('Quantity', row.get('Shares', 0))),
                'book_value': float(row.get('Book Value', row.get('Cost', 0))),
                'market_value': float(row.get('Market Value', row.get('Value', 0)))
            }

            if position['ticker']:
                self.positions.append(position)

    def _extract_transactions_from_csv(self, df: pd.DataFrame):
        date_col = None
        type_col = None

        for col in df.columns:
            col_lower = col.lower()
            if col_lower in ['date', 'transaction date', 'trade date']:
                date_col = col
            elif col_lower in ['type', 'transaction', 'transaction type']:
                type_col = col

        if not date_col or not type_col:
            return

        # Ensure helper methods exist on self (provide sensible fallbacks if not defined elsewhere)
        if not hasattr(self, '_extract_quantity_from_description'):
            def _extract_quantity_from_description(description):
                if not description:
                    return None
                # Look for patterns like "50", "50.0", "50 shares", "50 x", "(50)"
                m = re.search(r'([0-9]+(?:[.,][0-9]+)?)', str(description))
                if not m:
                    return None
                try:
                    return float(m.group(1).replace(',', ''))
                except:
                    return None
            self._extract_quantity_from_description = _extract_quantity_from_description

        if not hasattr(self, '_extract_name_from_description'):
            def _extract_name_from_description(description):
                if not description:
                    return ''
                parts = re.split(r'\s*-\s*', str(description), maxsplit=1)
                if len(parts) > 1:
                    return parts[1].strip()
                return str(description).strip()
            self._extract_name_from_description = _extract_name_from_description

        for _, row in df.iterrows():
            transaction_type = str(row.get(type_col, '')).upper()
            description = row.get('description', row.get('Description', ''))

            ticker = self._extract_ticker_from_description(description)
            amount = float(row.get('amount', row.get('Amount', 0))) if pd.notna(row.get('amount', row.get('Amount', 0))) else 0.0

            mapped_type = self._map_transaction_type(transaction_type)

            if mapped_type is None:
                continue

            quantity = float(row.get('Quantity', row.get('Shares', row.get('quantity', row.get('shares', 0))))) if pd.notna(row.get('Quantity', row.get('Shares', row.get('quantity', row.get('shares', 0))))) else None

            # Only extract quantity from description for buy/sell/transfer transactions
            # Dividends, deposits, withdrawals, etc. should not have quantities extracted from descriptions
            if (quantity is None or quantity == 0) and mapped_type in ['buy', 'sell', 'transfer']:
                quantity = self._extract_quantity_from_description(description)
            elif mapped_type not in ['buy', 'sell', 'transfer']:
                # For non-trading transactions, set quantity to 0 or None
                quantity = 0

            transaction = {
                'date': self._parse_date(row.get(date_col, '')),
                'type': mapped_type,
                'ticker': ticker or row.get('Symbol', row.get('Ticker', row.get('symbol', row.get('ticker', '')))),
                'quantity': quantity,
                'price': float(row.get('Price', row.get('price', 0))) if pd.notna(row.get('Price', row.get('price', 0))) else None,
                'fees': float(row.get('Fees', row.get('Commission', row.get('fees', row.get('commission', 0))))),
                'total': amount,
                'description': description
            }

            self.transactions.append(transaction)

            if mapped_type == 'transfer' and ticker and quantity and quantity > 0:
                existing_position = next((p for p in self.positions if p['ticker'] == ticker), None)
                if existing_position:
                    existing_position['quantity'] += quantity
                else:
                    self.positions.append({
                        'ticker': ticker,
                        'name': self._extract_name_from_description(description),
                        'quantity': quantity,
                        'book_value': 0.0,
                        'market_value': 0.0
                    })

            if mapped_type == 'deposit' and amount > 0:
                cash_position = next((p for p in self.positions if p['ticker'] == 'CASH'), None)
                if cash_position:
                    cash_position['quantity'] += amount
                    cash_position['book_value'] += amount
                    cash_position['market_value'] += amount
                else:
                    self.positions.append({
                        'ticker': 'CASH',
                        'name': 'Cash',
                        'quantity': amount,
                        'book_value': amount,
                        'market_value': amount
                    })

            if transaction['type'] == 'dividend' and amount > 0:
                dividend = {
                    'ticker': transaction['ticker'],
                    'date': transaction['date'],
                    'amount': abs(amount),
                    'currency': 'CAD'
                }
                self.dividends.append(dividend)

    def _extract_ticker_from_description(self, description: str) -> str:
        if not description:
            return ''

        match = re.match(r'^([A-Z][A-Z0-9.]*)\s*-', str(description))
        if match:
            return match.group(1)
        return ''

    def _extract_quantity_from_description(self, description: str) -> float:
        if not description:
            return 0.0

        # First, try to match patterns with "shares" or "actions" keyword
        # Handle both English and French formats
        # English: "10.5 shares" or "10,000.5 shares" (dot = decimal, comma = thousands)
        # French: "10,5 actions" or "10 000,5 actions" (comma = decimal, space = thousands)
        match = re.search(r'(\d+(?:[\s,]\d{3})*(?:[.,]\d+)?)\s*(?:shares?|actions?)', str(description), re.IGNORECASE)
        if match:
            try:
                num_str = match.group(1)
                # French format: space or comma for thousands, comma for decimal
                # English format: comma for thousands, dot for decimal
                # If we have "10,0000" it's likely French "10.0000"
                # If we have "10,000.5" it's English
                # If we have "10 000,5" it's French

                # Check if it looks like French format (comma followed by 4 digits or space separators)
                if re.match(r'^\d+,\d{4}$', num_str) or ' ' in num_str:
                    # French format: remove spaces, replace comma with dot
                    num_str = num_str.replace(' ', '').replace(',', '.')
                else:
                    # English format: remove commas (thousands separator)
                    num_str = num_str.replace(',', '')

                return float(num_str)
            except:
                return 0.0

        # For "Transfer of X shares" or "Bought X shares" or "Achat de X actions" patterns
        match = re.search(r'(?:Transfer of|Bought|Sold|Achat de|Vente de)\s+(\d+(?:[\s,]\d{3})*(?:[.,]\d+)?)', str(description), re.IGNORECASE)
        if match:
            try:
                num_str = match.group(1)
                # Apply same logic as above
                if re.match(r'^\d+,\d{4}$', num_str) or ' ' in num_str:
                    num_str = num_str.replace(' ', '').replace(',', '.')
                else:
                    num_str = num_str.replace(',', '')
                return float(num_str)
            except:
                return 0.0

        # Don't use fallback for other cases to avoid extracting dates or other numbers
        return 0.0

    def _extract_name_from_description(self, description: str) -> str:
        if not description:
            return ''

        match = re.match(r'^[A-Z][A-Z0-9.]*\s*-\s*([^:]+)', str(description))
        if match:
            return match.group(1).strip()
        # Fallback: split on hyphen or colon and return the latter part
        parts = re.split(r'\s*[-:]\s*', str(description), maxsplit=1)
        if len(parts) > 1:
            return parts[1].strip()
        return str(description).strip()

    def _parse_date(self, date_str: str) -> str:
        try:
            if isinstance(date_str, pd.Timestamp):
                return date_str.isoformat()

            for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d']:
                try:
                    dt = datetime.strptime(str(date_str), fmt)
                    return dt.isoformat()
                except ValueError:
                    continue

            return datetime.now().isoformat()
        except:
            return datetime.now().isoformat()

    def _map_transaction_type(self, transaction_type: str) -> str:
        transaction_type = transaction_type.upper()

        if transaction_type in ['BUY', 'PURCHASE']:
            return 'buy'
        elif transaction_type in ['SELL', 'SALE']:
            return 'sell'
        elif transaction_type in ['DIV', 'DIVIDEND']:
            return 'dividend'
        elif transaction_type in ['DEPOSIT', 'DEP', 'TRFINTF', 'REFUND', 'CONT', 'EFT', 'FPLINT', 'TRFIN', 'AFT_IN', 'P2P_RECEIVED', 'E_TRFIN']:
            return 'deposit'
        elif transaction_type in ['WITHDRAWAL', 'WITHDRAW', 'WD', 'TRFOUT', 'OBP_OUT', 'E_TRFOUT', 'EFTOUT', 'P2P_SENT']:
            return 'withdrawal'
        elif transaction_type in ['FEE', 'FEES']:
            return 'fee'
        elif transaction_type in ['BONUS', 'REWARD', 'INT', 'GIVEAWAY', 'REFER']:
            return 'bonus'
        elif transaction_type in ['NRT', 'TAX', 'WHT']:
            return 'tax'
        elif transaction_type in ['LOAN', 'RECALL', 'STKDIS', 'STKREORG']:
            return None
        else:
            return None
