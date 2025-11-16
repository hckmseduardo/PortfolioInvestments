-- Add position snapshots and Plaid holdings metadata
-- This migration adds:
-- 1. New columns to positions table for Plaid holdings data
-- 2. position_snapshots table for historical position tracking

-- Add new columns to positions table for Plaid holdings metadata
ALTER TABLE positions ADD COLUMN IF NOT EXISTS security_type VARCHAR(50);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS security_subtype VARCHAR(50);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS sector VARCHAR(100);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS industry VARCHAR(100);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS institution_price DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS price_as_of TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS sync_date TIMESTAMP WITHOUT TIME ZONE;

-- Create position_snapshots table for historical tracking
CREATE TABLE IF NOT EXISTS position_snapshots (
    id VARCHAR PRIMARY KEY,
    position_id VARCHAR,  -- Reference to current position (can be NULL for deleted positions)
    account_id VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ticker VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    book_value DOUBLE PRECISION NOT NULL,
    market_value DOUBLE PRECISION NOT NULL,

    -- Plaid holdings metadata
    security_type VARCHAR(50),
    security_subtype VARCHAR(50),
    sector VARCHAR(100),
    industry VARCHAR(100),
    institution_price DOUBLE PRECISION,
    price_as_of TIMESTAMP WITHOUT TIME ZONE,

    -- Snapshot metadata
    snapshot_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS ix_position_snapshots_account_id ON position_snapshots(account_id);
CREATE INDEX IF NOT EXISTS ix_position_snapshots_ticker ON position_snapshots(ticker);
CREATE INDEX IF NOT EXISTS ix_position_snapshots_snapshot_date ON position_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS ix_position_snapshots_position_id ON position_snapshots(position_id);

-- Create composite index for querying snapshots by date and account
CREATE INDEX IF NOT EXISTS ix_position_snapshots_account_date ON position_snapshots(account_id, snapshot_date DESC);

COMMENT ON TABLE position_snapshots IS 'Historical snapshots of positions for tracking portfolio changes over time. Each sync from Plaid creates new snapshots.';
COMMENT ON COLUMN positions.security_type IS 'Security type from Plaid (equity, etf, cryptocurrency, etc.)';
COMMENT ON COLUMN positions.security_subtype IS 'Security subtype from Plaid (common stock, preferred, etc.)';
COMMENT ON COLUMN positions.sector IS 'Sector from Plaid (Finance, Communications, Technology, etc.)';
COMMENT ON COLUMN positions.industry IS 'Industry from Plaid (Major Banks, Major Telecommunications, etc.)';
COMMENT ON COLUMN positions.institution_price IS 'Price from financial institution via Plaid';
COMMENT ON COLUMN positions.price_as_of IS 'Date when the institution price was captured';
COMMENT ON COLUMN positions.sync_date IS 'Date when this position was last synced from Plaid';
