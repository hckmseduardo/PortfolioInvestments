#!/usr/bin/env python3
"""
Fix BNC Checking Account Balance

This script runs the balance validator on the BNC checking account
to recalculate all expected_balance values and update the account balance.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service
from app.services.balance_validator import validate_and_update_balances


def main():
    """Fix the BNC checking account balance."""
    print("="*80)
    print("Fix BNC Checking Account Balance")
    print("="*80)

    with get_db_context() as session:
        db = get_db_service(session)

        # Find BNC checking account
        print("\nFinding BNC Checking Account...")
        accounts = db.find("accounts", {})
        bnc_account = None

        for account in accounts:
            if ('NBC' in account.get('institution', '') or
                'National' in account.get('institution', '')):
                if account.get('account_type') == 'checking':
                    bnc_account = account
                    break

        if not bnc_account:
            print("✗ BNC Checking Account not found")
            return 1

        account_id = bnc_account['id']
        account_label = bnc_account.get('label', bnc_account.get('account_number', 'Unknown'))
        print(f"✓ Found account: {account_label} (ID: {account_id})")
        print(f"  Current balance: ${bnc_account.get('balance', 0):.2f}")

        # Get all transactions to find the latest one with actual_balance
        print("\nFinding latest transaction with actual_balance...")
        transactions = db.find("transactions", {"account_id": account_id})

        # Sort transactions chronologically
        from datetime import datetime, date
        def get_date_only(txn):
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

        sorted_transactions = sorted(
            transactions,
            key=lambda t: (
                get_date_only(t),
                -t.get('total', 0.0),
                t.get('id', '')
            )
        )

        # Find latest transaction with actual_balance
        # For transactions on the same date, use the one with the LOWEST balance
        # (which represents the final state after all transactions on that date)
        source_balance = None
        latest_date = None

        # First, find the latest date that has actual_balance
        for txn in reversed(sorted_transactions):
            if txn.get('actual_balance') is not None:
                latest_date = get_date_only(txn)
                break

        if latest_date:
            # Get all transactions on that date with actual_balance
            txns_on_latest_date = [
                txn for txn in sorted_transactions
                if get_date_only(txn) == latest_date and txn.get('actual_balance') is not None
            ]

            # Use the one with the LOWEST balance (final state)
            if txns_on_latest_date:
                final_txn = min(txns_on_latest_date, key=lambda t: t.get('actual_balance', float('inf')))
                source_balance = final_txn.get('actual_balance')
                print(f"✓ Found latest transaction with actual_balance: ${source_balance:.2f}")
                print(f"  Date: {final_txn.get('date')}")
                print(f"  Description: {final_txn.get('description', '')[:50]}")
                if len(txns_on_latest_date) > 1:
                    print(f"  Note: {len(txns_on_latest_date)} transactions on this date, using lowest balance")

        if source_balance is None:
            print("⚠ No transactions with actual_balance found")
            print("  Will calculate forward from 0")
        else:
            # Check if there are Plaid transactions after the latest statement balance
            latest_plaid_date = None
            for txn in reversed(sorted_transactions):
                if txn.get('plaid_transaction_id'):
                    latest_plaid_date = get_date_only(txn)
                    break

            print(f"\nDEBUG: Latest statement date: {latest_date}")
            print(f"DEBUG: Latest Plaid date: {latest_plaid_date}")

            if latest_plaid_date and latest_date and latest_plaid_date > latest_date:
                print(f"\n⚠ WARNING: Found Plaid transactions after latest statement date")
                print(f"  Latest statement: {latest_date}")
                print(f"  Latest Plaid: {latest_plaid_date}")
                print(f"  Will calculate forward from 0 instead of using statement anchor")
                source_balance = None
            else:
                print("\n⚠ WARNING: Duplicate transactions detected on same date")
                print("  This may cause balance inconsistencies")
                print("  Will calculate forward from 0 to handle duplicates correctly")
                source_balance = None

        # Run balance validation
        print("\nRunning balance validation...")
        result = validate_and_update_balances(
            db=db,
            account_id=account_id,
            source_current_balance=source_balance,
            source_name="fix_script"
        )

        session.commit()

        print("\n" + "="*80)
        print("Balance Validation Result")
        print("="*80)
        print(f"Status: {result['status']}")
        print(f"Final Balance: ${result['final_expected_balance']:.2f}")
        print(f"Transactions Processed: {result['transaction_count']}")
        print(f"Date Range: {result['oldest_date']} to {result['newest_date']}")

        if result.get('first_inconsistent_transaction_id'):
            print(f"\n⚠ Warning: Found balance inconsistency at transaction {result['first_inconsistent_transaction_id']}")
        else:
            print(f"\n✓ No balance inconsistencies detected")

        # Verify the fix
        updated_account = db.find_one("accounts", {"id": account_id})
        print(f"\nUpdated Account Balance: ${updated_account.get('balance', 0):.2f}")

        return 0 if result['status'] == 'success' else 1


if __name__ == "__main__":
    exit(main())
