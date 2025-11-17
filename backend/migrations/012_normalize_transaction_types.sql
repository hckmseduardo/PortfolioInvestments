-- Normalize all transaction types to "Money In" or "Money Out" based on amount
-- Per Definitions.MD: Money In = positive values, Money Out = negative values

-- Step 1: Add new enum values to the existing enum type
-- Must be in a separate transaction and committed before use
ALTER TYPE transactiontypeenum ADD VALUE IF NOT EXISTS 'Money In';
ALTER TYPE transactiontypeenum ADD VALUE IF NOT EXISTS 'Money Out';

-- Step 2: Update all transactions: set type based on total amount
-- This must be in a separate statement after the enum values are committed
BEGIN;

UPDATE transactions
SET type = (CASE
    WHEN total > 0 THEN 'Money In'
    WHEN total < 0 THEN 'Money Out'
    ELSE 'Money Out'  -- Default for zero amounts
END)::transactiontypeenum;

COMMIT;

-- Note: We cannot remove the old enum values in the same transaction as adding new ones
-- because PostgreSQL doesn't support removing enum values
-- The old values (BUY, SELL, etc.) will remain in the enum type but won't be used

-- Rollback instructions (commented out):
-- This migration cannot be easily rolled back as it loses the original transaction type information
-- To rollback, you would need to restore from a backup made before running this migration
