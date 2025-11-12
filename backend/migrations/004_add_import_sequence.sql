-- Migration: Add import_sequence field to transactions table
-- Description: Adds a sequence number to preserve transaction order from import sources (Plaid, statements)

-- Add import_sequence column to transactions table
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS import_sequence INTEGER;

-- Add composite index for efficient ordering by account + date + sequence
CREATE INDEX IF NOT EXISTS idx_transactions_account_date_sequence
ON transactions(account_id, date, import_sequence);

-- Add comment for documentation
COMMENT ON COLUMN transactions.import_sequence IS 'Preserves the order transactions arrive from import source (Plaid, statements). Used for correct ordering when multiple transactions have the same date.';
