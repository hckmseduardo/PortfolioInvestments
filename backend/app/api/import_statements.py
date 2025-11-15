from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Body
from typing import List, Optional, Dict
import os
import aiofiles
from pathlib import Path
import logging
import re
from datetime import datetime, date
from pydantic import BaseModel
from sqlalchemy.orm import Session
from rq.exceptions import NoSuchJobError
from app.models.schemas import User, Statement
from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service
from app.parsers.wealthsimple_parser import WealthsimpleParser
from app.parsers.tangerine_parser import TangerineParser
from app.parsers.nbc_parser import NBCParser
from app.parsers.ibkr_parser import InteractiveBrokersParser
from app.config import settings
from app.services.job_queue import enqueue_statement_job, get_job_info

router = APIRouter(prefix="/import", tags=["import"])
logger = logging.getLogger(__name__)


def _get_date_only(txn: Dict) -> date:
    """Extract date part from transaction's date field."""
    txn_date = txn.get('date', '')
    if isinstance(txn_date, datetime):
        return txn_date.date()
    elif isinstance(txn_date, date):
        return txn_date
    elif isinstance(txn_date, str):
        try:
            parsed = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))
            return parsed.date()
        except (ValueError, AttributeError):
            return date.min
    return date.min

# Security: File upload restrictions
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes
ALLOWED_EXTENSIONS = {'.pdf', '.csv', '.xlsx', '.xls', '.qfx', '.ofx'}
ALLOWED_MIME_TYPES = {
    'application/pdf',
    'text/csv',
    'text/plain',  # CSV files may be detected as plain text
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x-ofx',
    'application/vnd.intu.qfx',
    'application/octet-stream'  # Some file types may be detected as this
}


class StatementAccountChangeRequest(BaseModel):
    account_id: str


