-- Run in a transaction after inspecting the target identity. Never rewrites
-- tickets, assignments, historical approvals, or existing vendor prices.
ALTER TABLE work_types ADD COLUMN IF NOT EXISTS source_work_type_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS work_types_partner_source_unique
  ON work_types (partner_id, source_work_type_id) WHERE source_work_type_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS partner_catalog_initializations (
  kind text NOT NULL,
  partner_id integer NOT NULL,
  vendor_id integer NOT NULL DEFAULT 0,
  source_work_type_id integer NOT NULL,
  work_type_id integer NOT NULL,
  initialized_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, partner_id, vendor_id, source_work_type_id)
);

-- Internal migration bookkeeping is never exposed through the public Data API.
ALTER TABLE partner_catalog_initializations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_catalog_initializations FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON partner_catalog_initializations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON partner_catalog_initializations FROM authenticated;
  END IF;
END $$;

-- Earlier unledgered copies cannot distinguish intentional removal from an
-- incomplete copy. Stop rather than guess and resurrect a removed selection.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM work_types WHERE partner_id IS NOT NULL AND source_work_type_id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM partner_catalog_initializations) THEN
    RAISE EXCEPTION 'Existing partner source mappings have no initialization ledger; reconcile a preservation baseline before retrying';
  END IF;
END $$;

INSERT INTO work_types (partner_id, source_work_type_id, name, category,
  description, estimated_duration, estimated_price, required_certifications,
  blocking_certifications, tax_treatment)
SELECT p.id, w.id, w.name, w.category, w.description, w.estimated_duration,
  w.estimated_price, w.required_certifications, w.blocking_certifications, w.tax_treatment
FROM partners p CROSS JOIN work_types w
WHERE w.partner_id IS NULL
ON CONFLICT DO NOTHING;

-- An existing partner-owned item with the same canonical name is retained.
-- Record only its source mapping, without replacing its fields or prices.
UPDATE work_types owned SET source_work_type_id = master.id
FROM work_types master
WHERE owned.partner_id IS NOT NULL AND owned.source_work_type_id IS NULL
  AND master.partner_id IS NULL
  AND lower(btrim(owned.name)) = lower(btrim(master.name))
  AND NOT EXISTS (SELECT 1 FROM work_types mapped
    WHERE mapped.partner_id = owned.partner_id AND mapped.source_work_type_id = master.id);

WITH initialized AS (
  INSERT INTO partner_catalog_initializations (kind, partner_id, vendor_id, source_work_type_id, work_type_id)
  SELECT 'selection', owned.partner_id, rel.vendor_id, owned.source_work_type_id, owned.id
  FROM work_types owned JOIN partner_vendor_relationships rel ON rel.partner_id = owned.partner_id
    AND rel.status = 'approved'
  WHERE owned.source_work_type_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING vendor_id, source_work_type_id, work_type_id
)
INSERT INTO vendor_work_types (vendor_id, work_type_id, unit_price, unit,
  currency, notes, price_authority_acknowledged_at, last_price_change_reason, tax_treatment)
SELECT old.vendor_id, initialized.work_type_id, old.unit_price, old.unit, old.currency,
  old.notes, old.price_authority_acknowledged_at, old.last_price_change_reason, old.tax_treatment
FROM initialized JOIN vendor_work_types old ON old.vendor_id = initialized.vendor_id
  AND old.work_type_id = initialized.source_work_type_id
ON CONFLICT (vendor_id, work_type_id) DO NOTHING;

WITH initialized AS (
  INSERT INTO partner_catalog_initializations (kind, partner_id, vendor_id, source_work_type_id, work_type_id)
  SELECT 'afe', owned.partner_id, 0, owned.source_work_type_id, owned.id FROM work_types owned
  WHERE owned.partner_id IS NOT NULL AND owned.source_work_type_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING partner_id, source_work_type_id, work_type_id
)
INSERT INTO partner_work_type_afes (partner_id, work_type_id, afe)
SELECT old.partner_id, initialized.work_type_id, old.afe
FROM initialized JOIN partner_work_type_afes old ON old.partner_id = initialized.partner_id
  AND old.work_type_id = initialized.source_work_type_id
ON CONFLICT (partner_id, work_type_id) DO NOTHING;

WITH initialized AS (
  INSERT INTO partner_catalog_initializations (kind, partner_id, vendor_id, source_work_type_id, work_type_id)
  SELECT 'approval', owned.partner_id, rel.vendor_id, owned.source_work_type_id, owned.id
  FROM work_types owned JOIN partner_vendor_relationships rel ON rel.partner_id = owned.partner_id
  WHERE owned.source_work_type_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING partner_id, vendor_id, source_work_type_id, work_type_id
)
INSERT INTO partner_vendor_work_type_approvals (partner_id, vendor_id, work_type_id,
  approved_unit_price, approved_unit, approved_currency, approved_at, approved_by_user_id, tax_treatment)
SELECT old.partner_id, old.vendor_id, initialized.work_type_id, old.approved_unit_price,
  old.approved_unit, old.approved_currency, old.approved_at, old.approved_by_user_id, old.tax_treatment
FROM initialized JOIN partner_vendor_work_type_approvals old ON old.partner_id = initialized.partner_id
  AND old.vendor_id = initialized.vendor_id AND old.work_type_id = initialized.source_work_type_id
ON CONFLICT (partner_id, vendor_id, work_type_id) DO NOTHING;
