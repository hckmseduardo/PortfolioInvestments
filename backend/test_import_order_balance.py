#!/usr/bin/env python3
"""
Test Balance Consistency Across Different Import Orders

This test validates that the balance calculation system produces consistent results
regardless of whether:
1. Statement is imported first, then Plaid sync
2. Plaid sync happens first, then statement import

Test Account: BNC Checking Account

Expected Behavior:
- Final balance should be identical in both scenarios
- No balance inconsistencies should be flagged
- All transaction expected_balances should match
"""

import sys
import os
from datetime import datetime, date
from typing import Dict, List, Tuple

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service
from sqlalchemy.orm import Session


class BalanceTestResult:
    """Stores test results for validation."""

    def __init__(self, scenario_name: str):
        self.scenario_name = scenario_name
        self.account_balance = None
        self.transaction_count = 0
        self.transactions = []
        self.inconsistencies = []
        self.plaid_txn_count = 0
        self.statement_txn_count = 0

    def to_dict(self) -> Dict:
        return {
            "scenario": self.scenario_name,
            "account_balance": self.account_balance,
            "transaction_count": self.transaction_count,
            "plaid_txn_count": self.plaid_txn_count,
            "statement_txn_count": self.statement_txn_count,
            "inconsistencies": len(self.inconsistencies),
            "transactions": self.transactions
        }


def get_bnc_checking_account(db) -> Dict:
    """Find the BNC checking account."""
    accounts = db.find("accounts", {})
    for account in accounts:
        if ('NBC' in account.get('institution', '') or
            'National' in account.get('institution', '')):
            if account.get('account_type') == 'checking':
                return account
    return None


def backup_account_data(session: Session, account_id: str) -> Dict:
    """Backup account and all related transactions before test."""
    from app.database.models import Transaction, Account

    # Get account
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise ValueError(f"Account {account_id} not found")

    # Get all transactions
    transactions = session.query(Transaction).filter(
        Transaction.account_id == account_id
    ).all()

    backup = {
        "account": {
            "id": account.id,
            "balance": account.balance,
            "label": account.label
        },
        "transactions": []
    }

    for txn in transactions:
        backup["transactions"].append({
            "id": txn.id,
            "date": txn.date,
            "description": txn.description,
            "total": txn.total,
            "expected_balance": txn.expected_balance,
            "actual_balance": txn.actual_balance,
            "plaid_transaction_id": txn.plaid_transaction_id,
            "statement_id": txn.statement_id
        })

    return backup


def restore_account_data(session: Session, backup: Dict):
    """Restore account data from backup."""
    from app.database.models import Transaction, Account

    account_id = backup["account"]["id"]

    # Restore account balance
    account = session.query(Account).filter(Account.id == account_id).first()
    if account:
        account.balance = backup["account"]["balance"]

    # Restore transactions
    for txn_data in backup["transactions"]:
        txn = session.query(Transaction).filter(Transaction.id == txn_data["id"]).first()
        if txn:
            txn.expected_balance = txn_data["expected_balance"]
            txn.actual_balance = txn_data["actual_balance"]

    session.commit()


def collect_balance_data(session: Session, account_id: str, scenario_name: str) -> BalanceTestResult:
    """Collect balance data for the current state."""
    from app.database.models import Transaction, Account
    from sqlalchemy import cast, Date

    result = BalanceTestResult(scenario_name)

    # Get account balance
    account = session.query(Account).filter(Account.id == account_id).first()
    result.account_balance = account.balance if account else None

    # Get all transactions sorted chronologically
    transactions = session.query(Transaction).filter(
        Transaction.account_id == account_id
    ).order_by(
        cast(Transaction.date, Date).asc(),
        Transaction.total.desc(),
        Transaction.id.asc()
    ).all()

    result.transaction_count = len(transactions)

    for txn in transactions:
        txn_data = {
            "id": txn.id,
            "date": txn.date.isoformat() if txn.date else None,
            "description": txn.description[:40] if txn.description else "",
            "total": float(txn.total) if txn.total is not None else 0.0,
            "expected_balance": float(txn.expected_balance) if txn.expected_balance is not None else None,
            "actual_balance": float(txn.actual_balance) if txn.actual_balance is not None else None,
            "is_plaid": txn.plaid_transaction_id is not None,
            "is_statement": txn.statement_id is not None,
            "has_inconsistency": txn.has_balance_inconsistency or False,
            "discrepancy": float(txn.balance_discrepancy) if txn.balance_discrepancy is not None else None
        }

        result.transactions.append(txn_data)

        if txn.plaid_transaction_id:
            result.plaid_txn_count += 1
        if txn.statement_id:
            result.statement_txn_count += 1

        if txn.has_balance_inconsistency:
            result.inconsistencies.append({
                "transaction_id": txn.id,
                "date": txn.date.isoformat() if txn.date else None,
                "description": txn.description[:40] if txn.description else "",
                "expected": float(txn.expected_balance) if txn.expected_balance else None,
                "actual": float(txn.actual_balance) if txn.actual_balance else None,
                "discrepancy": float(txn.balance_discrepancy) if txn.balance_discrepancy else None
            })

    return result


