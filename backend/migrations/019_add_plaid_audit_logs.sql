-- Migration: Add Plaid audit logs table
-- Date: 2025-11-20
-- Description: Create table to store audit logs of all Plaid API interactions

CREATE TABLE IF NOT EXISTS plaid_audit_logs (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    plaid_item_id VARCHAR,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    endpoint VARCHAR NOT NULL,
    sync_type VARCHAR,
    method VARCHAR NOT NULL,
    status_code INTEGER,
    duration_ms INTEGER,
    request_params JSONB,
    response_summary JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_plaid_item
        FOREIGN KEY (plaid_item_id)
        REFERENCES plaid_items(id)
        ON DELETE CASCADE
);

-- Create indexes for faster lookups
CREATE INDEX idx_plaid_audit_logs_user_id ON plaid_audit_logs(user_id);
CREATE INDEX idx_plaid_audit_logs_plaid_item_id ON plaid_audit_logs(plaid_item_id);
CREATE INDEX idx_plaid_audit_logs_timestamp ON plaid_audit_logs(timestamp DESC);
CREATE INDEX idx_plaid_audit_logs_endpoint ON plaid_audit_logs(endpoint);

-- Add comments to document the purpose
COMMENT ON TABLE plaid_audit_logs IS 'Audit logs of all Plaid API interactions for compliance and debugging';
COMMENT ON COLUMN plaid_audit_logs.endpoint IS 'Plaid API endpoint called (e.g., /transactions/sync, /link/token/create)';
COMMENT ON COLUMN plaid_audit_logs.sync_type IS 'Type of sync operation (e.g., incremental, full_resync, initial)';
COMMENT ON COLUMN plaid_audit_logs.method IS 'HTTP method (GET, POST, etc.)';
COMMENT ON COLUMN plaid_audit_logs.duration_ms IS 'Request duration in milliseconds';
COMMENT ON COLUMN plaid_audit_logs.request_params IS 'Sanitized request parameters (sensitive data removed)';
COMMENT ON COLUMN plaid_audit_logs.response_summary IS 'Summary of response data (transaction counts, etc.)';
