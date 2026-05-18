-- Idempotent backfill: convert legacy field_employees.pec_certification +
-- pec_expiration_date into rows in employee_certifications named "PEC".
-- Safe to re-run; only inserts a PEC row if none exists yet for that employee.
INSERT INTO employee_certifications (
  employee_id, name, issuer, expiration_date, created_at
)
SELECT
  fe.id,
  'PEC',
  'PEC Premier',
  fe.pec_expiration_date,
  NOW()
FROM vendor_people fe
WHERE fe.deleted_at IS NULL
  AND (
    fe.pec_certification = TRUE
    OR fe.pec_expiration_date IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM employee_certifications ec
    WHERE ec.employee_id = fe.id
      AND ec.name = 'PEC'
      AND ec.deleted_at IS NULL
  );
