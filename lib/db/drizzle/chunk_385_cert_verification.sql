-- Vendor verification for employee-submitted certifications and a flag
-- so vendor office/admin can spot profile changes made by field employees.

ALTER TABLE employee_certifications
  ADD COLUMN IF NOT EXISTS vendor_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_verified_by_user_id integer REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN employee_certifications.vendor_verified_at IS
  'When set, vendor office/admin confirmed this certification entry. Null = pending review.';

ALTER TABLE vendor_people
  ADD COLUMN IF NOT EXISTS profile_pending_review_at timestamptz;

COMMENT ON COLUMN vendor_people.profile_pending_review_at IS
  'Set when a field employee updates their profile or certifications; cleared when vendor reviews.';

-- Existing rows predate verification workflow; treat as already verified.
UPDATE employee_certifications
SET vendor_verified_at = created_at
WHERE vendor_verified_at IS NULL AND deleted_at IS NULL;
