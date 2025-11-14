#!/usr/bin/env python3
"""Test script to import a statement and check duplicate detection"""

import sys
sys.path.insert(0, '/Volumes/dados/projects/PortfolioInvestments/backend')

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service
from app.api.import_statements import process_statement_file
from app.models.schemas import User
from sqlalchemy.orm import Session

def main():
    file_path = "/Users/hckmseduardo/Downloads/BNC - Carte de Credit - 2025-11-06-080919.csv"
    account_id = "7ebbb906-3b80-498b-ba0d-09c06fcdf346"

    # Get user (assuming first user for testing)
    with get_db_context() as session:
        db = get_db_service(session)

        # Get account to verify it exists
        account = db.find_one("accounts", {"id": account_id})
        if not account:
            print(f"ERROR: Account {account_id} not found")
            return

        print(f"Account found: {account.get('label')} ({account.get('account_number')})")
        print(f"Current balance: ${account.get('balance')}")
        print(f"Opening balance: ${account.get('opening_balance')}")

        # Get transaction counts before import
        transactions_before = db.find("transactions", {"account_id": account_id})
        plaid_count_before = sum(1 for t in transactions_before if t.get('plaid_transaction_id'))
        statement_count_before = sum(1 for t in transactions_before if t.get('statement_id'))

        print(f"\n=== BEFORE IMPORT ===")
        print(f"Total transactions: {len(transactions_before)}")
        print(f"Plaid transactions: {plaid_count_before}")
        print(f"Statement transactions: {statement_count_before}")

        # Create a fake user object
        user = User(
            id=account.get('user_id'),
            username="test_user",
            email="test@example.com"
        )

        # Process the statement
        print(f"\n=== IMPORTING STATEMENT ===")
        print(f"File: {file_path}")

        try:
            result = process_statement_file(
                file_path=file_path,
                account_id=account_id,
                db=db,
                current_user=user,
                statement_id=None  # Will create a new statement
            )

            session.commit()

            print(f"\n=== IMPORT RESULTS ===")
            print(f"Transactions created: {result['transactions_created']}")
            print(f"Transactions skipped: {result['transactions_skipped']}")
            print(f"Dividends created: {result['dividends_created']}")
            print(f"Positions created: {result['positions_created']}")

            # Get transaction counts after import
            transactions_after = db.find("transactions", {"account_id": account_id})
            plaid_count_after = sum(1 for t in transactions_after if t.get('plaid_transaction_id'))
            statement_count_after = sum(1 for t in transactions_after if t.get('statement_id'))

            print(f"\n=== AFTER IMPORT ===")
            print(f"Total transactions: {len(transactions_after)}")
            print(f"Plaid transactions: {plaid_count_after}")
            print(f"Statement transactions: {statement_count_after}")

            # Get updated account balance
            account_after = db.find_one("accounts", {"id": account_id})
            print(f"\nUpdated balance: ${account_after.get('balance')}")

            # Calculate expected balance
            opening = account_after.get('opening_balance', 0)
            total_txn_sum = sum(t.get('total', 0) for t in transactions_after)
            calculated = opening + total_txn_sum
            print(f"Calculated balance: ${calculated:.2f} (opening: ${opening:.2f} + sum: ${total_txn_sum:.2f})")

            if result.get('balance_validation'):
                print(f"\nBalance validation:")
                print(f"  Status: {result['balance_validation'].get('status')}")
                if result['balance_validation'].get('source_current_balance'):
                    print(f"  Plaid balance: ${result['balance_validation'].get('source_current_balance')}")

        except Exception as e:
            print(f"ERROR during import: {e}")
            import traceback
            traceback.print_exc()
            session.rollback()

if __name__ == "__main__":
    main()
