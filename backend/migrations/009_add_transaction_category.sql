-- Add transaction category classification field
-- Based on Definitions.MD transaction classification system

BEGIN;

-- Add category column to transactions table
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Add index for filtering/querying by category
CREATE INDEX IF NOT EXISTS ix_transactions_category ON transactions(category);

-- Add comment explaining the field
COMMENT ON COLUMN transactions.category IS 'Transaction category: Income, Salary, Transfer, Investment, Purchase, or Other (based on Definitions.MD)';

COMMIT;

-- Rollback instructions (commented out):
-- BEGIN;
-- DROP INDEX IF EXISTS ix_transactions_category;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS category;
-- COMMIT;
