#!/usr/bin/env python3
"""
Compare BNC Account State Before and After Plaid Sync

This script compares the snapshot taken before Plaid sync with the current state
to identify exactly what changed and where issues may have occurred.
"""

import sys
import os
import json
from datetime import datetime, date
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service


def serialize_date(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj


def load_before_snapshot() -> Dict:
    """Load the snapshot taken before Plaid sync."""
    snapshot_file = '/app/bnc_state_before_plaid_sync.json'

    if not os.path.exists(snapshot_file):
        print(f"✗ ERROR: Snapshot file not found: {snapshot_file}")
        print("Please run the snapshot script first before Plaid sync.")
        sys.exit(1)

    with open(snapshot_file, 'r') as f:
        return json.load(f)


def get_current_state(session) -> Dict:
    """Get the current state of BNC account."""
    db = get_db_service(session)

    # Find BNC checking account
    accounts = db.find('accounts', {})
    bnc_account = None

    for account in accounts:
        if ('NBC' in account.get('institution', '') or
            'National' in account.get('institution', '')):
            if account.get('account_type') == 'checking':
                bnc_account = account
                break

    if not bnc_account:
        print('Account not found')
        sys.exit(1)

    account_id = bnc_account['id']

    # Get all transactions
    transactions = db.find('transactions', {'account_id': account_id})

    # Prepare current state
    current_state = {
        'timestamp': datetime.now().isoformat(),
        'description': 'BNC Account State AFTER Plaid Sync',
        'account': {
            'id': account_id,
            'label': bnc_account.get('label'),
            'institution': bnc_account.get('institution'),
            'account_type': bnc_account.get('account_type'),
            'balance': bnc_account.get('balance'),
        },
        'transaction_summary': {
            'total_count': len(transactions),
            'plaid_count': sum(1 for t in transactions if t.get('plaid_transaction_id')),
            'statement_count': sum(1 for t in transactions if t.get('statement_id')),
            'manual_count': sum(1 for t in transactions if not t.get('plaid_transaction_id') and not t.get('statement_id')),
        },
        'transactions': []
    }

    # Sort transactions chronologically
    sorted_txns = sorted(transactions, key=lambda t: (
        t.get('date') if t.get('date') else datetime.min,
        -t.get('total', 0.0),
        t.get('id', '')
    ))

    for txn in sorted_txns:
        current_state['transactions'].append({
            'id': txn['id'],
            'date': serialize_date(txn.get('date')),
            'description': txn.get('description'),
            'type': txn.get('type'),
            'total': txn.get('total'),
            'expected_balance': txn.get('expected_balance'),
            'actual_balance': txn.get('actual_balance'),
            'plaid_transaction_id': txn.get('plaid_transaction_id'),
            'statement_id': txn.get('statement_id'),
            'source': txn.get('source'),
            'has_balance_inconsistency': txn.get('has_balance_inconsistency'),
            'balance_discrepancy': txn.get('balance_discrepancy'),
        })

    return current_state


def compare_states(before: Dict, after: Dict):
    """Compare before and after states and report differences."""
    print("=" * 100)
    print("BNC ACCOUNT COMPARISON: Before Plaid Sync → After Plaid Sync")
    print("=" * 100)

    # Account Balance
    print(f"\n📊 ACCOUNT BALANCE:")
    balance_before = before['account']['balance']
    balance_after = after['account']['balance']
    balance_diff = balance_after - balance_before

    print(f"  Before: ${balance_before:.2f}")
    print(f"  After:  ${balance_after:.2f}")

    if abs(balance_diff) < 0.01:
        print(f"  ✓ No change")
    elif abs(balance_diff) > 0.01:
        print(f"  ⚠ CHANGED by ${balance_diff:+.2f}")

    # Transaction Counts
    print(f"\n📝 TRANSACTION COUNTS:")
    print(f"  Before: {before['transaction_summary']['total_count']} total")
    print(f"    - Statement: {before['transaction_summary']['statement_count']}")
    print(f"    - Plaid: {before['transaction_summary']['plaid_count']}")
    print(f"    - Manual: {before['transaction_summary']['manual_count']}")

    print(f"  After:  {after['transaction_summary']['total_count']} total")
    print(f"    - Statement: {after['transaction_summary']['statement_count']}")
    print(f"    - Plaid: {after['transaction_summary']['plaid_count']}")
    print(f"    - Manual: {after['transaction_summary']['manual_count']}")

    added = after['transaction_summary']['total_count'] - before['transaction_summary']['total_count']
    print(f"  → {added:+d} transactions")

    # Build transaction maps
    before_txns = {t['id']: t for t in before['transactions']}
    after_txns = {t['id']: t for t in after['transactions']}

    # Find new transactions (added by Plaid)
    new_txn_ids = set(after_txns.keys()) - set(before_txns.keys())
    new_txns = [after_txns[tid] for tid in new_txn_ids]

    # Find modified transactions
    modified_txns = []
    for tid in set(before_txns.keys()) & set(after_txns.keys()):
        before_txn = before_txns[tid]
        after_txn = after_txns[tid]

        # Check if any relevant fields changed
        if (before_txn.get('total') != after_txn.get('total') or
            before_txn.get('expected_balance') != after_txn.get('expected_balance') or
            before_txn.get('has_balance_inconsistency') != after_txn.get('has_balance_inconsistency')):
            modified_txns.append({
                'id': tid,
                'before': before_txn,
                'after': after_txn
            })

    # New Plaid Transactions
    if new_txns:
        print(f"\n✨ NEW TRANSACTIONS ADDED BY PLAID ({len(new_txns)}):")
        print("=" * 100)

        # Sort by date
        new_txns_sorted = sorted(new_txns, key=lambda t: (t['date'], t['id']))

        for i, txn in enumerate(new_txns_sorted, 1):
            total = txn.get('total', 0)
            txn_type = txn.get('type', 'N/A')

            # Check if sign is correct
            sign_status = ''
            if 'OUT' in txn_type.upper() and total > 0:
                sign_status = ' ❌ WRONG SIGN! (Money Out should be negative)'
            elif 'IN' in txn_type.upper() and total < 0:
                sign_status = ' ❌ WRONG SIGN! (Money In should be positive)'
            elif 'OUT' in txn_type.upper() and total < 0:
                sign_status = ' ✓'
            elif 'IN' in txn_type.upper() and total > 0:
                sign_status = ' ✓'

            print(f"{i:3}. {txn['date']} | {(txn.get('description') or '')[:50]:50} | "
                  f"${total:10.2f} | {txn_type:15}{sign_status}")

            if txn.get('plaid_transaction_id'):
                print(f"     Plaid ID: {txn['plaid_transaction_id']}")

    # Modified Transactions
    if modified_txns:
        print(f"\n🔄 MODIFIED TRANSACTIONS ({len(modified_txns)}):")
        print("=" * 100)

        for mod in modified_txns[:10]:  # Show first 10
            print(f"\nTransaction: {mod['id']}")
            print(f"  Date: {mod['after']['date']}")
            print(f"  Description: {mod['after'].get('description', '')[:50]}")

            if mod['before'].get('total') != mod['after'].get('total'):
                print(f"  Total: ${mod['before'].get('total', 0):.2f} → ${mod['after'].get('total', 0):.2f}")

            if mod['before'].get('expected_balance') != mod['after'].get('expected_balance'):
                print(f"  Expected Balance: ${mod['before'].get('expected_balance', 0):.2f} → ${mod['after'].get('expected_balance', 0):.2f}")

            if mod['before'].get('has_balance_inconsistency') != mod['after'].get('has_balance_inconsistency'):
                print(f"  Inconsistency: {mod['before'].get('has_balance_inconsistency')} → {mod['after'].get('has_balance_inconsistency')}")

        if len(modified_txns) > 10:
            print(f"\n... and {len(modified_txns) - 10} more modified transactions")

    # Check for wrong signs in new Plaid transactions
    wrong_sign_txns = []
    for txn in new_txns:
        total = txn.get('total', 0)
        txn_type = txn.get('type', '')

        if ('OUT' in txn_type.upper() and total > 0) or ('IN' in txn_type.upper() and total < 0):
            wrong_sign_txns.append(txn)

    # Summary
    print(f"\n" + "=" * 100)
    print("SUMMARY")
    print("=" * 100)

    issues = []

    if abs(balance_diff) > 0.01:
        issues.append(f"Account balance changed by ${balance_diff:+.2f}")

    if wrong_sign_txns:
        issues.append(f"{len(wrong_sign_txns)} transactions have wrong signs")

    if issues:
        print("\n❌ ISSUES FOUND:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("\n✓ No issues found")

    print(f"\nNew Plaid Transactions: {len(new_txns)}")
    print(f"Modified Transactions: {len(modified_txns)}")
    print(f"Transactions with Wrong Signs: {len(wrong_sign_txns)}")

    return {
        'new_transactions': new_txns,
        'modified_transactions': modified_txns,
        'wrong_sign_transactions': wrong_sign_txns,
        'balance_difference': balance_diff
    }


def main():
    """Main comparison function."""
    print("\nLoading snapshots...\n")

    # Load before snapshot
    before = load_before_snapshot()
    print(f"✓ Loaded BEFORE snapshot from {before['timestamp']}")

    # Get current state
    with get_db_context() as session:
        after = get_current_state(session)
        print(f"✓ Loaded AFTER snapshot from {after['timestamp']}")

    # Compare
    results = compare_states(before, after)

    # Save after snapshot for future reference
    output_file = '/app/bnc_state_after_plaid_sync.json'
    with open(output_file, 'w') as f:
        json.dump(after, f, indent=2, default=str)
    print(f"\n✓ After snapshot saved to: {output_file}")

    return 0 if not results['wrong_sign_transactions'] else 1


if __name__ == "__main__":
    exit(main())
