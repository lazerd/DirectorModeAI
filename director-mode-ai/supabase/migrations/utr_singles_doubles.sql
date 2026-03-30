-- Add separate singles/doubles UTR columns to vault players
ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS utr_singles NUMERIC(4,2) CHECK (utr_singles >= 1.00 AND utr_singles <= 16.50);
ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS utr_doubles NUMERIC(4,2) CHECK (utr_doubles >= 1.00 AND utr_doubles <= 16.50);

-- Copy existing utr_rating to utr_singles for any existing rows
UPDATE cc_vault_players SET utr_singles = utr_rating WHERE utr_rating IS NOT NULL AND utr_singles IS NULL;
