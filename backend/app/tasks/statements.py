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
    # Get statement and verify ownership through account
    statement = db.find_one("statements", {"id": statement_id})
    if not statement:
        raise ValueError("Statement not found")

    # Verify user owns the account
    account = db.find_one("accounts", {"id": statement["account_id"], "user_id": user.id})
    if not account:
        raise ValueError("Statement not found")

    if not statement.get("file_path"):
        raise ValueError("Statement file path missing")

    account_id = new_account_id or statement.get("account_id")
    if not account_id:
        raise ValueError("Account is required to process statement")

    file_path = statement["file_path"]

    # Update statement record if account changed
    if account_id != statement.get("account_id"):
        db.update("statements", {"id": statement_id}, {
            "account_id": account_id,
        })
        session.commit()

    old_account_id = statement.get("account_id")
    if reprocess or (new_account_id and new_account_id != old_account_id):
        # Delete existing data for this statement using statement_id
        # This ensures only data from this specific statement is removed
        if statement_id:
            db.delete_many("transactions", {"statement_id": statement_id})
            db.delete_many("dividends", {"statement_id": statement_id})
            # Note: Positions are NOT deleted per-statement, they're recalculated from all transactions
            session.commit()

            # If account changed, recalculate positions for the old account
            if new_account_id and new_account_id != old_account_id and old_account_id:
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

        # Update only fields that exist in Statement model
        db.update("statements", {"id": statement_id}, {
            "transactions_count": result["transactions_created"],
            "start_date": metrics.get("transaction_first_date"),
            "end_date": metrics.get("transaction_last_date"),
        })
        session.commit()

        return {
            "statement_id": statement_id,
            "result": result
        }

    except Exception as exc:
        logger.error("Statement job failed for %s: %s", statement_id, exc, exc_info=True)
        # Note: Statement model doesn't store status/error fields anymore
        # Errors are tracked by the job queue system
        session.rollback()
        raise


def _reprocess_all_statements(db, session, user, account_scope: Optional[str]):
    """
    Reprocess all statements for a user or specific account with progress tracking.
    """
    from rq import get_current_job

    job = get_current_job()
    start_time = datetime.now()

    logger.info(f"=== Statement Reprocessing Started at {start_time.isoformat()} ===")

    # Get user's accounts first
    accounts = db.find("accounts", {"user_id": user.id})
    account_ids = [acc["id"] for acc in accounts]

    if account_scope:
        if account_scope not in account_ids:
            raise ValueError("Account not found")
        account_ids = [account_scope]

    # Get statements for user's accounts
    statements = []
    account_map = {acc["id"]: acc.get("label", acc["id"]) for acc in accounts}

    for account_id in account_ids:
        statements.extend(db.find("statements", {"account_id": account_id}))

    if not statements:
        raise ValueError("No statements found to reprocess")

    # Sort statements chronologically
    sorted_statements = sorted(statements, key=lambda x: x.get("uploaded_at", ""))

    # Build file list with status
    file_list = []
    for stmt in sorted_statements:
        file_list.append({
            "id": stmt["id"],
            "filename": stmt.get("filename", "Unknown"),
            "account": account_map.get(stmt.get("account_id"), "Unknown"),
            "status": "pending"
        })

    # Initialize job meta with file list
    if job:
        job.meta = job.meta or {}
        job.meta["stage"] = "clearing_data"
        job.meta["total_files"] = len(file_list)
        job.meta["files"] = file_list
        job.meta["current_file"] = None
        job.meta["progress"] = {
            "current": 0,
            "total": len(file_list),
            "successful": 0,
            "failed": 0
        }
        job.save_meta()

    logger.info(f"Found {len(sorted_statements)} statements to reprocess")
    for stmt in sorted_statements:
        logger.info(f"  - {stmt.get('filename')} ({account_map.get(stmt.get('account_id'))})")

    # Clear all prior data for the affected accounts
    account_ids = {stmt.get("account_id") for stmt in statements if stmt.get("account_id")}
    if account_scope:
        account_ids = {account_scope}

    logger.info(f"Clearing existing data for {len(account_ids)} account(s)...")
    for account_id in account_ids:
        if not account_id:
            continue
        db.delete_many("transactions", {"account_id": account_id})
        db.delete_many("dividends", {"account_id": account_id})
        db.delete_many("positions", {"account_id": account_id})
    session.commit()
    logger.info("Data cleared successfully")

    successful = 0
    failed = 0
    failed_files = []

    # Process each statement with progress updates
    for idx, statement in enumerate(sorted_statements, 1):
        filename = statement.get("filename", "Unknown")
        account_name = account_map.get(statement.get("account_id"), "Unknown")

        # Update job meta with current file
        if job:
            job.meta["stage"] = "processing"
            job.meta["current_file"] = {
                "index": idx,
                "filename": filename,
                "account": account_name
            }
            job.meta["progress"] = {
                "current": idx - 1,
                "total": len(sorted_statements),
                "successful": successful,
                "failed": failed
            }
            # Update file status to processing
            for f in job.meta["files"]:
                if f["id"] == statement["id"]:
                    f["status"] = "processing"
                    break
            job.save_meta()

        logger.info(f"[{idx}/{len(sorted_statements)}] Processing: {filename} ({account_name})")

        try:
            result = _process_statement(
                db=db,
                session=session,
                user=user,
                statement_id=statement["id"],
                reprocess=True,
                new_account_id=None,
            )
            successful += 1

            # Update file status to completed
            if job:
                for f in job.meta["files"]:
                    if f["id"] == statement["id"]:
                        f["status"] = "completed"
                        f["transactions_created"] = result.get("result", {}).get("transactions_created", 0)
                        break
                job.save_meta()

            logger.info(f"[{idx}/{len(sorted_statements)}] ✓ Success: {filename}")

        except Exception as e:
            failed += 1
            failed_files.append({"filename": filename, "error": str(e)})

            # Update file status to failed
            if job:
                for f in job.meta["files"]:
                    if f["id"] == statement["id"]:
                        f["status"] = "failed"
                        f["error"] = str(e)
                        break
                job.save_meta()

            logger.error(f"[{idx}/{len(sorted_statements)}] ✗ Failed: {filename} - {str(e)}")

    # Final update
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    if job:
        job.meta["stage"] = "completed"
        job.meta["current_file"] = None
        job.meta["progress"] = {
            "current": len(sorted_statements),
            "total": len(sorted_statements),
            "successful": successful,
            "failed": failed
        }
        job.meta["duration_seconds"] = duration
        job.save_meta()

    logger.info(f"=== Statement Reprocessing Completed at {end_time.isoformat()} ===")
    logger.info(f"Duration: {duration:.2f} seconds")
    logger.info(f"Results: {successful} successful, {failed} failed out of {len(sorted_statements)} total")

    if failed_files:
        logger.warning("Failed files:")
        for failed_file in failed_files:
            logger.warning(f"  - {failed_file['filename']}: {failed_file['error']}")

    return {
        "total": len(sorted_statements),
        "successful": successful,
        "failed": failed,
        "account_scope": account_scope,
        "duration_seconds": duration,
        "failed_files": failed_files
    }
