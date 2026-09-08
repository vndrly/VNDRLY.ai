-- Preserve all legacy notes without guessing the company that authored them.
ALTER TABLE vendor_notes ADD COLUMN IF NOT EXISTS owner_org_type text;
ALTER TABLE vendor_notes ADD COLUMN IF NOT EXISTS owner_org_id integer;
