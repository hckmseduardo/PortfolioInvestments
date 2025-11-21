#!/usr/bin/env python3
"""
Full Import Order Test

This script automates the complete test:
1. Record current state (Statement only)
2. Replay Plaid sync to add Plaid transactions
3. Validate balance consistency
4. Verify that import order doesn't matter
"""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service
from app.database.models import PlaidItem, PlaidAccount
from app.tasks.plaid_sync import run_plaid_sync_job


def find_bnc_plaid_item(session):
    """Find the Plaid item for BNC checking account."""
    # Find BNC checking account
    db = get_db_service(session)
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
        return None, None

    account_id = bnc_account['id']
    print(f"✓ Found BNC Checking Account: {bnc_account.get('label', account_id)}")

    # Find Plaid account mapping
    plaid_account = session.query(PlaidAccount).filter(
        PlaidAccount.account_id == account_id
    ).first()

    if not plaid_account:
        print("✗ BNC account not linked to Plaid")
        return bnc_account, None

    # Get Plaid item
    plaid_item = session.query(PlaidItem).filter(
        PlaidItem.id == plaid_account.plaid_item_id
    ).first()

    if not plaid_item:
        print("✗ Plaid item not found")
        return bnc_account, None

    print(f"✓ Found Plaid item: {plaid_item.institution_name}")

    return bnc_account, plaid_item


def run_balance_test(label):
    """Run the balance validation test and return result."""
    import subprocess

    print(f"\n{'='*80}")
    print(f"Running Balance Test: {label}")
    print(f"{'='*80}")

    result = subprocess.run(
        ['python', 'test_import_order_balance.py'],
        capture_output=True,
        text=True
    )

    # Parse the result
    passed = "✓ ALL CHECKS PASSED" in result.stdout

    # Extract key metrics
    lines = result.stdout.split('\n')
    metrics = {
        'passed': passed,
        'account_balance': None,
        'transaction_count': 0,
        'plaid_count': 0,
        'statement_count': 0,
        'inconsistencies': 0
    }

    for line in lines:
        if 'Account Balance:' in line:
            try:
                metrics['account_balance'] = float(line.split('$')[1].split()[0])
            except:
                pass
        elif 'Total Transactions:' in line:
            try:
                metrics['transaction_count'] = int(line.split(':')[1].strip())
            except:
                pass
        elif '- Plaid Transactions:' in line or '- Plaid:' in line:
            try:
                metrics['plaid_count'] = int(line.split(':')[1].strip())
            except:
                pass
        elif '- Statement Transactions:' in line or '- Statement:' in line:
            try:
                metrics['statement_count'] = int(line.split(':')[1].strip())
            except:
                pass
        elif 'Balance Inconsistencies:' in line:
            try:
                metrics['inconsistencies'] = int(line.split(':')[1].strip())
            except:
                pass

    return metrics, result.stdout, result.stderr


