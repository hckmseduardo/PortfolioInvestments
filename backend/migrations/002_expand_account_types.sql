-- Migration: Expand account types to support all Plaid account types
-- Date: 2025-11-12
-- Description: Adds new account types including loans, retirement accounts, and specialized accounts

-- PostgreSQL requires recreating the enum type to add new values
-- We'll do this by:
-- 1. Creating a new enum type with all values
-- 2. Altering the column to use the new type
-- 3. Dropping the old type

-- Create new enum type with all account types
CREATE TYPE accounttypeenum_new AS ENUM (
    -- Depository accounts
    'checking',
    'savings',
    'money_market',
    'cd',
    'cash_management',
    'prepaid',
    'paypal',
    'hsa',
    'ebt',

    -- Credit accounts
    'credit_card',

    -- Loan accounts
    'mortgage',
    'auto_loan',
    'student_loan',
    'home_equity',
    'personal_loan',
    'business_loan',
    'line_of_credit',

    -- Investment & Retirement accounts
    'investment',
    'brokerage',
    '401k',
    '403b',
    '457b',
    '529',
    'ira',
    'roth_ira',
    'sep_ira',
    'simple_ira',
    'pension',
    'stock_plan',

    -- Canadian retirement accounts
    'tfsa',
    'rrsp',
    'rrif',
    'resp',
    'rdsp',
    'lira',

    -- Other specialized accounts
    'crypto',
    'mutual_fund',
    'annuity',
    'life_insurance',
    'trust',

    -- Catch-all
    'other'
);

-- Alter the accounts table to use the new enum type
-- Convert uppercase values to lowercase during migration
ALTER TABLE accounts
    ALTER COLUMN account_type TYPE accounttypeenum_new
    USING LOWER(account_type::text)::accounttypeenum_new;

-- Drop the old enum type
DROP TYPE accounttypeenum;

-- Rename the new enum type to the original name
ALTER TYPE accounttypeenum_new RENAME TO accounttypeenum;

-- Add comment for documentation
COMMENT ON TYPE accounttypeenum IS 'Expanded account types supporting all Plaid account categories including depository, credit, loan, investment, and specialized accounts';
