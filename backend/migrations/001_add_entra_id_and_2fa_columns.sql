-- Migration: Add Entra ID and Two-Factor Authentication columns to users table
-- Date: 2025-11-09

BEGIN;

-- Make hashed_password nullable for Entra-only users
ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL;

-- Add authentication provider tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR DEFAULT 'local' NOT NULL;

-- Add Microsoft Entra ID fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS entra_id VARCHAR UNIQUE;
CREATE INDEX IF NOT EXISTS ix_users_entra_id ON users(entra_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS entra_tenant_id VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS entra_email_verified BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS entra_linked_at TIMESTAMP;

-- Add account linking fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP;

-- Add two-factor authentication fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes TEXT;

-- Drop the migrated_from_json column (no longer needed)
ALTER TABLE users DROP COLUMN IF EXISTS migrated_from_json;

COMMIT;