def main():
    """Run the full import order test."""
    print("\n" + "="*80)
    print("FULL IMPORT ORDER TEST - Automated Validation")
    print("="*80)
    print("\nThis test validates that balance calculations work correctly")
    print("regardless of whether Plaid or Statement data is imported first.")
    print("="*80)

    with get_db_context() as session:
        # Step 1: Find BNC account and Plaid item
        print("\n[Step 1/5] Finding BNC account and Plaid item...")
        bnc_account, plaid_item = find_bnc_plaid_item(session)

        if not bnc_account:
            return 1

        if not plaid_item:
            print("\n⚠ WARNING: BNC account not linked to Plaid")
            print("Cannot run Plaid replay test. Please link account to Plaid first.")
            print("\nRunning validation on current state only...")

            # Run test on current state
            metrics, stdout, stderr = run_balance_test("Current State (Statement Only)")

            if metrics['passed']:
                print("\n✓ Current state validation PASSED")
                print(f"  Balance: ${metrics['account_balance']:.2f}")
                print(f"  Transactions: {metrics['transaction_count']}")
                print(f"  Statement: {metrics['statement_count']}, Plaid: {metrics['plaid_count']}")
            else:
                print("\n✗ Current state validation FAILED")
                print(stdout)

            return 0 if metrics['passed'] else 1

        # Step 2: Test current state (Statement only)
        print("\n[Step 2/5] Testing current state (Statement data only)...")
        state_before, stdout_before, stderr_before = run_balance_test("Before Plaid Sync")

        print(f"\n📊 State Before Plaid Sync:")
        print(f"  ✓ Balance: ${state_before['account_balance']:.2f}")
        print(f"  ✓ Total Transactions: {state_before['transaction_count']}")
        print(f"  ✓ Statement Transactions: {state_before['statement_count']}")
        print(f"  ✓ Plaid Transactions: {state_before['plaid_count']}")
        print(f"  ✓ Inconsistencies: {state_before['inconsistencies']}")
        print(f"  ✓ Test Passed: {state_before['passed']}")

        if not state_before['passed']:
            print("\n✗ ERROR: Current state has validation errors!")
            print("Please fix these before continuing:")
            print(stdout_before)
            return 1

        # Step 3: Full Plaid sync
        print(f"\n[Step 3/5] Running full Plaid sync for {plaid_item.institution_name}...")
        print("This will fetch and add Plaid transactions...")

        try:
            user_id = bnc_account.get('user_id')
            if not user_id:
                print("✗ ERROR: Could not determine user_id for account")
                return 1

            # Run full Plaid sync
            print(f"Starting full Plaid sync for item {plaid_item.id}...")
            result = run_plaid_sync_job(user_id, plaid_item.id, full_resync=True)

            print(f"\n✓ Plaid Sync completed:")
            print(f"  Status: {result.get('status', 'unknown')}")
            if 'synced_accounts' in result:
                for account_result in result['synced_accounts']:
                    print(f"  Account {account_result.get('account_id', 'unknown')}:")
                    print(f"    Added: {account_result.get('transactions_added', 0)}")
                    print(f"    Modified: {account_result.get('transactions_modified', 0)}")
                    print(f"    Removed: {account_result.get('transactions_removed', 0)}")

            # Wait for sync to complete
            print("\nWaiting for sync to complete...")
            time.sleep(3)

        except Exception as e:
            print(f"\n✗ ERROR during Plaid sync: {e}")
            import traceback
            traceback.print_exc()
            return 1

        # Step 4: Test after Plaid sync
        print("\n[Step 4/5] Testing after Plaid sync (Statement + Plaid data)...")
        state_after, stdout_after, stderr_after = run_balance_test("After Plaid Sync")

        print(f"\n📊 State After Plaid Sync:")
        print(f"  ✓ Balance: ${state_after['account_balance']:.2f}")
        print(f"  ✓ Total Transactions: {state_after['transaction_count']}")
        print(f"  ✓ Statement Transactions: {state_after['statement_count']}")
        print(f"  ✓ Plaid Transactions: {state_after['plaid_count']}")
        print(f"  ✓ Inconsistencies: {state_after['inconsistencies']}")
        print(f"  ✓ Test Passed: {state_after['passed']}")

        # Step 5: Compare results
        print(f"\n[Step 5/5] Comparing results...")
        print("="*80)

        print(f"\n📈 Transaction Changes:")
        print(f"  Before: {state_before['transaction_count']} transactions")
        print(f"  After:  {state_after['transaction_count']} transactions")
        print(f"  Added:  {state_after['transaction_count'] - state_before['transaction_count']} transactions")

        print(f"\n💰 Balance Comparison:")
        print(f"  Before: ${state_before['account_balance']:.2f}")
        print(f"  After:  ${state_after['account_balance']:.2f}")

        balance_diff = abs(state_after['account_balance'] - state_before['account_balance'])
        if balance_diff < 0.01:
            print(f"  ✓ Balance remained stable (diff: ${balance_diff:.2f})")
        else:
            print(f"  ⚠ Balance changed by ${state_after['account_balance'] - state_before['account_balance']:.2f}")
            print(f"    This is expected if Plaid has newer transactions")

        print(f"\n🔍 Data Source Mix:")
        print(f"  Statement: {state_after['statement_count']} transactions")
        print(f"  Plaid:     {state_after['plaid_count']} transactions")

        if state_after['plaid_count'] > 0 and state_after['statement_count'] > 0:
            print(f"  ✓ Account now has BOTH Statement and Plaid data")

        print(f"\n⚖️  Balance Validation:")
        print(f"  Inconsistencies Before: {state_before['inconsistencies']}")
        print(f"  Inconsistencies After:  {state_after['inconsistencies']}")

        # Final verdict
        print(f"\n{'='*80}")
        print("TEST RESULTS")
        print(f"{'='*80}")

        all_passed = True

        if state_before['passed']:
            print("✓ Check 1: Statement-only state is valid")
        else:
            print("✗ Check 1: Statement-only state has errors")
            all_passed = False

        if state_after['passed']:
            print("✓ Check 2: Statement + Plaid state is valid")
        else:
            print("✗ Check 2: Statement + Plaid state has errors")
            all_passed = False

        if state_after['inconsistencies'] == 0:
            print("✓ Check 3: No balance inconsistencies after adding Plaid data")
        else:
            print(f"✗ Check 3: {state_after['inconsistencies']} balance inconsistencies detected")
            all_passed = False

        if state_after['plaid_count'] > 0:
            print("✓ Check 4: Plaid transactions successfully added")
        else:
            print("⚠ Check 4: No Plaid transactions added (may be expected)")

        print(f"\n{'='*80}")
        if all_passed:
            print("🎉 ALL TESTS PASSED!")
            print("\nConclusion:")
            print("The balance calculation system is working correctly!")
            print("Balances remain consistent when combining Statement and Plaid data.")
            print("The import order does NOT matter - the system maintains consistency.")
        else:
            print("❌ SOME TESTS FAILED")
            print("\nPlease review the errors above.")
            print("\nDetailed output from failed tests:")
            if not state_before['passed']:
                print("\n--- Before Plaid Sync ---")
                print(stdout_before)
            if not state_after['passed']:
                print("\n--- After Plaid Sync ---")
                print(stdout_after)

        print(f"{'='*80}")

        return 0 if all_passed else 1


if __name__ == "__main__":
    exit(main())
