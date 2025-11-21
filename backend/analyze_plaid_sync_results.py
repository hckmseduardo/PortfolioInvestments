#!/usr/bin/env python3
"""
Analyze Plaid Sync Results

Show what changed after Plaid sync
"""

import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service


def main():
    """Analyze Plaid sync results."""
    print("=" * 100)
    print("Plaid Sync Results Analysis")
    print("=" * 100)

    with get_db_context() as session:
        db = get_db_service(session)

        # Find BNC checking account
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

        # Get all transactions
        transactions = db.find("transactions", {"account_id": account_id})
        plaid_txns = [t for t in transactions if t.get('plaid_transaction_id')]
        statement_txns = [t for t in transactions if t.get('statement_id')]

        print(f"\n📊 Summary:")
        print(f"  Total transactions: {len(transactions)}")
        print(f"  Statement: {len(statement_txns)}")
        print(f"  Plaid: {len(plaid_txns)}")
        print(f"  Balance: ${bnc_account.get('balance', 0):.2f}")

        # Show all Plaid transactions
        print(f"\n✨ ALL Plaid Transactions ({len(plaid_txns)}):")
        print("-" * 100)

        plaid_txns_sorted = sorted(plaid_txns, key=lambda t: t.get('date', ''), reverse=True)

        for i, txn in enumerate(plaid_txns_sorted, 1):
            total = txn.get('total', 0)
            txn_type = txn.get('type', 'N/A')
            sign_emoji = "💰" if total > 0 else "💸"
            date_str = str(txn.get('date', ''))[:10]

            print(f"{i:3}. {sign_emoji} {date_str} | {(txn.get('description') or '')[:50]:50} | ${total:10.2f} | {txn_type:15}")

        # Calculate what was removed
        print(f"\n📝 Transaction Changes:")
        print(f"  Before: 482 statement transactions")
        print(f"  After:  {len(statement_txns)} statement + {len(plaid_txns)} Plaid = {len(transactions)} total")
        print(f"  Removed: {482 - len(statement_txns)} statement transactions (detected as duplicates)")
        print(f"  Added: {len(plaid_txns)} Plaid transactions")

        # Check if balance is correct
        expected_balance = 2453.84
        actual_balance = bnc_account.get('balance', 0)

        print(f"\n💰 Balance Check:")
        print(f"  Expected (from Plaid): ${expected_balance:.2f}")
        print(f"  Actual: ${actual_balance:.2f}")

        if abs(actual_balance - expected_balance) < 0.01:
            print(f"  ✓ Balance matches!")
        else:
            diff = actual_balance - expected_balance
            print(f"  ✗ Balance mismatch! Difference: ${diff:+.2f}")

        print("\n" + "=" * 100)

        return 0


if __name__ == "__main__":
    exit(main())
