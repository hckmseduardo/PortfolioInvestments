-- Migration: Add balance validation fields to transactions table
-- Description: Adds fields to track actual balance, expected balance, and inconsistencies

-- Add balance validation columns to transactions table
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS actual_balance NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS expected_balance NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS has_balance_inconsistency BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS balance_discrepancy NUMERIC(15, 2);

-- Add index for filtering inconsistent transactions
CREATE INDEX IF NOT EXISTS idx_transactions_inconsistency
ON transactions(has_balance_inconsistency)
WHERE has_balance_inconsistency = TRUE;

-- Add index for account_id + date for balance calculation
CREATE INDEX IF NOT EXISTS idx_transactions_account_date
ON transactions(account_id, date);

-- Add comment for documentation
COMMENT ON COLUMN transactions.actual_balance IS 'Balance reported by source (Plaid, statement, etc.) after this transaction';
COMMENT ON COLUMN transactions.expected_balance IS 'Calculated balance based on previous balance + transaction total';
COMMENT ON COLUMN transactions.has_balance_inconsistency IS 'TRUE if abs(expected_balance - actual_balance) > $1.00';
COMMENT ON COLUMN transactions.balance_discrepancy IS 'Difference between expected and actual balance (expected - actual)';
