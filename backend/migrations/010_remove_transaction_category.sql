-- Remove transaction category field
-- Simplify classification to only Type (Money In/Money Out)

BEGIN;

-- Drop index first
DROP INDEX IF EXISTS ix_transactions_category;

-- Drop category column from transactions table
ALTER TABLE transactions
DROP COLUMN IF EXISTS category;

COMMIT;

-- Rollback instructions (commented out):
-- BEGIN;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category VARCHAR(50);
-- CREATE INDEX IF NOT EXISTS ix_transactions_category ON transactions(category);
-- COMMIT;