class ReprocessAllRequest(BaseModel):
    account_id: Optional[str] = None


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal and other security issues.

    - Removes directory traversal characters (../, ..\\, etc.)
    - Removes path separators
    - Removes control characters and special characters
    - Limits filename length
    - Preserves extension
    """
    # Remove any path components
    filename = os.path.basename(filename)

    # Remove directory traversal attempts
    filename = filename.replace('..', '').replace('/', '').replace('\\', '')

    # Split into name and extension
    name, ext = os.path.splitext(filename)

    # Remove control characters and special characters, keep only alphanumeric, dash, underscore, space
    name = re.sub(r'[^\w\s\-.]', '', name)

    # Remove any remaining dots from name (except the one before extension)
    name = name.replace('.', '_')

    # Limit name length (200 chars max)
    if len(name) > 200:
        name = name[:200]

    # Reconstruct filename
    sanitized = f"{name}{ext.lower()}"

    # Final safety check - ensure no path components
    if '/' in sanitized or '\\' in sanitized or '..' in sanitized:
        raise ValueError("Invalid filename after sanitization")

    return sanitized


def allowed_file(filename: str) -> bool:
    """
    Check if file extension is allowed.
    Note: Content-type validation is also performed separately.
    """
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


async def validate_file_content_type(file: UploadFile) -> bool:
    """
    Validate file content type by checking the actual file content.
    This provides additional security beyond extension checking.
    """
    # Read first 2KB to detect file type
    content_sample = await file.read(2048)
    await file.seek(0)  # Reset file pointer

    # Check file signature (magic bytes)
    if content_sample.startswith(b'%PDF'):
        return True  # PDF file
    elif content_sample.startswith(b'PK'):
        return True  # ZIP-based files (xlsx, xls)
    elif len(content_sample) > 0:
        # For CSV/text files, check if it's valid text
        try:
            content_sample.decode('utf-8')
            return True
        except UnicodeDecodeError:
            # Try other encodings
            try:
                content_sample.decode('latin-1')
                return True
            except:
                return False

    return False


def _coerce_datetime(value):
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        # Convert date to datetime at midnight
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00") if value.endswith("Z") else value
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None
    return None


def _verify_statement_ownership(db, statement_id: str, user_id: str):
    """
    Verify that a statement belongs to one of the user's accounts.
    Returns the statement if found, raises HTTPException otherwise.
    """
    statement = db.find_one("statements", {"id": statement_id})
    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement not found"
        )

    # Check if the statement's account belongs to the user
    account = db.find_one("accounts", {"id": statement["account_id"], "user_id": user_id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement not found"
        )

    return statement


def _coerce_number(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def compute_statement_metrics(statement_id: str, db):
    """
    Compute metrics for a statement by querying transactions linked to it.
    """
    transactions = db.find("transactions", {"statement_id": statement_id})
    first_date = None
    last_date = None
    credit_volume = 0.0
    debit_volume = 0.0

    for txn in transactions:
        txn_date = _coerce_datetime(txn.get("date"))
        if txn_date:
            if first_date is None or txn_date < first_date:
                first_date = txn_date
            if last_date is None or txn_date > last_date:
                last_date = txn_date

        total_value = _coerce_number(txn.get("total"))
        if total_value is None:
            continue

        if total_value > 0:
            credit_volume += total_value
        elif total_value < 0:
            debit_volume += abs(total_value)

    return {
        "transaction_first_date": first_date.isoformat() if first_date else None,
        "transaction_last_date": last_date.isoformat() if last_date else None,
        "credit_volume": round(credit_volume, 2),
        "debit_volume": round(debit_volume, 2),
    }

def recalculate_positions_from_transactions(account_id: str, db, statement_id: Optional[str] = None):
    """
    Recalculate positions from ALL transactions for an account.

    NOTE: Positions are account-wide, not per-statement. They represent the cumulative
    state of the account based on all transactions. The statement_id parameter is ignored
    but kept for backward compatibility.

    Args:
        account_id: The account to recalculate positions for
        db: Database service instance
        statement_id: IGNORED - kept for backward compatibility
    """
    transactions = db.find("transactions", {"account_id": account_id})
    # Filter out transactions with None dates and sort by date (date part only), then by value DESC (credits before debits), then by ID
    transactions = [t for t in transactions if t.get('date') is not None]
    transactions = sorted(transactions, key=lambda x: (_get_date_only(x), -x.get('total', 0.0), x.get('id', '')))

    positions_map: Dict[str, Dict] = {}

    cash_position = {
        'ticker': 'CASH',
        'name': 'Cash',
        'quantity': 0,
        'book_value': 0,
        'market_value': 0,
        'account_id': account_id
    }

    for txn in transactions:
        txn_type = txn.get('type')
        ticker = (txn.get('ticker') or '').strip()
        quantity = txn.get('quantity', 0)
        total = txn.get('total', 0)

        # Handle cash-only transactions first (case-insensitive comparison)
        txn_type_upper = (txn_type or '').upper()
        if txn_type_upper in ['DEPOSIT', 'BONUS']:
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total
            continue

        if txn_type_upper in ['WITHDRAWAL', 'FEE', 'TAX']:
            # total should reflect the cash change (positive for deposit, negative for withdrawal)
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total
            continue

        if not ticker:
            # Non-cash transaction without a ticker: skip
            continue

        if ticker not in positions_map:
            description = txn.get('description') or ''
            positions_map[ticker] = {
                'ticker': ticker,
                'name': description.split(':')[0].split('-', 1)[-1].strip() if '-' in description else ticker,
                'quantity': 0,
                'book_value': 0,
                'market_value': 0,
                'account_id': account_id
            }

        position = positions_map[ticker]

        if txn_type_upper == 'BUY':
            # Increase holding and book value; cash decreases by the cash spent
            position['quantity'] += quantity
            position['book_value'] += abs(total)
            cash_position['quantity'] -= abs(total)
            cash_position['book_value'] -= abs(total)
            cash_position['market_value'] -= abs(total)
        elif txn_type_upper == 'SELL':
            # Decrease holding using average cost if possible; cash increases by proceeds
            if position['quantity'] > 0:
                avg_cost = position['book_value'] / position['quantity']
                position['quantity'] -= quantity
                position['book_value'] -= quantity * avg_cost
            else:
                position['quantity'] -= quantity
            cash_position['quantity'] += abs(total)
            cash_position['book_value'] += abs(total)
            cash_position['market_value'] += abs(total)
        elif txn_type_upper == 'TRANSFER':
            # Transfers change quantity but typically don't affect cash
            position['quantity'] += quantity
        elif txn_type_upper == 'DIVIDEND':
            # Dividends increase cash
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total
        elif txn_type_upper == 'INTEREST':
            # Interest increases cash
            cash_position['quantity'] += total
            cash_position['book_value'] += total
            cash_position['market_value'] += total

    # Ensure CASH is included in the positions map so it's persisted
    positions_map['CASH'] = cash_position

    # Always delete ALL positions for the account and recalculate from scratch
    # Positions are account-wide and represent cumulative state, not per-statement
    db.delete_many("positions", {"account_id": account_id})

    positions_created = 0
    for ticker, position_data in positions_map.items():
        # Persist positions with positive quantity or the CASH position
        if position_data.get('quantity', 0) > 0 or ticker == 'CASH':
            position_doc = {
                **position_data,
                "last_updated": datetime.now().isoformat()
            }
            # Do NOT set statement_id - positions are account-wide, not per-statement
            db.insert("positions", position_doc)
            positions_created += 1

    return positions_created

def remove_duplicate_transactions(account_id: str, db) -> Dict:
    """
    Remove duplicate transactions for an account.
    Keeps Plaid-synced transactions, removes statement imports that duplicate Plaid data.
    Also removes duplicates within the same source type.

    Args:
        account_id: Account ID to clean up
        db: Database service instance

    Returns:
        Dictionary with cleanup statistics
    """
    logger.info(f"Starting duplicate cleanup for account {account_id}")

    # First, remove statement-imported transactions that have matching Plaid transactions
    transactions = db.find("transactions", {"account_id": account_id})

    duplicates_removed = 0
    plaid_vs_statement_removed = 0
    statement_vs_statement_removed = 0

    # Group transactions by (date, type, total) to find duplicates
    # Normalize date to date-only to match datetime and date objects
    from collections import defaultdict
    groups = defaultdict(list)

    for txn in transactions:
        # Normalize date to date-only for grouping
        txn_date = txn.get('date')
        if isinstance(txn_date, datetime):
            date_key = txn_date.date()
        elif isinstance(txn_date, date):
            date_key = txn_date
        elif isinstance(txn_date, str):
            try:
                parsed = datetime.fromisoformat(txn_date.replace('Z', '+00:00'))
                date_key = parsed.date()
            except (ValueError, AttributeError):
                date_key = txn_date
        else:
            date_key = txn_date

        key = (
            date_key,
            txn.get('type'),
            txn.get('total')
        )
        groups[key].append(txn)

    # Process each group
    for key, txn_group in groups.items():
        if len(txn_group) <= 1:
            continue  # No duplicates

        # Separate Plaid and statement transactions
        # Any transaction without plaid_transaction_id is considered a statement import
        plaid_txns = [t for t in txn_group if t.get('plaid_transaction_id')]
        statement_txns = [t for t in txn_group if not t.get('plaid_transaction_id')]

        # If both Plaid and statement transactions exist, remove statement ones
        if plaid_txns and statement_txns:
            for stmt_txn in statement_txns:
                db.delete("transactions", stmt_txn['id'])
                duplicates_removed += 1
                plaid_vs_statement_removed += 1
                logger.debug(f"Removed duplicate statement transaction (has Plaid version): {stmt_txn['id']}")

        # If only statement transactions with duplicates, keep first one
        elif len(statement_txns) > 1:
            # Sort by import sequence or ID to keep the first one
            sorted_stmt = sorted(statement_txns, key=lambda t: (t.get('import_sequence') or 0, t.get('id')))
            for stmt_txn in sorted_stmt[1:]:
                db.delete("transactions", stmt_txn['id'])
                duplicates_removed += 1
                statement_vs_statement_removed += 1
                logger.debug(f"Removed duplicate statement transaction: {stmt_txn['id']}")

        # If only Plaid transactions with duplicates, keep first one
        elif len(plaid_txns) > 1:
            sorted_plaid = sorted(plaid_txns, key=lambda t: t.get('id'))
            for plaid_txn in sorted_plaid[1:]:
                db.delete("transactions", plaid_txn['id'])
                duplicates_removed += 1
                logger.debug(f"Removed duplicate Plaid transaction: {plaid_txn['id']}")

    logger.info(
        f"Duplicate cleanup complete for account {account_id}: "
        f"{duplicates_removed} total removed "
        f"({plaid_vs_statement_removed} Plaid vs statement, "
        f"{statement_vs_statement_removed} statement vs statement)"
    )

    return {
        "duplicates_removed": duplicates_removed,
        "plaid_vs_statement_removed": plaid_vs_statement_removed,
        "statement_vs_statement_removed": statement_vs_statement_removed
    }


def detect_statement_type(file_path: str) -> str:
    """
    Detect which bank/institution the statement is from.

    Returns: 'wealthsimple', 'tangerine', 'nbc', or 'ibkr'
    """
    file_ext = Path(file_path).suffix.lower()
    filename = Path(file_path).name.lower()

    # Check filename for hints
    if 'bnc' in filename or 'nbc' in filename or 'banque nationale' in filename:
        return 'nbc'
    elif 'tangerine' in filename:
        return 'tangerine'
    elif 'wealthsimple' in filename or 'wealth' in filename:
        return 'wealthsimple'

    # For QFX files, always use Tangerine parser
    if file_ext in ['.qfx', '.ofx']:
        return 'tangerine'

    # For CSV, try to detect by reading the first chunk
    if file_ext == '.csv':
        sample = ''
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                sample = f.read(4096).lower()
        except Exception:
            sample = ''

        first_line = sample.splitlines()[0] if sample else ''

        if 'interactive brokers' in sample or 'informe de actividad' in sample:
            return 'ibkr'
        if 'debit' in first_line and 'credit' in first_line and 'balance' in first_line and ';' in first_line:
            return 'nbc'
        if 'nom' in first_line and 'montant' in first_line:
            return 'tangerine'

        return 'wealthsimple'

    # Default to Wealthsimple for backwards compatibility
    return 'wealthsimple'

def process_statement_file(file_path: str, account_id: str, db, current_user: User, statement_id: str = None):
    file_ext = Path(file_path).suffix.lower()
    statement_type = detect_statement_type(file_path)

    # Choose appropriate parser
    if statement_type == 'nbc':
        parser = NBCParser(file_path)
        parsed_data = parser.parse()
    elif statement_type == 'tangerine':
        parser = TangerineParser(file_path)
        parsed_data = parser.parse()
    elif statement_type == 'ibkr':
        parser = InteractiveBrokersParser(file_path)
        parsed_data = parser.parse()
    else:
        # Wealthsimple parser
        parser = WealthsimpleParser()
        if file_ext == '.pdf':
            parsed_data = parser.parse_pdf(str(file_path))
        elif file_ext == '.csv':
            parsed_data = parser.parse_csv(str(file_path))
        elif file_ext in ['.xlsx', '.xls']:
            parsed_data = parser.parse_excel(str(file_path))
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported file format"
            )

    if not account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account ID is required"
        )

    transactions_created = 0
    transactions_skipped = 0
    skipped_transactions_details = []  # Track details of skipped transactions
    transaction_first_date = None
    transaction_last_date = None
    credit_volume = 0.0
    debit_volume = 0.0
    for idx, transaction_data in enumerate(parsed_data.get('transactions', []), 1):
        if transaction_data.get('type') is None:
            continue

        # Normalize transaction type to uppercase for database enum
        txn_type = transaction_data.get('type')
        if isinstance(txn_type, str):
            txn_type = txn_type.upper()

        # Enhanced duplicate detection:
        # 1. Check for Plaid-synced transactions (same account, date, amount)
        # 2. Check for duplicates from OTHER statements
        # This prevents importing transactions that already exist from Plaid sync
        # or from overlapping statement imports

        # Query for transactions with same account, type, and amount
        # We'll filter by date separately to handle time component differences
        duplicate_filter = {
            "account_id": account_id,
            "type": txn_type,
            "total": transaction_data.get('total')
        }
        # Add optional fields to the filter if they exist
        # Only use ticker and quantity for investment transactions where they're meaningful
        if transaction_data.get('ticker'):
            duplicate_filter["ticker"] = transaction_data.get('ticker')
        # Only use quantity as a filter if it's non-zero (investment transactions)
        # Bank transactions typically have quantity=0 or NULL, which shouldn't be used for matching
        if transaction_data.get('quantity') and transaction_data.get('quantity') != 0:
            duplicate_filter["quantity"] = transaction_data.get('quantity')

        # Get all potential duplicates (same account, type, amount)
        potential_duplicates = db.find("transactions", duplicate_filter)

        # DEBUG: Log the filter and results for first transaction
        if idx == 1:
            logger.info(f"[DUPLICATE DEBUG] Filter: {duplicate_filter}")
            logger.info(f"[DUPLICATE DEBUG] Found {len(potential_duplicates)} potential duplicates")
            for pd in potential_duplicates[:3]:
                logger.info(f"[DUPLICATE DEBUG]   - ID: {pd.get('id')}, date: {pd.get('date')}, plaid: {pd.get('plaid_transaction_id') is not None}, stmt: {pd.get('statement_id') is not None}")

        # Filter by date (comparing only the date part, ignoring time)
        # This ensures we match transactions regardless of time-of-day differences
        txn_date = transaction_data.get('date')
        if isinstance(txn_date, datetime):
            txn_date_only = txn_date.date()
        elif isinstance(txn_date, date):
            txn_date_only = txn_date
        else:
            txn_date_only = txn_date

        existing = []
        for txn in potential_duplicates:
            txn_db_date = _coerce_datetime(txn.get('date'))
            if txn_db_date:
                if isinstance(txn_db_date, datetime):
                    txn_db_date_only = txn_db_date.date()
                else:
                    txn_db_date_only = txn_db_date

                # Compare date parts only
                if txn_date_only == txn_db_date_only:
                    existing.append(txn)

        # Debug: Log what we found (only for first few transactions)
        if idx <= 5:
            logger.info(f"[DEBUG {idx}] Checking: date={txn_date_only} type={txn_type} total={transaction_data.get('total')} desc={transaction_data.get('description')[:30]}")
            logger.info(f"[DEBUG {idx}] Found {len(potential_duplicates)} potential duplicates (same account/type/amount)")
            logger.info(f"[DEBUG {idx}] Found {len(existing)} exact matches after date filtering")
            for e in existing[:3]:
                e_date = _coerce_datetime(e.get('date'))
                e_date_str = e_date.isoformat() if e_date else 'None'
                logger.info(f"[DEBUG {idx}]   - date: {e_date_str}, plaid_id: {e.get('plaid_transaction_id') is not None}, stmt_id: {e.get('statement_id') is not None}, desc: {e.get('description')[:30]}")

        existing_committed = [
            txn for txn in existing
            if txn.get('plaid_transaction_id') is not None or txn.get('statement_id') is not None
        ]

        if idx <= 5:
            logger.info(f"[DEBUG {idx}] After filtering: {len(existing_committed)} committed transactions")

        # Check if duplicate exists from:
        # 1. Plaid sync (has plaid_transaction_id)
        # 2. Different statement import (different statement_id)
        if existing_committed:
            # Skip if any transaction is from Plaid sync
            has_plaid_duplicate = any(
                txn.get('plaid_transaction_id') is not None for txn in existing_committed
            )

            if has_plaid_duplicate:
                transactions_skipped += 1
                # Track details of skipped transaction
                skipped_transactions_details.append({
                    "date": str(transaction_data.get('date')),
                    "description": transaction_data.get('description'),
                    "amount": transaction_data.get('total'),
                    "type": txn_type,
                    "reason": "Already imported from Plaid",
                    "plaid_transaction_id": existing_committed[0].get('plaid_transaction_id') if existing_committed else None
                })
                logger.debug(f"Skipping transaction - already synced from Plaid: {transaction_data.get('date')} {transaction_data.get('total')}")
                continue

            # Skip if transaction exists from a different statement
            if statement_id:
                is_duplicate_from_other_statement = any(
                    txn.get('statement_id') != statement_id for txn in existing
                )
                if is_duplicate_from_other_statement:
                    transactions_skipped += 1
                    logger.debug(f"Skipping transaction - already imported from another statement: {transaction_data.get('date')} {transaction_data.get('total')}")
                    continue
            elif not statement_id:
                # If no statement_id provided, skip duplicates (backwards compatibility)
                transactions_skipped += 1
                continue

        # Prepare transaction document with normalized type
        transaction_doc = {
            **transaction_data,
            "type": txn_type,  # Use normalized uppercase type
            "account_id": account_id,
            "source": "import",  # Mark as imported from statement
            "import_sequence": idx  # Preserve order from statement file
        }
        # Link transaction to statement if statement_id is provided
        if statement_id:
            transaction_doc["statement_id"] = statement_id
        db.insert("transactions", transaction_doc)
        transactions_created += 1

        txn_date = _coerce_datetime(transaction_data.get('date'))
        if txn_date:
            if transaction_first_date is None or txn_date < transaction_first_date:
                transaction_first_date = txn_date
            if transaction_last_date is None or txn_date > transaction_last_date:
                transaction_last_date = txn_date

        total_value = transaction_data.get('total')
        if isinstance(total_value, (int, float)):
            if total_value > 0:
                credit_volume += total_value
            elif total_value < 0:
                debit_volume += abs(total_value)

    dividends_created = 0
    dividends_skipped = 0
    for dividend_data in parsed_data.get('dividends', []):
        # Check for duplicate dividend (same account, ticker, date, amount)
        duplicate_filter = {
            "account_id": account_id,
            "ticker": dividend_data.get('ticker'),
            "date": dividend_data.get('date'),
            "amount": dividend_data.get('amount')
        }
        existing = db.find("dividends", duplicate_filter)
        if existing:
            # Duplicate found - skip this dividend
            dividends_skipped += 1
            continue

        dividend_doc = {
            **dividend_data,
            "account_id": account_id
        }
        # Link dividend to statement if statement_id is provided
        if statement_id:
            dividend_doc["statement_id"] = statement_id
        db.insert("dividends", dividend_doc)
        dividends_created += 1

    # Recalculate positions from imported transactions
    positions_created = recalculate_positions_from_transactions(account_id, db, statement_id)

    # NOTE: We do NOT automatically remove "duplicate" transactions during import
    # because CSV statements from banks (especially credit cards with multiple card numbers)
    # can legitimately have the same amount on the same day for different cards.
    # Users can manually run cleanup via the /accounts/{account_id}/cleanup-duplicates endpoint if needed.
    cleanup_result = {
        "duplicates_removed": 0,
        "plaid_vs_statement_removed": 0,
        "statement_vs_statement_removed": 0
    }

    # Balance validation: Calculate expected_balance for all transactions
    # This ensures running balances are coherent
    from app.services.balance_validator import validate_and_update_balances

    # Check if account is linked to Plaid to reconcile balance
    plaid_current_balance = None
    try:
        from app.database.models import PlaidAccount, PlaidItem
        from app.services.plaid_client import plaid_client
        from sqlalchemy.orm import Session

        # Get session from db object (assuming it has a session attribute)
        if hasattr(db, 'session'):
            session = db.session

            # Check if account is linked to Plaid
            plaid_account = session.query(PlaidAccount).filter(
                PlaidAccount.account_id == account_id
            ).first()

            if plaid_account:
                # Get the Plaid item
                plaid_item = session.query(PlaidItem).filter(
                    PlaidItem.id == plaid_account.plaid_item_id
                ).first()

                if plaid_item and plaid_item.access_token:
                    # Fetch current balance from Plaid
                    accounts_response = plaid_client.get_accounts(plaid_item.access_token)

                    # Fetch investment holdings to get cash balances
                    holdings_response = plaid_client.get_investment_holdings(plaid_item.access_token)
                    investment_cash_map = {}

                    if holdings_response:
                        # Use calculated cash balances (Total Account Value - Holdings Value)
                        investment_cash_map = holdings_response.get('cash_balances', {})

                    if accounts_response and accounts_response.get('accounts'):
                        for plaid_acc in accounts_response['accounts']:
                            if plaid_acc['account_id'] == plaid_account.plaid_account_id:
                                # Get balance from Plaid
                                # For investment accounts, use cash balance from holdings
                                # For other accounts, use current balance
                                account_obj = db.find_one("accounts", {"id": account_id})
                                balances = plaid_acc.get('balances', {})
                                acc_type = plaid_acc.get('type')
                                if acc_type and hasattr(acc_type, 'value'):
                                    acc_type = acc_type.value
                                elif acc_type:
                                    acc_type = str(acc_type)

                                if acc_type == 'investment':
                                    plaid_current_balance = investment_cash_map.get(plaid_account.plaid_account_id, 0.0)
                                    logger.info(
                                        f"Using cash from holdings for investment account {account_obj.get('label') if account_obj else 'Unknown'}: ${plaid_current_balance}"
                                    )
                                else:
                                    plaid_current_balance = balances.get('current')

                                # For credit cards and loans, Plaid returns positive balance = amount owed
                                # We need to negate it so owing money = negative balance in our system
                                liability_account_types = ['credit_card', 'mortgage', 'auto_loan', 'student_loan',
                                                          'home_equity', 'personal_loan', 'business_loan', 'line_of_credit']
                                if account_obj and account_obj.get('account_type') in liability_account_types:
                                    plaid_current_balance = -plaid_current_balance
                                    logger.info(
                                        f"Negated liability account balance for {account_obj.get('label')} ({account_obj.get('account_type')}): ${plaid_current_balance}"
                                    )

                                logger.info(
                                    f"Account {account_id} is Plaid-linked. "
                                    f"Current balance from Plaid: ${plaid_current_balance}"
                                )

                                # Update account balance to match Plaid
                                if plaid_current_balance is not None:
                                    db.update("accounts", {"id": account_id}, {
                                        "balance": plaid_current_balance
                                    })
                                    logger.info(
                                        f"Updated account {account_id} balance to match Plaid: ${plaid_current_balance}"
                                    )
                                break
    except Exception as e:
        logger.warning(f"Could not fetch Plaid balance for reconciliation: {e}")

    # Validate and update balances with Plaid's current balance if available
    validation_result = validate_and_update_balances(
        db=db,
        account_id=account_id,
        source_current_balance=plaid_current_balance,
        source_name="statement_import"
    )

    logger.info(f"Balance validation for statement import: {validation_result}")

    # Note: Skipped transactions are returned in the result dict below
    # (not stored in database as the schema doesn't have these fields)

    return {
        "account_id": account_id,
        "positions_created": positions_created,
        "transactions_created": transactions_created,
        "transactions_skipped": transactions_skipped,
        "skipped_transactions": skipped_transactions_details,  # List of skipped transaction details
        "duplicates_removed": cleanup_result['duplicates_removed'],
        "plaid_vs_statement_removed": cleanup_result['plaid_vs_statement_removed'],
        "statement_vs_statement_removed": cleanup_result['statement_vs_statement_removed'],
        "dividends_created": dividends_created,
        "dividends_skipped": dividends_skipped,
        "transaction_first_date": transaction_first_date.isoformat() if transaction_first_date else None,
        "transaction_last_date": transaction_last_date.isoformat() if transaction_last_date else None,
        "credit_volume": round(credit_volume, 2),
        "debit_volume": round(debit_volume, 2),
        "balance_validation": validation_result
    }

@router.post("/statement")
async def import_statement(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    # Security: Validate file extension
    if not allowed_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Security: Validate content type by checking file content
    if not await validate_file_content_type(file):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content type validation failed. File may be corrupted or have incorrect extension."
        )

    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )

    logger.info(f"Starting file upload (filename will be sanitized)")

    upload_dir = Path(settings.UPLOAD_PATH)
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Security: Sanitize filename to prevent path traversal
    try:
        sanitized_name = sanitize_filename(file.filename)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid filename: {str(e)}"
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{current_user.id}_{timestamp}_{sanitized_name}"
    file_path = upload_dir / safe_filename

    # Security: Verify the final path is within the upload directory
    if not file_path.resolve().is_relative_to(upload_dir.resolve()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file path detected"
        )

    # Security: Read file content and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / 1024 / 1024}MB"
        )

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is empty"
        )

    logger.info(f"File content length: {len(content)} bytes")

    async with aiofiles.open(file_path, 'wb') as out_file:
        await out_file.write(content)

    logger.info(f"File written to: {file_path}")

    statement_doc = {
        "filename": file.filename,
        "file_path": str(file_path),
        "file_type": Path(file.filename).suffix.lower(),
        "account_id": account_id,
        "upload_date": datetime.now(),
        "transactions_count": 0
    }
    statement = db.insert("statements", statement_doc)
    session.commit()

    # Automatically enqueue processing job
    job = enqueue_statement_job(
        user_id=current_user.id,
        statement_id=statement['id'],
        action="process",
    )

    logger.info(f"Statement {statement['id']} uploaded and queued for processing with job {job.id}")

    return {
        "message": "Statement uploaded successfully. Processing started.",
        "statement_id": statement['id'],
        "job_id": job.id,
        "statement": statement
    }

@router.post("/statements/{statement_id}/process")
async def process_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    statement = _verify_statement_ownership(db, statement_id, current_user.id)

    if not os.path.exists(statement['file_path']):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement file not found on disk"
        )

    job = enqueue_statement_job(
        user_id=current_user.id,
        statement_id=statement_id,
        action="process",
    )

    return {
        "message": "Statement is being processed",
        "statement_id": statement_id,
        "job_id": job.id
    }

@router.get("/statements", response_model=List[Statement])
async def list_statements(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    # Get user's accounts first, then get statements for those accounts
    accounts = db.find("accounts", {"user_id": current_user.id})
    account_ids = [acc["id"] for acc in accounts]
    account_lookup = {acc["id"]: acc for acc in accounts}

    # Get all statements for user's accounts
    statements = []
    for account_id in account_ids:
        statements.extend(db.find("statements", {"account_id": account_id}))

    for statement in statements:
        account = account_lookup.get(statement.get("account_id"))
        if account:
            statement["account_label"] = account.get("label") or account.get("account_number")
            statement["account_institution"] = account.get("institution")
            statement["user_id"] = account.get("user_id")
        else:
            statement["account_label"] = None
            statement["account_institution"] = None
            statement["user_id"] = current_user.id

        # Map database fields to frontend expected fields
        statement["uploaded_at"] = statement.get("upload_date")
        statement["transaction_first_date"] = statement.get("start_date")
        statement["transaction_last_date"] = statement.get("end_date")

        # Add frontend compatibility fields with defaults
        statement["status"] = "completed"
        statement["processed_at"] = statement.get("upload_date")  # Use upload_date as processed_at
        statement["positions_count"] = 0
        statement["dividends_count"] = 0
        statement["credit_volume"] = 0.0
        statement["debit_volume"] = 0.0
        statement["error_message"] = None

        # Compute file_size from actual file on disk
        file_path = statement.get("file_path")
        if file_path and os.path.exists(file_path):
            statement["file_size"] = os.path.getsize(file_path)
        else:
            statement["file_size"] = 0

    return statements

@router.post("/statements/{statement_id}/reprocess")
async def reprocess_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    statement = _verify_statement_ownership(db, statement_id, current_user.id)

    if not os.path.exists(statement['file_path']):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement file not found on disk"
        )

    job = enqueue_statement_job(
        user_id=current_user.id,
        statement_id=statement_id,
        action="reprocess",
    )

    return {
        "message": "Statement is being reprocessed",
        "statement_id": statement_id,
        "job_id": job.id
    }

@router.post("/statements/reprocess-all")
async def reprocess_all_statements(
    payload: Optional[ReprocessAllRequest] = Body(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)

    # Get user's accounts first
    accounts = db.find("accounts", {"user_id": current_user.id})
    account_ids = [acc["id"] for acc in accounts]

    # Get all statements for user's accounts
    statements = []
    for account_id in account_ids:
        statements.extend(db.find("statements", {"account_id": account_id}))

    if not statements:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No statements found"
        )

    account_scope = payload.account_id if payload else None
    if account_scope:
        statements = [stmt for stmt in statements if stmt.get("account_id") == account_scope]
        if not statements:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No statements found for selected account"
            )

    job = enqueue_statement_job(
        user_id=current_user.id,
        statement_id=None,
        action="reprocess_all",
        account_scope=account_scope,
    )

    return {
        "message": f"Queued reprocess for {len(statements)} statement(s)",
        "job_id": job.id,
        "count": len(statements)
    }

@router.delete("/statements/{statement_id}")
async def delete_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    statement = _verify_statement_ownership(db, statement_id, current_user.id)
    account_id = statement.get('account_id')

    # Delete the physical file
    if os.path.exists(statement['file_path']):
        os.remove(statement['file_path'])

    # Delete the statement record
    # The CASCADE delete in the database will automatically remove:
    # - All transactions linked to this statement
    # - All dividends linked to this statement
    # - All positions linked to this statement
    # - All expenses linked to this statement
    db.delete("statements", statement_id)
    session.commit()

    # Recalculate positions from remaining transactions for this account
    if account_id:
        recalculate_positions_from_transactions(account_id, db)
        session.commit()

    return {"message": "Statement and associated data deleted successfully"}


@router.get("/jobs/{job_id}")
async def get_statement_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    try:
        info = get_job_info(job_id)
    except NoSuchJobError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )

    job_meta = info.get("meta") or {}
    if job_meta.get("user_id") != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )

    return info

@router.post("/accounts/{account_id}/cleanup-duplicates")
async def cleanup_duplicate_transactions(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Remove duplicate transactions for an account.
    Keeps Plaid-synced transactions, removes statement imports that duplicate Plaid data.
    Also reconciles balance with Plaid after cleanup.
    """
    db = get_db_service(session)

    # Verify account belongs to user
    account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Remove duplicates
    cleanup_result = remove_duplicate_transactions(account_id, db)
    session.commit()

    # Recalculate positions after cleanup
    positions_created = recalculate_positions_from_transactions(account_id, db)
    session.commit()

    # Reconcile balance with Plaid
    plaid_current_balance = None
    try:
        from app.database.models import PlaidAccount, PlaidItem
        from app.services.plaid_client import plaid_client

        plaid_account = session.query(PlaidAccount).filter(
            PlaidAccount.account_id == account_id
        ).first()

        if plaid_account:
            plaid_item = session.query(PlaidItem).filter(
                PlaidItem.id == plaid_account.plaid_item_id
            ).first()

            if plaid_item and plaid_item.access_token:
                accounts_response = plaid_client.get_accounts(plaid_item.access_token)

                # Fetch investment holdings to get cash balances
                holdings_response = plaid_client.get_investment_holdings(plaid_item.access_token)
                investment_cash_map = {}

                if holdings_response:
                    # Use calculated cash balances (Total Account Value - Holdings Value)
                    investment_cash_map = holdings_response.get('cash_balances', {})

                if accounts_response and accounts_response.get('accounts'):
                    for plaid_acc in accounts_response['accounts']:
                        if plaid_acc['account_id'] == plaid_account.plaid_account_id:
                            balances = plaid_acc.get('balances', {})
                            acc_type = plaid_acc.get('type')
                            if acc_type and hasattr(acc_type, 'value'):
                                acc_type = acc_type.value
                            elif acc_type:
                                acc_type = str(acc_type)

                            # For investment accounts, use cash balance from holdings
                            # For other accounts, use current balance
                            if acc_type == 'investment':
                                plaid_current_balance = investment_cash_map.get(plaid_account.plaid_account_id, 0.0)
                                logger.info(
                                    f"Using cash from holdings for investment account {account.get('label') if account else 'Unknown'}: ${plaid_current_balance}"
                                )
                            else:
                                plaid_current_balance = balances.get('current')

                            # For credit cards and loans, Plaid returns positive balance = amount owed
                            # We need to negate it so owing money = negative balance in our system
                            liability_account_types = ['credit_card', 'mortgage', 'auto_loan', 'student_loan',
                                                      'home_equity', 'personal_loan', 'business_loan', 'line_of_credit']
                            if account.get('account_type') in liability_account_types:
                                plaid_current_balance = -plaid_current_balance
                                logger.info(
                                    f"Negated liability account balance for {account.get('label')} ({account.get('account_type')}): ${plaid_current_balance}"
                                )

                            if plaid_current_balance is not None:
                                db.update("accounts", {"id": account_id}, {
                                    "balance": plaid_current_balance
                                })
                                session.commit()
                                logger.info(
                                    f"Updated account {account_id} balance to match Plaid: ${plaid_current_balance}"
                                )
                            break
    except Exception as e:
        logger.warning(f"Could not fetch Plaid balance for reconciliation: {e}")

    # Validate balances
    from app.services.balance_validator import validate_and_update_balances
    validation_result = validate_and_update_balances(
        db=db,
        account_id=account_id,
        source_current_balance=plaid_current_balance,
        source_name="cleanup"
    )
    session.commit()

    return {
        "message": "Duplicate cleanup completed",
        "cleanup": cleanup_result,
        "positions_recalculated": positions_created,
        "plaid_balance": plaid_current_balance,
        "validation": validation_result
    }


