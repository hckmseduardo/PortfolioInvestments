"""
Balance Validation Service

Provides balance validation logic for transactions imported from any source
(Plaid, statement imports, etc.)
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


def validate_and_update_balances(
    db,
    account_id: str,
    source_current_balance: Optional[float] = None,
    source_name: str = "import"
) -> Dict[str, Any]:
    """
    Validate transaction balances and update opening balance for an account.

    This function:
    1. Calculates expected_balance for each transaction chronologically
    2. Stores expected_balance in each transaction record
    3. Compares final calculated balance with source current balance (if provided)
    4. Flags inconsistencies if discrepancy > $1.00
    5. Updates account opening balance based on source balance - transaction sum

    Args:
        db: Database service
        account_id: Account ID to validate
        source_current_balance: Current balance from source (Plaid, statement, etc.)
                                If None, validation is skipped but expected_balance is still calculated
        source_name: Name of the import source for logging

    Returns:
        Dictionary with validation results
    """
    from app.database.models import Transaction, Account

    TOLERANCE = 1.00  # $1.00 tolerance for balance inconsistencies

    # Get account
    account = db.find_one("accounts", {"id": account_id})
    if not account:
        logger.warning(f"Account {account_id} not found for balance validation")
        return {"status": "error", "message": "Account not found"}

    # Get all transactions for this account, ordered chronologically
    # Order by date, then by transaction value for clearer balance progression
    transactions = db.find("transactions", {"account_id": account_id})
    if not transactions:
        logger.info(f"Account {account.get('label')} has no transactions, skipping validation")
        return {"status": "skipped", "message": "No transactions"}

    # Sort transactions chronologically
    sorted_transactions = sorted(
        transactions,
        key=lambda t: (
            t.get('date', ''),
            t.get('total', 0.0),
            t.get('id', '')
        )
    )

    # Get opening balance
    opening_balance = account.get('opening_balance') or 0.0

    # Calculate expected balance for each transaction
    running_balance = opening_balance
    for txn in sorted_transactions:
        running_balance += txn.get('total', 0.0)

        # Update transaction with expected balance
        db.update("transactions", {"id": txn['id']}, {
            "expected_balance": round(running_balance, 2),
            "has_balance_inconsistency": False,  # Reset flag, will update if needed
            "balance_discrepancy": None
        })

    # Validate against source current balance if provided
    final_expected_balance = running_balance
    validation_result = {
        "status": "success",
        "opening_balance": opening_balance,
        "final_expected_balance": round(final_expected_balance, 2),
        "transaction_count": len(sorted_transactions),
        "oldest_date": sorted_transactions[0].get('date'),
        "newest_date": sorted_transactions[-1].get('date')
    }

    if source_current_balance is not None:
        discrepancy = abs(final_expected_balance - source_current_balance)
        validation_result["source_current_balance"] = source_current_balance
        validation_result["discrepancy"] = round(discrepancy, 2)

        if discrepancy > TOLERANCE:
            logger.warning(
                f"Balance inconsistency detected for {account.get('label')} ({source_name}): "
                f"Expected: ${final_expected_balance:.2f}, "
                f"Source current: ${source_current_balance:.2f}, "
                f"Discrepancy: ${discrepancy:.2f}"
            )

            # Flag the last transaction as inconsistent
            last_txn = sorted_transactions[-1]
            db.update("transactions", {"id": last_txn['id']}, {
                "has_balance_inconsistency": True,
                "balance_discrepancy": round(final_expected_balance - source_current_balance, 2)
            })

            validation_result["status"] = "inconsistent"
            validation_result["flagged_transaction_id"] = last_txn['id']
        else:
            logger.info(
                f"Balance validation passed for {account.get('label')} ({source_name}): "
                f"Expected: ${final_expected_balance:.2f}, "
                f"Source: ${source_current_balance:.2f}, "
                f"Discrepancy: ${discrepancy:.2f} (within tolerance)"
            )

    return validation_result


def update_opening_balance_from_source(
    db,
    account_id: str,
    source_current_balance: float,
    source_name: str = "import"
) -> Dict[str, Any]:
    """
    Update account opening balance by working backwards from source current balance.

    The opening balance is calculated as:
    opening_balance = source_current_balance - sum(all_transactions)

    Args:
        db: Database service
        account_id: Account ID to update
        source_current_balance: Current balance from source (Plaid, statement, etc.)
        source_name: Name of the import source for logging

    Returns:
        Dictionary with update results
    """
    # Get account
    account = db.find_one("accounts", {"id": account_id})
    if not account:
        logger.warning(f"Account {account_id} not found for opening balance update")
        return {"status": "error", "message": "Account not found"}

    # Get all transactions for this account
    transactions = db.find("transactions", {"account_id": account_id})
    if not transactions:
        logger.info(f"Account {account.get('label')} has no transactions, keeping opening balance")
        return {"status": "skipped", "message": "No transactions"}

    # Sort transactions chronologically
    sorted_transactions = sorted(
        transactions,
        key=lambda t: (
            t.get('date', ''),
            t.get('total', 0.0),
            t.get('id', '')
        )
    )

    # Calculate sum of all transactions
    transaction_sum = sum(txn.get('total', 0.0) for txn in transactions)

    # Calculate opening balance: current - all transactions
    opening_balance = source_current_balance - transaction_sum

    # Get the oldest transaction date
    oldest_transaction_date = sorted_transactions[0].get('date')
    if isinstance(oldest_transaction_date, str):
        oldest_transaction_date = datetime.fromisoformat(oldest_transaction_date.replace('Z', '+00:00'))

    # Update the account's opening balance
    db.update("accounts", {"id": account_id}, {
        "opening_balance": opening_balance,
        "opening_balance_date": oldest_transaction_date
    })

    logger.info(
        f"Updated opening balance for {account.get('label')} ({source_name}): "
        f"${opening_balance:.2f} as of {oldest_transaction_date}, "
        f"source balance: ${source_current_balance:.2f}, "
        f"sum of {len(transactions)} transactions: ${transaction_sum:.2f}"
    )

    return {
        "status": "success",
        "opening_balance": round(opening_balance, 2),
        "opening_balance_date": oldest_transaction_date,
        "source_current_balance": source_current_balance,
        "transaction_sum": round(transaction_sum, 2),
        "transaction_count": len(transactions)
    }
