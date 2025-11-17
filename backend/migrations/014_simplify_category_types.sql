-- Migration: Simplify category types from 4 types to 2 types (money_in, money_out)
-- This migration updates the category.type field to use only 'money_in' and 'money_out'

-- Update existing category types
-- Map: 'income' -> 'money_in'
-- Map: 'expense', 'investment', 'transfer' -> 'money_out'
UPDATE category
SET type = CASE
    WHEN type = 'income' THEN 'money_in'
    WHEN type IN ('expense', 'investment', 'transfer') THEN 'money_out'
    ELSE type
END;

-- Note: We don't need to modify the table structure as we're just changing the values
-- The type column already exists and can accommodate the new values
