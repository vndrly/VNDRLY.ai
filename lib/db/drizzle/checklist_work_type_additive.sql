ALTER TABLE work_hub_checklist_templates ADD COLUMN IF NOT EXISTS work_type_id integer REFERENCES work_types(id);
ALTER TABLE work_hub_checklist_templates ADD COLUMN IF NOT EXISTS work_type_ids jsonb;
