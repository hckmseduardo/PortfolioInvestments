from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from typing import List, Optional
import os
import aiofiles
from pathlib import Path
import logging
from datetime import datetime
from app.models.schemas import User, Statement
from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.parsers.wealthsimple_parser import WealthsimpleParser
from app.config import settings

router = APIRouter(prefix="/import", tags=["import"])
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {'.pdf', '.csv', '.xlsx', '.xls'}

def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS

def process_statement_file(file_path: str, account_id: str, db, current_user: User):
    parser = WealthsimpleParser()
    file_ext = Path(file_path).suffix.lower()

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

    positions_created = 0
    for position_data in parsed_data.get('positions', []):
        position_doc = {
            **position_data,
            "account_id": account_id,
            "last_updated": datetime.now().isoformat()
        }
        db.insert("positions", position_doc)
        positions_created += 1

    transactions_created = 0
    for transaction_data in parsed_data.get('transactions', []):
        if transaction_data.get('type') is None:
            continue
        transaction_doc = {
            **transaction_data,
            "account_id": account_id
        }
        db.insert("transactions", transaction_doc)
        transactions_created += 1

    dividends_created = 0
    for dividend_data in parsed_data.get('dividends', []):
        dividend_doc = {
            **dividend_data,
            "account_id": account_id
        }
        db.insert("dividends", dividend_doc)
        dividends_created += 1

    return {
        "account_id": account_id,
        "positions_created": positions_created,
        "transactions_created": transactions_created,
        "dividends_created": dividends_created
    }

@router.post("/statement")
async def import_statement(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    current_user: User = Depends(get_current_user)
):
    if not allowed_file(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    db = get_db()

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
        "file_size": os.path.getsize(file_path),
        "file_type": Path(file.filename).suffix.lower(),
        "status": "pending",
        "user_id": current_user.id,
        "account_id": account_id,
        "uploaded_at": datetime.now().isoformat(),
        "positions_count": 0,
        "transactions_count": 0,
        "dividends_count": 0
    }
    statement = db.insert("statements", statement_doc)

    return {
        "message": "Statement uploaded successfully",
        "statement_id": statement['id'],
        "statement": statement
    }

@router.post("/statements/{statement_id}/process")
async def process_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    statement = db.find_one("statements", {"id": statement_id, "user_id": current_user.id})

    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement not found"
        )

    if not os.path.exists(statement['file_path']):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement file not found on disk"
        )

    db.update("statements", statement_id, {
        "status": "processing",
        "processed_at": None
    })

    try:
        result = process_statement_file(
            statement['file_path'],
            statement.get('account_id'),
            db,
            current_user
        )

        db.update("statements", statement_id, {
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "account_id": result["account_id"],
            "positions_count": result["positions_created"],
            "transactions_count": result["transactions_created"],
            "dividends_count": result["dividends_created"]
        })

        return {
            "message": "Statement processed successfully",
            "statement_id": statement_id,
            **result
        }

    except Exception as e:
        logger.error(f"Error processing file: {str(e)}", exc_info=True)
        db.update("statements", statement_id, {
            "status": "failed",
            "processed_at": datetime.now().isoformat(),
            "error_message": str(e)
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing file: {str(e)}"
        )

@router.get("/statements", response_model=List[Statement])
async def list_statements(current_user: User = Depends(get_current_user)):
    db = get_db()
    statements = db.find("statements", {"user_id": current_user.id})
    return statements

@router.post("/statements/{statement_id}/reprocess")
async def reprocess_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    statement = db.find_one("statements", {"id": statement_id, "user_id": current_user.id})

    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement not found"
        )

    if not os.path.exists(statement['file_path']):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement file not found on disk"
        )

    db.update("statements", statement_id, {
        "status": "processing",
        "processed_at": None,
        "error_message": None
    })

    try:
        if statement.get('account_id'):
            db.delete_many("positions", {"account_id": statement['account_id']})
            db.delete_many("transactions", {"account_id": statement['account_id']})
            db.delete_many("dividends", {"account_id": statement['account_id']})

        result = process_statement_file(
            statement['file_path'],
            statement.get('account_id'),
            db,
            current_user
        )

        db.update("statements", statement_id, {
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "account_id": result["account_id"],
            "positions_count": result["positions_created"],
            "transactions_count": result["transactions_created"],
            "dividends_count": result["dividends_created"],
            "error_message": None
        })

        return {
            "message": "Statement reprocessed successfully",
            "statement_id": statement_id,
            **result
        }

    except Exception as e:
        logger.error(f"Error reprocessing file: {str(e)}", exc_info=True)
        db.update("statements", statement_id, {
            "status": "failed",
            "processed_at": datetime.now().isoformat(),
            "error_message": str(e)
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error reprocessing file: {str(e)}"
        )

@router.delete("/statements/{statement_id}")
async def delete_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    statement = db.find_one("statements", {"id": statement_id, "user_id": current_user.id})

    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statement not found"
        )

    if statement.get('account_id'):
        db.delete_many("transactions", {"account_id": statement['account_id']})
        db.delete_many("dividends", {"account_id": statement['account_id']})
        db.delete_many("positions", {"account_id": statement['account_id']})

    if os.path.exists(statement['file_path']):
        os.remove(statement['file_path'])

    db.delete("statements", statement_id)

    return {"message": "Statement and associated data deleted successfully"}
