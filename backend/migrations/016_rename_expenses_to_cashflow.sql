-- Migration: Rename expenses table to cashflow
-- Date: 2025-11-17

-- Rename the table
ALTER TABLE expenses RENAME TO cashflow;

-- Rename indexes to match new table name
ALTER INDEX idx_expenses_account_id RENAME TO idx_cashflow_account_id;
ALTER INDEX idx_expenses_statement_id RENAME TO idx_cashflow_statement_id;
ALTER INDEX idx_expenses_transaction_id RENAME TO idx_cashflow_transaction_id;
ALTER INDEX idx_expenses_date RENAME TO idx_cashflow_date;
ALTER INDEX idx_expenses_type RENAME TO idx_cashflow_type;
ALTER INDEX idx_expenses_category RENAME TO idx_cashflow_category;
ALTER INDEX idx_expenses_paired_transaction_id RENAME TO idx_cashflow_paired_transaction_id;
ALTER INDEX idx_expenses_paired_account_id RENAME TO idx_cashflow_paired_account_id;
ALTER INDEX idx_expenses_pfc_primary RENAME TO idx_cashflow_pfc_primary;
ALTER INDEX idx_expenses_pfc_detailed RENAME TO idx_cashflow_pfc_detailed;

-- Rename foreign key constraints
ALTER TABLE cashflow DROP CONSTRAINT expenses_account_id_fkey;
ALTER TABLE cashflow ADD CONSTRAINT cashflow_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE cashflow DROP CONSTRAINT expenses_statement_id_fkey;
ALTER TABLE cashflow ADD CONSTRAINT cashflow_statement_id_fkey
    FOREIGN KEY (statement_id) REFERENCES statements(id) ON DELETE CASCADE;

ALTER TABLE cashflow DROP CONSTRAINT expenses_transaction_id_fkey;
ALTER TABLE cashflow ADD CONSTRAINT cashflow_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

-- Backfill type field from transactions table for existing records
UPDATE cashflow
SET type = t.type
FROM transactions t
WHERE cashflow.transaction_id = t.id
  AND cashflow.type IS NULL;