@router.put("/statements/{statement_id}/account")
async def change_statement_account(
    statement_id: str,
    payload: StatementAccountChangeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    db = get_db_service(session)
    statement = _verify_statement_ownership(db, statement_id, current_user.id)

    new_account = db.find_one("accounts", {"id": payload.account_id, "user_id": current_user.id})
    if not new_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    if statement.get("account_id") == payload.account_id:
        return {"message": "Statement already assigned to this account"}

    # Remove existing data tied to this statement
    # Delete by statement_id to ensure only this statement's data is removed
    db.delete_many("transactions", {"statement_id": statement_id})
    db.delete_many("dividends", {"statement_id": statement_id})
    # Note: Positions are NOT deleted per-statement

    # Recalculate positions for the old account if it exists
    old_account_id = statement.get("account_id")
    if old_account_id:
        recalculate_positions_from_transactions(old_account_id, db)

    db.update("statements", statement_id, {
        "account_id": payload.account_id,
        "transactions_count": 0
    })
    session.commit()

    job = enqueue_statement_job(
        user_id=current_user.id,
        statement_id=statement_id,
        action="reprocess",
        target_account_id=payload.account_id
    )

    return {
        "message": "Account updated. Statement is being reprocessed.",
        "job_id": job.id,
        "statement_id": statement_id
    }
