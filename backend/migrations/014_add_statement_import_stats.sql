-- Migration: Add import statistics to statements table
-- Date: 2025-11-16
-- Description: Adds transactions_created and transactions_skipped columns to track import statistics

-- Add transactions_created column (number of transactions successfully imported)
ALTER TABLE statements
ADD COLUMN IF NOT EXISTS transactions_created INTEGER NOT NULL DEFAULT 0;

-- Add transactions_skipped column (number of transactions skipped/ignored)
ALTER TABLE statements
ADD COLUMN IF NOT EXISTS transactions_skipped INTEGER NOT NULL DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN statements.transactions_created IS 'Number of transactions successfully imported from this statement';
COMMENT ON COLUMN statements.transactions_skipped IS 'Number of transactions skipped/ignored during import (duplicates, outside date range, etc.)';

-- Optionally initialize values for existing records (set transactions_created = transactions_count for existing statements)
UPDATE statements
SET transactions_created = transactions_count
WHERE transactions_created = 0 AND transactions_count > 0;
