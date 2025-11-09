from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Body
from typing import List, Optional, Dict
import os
import aiofiles
from pathlib import Path
import logging
from datetime import datetime
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

ALLOWED_EXTENSIONS = {'.pdf', '.csv', '.xlsx', '.xls', '.qfx', '.ofx'}


class StatementAccountChangeRequest(BaseModel):
    account_id: str


class ReprocessAllRequest(BaseModel):
    account_id: Optional[str] = None


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _coerce_datetime(value):
    if isinstance(value, datetime):
        return value
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
    # Filter out transactions with None dates and sort
    transactions = [t for t in transactions if t.get('date') is not None]
    transactions = sorted(transactions, key=lambda x: x.get('date', ''))

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
    transaction_first_date = None
    transaction_last_date = None
    credit_volume = 0.0
    debit_volume = 0.0
    for transaction_data in parsed_data.get('transactions', []):
        if transaction_data.get('type') is None:
            continue

        # Check for duplicate transaction (same account, date, type, ticker, quantity, total)
        # This prevents importing the same transaction multiple times from overlapping statements
        duplicate_filter = {
            "account_id": account_id,
            "date": transaction_data.get('date'),
            "type": transaction_data.get('type'),
            "total": transaction_data.get('total')
        }
        # Add optional fields to the filter if they exist
        if transaction_data.get('ticker'):
            duplicate_filter["ticker"] = transaction_data.get('ticker')
        if transaction_data.get('quantity') is not None:
            duplicate_filter["quantity"] = transaction_data.get('quantity')

        existing = db.find("transactions", duplicate_filter)
        if existing:
            # Duplicate found - skip this transaction
            transactions_skipped += 1
            continue

        transaction_doc = {
            **transaction_data,
            "account_id": account_id
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

    positions_created = recalculate_positions_from_transactions(account_id, db, statement_id)

    return {
        "account_id": account_id,
        "positions_created": positions_created,
        "transactions_created": transactions_created,
        "transactions_skipped": transactions_skipped,
        "dividends_created": dividends_created,
        "dividends_skipped": dividends_skipped,
        "transaction_first_date": transaction_first_date.isoformat() if transaction_first_date else None,
        "transaction_last_date": transaction_last_date.isoformat() if transaction_last_date else None,
        "credit_volume": round(credit_volume, 2),
        "debit_volume": round(debit_volume, 2)
    }

@router.post("/statement")
async def import_statement(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    if not allowed_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    db = get_db_service(session)

    if account_id:
        account = db.find_one("accounts", {"id": account_id, "user_id": current_user.id})
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found"
            )

    logger.info(f"Starting file upload for: {file.filename}")

    upload_dir = Path(settings.UPLOAD_PATH)
    upload_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{current_user.id}_{timestamp}_{file.filename}"
    file_path = upload_dir / safe_filename

    content = await file.read()
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
        "message": "Statement uploaded and queued for processing",
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
        "message": "Statement queued for processing",
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
        "message": "Statement queued for reprocessing",
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
        "message": "Account updated. Statement queued for reprocessing.",
        "job_id": job.id,
        "statement_id": statement_id
    }
