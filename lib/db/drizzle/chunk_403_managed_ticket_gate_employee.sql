ALTER TABLE tickets ADD COLUMN IF NOT EXISTS gate_employee_user_id integer REFERENCES users(id);
