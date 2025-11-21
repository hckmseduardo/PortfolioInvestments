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
    Validate transaction balances and update account balance.

    This function:
    1. Calculates expected_balance for each transaction chronologically
    2. Stores expected_balance in each transaction record
    3. Compares final calculated balance with source current balance (if provided)
    4. Flags inconsistencies if discrepancy > $1.00
    5. Updates account.balance based on source balance or last transaction

    Strategy:
    - If source_current_balance provided: use as anchor, calculate BACKWARD
    - If not provided: calculate FORWARD from 0 or from last transaction with actual_balance

    Args:
        db: Database service
        account_id: Account ID to validate
        source_current_balance: Current balance from source (statement ending balance, etc.)
                                If provided, used as anchor to calculate backward
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

    # Sort transactions chronologically by date, then by amount DESC (credits before debits)
    # Note: Intraday order may vary from statement, but end-of-day balance should match
    sorted_transactions = sorted(
        transactions,
        key=lambda t: (
            _get_date_only(t),
            -t.get('total', 0.0),  # Sort by amount DESC (larger amounts first)
            t.get('id', '')
        )
    )

    first_inconsistent_txn = None  # Track the first transaction with balance inconsistency

    # Strategy: Calculate expected_balance for all transactions
    # If source_current_balance provided: use as anchor, calculate BACKWARD
    # If not provided: calculate FORWARD from 0 or from last transaction with actual_balance
    if source_current_balance is not None:
        # BACKWARD calculation: use source balance as anchor for last transaction
        logger.info(f"Using source balance ${source_current_balance:.2f} as anchor, calculating backward")

        running_balance = source_current_balance
        for txn in reversed(sorted_transactions):
            calculated_balance = round(running_balance, 2)

            # Check for inconsistency with actual_balance if provided
            actual_balance = txn.get('actual_balance')
            has_inconsistency = False
            discrepancy = None

            if actual_balance is not None:
                discrepancy = calculated_balance - actual_balance
                if abs(discrepancy) > TOLERANCE:
                    has_inconsistency = True
                    if first_inconsistent_txn is None:
                        first_inconsistent_txn = txn
                        logger.warning(
                            f"Balance inconsistency detected at transaction {txn['id']} "
                            f"({txn.get('date')}): Expected: ${calculated_balance:.2f}, "
                            f"Actual: ${actual_balance:.2f}, Discrepancy: ${discrepancy:.2f}"
                        )

            # Update transaction with calculated balance
            db.update("transactions", {"id": txn['id']}, {
                "expected_balance": calculated_balance,
                "has_balance_inconsistency": has_inconsistency,
                "balance_discrepancy": round(discrepancy, 2) if discrepancy is not None else None
            })

            # Move backward
            running_balance -= txn.get('total', 0.0)

        final_expected_balance = source_current_balance

        # Update account balance to source balance
        db.update("accounts", {"id": account_id}, {"balance": source_current_balance})
        logger.info(f"Updated account balance to source balance: ${source_current_balance:.2f}")

    else:
        # FORWARD calculation: start from 0 or from last transaction with actual_balance
        logger.info("No source balance provided, calculating forward from existing balances")

        # Build a set of end-of-day transaction IDs
        # For transactions with actual_balance: use the one with LOWEST balance (final state after all txns)
        # For transactions without actual_balance: use the last in sorted order
        end_of_day_txn_ids = set()
        date_to_txns = {}

        # Group transactions by date
        for txn in sorted_transactions:
            txn_date = _get_date_only(txn)
            if txn_date not in date_to_txns:
                date_to_txns[txn_date] = []
            date_to_txns[txn_date].append(txn)

        # For each date, find the end-of-day transaction
        for txn_date, txns in date_to_txns.items():
            # Prefer transaction with lowest actual_balance (final state after all transactions)
            txns_with_balance = [t for t in txns if t.get('actual_balance') is not None]

            if txns_with_balance:
                # Find minimum actual_balance
                min_balance = min(t.get('actual_balance') for t in txns_with_balance)

                # Get all transactions with this minimum balance
                txns_with_min_balance = [t for t in txns_with_balance
                                        if t.get('actual_balance') == min_balance]

                # If multiple transactions have the same balance, use the LAST one
                # (more likely to be the true end-of-day transaction)
                end_of_day_txn = txns_with_min_balance[-1]
            else:
                # No actual_balance available, use last in sorted order
                end_of_day_txn = txns[-1]

            end_of_day_txn_ids.add(end_of_day_txn['id'])

        running_balance = 0.0
        for txn in sorted_transactions:
            running_balance += txn.get('total', 0.0)
            calculated_balance = round(running_balance, 2)

            # Check for inconsistency with actual_balance ONLY for end-of-day transactions
            actual_balance = txn.get('actual_balance')
            has_inconsistency = False
            discrepancy = None
            is_end_of_day = txn['id'] in end_of_day_txn_ids

            if actual_balance is not None and is_end_of_day:
                # Only check end-of-day balances (intra-day order may vary from statement)
                discrepancy = calculated_balance - actual_balance
                if abs(discrepancy) > TOLERANCE:
                    has_inconsistency = True
                    if first_inconsistent_txn is None:
                        first_inconsistent_txn = txn
                        logger.warning(
                            f"End-of-day balance inconsistency detected at {txn['id']} "
                            f"({txn.get('date')}): Expected: ${calculated_balance:.2f}, "
                            f"Actual: ${actual_balance:.2f}, Discrepancy: ${discrepancy:.2f}"
                        )

            # Update transaction with calculated balance
            db.update("transactions", {"id": txn['id']}, {
                "expected_balance": calculated_balance,
                "has_balance_inconsistency": has_inconsistency,
                "balance_discrepancy": round(discrepancy, 2) if discrepancy is not None else None
            })

        final_expected_balance = running_balance

        # Update account balance to last transaction's expected_balance
        db.update("accounts", {"id": account_id}, {"balance": final_expected_balance})
        logger.info(f"Updated account balance to last transaction: ${final_expected_balance:.2f}")

    # Build validation result
    validation_result = {
        "status": "success" if first_inconsistent_txn is None else "inconsistent",
        "final_expected_balance": round(final_expected_balance, 2),
        "transaction_count": len(sorted_transactions),
        "oldest_date": sorted_transactions[0].get('date'),
        "newest_date": sorted_transactions[-1].get('date'),
        "first_inconsistent_transaction_id": first_inconsistent_txn['id'] if first_inconsistent_txn else None
    }

    # Add source balance to result if provided
    if source_current_balance is not None:
        validation_result["source_current_balance"] = source_current_balance
        logger.info(
            f"Balance validation completed for {account.get('label')} ({source_name}): "
            f"Final balance: ${final_expected_balance:.2f}, "
            f"Source balance: ${source_current_balance:.2f}"
        )

    return validation_result


def update_opening_balance_from_source(
    db,
    account_id: str,
    source_current_balance: float,
    source_name: str = "import"
) -> Dict[str, Any]:
    """
    DEPRECATED: This function is deprecated. Use validate_and_update_balances() instead.

    This function now redirects to validate_and_update_balances() which uses the
    simplified balance system (no opening_balance, only account.balance).

    Args:
        db: Database service
        account_id: Account ID to update
        source_current_balance: Current balance from source (statement ending balance, etc.)
        source_name: Name of the import source for logging

    Returns:
        Dictionary with update results
    """
    logger.warning(
        f"update_opening_balance_from_source() is deprecated. "
        f"Redirecting to validate_and_update_balances() for account {account_id}"
    )

    # Redirect to the new function
    return validate_and_update_balances(
        db=db,
        account_id=account_id,
        source_current_balance=source_current_balance,
        source_name=source_name
    )
