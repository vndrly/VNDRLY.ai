CREATE TABLE IF NOT EXISTS work_hub_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_org_type text NOT NULL, owner_org_id integer NOT NULL,
  provider text NOT NULL DEFAULT 'microsoft_365', direction text NOT NULL DEFAULT 'microsoft_to_vndrly', status text NOT NULL DEFAULT 'preview', categories text[] NOT NULL,
  requested_by_id integer NOT NULL REFERENCES users(id), reviewed_by_id integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, activated_at timestamptz, completed_at timestamptz, error_summary jsonb
);
CREATE INDEX IF NOT EXISTS work_hub_import_batches_owner_created_idx ON work_hub_import_batches(owner_org_type, owner_org_id, created_at);
CREATE TABLE IF NOT EXISTS work_hub_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES work_hub_import_batches(id) ON DELETE CASCADE,
  category text NOT NULL, external_id text NOT NULL, external_version text, source_url text, source_modified_at timestamptz, imported_at timestamptz,
  status text NOT NULL DEFAULT 'staged', payload jsonb NOT NULL, permission_mapping jsonb, conflict jsonb, activated_subject_type text, activated_subject_id text, error jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS work_hub_import_items_provider_item_unique ON work_hub_import_items(category, external_id, external_version);
CREATE INDEX IF NOT EXISTS work_hub_import_items_batch_idx ON work_hub_import_items(batch_id, status);
