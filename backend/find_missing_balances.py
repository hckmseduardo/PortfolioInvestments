#!/usr/bin/env python3
from app.database.postgres_db import get_db_context
from app.database.models import Transaction

with get_db_context() as session:
    txns = session.query(Transaction).filter(
        Transaction.account_id == '0518a74f-8544-449f-b1aa-12d805734567',
        Transaction.expected_balance == None
    ).all()

    print(f'Found {len(txns)} transactions without expected_balance:')
    for txn in txns:
        print(f'  ID: {txn.id}')
        print(f'  Date: {txn.date}')
        print(f'  Description: {txn.description[:50] if txn.description else "N/A"}')
        print(f'  Total: ${txn.total}')
        print()
