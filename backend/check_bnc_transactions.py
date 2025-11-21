#!/usr/bin/env python3
"""
Check BNC Account Transaction State

Quick script to check current transaction counts and balance
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service


def main():
    """Check BNC account transaction state."""
    print("=" * 80)
    print("BNC Account Transaction State")
    print("=" * 80)

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
        account_label = bnc_account.get('label', bnc_account.get('account_number', 'Unknown'))

        print(f"\n✓ Found account: {account_label}")
        print(f"  ID: {account_id}")
        print(f"  Current balance: ${bnc_account.get('balance', 0):.2f}")

        # Get transactions
        transactions = db.find("transactions", {"account_id": account_id})
        plaid_count = sum(1 for t in transactions if t.get('plaid_transaction_id'))
        statement_count = sum(1 for t in transactions if t.get('statement_id'))
        manual_count = len(transactions) - plaid_count - statement_count

        print(f"\n📝 Transaction Summary:")
        print(f"  Total: {len(transactions)}")
        print(f"  - Statement: {statement_count}")
        print(f"  - Plaid: {plaid_count}")
        print(f"  - Manual: {manual_count}")

        # Show sample Plaid transactions if any
        if plaid_count > 0:
            print(f"\n✨ Sample Plaid Transactions ({min(3, plaid_count)} of {plaid_count}):")
            plaid_txns = [t for t in transactions if t.get('plaid_transaction_id')]
            plaid_txns.sort(key=lambda t: t.get('date', ''), reverse=True)

            for i, txn in enumerate(plaid_txns[:3], 1):
                total = txn.get('total', 0)
                txn_type = txn.get('type', 'N/A')
                sign_emoji = "💰" if total > 0 else "💸"
                print(f"  {i}. {sign_emoji} {txn.get('date')} | {(txn.get('description') or '')[:40]:40} | ${total:10.2f} | {txn_type}")

        print("\n" + "=" * 80)
        print("Ready for Plaid sync!")
        print("=" * 80)

        return 0


if __name__ == "__main__":
    exit(main())
