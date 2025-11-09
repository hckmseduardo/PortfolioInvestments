-- Migration: Add Microsoft Entra ID Authentication Support
-- Version: 001
-- Date: 2025-11-09
-- Description: Adds columns to support Microsoft Entra ID authentication and account linking

BEGIN;

-- Make hashed_password nullable to support Entra-only users
ALTER TABLE users
  ALTER COLUMN hashed_password DROP NOT NULL;

-- Add authentication provider tracking
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'local' NOT NULL;

-- Add Microsoft Entra ID fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS entra_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS entra_tenant_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS entra_email_verified BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS entra_linked_at TIMESTAMP;

-- Add account linking fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_linked BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP;

-- Add Two-Factor Authentication fields (if not already present from previous migrations)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS two_factor_backup_codes TEXT;

-- Create unique index on entra_id (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_entra_id
  ON users(entra_id) WHERE entra_id IS NOT NULL;

-- Create index on auth_provider for faster queries
CREATE INDEX IF NOT EXISTS idx_users_auth_provider
  ON users(auth_provider);

-- Update existing users to have 'local' auth provider
UPDATE users
  SET auth_provider = 'local'
  WHERE auth_provider IS NULL OR auth_provider = '';

-- Add comment to the table
COMMENT ON TABLE users IS 'User accounts supporting both local and Microsoft Entra ID authentication';
COMMENT ON COLUMN users.auth_provider IS 'Authentication method: local, entra, or hybrid';
COMMENT ON COLUMN users.entra_id IS 'Microsoft Entra ID Object ID (oid claim from token)';
COMMENT ON COLUMN users.entra_tenant_id IS 'Microsoft Entra ID Tenant ID';
COMMENT ON COLUMN users.entra_email_verified IS 'Whether email was verified by Entra ID';
COMMENT ON COLUMN users.account_linked IS 'Whether local account is linked to Entra ID';

COMMIT;

-- Rollback script (run separately if needed):
-- BEGIN;
-- ALTER TABLE users ALTER COLUMN hashed_password SET NOT NULL;
-- ALTER TABLE users DROP COLUMN IF EXISTS auth_provider;
-- ALTER TABLE users DROP COLUMN IF EXISTS entra_id;
-- ALTER TABLE users DROP COLUMN IF EXISTS entra_tenant_id;
-- ALTER TABLE users DROP COLUMN IF EXISTS entra_email_verified;
-- ALTER TABLE users DROP COLUMN IF EXISTS entra_linked_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS account_linked;
-- ALTER TABLE users DROP COLUMN IF EXISTS linked_at;
-- DROP INDEX IF EXISTS idx_users_entra_id;
-- DROP INDEX IF EXISTS idx_users_auth_provider;
-- COMMIT;
