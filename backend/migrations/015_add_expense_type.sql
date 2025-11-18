-- Add type field to expenses table to store transaction type (Money In or Money Out)
-- This allows filtering expenses by type without joining to transactions table

-- Add the type column
ALTER TABLE expenses
ADD COLUMN type VARCHAR(20);

-- Create an index for better query performance
CREATE INDEX idx_expenses_type ON expenses(type);

-- Backfill existing expenses with type from linked transactions
UPDATE expenses e
SET type = t.type::text
FROM transactions t
WHERE e.transaction_id = t.id
AND e.type IS NULL;

-- For expenses without linked transactions (manually created), default to Money Out
UPDATE expenses
SET type = 'Money Out'
WHERE type IS NULL;
