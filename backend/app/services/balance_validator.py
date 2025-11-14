"""
Balance Validation Service

Provides balance validation logic for transactions imported from any source
(Plaid, statement imports, etc.)
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, date

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
    # Use import_sequence to preserve intra-day order, fallback to ID for manual entries
    transactions = db.find("transactions", {"account_id": account_id})
    if not transactions:
        logger.info(f"Account {account.get('label')} has no transactions, skipping validation")
        return {"status": "skipped", "message": "No transactions"}

    # Sort transactions chronologically by date (date part only), then by value DESC (credits before debits), then by ID
    sorted_transactions = sorted(
        transactions,
        key=lambda t: (
            _get_date_only(t),
            -t.get('total', 0.0),  # Negative for descending order
            t.get('id', '')
        )
    )

    # Find the first Plaid transaction
    # Opening balance from Plaid applies from this transaction forward
    plaid_transactions = [t for t in sorted_transactions if t.get('plaid_transaction_id')]
    first_plaid_txn_id = None
    if plaid_transactions:
        first_plaid_txn_id = plaid_transactions[0].get('id')
        first_plaid_date = plaid_transactions[0].get('date')
        logger.info(f"First Plaid transaction: {first_plaid_txn_id} on {first_plaid_date}")

    # Get opening balance from account (this is the balance at first Plaid transaction)
    opening_balance = account.get('opening_balance') or 0.0

    # Calculate expected balance for each transaction
    # For transactions BEFORE first Plaid transaction: start at 0
    # For transactions FROM first Plaid transaction: use opening_balance
    running_balance = 0.0  # Start at 0 for pre-Plaid transactions
    reached_first_plaid = False
    first_inconsistent_txn = None  # Track the first transaction with balance inconsistency

    for txn in sorted_transactions:
        # When we reach the first Plaid transaction, set running balance to opening_balance
        # This represents the balance at the START of Plaid sync
        if first_plaid_txn_id and txn.get('id') == first_plaid_txn_id and not reached_first_plaid:
            # This is the first Plaid transaction
            # Set running balance to opening balance BEFORE adding this transaction
            running_balance = opening_balance
            reached_first_plaid = True
            logger.info(f"Reached first Plaid transaction, setting balance to opening_balance: ${opening_balance}")

        running_balance += txn.get('total', 0.0)
        calculated_balance = round(running_balance, 2)

        # Check if this transaction has an inconsistency by comparing calculated vs actual balance
        # actual_balance is the "truth" from the source (bank statement, Plaid, or user correction)
        actual_balance = txn.get('actual_balance')
        has_inconsistency = False
        discrepancy = None

        if actual_balance is not None:
            # Compare our calculated balance with the actual balance from the source
            discrepancy = calculated_balance - actual_balance
            if abs(discrepancy) > TOLERANCE:
                has_inconsistency = True
                if first_inconsistent_txn is None:
                    # This is the first inconsistent transaction we found
                    first_inconsistent_txn = txn
                    logger.warning(
                        f"Balance inconsistency detected at transaction {txn['id']} "
                        f"({txn.get('date')}): Expected (calculated): ${calculated_balance:.2f}, "
                        f"Actual (from source): ${actual_balance:.2f}, Discrepancy: ${discrepancy:.2f}"
                    )

        # Always update expected_balance to our calculated value
        # This ensures the running balance calculation is always fresh
        db.update("transactions", {"id": txn['id']}, {
            "expected_balance": calculated_balance,
            "has_balance_inconsistency": has_inconsistency,
            "balance_discrepancy": round(discrepancy, 2) if discrepancy is not None else None
        })

    # Validate against source current balance if provided
    final_expected_balance = running_balance
    validation_result = {
        "status": "success" if first_inconsistent_txn is None else "inconsistent",
        "opening_balance": opening_balance,
        "opening_balance_applies_from": first_plaid_date if first_plaid_txn_id else None,
        "final_expected_balance": round(final_expected_balance, 2),
        "transaction_count": len(sorted_transactions),
        "oldest_date": sorted_transactions[0].get('date'),
        "newest_date": sorted_transactions[-1].get('date'),
        "has_plaid_transactions": first_plaid_txn_id is not None,
        "first_inconsistent_transaction_id": first_inconsistent_txn['id'] if first_inconsistent_txn else None
    }

    # Additional validation against source current balance (if provided)
    # This checks if our final calculated balance matches what the bank/Plaid reports
    if source_current_balance is not None:
        discrepancy = abs(final_expected_balance - source_current_balance)
        validation_result["source_current_balance"] = source_current_balance
        validation_result["source_balance_discrepancy"] = round(discrepancy, 2)

        if discrepancy > TOLERANCE:
            logger.warning(
                f"Final balance mismatch for {account.get('label')} ({source_name}): "
                f"Calculated: ${final_expected_balance:.2f}, "
                f"Source reports: ${source_current_balance:.2f}, "
                f"Discrepancy: ${discrepancy:.2f}"
            )

            # Only flag the last transaction if no other inconsistencies were found
            # (If we already found inconsistencies, they're the root cause)
            if first_inconsistent_txn is None:
                last_txn = sorted_transactions[-1]
                db.update("transactions", {"id": last_txn['id']}, {
                    "has_balance_inconsistency": True,
                    "balance_discrepancy": round(final_expected_balance - source_current_balance, 2)
                })
                validation_result["flagged_transaction_id"] = last_txn['id']

            validation_result["status"] = "inconsistent"
        else:
            logger.info(
                f"Balance validation passed for {account.get('label')} ({source_name}): "
                f"Calculated: ${final_expected_balance:.2f}, "
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

    # Sort transactions chronologically by date (date part only), then by value DESC (credits before debits), then by ID
    sorted_transactions = sorted(
        transactions,
        key=lambda t: (
            _get_date_only(t),
            -t.get('total', 0.0),  # Negative for descending order
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
    