-- Migration: Add foreign key constraints for statement_id columns with CASCADE DELETE
-- Purpose: Ensure that deleting a statement automatically deletes all related data

-- Add foreign key constraint for positions.statement_id
ALTER TABLE positions
ADD CONSTRAINT positions_statement_id_fkey
FOREIGN KEY (statement_id)
REFERENCES statements(id)
ON DELETE CASCADE;

-- Add foreign key constraint for transactions.statement_id
ALTER TABLE transactions
ADD CONSTRAINT transactions_statement_id_fkey
FOREIGN KEY (statement_id)
REFERENCES statements(id)
ON DELETE CASCADE;

-- Add foreign key constraint for dividends.statement_id
ALTER TABLE dividends
ADD CONSTRAINT dividends_statement_id_fkey
FOREIGN KEY (statement_id)
REFERENCES statements(id)
ON DELETE CASCADE;

-- Add foreign key constraint for expenses.statement_id
ALTER TABLE expenses
ADD CONSTRAINT expenses_statement_id_fkey
FOREIGN KEY (statement_id)
REFERENCES statements(id)
ON DELETE CASCADE;
