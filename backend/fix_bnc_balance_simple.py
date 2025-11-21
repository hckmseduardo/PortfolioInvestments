#!/usr/bin/env python3
"""
Fix BNC Checking Account Balance - Simple Version

This script runs the balance validator on the BNC checking account
using forward calculation from zero (no statement balance anchor).
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
    print("Fix BNC Checking Account Balance - Simple Version")
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

        # Get transaction counts
        transactions = db.find("transactions", {"account_id": account_id})
        plaid_count = sum(1 for t in transactions if t.get('plaid_transaction_id'))
        statement_count = sum(1 for t in transactions if t.get('statement_id'))

        print(f"\nTransaction Summary:")
        print(f"  Total: {len(transactions)}")
        print(f"  Plaid: {plaid_count}")
        print(f"  Statement: {statement_count}")

        # Run balance validation WITHOUT source balance (forward calculation from 0)
        print("\nRunning balance validation (forward calculation from 0)...")
        print("This will handle duplicate transactions correctly")

        result = validate_and_update_balances(
            db=db,
            account_id=account_id,
            source_current_balance=None,  # Force forward calculation
            source_name="fix_script_simple"
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
