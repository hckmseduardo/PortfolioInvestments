-- Migration: Add Instrument Types, Industries and Metadata tables
-- Date: 2025-11-09

BEGIN;

-- Create instrument_types table
CREATE TABLE IF NOT EXISTS instrument_types (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    color VARCHAR NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_instrument_types_user_id ON instrument_types(user_id);

-- Create instrument_industries table
CREATE TABLE IF NOT EXISTS instrument_industries (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    color VARCHAR NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_instrument_industries_user_id ON instrument_industries(user_id);

-- Create instrument_metadata table
CREATE TABLE IF NOT EXISTS instrument_metadata (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker VARCHAR NOT NULL,
    instrument_type_id VARCHAR REFERENCES instrument_types(id) ON DELETE SET NULL,
    instrument_industry_id VARCHAR REFERENCES instrument_industries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_instrument_metadata_user_id ON instrument_metadata(user_id);
CREATE INDEX IF NOT EXISTS ix_instrument_metadata_ticker ON instrument_metadata(ticker);

COMMIT;
