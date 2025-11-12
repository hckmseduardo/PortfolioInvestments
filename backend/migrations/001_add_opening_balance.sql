-- Migration: Add opening_balance fields to accounts table
-- Date: 2025-11-11
-- Description: Adds opening_balance and opening_balance_date columns to track account starting balances

-- Add opening_balance column (nullable)
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS opening_balance DOUBLE PRECISION;

-- Add opening_balance_date column (nullable)
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS opening_balance_date TIMESTAMP WITHOUT TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN accounts.opening_balance IS 'Starting balance before the oldest transaction';
COMMENT ON COLUMN accounts.opening_balance_date IS 'Date of the opening balance';
