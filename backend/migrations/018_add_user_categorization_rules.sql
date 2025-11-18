-- Migration: Add user categorization rules table
-- Date: 2025-11-18
-- Description: Create table to store user-specific categorization rules learned from manual category changes

CREATE TABLE IF NOT EXISTS user_categorization_rules (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    description_pattern VARCHAR NOT NULL,
    account_id VARCHAR,
    transaction_type VARCHAR,
    amount_min NUMERIC(15, 2),
    amount_max NUMERIC(15, 2),
    category_name VARCHAR NOT NULL,
    match_count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_account
        FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
);

-- Create indexes for faster lookups
CREATE INDEX idx_user_categorization_rules_user_id ON user_categorization_rules(user_id);
CREATE INDEX idx_user_categorization_rules_description ON user_categorization_rules(description_pattern);
CREATE INDEX idx_user_categorization_rules_account ON user_categorization_rules(account_id);

-- Add comment to document the purpose
COMMENT ON TABLE user_categorization_rules IS 'Stores user-specific categorization rules learned from manual category changes. Used to personalize automatic categorization.';
COMMENT ON COLUMN user_categorization_rules.description_pattern IS 'Transaction description pattern to match (can be partial or full match)';
COMMENT ON COLUMN user_categorization_rules.match_count IS 'Number of times this rule has been applied (for tracking rule effectiveness)';
