-- Remove stock-related fields from transactions table
-- Simplify transactions to only track basic transaction info

BEGIN;

-- Drop ticker column
ALTER TABLE transactions
DROP COLUMN IF EXISTS ticker;

-- Drop quantity column
ALTER TABLE transactions
DROP COLUMN IF EXISTS quantity;

-- Drop price column
ALTER TABLE transactions
DROP COLUMN IF EXISTS price;

-- Drop fees column
ALTER TABLE transactions
DROP COLUMN IF EXISTS fees;

COMMIT;

-- Rollback instructions (commented out):
-- BEGIN;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ticker VARCHAR(50);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quantity FLOAT;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS price FLOAT;
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fees FLOAT DEFAULT 0.0 NOT NULL;
-- COMMIT;
