-- Resync every public-schema serial sequence to MAX(id) and backfill ticket
-- lifecycle_state rows that drifted from status during legacy seed / phone intake.

DO $$
DECLARE
  r RECORD;
  seq_fqname text;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name,
      s.relname AS sequence_name
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
    JOIN pg_class c ON c.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE s.relkind = 'S'
      AND n.nspname = 'public'
  LOOP
    seq_fqname := format('%I.%I', r.schema_name, r.sequence_name);
    EXECUTE format(
      'SELECT setval(%L, GREATEST(COALESCE((SELECT MAX(%I) FROM %I.%I), 0), 1))',
      seq_fqname,
      r.column_name,
      r.schema_name,
      r.table_name
    );
  END LOOP;
END $$;

-- in_progress means on the clock → on_site
UPDATE tickets
SET lifecycle_state = 'on_site'
WHERE status = 'in_progress'
  AND (lifecycle_state IS NULL OR lifecycle_state IN ('pending_arrival', 'en_route', 'on_location'));

-- checked-out / closed field phases
UPDATE tickets
SET lifecycle_state = 'off_site'
WHERE status IN ('pending_review', 'completed', 'submitted', 'approved', 'awaiting_payment', 'funds_dispersed', 'kicked_back')
  AND lifecycle_state IS NULL
  AND check_out_time IS NOT NULL;

UPDATE tickets
SET lifecycle_state = 'off_site'
WHERE status IN ('submitted', 'approved', 'awaiting_payment', 'funds_dispersed', 'kicked_back')
  AND lifecycle_state IN ('pending_arrival', 'en_route', 'on_location', 'on_site');

-- pre-field-work office statuses
UPDATE tickets
SET lifecycle_state = 'pending_arrival'
WHERE lifecycle_state IS NULL
  AND status IN ('initiated', 'draft', 'awaiting_acceptance', 'denied');

-- terminal / cancelled — clear stale active lifecycle
UPDATE tickets
SET lifecycle_state = 'off_site'
WHERE status = 'cancelled'
  AND lifecycle_state IS NOT NULL
  AND lifecycle_state <> 'off_site';
