-- Migration: Add Plaid Personal Finance Category (PFC) fields
-- Date: 2025-11-12
-- Description: Adds PFC fields to transactions and expenses for better categorization

-- Add PFC columns to transactions table
ALTER TABLE transactions ADD COLUMN pfc_primary VARCHAR(100);
ALTER TABLE transactions ADD COLUMN pfc_detailed VARCHAR(100);
ALTER TABLE transactions ADD COLUMN pfc_confidence VARCHAR(20);

-- Add PFC columns to expenses table
ALTER TABLE expenses ADD COLUMN pfc_primary VARCHAR(100);
ALTER TABLE expenses ADD COLUMN pfc_detailed VARCHAR(100);
ALTER TABLE expenses ADD COLUMN pfc_confidence VARCHAR(20);

-- Add indexes for better query performance
CREATE INDEX idx_transactions_pfc_primary ON transactions(pfc_primary);
CREATE INDEX idx_transactions_pfc_detailed ON transactions(pfc_detailed);
CREATE INDEX idx_expenses_pfc_primary ON expenses(pfc_primary);
CREATE INDEX idx_expenses_pfc_detailed ON expenses(pfc_detailed);

-- Add comments for documentation
COMMENT ON COLUMN transactions.pfc_primary IS 'Plaid Personal Finance Category - Primary category (e.g., FOOD_AND_DRINK, TRANSPORTATION)';
COMMENT ON COLUMN transactions.pfc_detailed IS 'Plaid Personal Finance Category - Detailed category (e.g., FOOD_AND_DRINK_GROCERIES)';
COMMENT ON COLUMN transactions.pfc_confidence IS 'Plaid categorization confidence level (VERY_HIGH, HIGH, MEDIUM, LOW, UNKNOWN)';
COMMENT ON COLUMN expenses.pfc_primary IS 'Plaid Personal Finance Category - Primary category (e.g., FOOD_AND_DRINK, TRANSPORTATION)';
COMMENT ON COLUMN expenses.pfc_detailed IS 'Plaid Personal Finance Category - Detailed category (e.g., FOOD_AND_DRINK_GROCERIES)';
COMMENT ON COLUMN expenses.pfc_confidence IS 'Plaid categorization confidence level (VERY_HIGH, HIGH, MEDIUM, LOW, UNKNOWN)';
