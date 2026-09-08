-- Historical roles are unknown; preserve NULL without guessing or backfill.
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS entry_category text;
