-- Migration: Add Plaid Integration Support
-- Date: 2025-11-09
-- Description: Adds tables and columns for Plaid bank account integration

BEGIN;

-- Add is_plaid_linked column to accounts table
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS is_plaid_linked INTEGER DEFAULT 0 NOT NULL;

COMMENT ON COLUMN accounts.is_plaid_linked IS '0 = not linked, 1 = Plaid linked';

-- Add source and plaid_transaction_id columns to transactions table
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual' NOT NULL,
ADD COLUMN IF NOT EXISTS plaid_transaction_id VARCHAR NULL;

-- Create index on source column for filtering
CREATE INDEX IF NOT EXISTS ix_transactions_source ON transactions(source);

-- Create unique index on plaid_transaction_id for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS ix_transactions_plaid_transaction_id
ON transactions(plaid_transaction_id)
WHERE plaid_transaction_id IS NOT NULL;

COMMENT ON COLUMN transactions.source IS 'Transaction source: manual, plaid, or import';
COMMENT ON COLUMN transactions.plaid_transaction_id IS 'Plaid transaction ID for deduplication';

-- Create plaid_items table
CREATE TABLE IF NOT EXISTS plaid_items (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token VARCHAR NOT NULL,
    item_id VARCHAR NOT NULL,
    institution_id VARCHAR NOT NULL,
    institution_name VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_synced TIMESTAMP NULL,
    error_message TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_plaid_items_user_id ON plaid_items(user_id);
CREATE INDEX IF NOT EXISTS ix_plaid_items_status ON plaid_items(status);

COMMENT ON TABLE plaid_items IS 'Plaid bank connection items';
COMMENT ON COLUMN plaid_items.access_token IS 'Plaid access token (encrypt in production)';
COMMENT ON COLUMN plaid_items.status IS 'Status: active, error, disconnected';

-- Create plaid_accounts table
CREATE TABLE IF NOT EXISTS plaid_accounts (
    id VARCHAR PRIMARY KEY,
    plaid_item_id VARCHAR NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
    account_id VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plaid_account_id VARCHAR NOT NULL,
    mask VARCHAR NULL,
    name VARCHAR NOT NULL,
    official_name VARCHAR NULL,
    type VARCHAR NOT NULL,
    subtype VARCHAR NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_plaid_accounts_plaid_item_id ON plaid_accounts(plaid_item_id);
CREATE INDEX IF NOT EXISTS ix_plaid_accounts_account_id ON plaid_accounts(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_plaid_accounts_plaid_account_id ON plaid_accounts(plaid_account_id);

COMMENT ON TABLE plaid_accounts IS 'Mapping between Plaid accounts and app accounts';

-- Create plaid_sync_cursors table
CREATE TABLE IF NOT EXISTS plaid_sync_cursors (
    id VARCHAR PRIMARY KEY,
    plaid_item_id VARCHAR NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
    cursor VARCHAR NOT NULL,
    last_sync TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_plaid_sync_cursors_plaid_item_id ON plaid_sync_cursors(plaid_item_id);

COMMENT ON TABLE plaid_sync_cursors IS 'Cursors for incremental Plaid transaction syncing';
COMMENT ON COLUMN plaid_sync_cursors.cursor IS 'Plaid sync cursor for /transactions/sync endpoint';

COMMIT;

-- Rollback script (if needed):
-- BEGIN;
-- DROP TABLE IF EXISTS plaid_sync_cursors CASCADE;
-- DROP TABLE IF EXISTS plaid_accounts CASCADE;
-- DROP TABLE IF EXISTS plaid_items CASCADE;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS plaid_transaction_id;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS source;
-- ALTER TABLE accounts DROP COLUMN IF EXISTS is_plaid_linked;
-- COMMIT;