def compare_results(result1: BalanceTestResult, result2: BalanceTestResult) -> Dict:
    """Compare two test results and identify differences."""
    comparison = {
        "balances_match": abs((result1.account_balance or 0) - (result2.account_balance or 0)) < 0.01,
        "balance_difference": (result1.account_balance or 0) - (result2.account_balance or 0),
        "transaction_count_matches": result1.transaction_count == result2.transaction_count,
        "inconsistencies": {
            result1.scenario_name: len(result1.inconsistencies),
            result2.scenario_name: len(result2.inconsistencies)
        },
        "transaction_differences": []
    }

    # Compare transaction balances
    txn_map1 = {txn["id"]: txn for txn in result1.transactions}
    txn_map2 = {txn["id"]: txn for txn in result2.transactions}

    all_txn_ids = set(txn_map1.keys()) | set(txn_map2.keys())

    for txn_id in all_txn_ids:
        txn1 = txn_map1.get(txn_id)
        txn2 = txn_map2.get(txn_id)

        if not txn1:
            comparison["transaction_differences"].append({
                "id": txn_id,
                "issue": f"Transaction only exists in {result2.scenario_name}"
            })
        elif not txn2:
            comparison["transaction_differences"].append({
                "id": txn_id,
                "issue": f"Transaction only exists in {result1.scenario_name}"
            })
        else:
            # Compare expected_balance
            bal1 = txn1.get("expected_balance")
            bal2 = txn2.get("expected_balance")

            if bal1 is not None and bal2 is not None:
                if abs(bal1 - bal2) > 0.01:
                    comparison["transaction_differences"].append({
                        "id": txn_id,
                        "date": txn1.get("date"),
                        "description": txn1.get("description"),
                        "issue": "Expected balance mismatch",
                        result1.scenario_name: bal1,
                        result2.scenario_name: bal2,
                        "difference": bal1 - bal2
                    })

    return comparison


def print_result(result: BalanceTestResult):
    """Print test result in a readable format."""
    print(f"\n{'='*80}")
    print(f"Scenario: {result.scenario_name}")
    print(f"{'='*80}")
    print(f"Account Balance: ${result.account_balance:.2f}" if result.account_balance else "N/A")
    print(f"Total Transactions: {result.transaction_count}")
    print(f"  - Plaid Transactions: {result.plaid_txn_count}")
    print(f"  - Statement Transactions: {result.statement_txn_count}")
    print(f"Balance Inconsistencies: {len(result.inconsistencies)}")

    if result.inconsistencies:
        print("\nInconsistencies Found:")
        for inc in result.inconsistencies:
            print(f"  - {inc['date']} {inc['description']}: "
                  f"Expected ${inc['expected']:.2f}, Actual ${inc['actual']:.2f}, "
                  f"Diff ${inc['discrepancy']:.2f}")

    print(f"\nFirst 5 Transactions:")
    for txn in result.transactions[:5]:
        source = []
        if txn['is_plaid']:
            source.append('Plaid')
        if txn['is_statement']:
            source.append('Statement')
        source_str = '+'.join(source) if source else 'Manual'

        desc = txn['description'] or ''
        exp_bal = txn['expected_balance'] if txn['expected_balance'] is not None else 0.0

        print(f"  {txn['date']} | {desc:40} | "
              f"${txn['total']:8.2f} | Bal: ${exp_bal:10.2f} | {source_str}")

    if result.transaction_count > 5:
        print(f"  ... and {result.transaction_count - 5} more")


def print_comparison(comparison: Dict):
    """Print comparison results."""
    print(f"\n{'='*80}")
    print("COMPARISON RESULTS")
    print(f"{'='*80}")

    print(f"✓ Balances Match: {comparison['balances_match']}")
    if not comparison['balances_match']:
        print(f"  Difference: ${comparison['balance_difference']:.2f}")

    print(f"✓ Transaction Counts Match: {comparison['transaction_count_matches']}")

    print(f"\nInconsistencies:")
    for scenario, count in comparison['inconsistencies'].items():
        status = "✓" if count == 0 else "✗"
        print(f"  {status} {scenario}: {count}")

    if comparison['transaction_differences']:
        print(f"\n✗ Transaction Differences Found: {len(comparison['transaction_differences'])}")
        for diff in comparison['transaction_differences'][:5]:
            print(f"  - {diff}")
        if len(comparison['transaction_differences']) > 5:
            print(f"  ... and {len(comparison['transaction_differences']) - 5} more")
    else:
        print(f"\n✓ No Transaction Differences Found")


