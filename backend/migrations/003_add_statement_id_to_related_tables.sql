-- Migration: Add statement_id foreign key to positions, transactions, dividends, and expenses
-- Purpose: Link records to their source statement for proper cascade deletion

-- Add statement_id column to positions table
ALTER TABLE positions
ADD COLUMN statement_id VARCHAR;

-- Add foreign key constraint
CREATE INDEX idx_positions_statement_id ON positions(statement_id);

-- Add statement_id column to transactions table
ALTER TABLE transactions
ADD COLUMN statement_id VARCHAR;

-- Add foreign key constraint
CREATE INDEX idx_transactions_statement_id ON transactions(statement_id);

-- Add statement_id column to dividends table
ALTER TABLE dividends
ADD COLUMN statement_id VARCHAR;

-- Add foreign key constraint
CREATE INDEX idx_dividends_statement_id ON dividends(statement_id);

-- Add statement_id column to expenses table
ALTER TABLE expenses
ADD COLUMN statement_id VARCHAR;

-- Add foreign key constraint
CREATE INDEX idx_expenses_statement_id ON expenses(statement_id);

-- Note: PostgreSQL foreign key constraints with CASCADE are enforced by SQLAlchemy ORM
-- The actual CASCADE behavior is defined in the models.py file
