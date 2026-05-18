-- Idempotent backfill for the multi-person crew time-tracking feature.
--
-- Brings legacy ticket-level check-in/out into the new ticket_check_ins
-- table for the primary field employee on each ticket. Safe to re-run.
--
-- Prereqs: lib/db schema for ticket_check_ins is pushed (drizzle db:push)
-- and the unique index uniq_open_check_in_per_employee exists.

INSERT INTO ticket_check_ins
  (ticket_id, employee_id, check_in_at, check_in_latitude, check_in_longitude,
   check_out_at, check_out_latitude, check_out_longitude, hourly_rate_at_time, source)
SELECT
  t.id,
  t.field_employee_id,
  t.check_in_time,
  t.check_in_latitude,
  t.check_in_longitude,
  t.check_out_time,
  t.check_out_latitude,
  t.check_out_longitude,
  vp.hourly_rate,
  'auto'
FROM tickets t
JOIN vendor_people vp ON vp.id = t.field_employee_id
WHERE t.field_employee_id IS NOT NULL
  AND t.check_in_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ticket_check_ins tci
    WHERE tci.ticket_id = t.id
      AND tci.employee_id = t.field_employee_id
      AND tci.check_in_at = t.check_in_time
  );

-- Add the partial unique index if it does not already exist.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_check_in_per_employee
  ON ticket_check_ins (ticket_id, employee_id)
  WHERE check_out_at IS NULL;
