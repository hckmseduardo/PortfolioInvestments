-- Add security metadata management tables
-- This migration adds tables to manage security types, subtypes, sectors, and industries

-- Security Types table
CREATE TABLE IF NOT EXISTS security_types (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#808080',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Security Subtypes table
CREATE TABLE IF NOT EXISTS security_subtypes (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#808080',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Sectors table
CREATE TABLE IF NOT EXISTS sectors (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#808080',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Industries table
CREATE TABLE IF NOT EXISTS industries (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#808080',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

COMMENT ON TABLE security_types IS 'Security types (equity, etf, cryptocurrency, etc.) with customizable display';
COMMENT ON TABLE security_subtypes IS 'Security subtypes (common stock, preferred, etc.) with customizable display';
COMMENT ON TABLE sectors IS 'Economic sectors (Finance, Technology, etc.) with customizable display';
COMMENT ON TABLE industries IS 'Industries (Major Banks, Software, etc.) with customizable display';
