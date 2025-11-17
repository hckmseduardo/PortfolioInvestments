-- Migration: Add first_plaid_transaction_date field to accounts table
-- Date: 2025-11-16
-- Description: Adds first_plaid_transaction_date column to track the earliest transaction date imported from Plaid

-- Add first_plaid_transaction_date column (nullable)
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS first_plaid_transaction_date TIMESTAMP WITHOUT TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN accounts.first_plaid_transaction_date IS 'First transaction date imported from Plaid during full sync';
