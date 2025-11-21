-- Migration: Add investment support tracking fields to plaid_items table
-- Date: 2025-01-18
-- Description: Add fields to track whether institutions support investments and if users have enabled it

-- Add investment tracking fields to plaid_items
ALTER TABLE plaid_items
ADD COLUMN IF NOT EXISTS supports_investments BOOLEAN DEFAULT FALSE NOT NULL;

ALTER TABLE plaid_items
ADD COLUMN IF NOT EXISTS investments_enabled BOOLEAN DEFAULT FALSE NOT NULL;

ALTER TABLE plaid_items
ADD COLUMN IF NOT EXISTS investments_enabled_at TIMESTAMP;

-- Add comment for documentation
COMMENT ON COLUMN plaid_items.supports_investments IS 'Whether the Plaid institution supports the investments product';
COMMENT ON COLUMN plaid_items.investments_enabled IS 'Whether the user has enabled investment tracking for this connection';
COMMENT ON COLUMN plaid_items.investments_enabled_at IS 'Timestamp when investments were enabled';
