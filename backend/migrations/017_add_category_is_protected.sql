-- Migration: Add is_protected field to categories table
-- Date: 2025-11-18
-- Description: Add boolean field to mark special categories (Dividends, Interest, Bonus) as protected from renaming

-- Add is_protected column to categories table (default FALSE)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark Dividends, Interest, Bonus, Salary, Tax Refund, and Insurance Refund categories as protected
-- These categories are special income categories that should not be renamed by users
UPDATE categories
SET is_protected = TRUE
WHERE name IN ('Dividends', 'Interest', 'Bonus', 'Salary', 'Tax Refund', 'Insurance Refund');

-- Add comment to document the purpose
COMMENT ON COLUMN categories.is_protected IS 'Protected categories cannot be renamed by users. Used for special system categories like Dividends, Interest, Bonus, Salary, Tax Refund, and Insurance Refund.';
