#!/usr/bin/env python3
from app.database.postgres_db import get_db_context

with get_db_context() as db:
    # Query transactions for NBC account with plaid_transaction_id in August 2025
    result = db.execute('''
        SELECT
            date,
            description,
            total,
            plaid_transaction_id IS NOT NULL as is_plaid,
            statement_id IS NOT NULL as is_statement
        FROM transactions
        WHERE account_id IN (
            SELECT id FROM accounts WHERE institution LIKE '%NBC%' OR institution LIKE '%National%'
        )
        AND date >= '2025-08-15'
        AND date < '2025-09-01'
        ORDER BY date
        LIMIT 30
    ''').fetchall()

    print(f'Found {len(result)} transactions between Aug 15-31, 2025:')
    print('-' * 100)
    for row in result:
        desc = row[1][:40] if row[1] else ''
        print(f'{row[0]} | {desc:40} | ${row[2]:8.2f} | Plaid: {row[3]} | Statement: {row[4]}')
