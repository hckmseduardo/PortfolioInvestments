import logging
from datetime import datetime
from types import SimpleNamespace
from typing import Optional

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service
from app.api.import_statements import (
    process_statement_file,
    recalculate_positions_from_transactions,
    compute_statement_metrics,
)

logger = logging.getLogger(__name__)


def run_statement_job(
    action: str,
    user_id: str,
    statement_id: Optional[str] = None,
    target_account_id: Optional[str] = None,
    account_scope: Optional[str] = None,
):
    """
    Background entry point for statement processing jobs.
    """
    with get_db_context() as session:
        db = get_db_service(session)
        user = SimpleNamespace(id=user_id)

        if action == "process":
            if not statement_id:
                raise ValueError("statement_id is required for process action")
            return _process_statement(db, session, user, statement_id, reprocess=False, new_account_id=target_account_id)

        if action == "reprocess":
            if not statement_id:
                raise ValueError("statement_id is required for reprocess action")
            return _process_statement(db, session, user, statement_id, reprocess=True, new_account_id=target_account_id)

        if action == "reprocess_all":
            return _reprocess_all_statements(db, session, user, account_scope)

        raise ValueError(f"Unknown statement job action: {action}")


def _process_statement(db, session, user, statement_id: str, reprocess: bool, new_account_id: Optional[str]):
    statement = db.find_one("statements", {"id": statement_id, "user_id": user.id})
    if not statement:
        raise ValueError("Statement not found")

    if not statement.get("file_path"):
        raise ValueError("Statement file path missing")

    account_id = new_account_id or statement.get("account_id")
    if not account_id:
        raise ValueError("Account is required to process statement")

    file_path = statement["file_path"]

    # Update statement record to reflect pending processing
    db.update("statements", statement_id, {
        "status": "processing",
        "processed_at": None,
        "error_message": None,
        "account_id": account_id,
    })
    session.commit()

    old_account_id = statement.get("account_id")
    if reprocess or (new_account_id and new_account_id != old_account_id):
        # Remove previously imported records tied to this statement
        db.delete_many("transactions", {"statement_id": statement_id})
        db.delete_many("dividends", {"statement_id": statement_id})
        session.commit()
        if old_account_id:
            recalculate_positions_from_transactions(old_account_id, db)
            session.commit()

    try:
        result = process_statement_file(
            file_path,
            account_id,
            db,
            user,
            statement_id
        )

        metrics = compute_statement_metrics(statement_id, db) if statement_id else {
            "transaction_first_date": result.get("transaction_first_date"),
            "transaction_last_date": result.get("transaction_last_date"),
            "credit_volume": result.get("credit_volume", 0),
            "debit_volume": result.get("debit_volume", 0),
        }

        db.update("statements", statement_id, {
            "status": "completed",
            "processed_at": datetime.now().isoformat(),
            "account_id": result["account_id"],
            "positions_count": result["positions_created"],
            "transactions_count": result["transactions_created"],
            "dividends_count": result["dividends_created"],
            "transaction_first_date": metrics.get("transaction_first_date"),
            "transaction_last_date": metrics.get("transaction_last_date"),
            "credit_volume": metrics.get("credit_volume", 0),
            "debit_volume": metrics.get("debit_volume", 0),
            "error_message": None
        })
        session.commit()

        return {
            "statement_id": statement_id,
            "result": result
        }

    except Exception as exc:
        logger.error("Statement job failed for %s: %s", statement_id, exc, exc_info=True)
        db.update("statements", statement_id, {
            "status": "failed",
            "processed_at": datetime.now().isoformat(),
            "error_message": str(exc)
        })
        session.commit()
        raise


def _reprocess_all_statements(db, session, user, account_scope: Optional[str]):
    statements = db.find("statements", {"user_id": user.id})
    if account_scope:
        statements = [stmt for stmt in statements if stmt.get("account_id") == account_scope]

    if not statements:
        raise ValueError("No statements found to reprocess")

    account_ids = {stmt.get("account_id") for stmt in statements if stmt.get("account_id")}
    if account_scope:
        account_ids = {account_scope}

    # Clear all prior data for the affected accounts
    for account_id in account_ids:
        if not account_id:
            continue
        db.delete_many("transactions", {"account_id": account_id})
        db.delete_many("dividends", {"account_id": account_id})
        db.delete_many("positions", {"account_id": account_id})
    session.commit()

    successful = 0
    failed = 0

    for statement in sorted(statements, key=lambda x: x.get("uploaded_at", "")):
        try:
            _process_statement(
                db=db,
                session=session,
                user=user,
                statement_id=statement["id"],
                reprocess=True,
                new_account_id=None,
            )
            successful += 1
        except Exception:
            failed += 1

    return {
        "total": len(statements),
        "successful": successful,
        "failed": failed,
        "account_scope": account_scope,
    }
