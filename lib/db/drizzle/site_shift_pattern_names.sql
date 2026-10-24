-- Additive metadata for named weekly staffing patterns; no shift or assignment changes.
ALTER TABLE workforce_staffing_requirements ADD COLUMN IF NOT EXISTS pattern_name text;
ALTER TABLE workforce_staffing_requirements ADD COLUMN IF NOT EXISTS timezone text;