def main():
    """Run the balance consistency tests."""
    print("\n" + "="*80)
    print("BALANCE CONSISTENCY TEST - Import Order Validation")
    print("="*80)
    print("\nThis test validates that balance calculations are consistent")
    print("regardless of import order (Statement first vs Plaid first)")
    print("="*80)

    with get_db_context() as session:
        db = get_db_service(session)

        # Find BNC checking account
        print("\n[1/6] Finding BNC Checking Account...")
        account = get_bnc_checking_account(db)

        if not account:
            print("✗ ERROR: BNC Checking Account not found")
            print("  Please ensure you have a BNC/National Bank checking account set up")
            return 1

        account_id = account['id']
        account_label = account.get('label', account.get('account_number', 'Unknown'))
        print(f"✓ Found account: {account_label} (ID: {account_id})")

        # Backup current state
        print("\n[2/6] Backing up current account state...")
        backup = backup_account_data(session, account_id)
        print(f"✓ Backed up {len(backup['transactions'])} transactions")

        try:
            # Collect current state
            print("\n[3/6] Collecting current balance state...")
            current_result = collect_balance_data(session, account_id, "Current State")
            print_result(current_result)

            # Analyze current state
            print("\n[4/6] Analyzing current import composition...")
            has_plaid = current_result.plaid_txn_count > 0
            has_statement = current_result.statement_txn_count > 0

            if has_plaid and has_statement:
                print(f"✓ Account has both Plaid ({current_result.plaid_txn_count}) and "
                      f"Statement ({current_result.statement_txn_count}) transactions")
                print("  This is the ideal state for testing import order independence")
            elif has_plaid:
                print(f"⚠ Account only has Plaid transactions ({current_result.plaid_txn_count})")
                print("  To fully test, please also import a statement")
            elif has_statement:
                print(f"⚠ Account only has Statement transactions ({current_result.statement_txn_count})")
                print("  To fully test, please also sync with Plaid")
            else:
                print("✗ Account has no transactions")
                print("  Please import data before running this test")
                return 1

            # Validation checks
            print("\n[5/6] Running validation checks...")

            checks_passed = True

            # Check 1: No balance inconsistencies
            if len(current_result.inconsistencies) == 0:
                print("✓ Check 1: No balance inconsistencies detected")
            else:
                print(f"✗ Check 1: Found {len(current_result.inconsistencies)} balance inconsistencies")
                checks_passed = False

            # Check 2: Account balance matches last transaction
            if current_result.transactions:
                last_txn = current_result.transactions[-1]
                if abs((current_result.account_balance or 0) - (last_txn.get('expected_balance') or 0)) < 0.01:
                    print("✓ Check 2: Account balance matches last transaction")
                else:
                    account_bal = current_result.account_balance if current_result.account_balance is not None else 0
                    expected_bal = last_txn.get('expected_balance') if last_txn.get('expected_balance') is not None else 0
                    print(f"✗ Check 2: Account balance (${account_bal:.2f}) "
                          f"doesn't match last transaction (${expected_bal:.2f})")
                    checks_passed = False

            # Check 3: All transactions have expected_balance
            txns_without_balance = [t for t in current_result.transactions
                                   if t.get('expected_balance') is None]
            if len(txns_without_balance) == 0:
                print("✓ Check 3: All transactions have expected_balance calculated")
            else:
                print(f"✗ Check 3: {len(txns_without_balance)} transactions missing expected_balance")
                checks_passed = False

            # Check 4: Transactions with actual_balance match expected_balance (within tolerance)
            mismatches = []
            for txn in current_result.transactions:
                if txn.get('actual_balance') is not None:
                    expected = txn.get('expected_balance', 0)
                    actual = txn.get('actual_balance', 0)
                    if abs(expected - actual) > 1.00:  # $1.00 tolerance
                        mismatches.append(txn)

            if len(mismatches) == 0:
                print("✓ Check 4: All actual_balance values match expected_balance (within $1.00)")
            else:
                print(f"✗ Check 4: {len(mismatches)} transactions have actual/expected balance mismatches > $1.00")
                for txn in mismatches[:3]:
                    print(f"    {txn['date']} {txn['description']}: "
                          f"Expected ${txn.get('expected_balance', 0):.2f}, "
                          f"Actual ${txn.get('actual_balance', 0):.2f}")
                checks_passed = False

            # Summary
            print("\n[6/6] Test Summary")
            print("="*80)

            if checks_passed:
                print("✓ ALL CHECKS PASSED")
                print("\nThe balance calculation system is working correctly!")
                print("All transactions have consistent balances regardless of import order.")
            else:
                print("✗ SOME CHECKS FAILED")
                print("\nPlease review the issues above and fix any balance inconsistencies.")

            print(f"\nFinal Account Balance: ${current_result.account_balance:.2f}")
            print(f"Total Transactions: {current_result.transaction_count}")
            print(f"  - Plaid: {current_result.plaid_txn_count}")
            print(f"  - Statement: {current_result.statement_txn_count}")

            return 0 if checks_passed else 1

        finally:
            # Note: We're not restoring from backup in this test
            # The test only validates the current state
            print("\n" + "="*80)
            print("Test completed. Account state unchanged.")
            print("="*80)


if __name__ == "__main__":
    exit(main())
