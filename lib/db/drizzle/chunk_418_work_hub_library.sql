ALTER TABLE work_hub_form_templates ADD COLUMN IF NOT EXISTS library_metadata JSONB;
ALTER TABLE work_hub_form_templates ADD COLUMN IF NOT EXISTS bundle_definition JSONB;
ALTER TABLE work_hub_form_instances ADD COLUMN IF NOT EXISTS assignment_metadata JSONB;
