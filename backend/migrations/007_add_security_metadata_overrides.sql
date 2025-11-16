-- Add security metadata overrides table
-- This allows users to customize metadata for specific securities

CREATE TABLE IF NOT EXISTS security_metadata_overrides (
    id VARCHAR PRIMARY KEY,
    ticker VARCHAR NOT NULL,
    security_name VARCHAR NOT NULL,
    custom_type VARCHAR(50),
    custom_subtype VARCHAR(50),
    custom_sector VARCHAR(100),
    custom_industry VARCHAR(100),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(ticker, security_name)
);

CREATE INDEX IF NOT EXISTS ix_security_overrides_ticker ON security_metadata_overrides(ticker);

COMMENT ON TABLE security_metadata_overrides IS 'User-defined overrides for security metadata that persist across syncs';
COMMENT ON COLUMN security_metadata_overrides.ticker IS 'Security ticker symbol';
COMMENT ON COLUMN security_metadata_overrides.security_name IS 'Security name for uniqueness';
COMMENT ON COLUMN security_metadata_overrides.custom_type IS 'Custom security type override';
COMMENT ON COLUMN security_metadata_overrides.custom_subtype IS 'Custom security subtype override';
COMMENT ON COLUMN security_metadata_overrides.custom_sector IS 'Custom sector override';
COMMENT ON COLUMN security_metadata_overrides.custom_industry IS 'Custom industry override';
