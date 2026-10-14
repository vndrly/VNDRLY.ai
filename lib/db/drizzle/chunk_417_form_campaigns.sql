ALTER TABLE work_hub_form_templates ADD COLUMN IF NOT EXISTS campaign_config jsonb;
ALTER TABLE work_hub_form_templates ADD COLUMN IF NOT EXISTS campaign_state jsonb;
ALTER TABLE work_hub_form_instances ADD COLUMN IF NOT EXISTS campaign_version integer;
