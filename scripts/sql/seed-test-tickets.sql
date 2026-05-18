-- =============================================================
-- Seed test data: tickets + hotlist for
--   Partners: ExxonMobil (1), Mach Natural Resources (19)
--   Vendors:  Baker Hughes Field Svcs (2), Winchester (3)
--
-- Idempotent: every row inserted here is tagged with a "[SEED]"
-- prefix in its description / title / notes column so a re-run
-- wipes prior seed rows first and re-creates fresh ones.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Clean prior seed rows
-- -------------------------------------------------------------
DELETE FROM ticket_status_history       WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%');
DELETE FROM ticket_assignment_rates     WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%');
DELETE FROM ticket_check_ins            WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%');
DELETE FROM ticket_crew                 WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%');
DELETE FROM ticket_line_items           WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%');
DELETE FROM ticket_scheduled_notifications WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%');
DELETE FROM tickets                     WHERE description LIKE '[SEED]%';

DELETE FROM hotlist_bids     WHERE job_id IN (SELECT id FROM hotlist_jobs WHERE description LIKE '[SEED]%');
DELETE FROM hotlist_comments WHERE job_id IN (SELECT id FROM hotlist_jobs WHERE description LIKE '[SEED]%');
DELETE FROM hotlist_jobs     WHERE description LIKE '[SEED]%';

-- -------------------------------------------------------------
-- 2. Make sure the four partner-vendor relationships are "approved"
--    (existing rows are 'auto_unapproved'; BH×Mach is missing)
-- -------------------------------------------------------------
UPDATE partner_vendor_relationships SET status='approved'
 WHERE (partner_id, vendor_id) IN ((1,2),(1,3),(19,3));

INSERT INTO partner_vendor_relationships (partner_id, vendor_id, status)
SELECT 19, 2, 'approved'
WHERE NOT EXISTS (
  SELECT 1 FROM partner_vendor_relationships WHERE partner_id=19 AND vendor_id=2
);

-- -------------------------------------------------------------
-- 3. Backfill vendor_work_types so every (vendor, work_type) pair
--    we'll cite below has a price + unit. INSERT...SELECT WHERE NOT EXISTS
--    keeps it idempotent.
-- -------------------------------------------------------------
WITH wanted(vendor_id, work_type_id, unit_price, unit) AS (
  VALUES
    (2,  1, 250.00, 'per_hour'),
    (2,  4, 800.00, 'per_well'),
    (2,  5, 950.00, 'per_well'),
    (2,  6, 18000.00, 'per_stage'),
    (2,  9, 165.00, 'per_hour'),
    (2, 13, 175.00, 'per_hour'),
    (2, 15, 220.00, 'per_hour'),
    (2, 19, 145.00, 'per_hour'),
    (3,  1, 240.00, 'per_hour'),
    (3,  4, 780.00, 'per_well'),
    (3,  5, 920.00, 'per_well'),
    (3,  9, 155.00, 'per_hour'),
    (3, 11, 1200.00, 'per_well'),
    (3, 13, 150.00, 'per_hour'),
    (3, 16, 95.00,  'per_hour'),
    (3, 39, 425.00, 'per_hour'),
    (3, 41, 320.00, 'per_hour')
)
INSERT INTO vendor_work_types (vendor_id, work_type_id, unit_price, unit)
SELECT w.vendor_id, w.work_type_id, w.unit_price, w.unit
  FROM wanted w
 WHERE NOT EXISTS (
   SELECT 1 FROM vendor_work_types vwt
    WHERE vwt.vendor_id = w.vendor_id AND vwt.work_type_id = w.work_type_id
 );

-- And update prices for any existing rows that have NULL price (so the
-- ticket detail screens show real numbers).
UPDATE vendor_work_types vwt
   SET unit_price = w.unit_price, unit = w.unit
  FROM (VALUES
    (2,  4, 800.00, 'per_well'),
    (2,  6, 18000.00, 'per_stage'),
    (2, 13, 175.00, 'per_hour'),
    (2, 15, 220.00, 'per_hour'),
    (2, 19, 145.00, 'per_hour'),
    (3,  1, 240.00, 'per_hour'),
    (3,  4, 780.00, 'per_well'),
    (3,  5, 920.00, 'per_well'),
    (3,  9, 155.00, 'per_hour'),
    (3, 11, 1200.00, 'per_well'),
    (3, 16, 95.00,  'per_hour'),
    (3, 39, 425.00, 'per_hour'),
    (3, 41, 320.00, 'per_hour')
  ) AS w(vendor_id, work_type_id, unit_price, unit)
 WHERE vwt.vendor_id = w.vendor_id
   AND vwt.work_type_id = w.work_type_id
   AND vwt.unit_price IS NULL;

-- -------------------------------------------------------------
-- 4. Insert tickets: 12 per (vendor × partner) combo = 48 tickets
--    Each combo covers the same lifecycle distribution so QA has
--    fresh examples in every state.
--
-- Slot index 0..11 maps to:
--   0  initiated         (no schedule, no crew)
--   1  initiated         (scheduled, foreman + crew, ack pending)
--   2  in_progress       (checked in, no checkout)
--   3  in_progress       (checked in, no checkout, second sample)
--   4  submitted         (full check-in/out, line items)
--   5  submitted         (full check-in/out, line items, second)
--   6  pending_review    (kicked back to office for line-item review)
--   7  approved          (approved_at set, line items, ready to invoice)
--   8  awaiting_acceptance (sent to vendor for handshake)
--   9  kicked_back       (with reason)
--  10  funds_dispersed   (paid)
--  11  cancelled         (with pre_cancel_status)
-- -------------------------------------------------------------

WITH combos(vendor_id, partner_id, foreman_user_id, vendor_admin_user_id, partner_admin_user_id) AS (
  VALUES
    (2,  1,  341, 341,   2),  -- BH × Exxon
    (2, 19,  341, 341, 342),  -- BH × Mach
    (3,  1,  340, 340,   2),  -- Winchester × Exxon
    (3, 19,  340, 340, 342)   -- Winchester × Mach
),
-- Sites available per partner (cap to a reasonable variety)
partner_sites AS (
  SELECT 1 AS partner_id, ARRAY[1,4,20,21,22,23,24,25,26,27,28,29,30,31] AS sites
  UNION ALL
  SELECT 19, ARRAY[5,6,7,8,9,10,11,12,13,14,15,16,17,18]
),
-- Work types and employees per vendor
vendor_meta AS (
  SELECT 2 AS vendor_id,
         ARRAY[4, 6, 13, 15, 19, 1, 5, 9]    AS work_types,
         ARRAY[3, 11, 12, 13, 14]            AS employees
  UNION ALL
  SELECT 3,
         ARRAY[1, 4, 5, 9, 11, 13, 16, 39, 41],
         ARRAY[4, 5, 6, 15, 16]
),
slots(slot, status) AS (
  VALUES
    (0,  'initiated'),
    (1,  'initiated'),
    (2,  'in_progress'),
    (3,  'in_progress'),
    (4,  'submitted'),
    (5,  'submitted'),
    (6,  'pending_review'),
    (7,  'approved'),
    (8,  'awaiting_acceptance'),
    (9,  'kicked_back'),
    (10, 'funds_dispersed'),
    (11, 'cancelled')
),
plan AS (
  SELECT
    c.vendor_id,
    c.partner_id,
    c.foreman_user_id,
    c.vendor_admin_user_id,
    c.partner_admin_user_id,
    s.slot,
    s.status,
    -- Pick a deterministic site / work_type / employee per slot
    ps.sites[ 1 + ((s.slot * 3 + c.vendor_id + c.partner_id) % array_length(ps.sites, 1)) ] AS site_id,
    vm.work_types[ 1 + ((s.slot * 5 + c.vendor_id) % array_length(vm.work_types, 1)) ]      AS work_type_id,
    vm.employees [ 1 + ((s.slot + c.partner_id) % array_length(vm.employees, 1)) ]          AS employee_id
  FROM combos c
  JOIN partner_sites ps ON ps.partner_id = c.partner_id
  JOIN vendor_meta vm   ON vm.vendor_id  = c.vendor_id
  CROSS JOIN slots s
),
inserted AS (
  INSERT INTO tickets (
    site_location_id, vendor_id, work_type_id, field_employee_id,
    status, intake_channel,
    description, notes, kickback_reason,
    check_in_time, check_out_time,
    check_in_latitude, check_in_longitude,
    check_out_latitude, check_out_longitude,
    scheduled_start_at, scheduled_duration_minutes, foreman_user_id,
    scheduled_at, scheduled_by_id,
    approved_at,
    payment_method, payment_reference, payment_note,
    payment_dispersed_at, payment_dispersed_by_id,
    pre_cancel_status, cancelled_at, cancelled_by_id,
    created_by_id,
    created_at, updated_at
  )
  SELECT
    p.site_id,
    p.vendor_id,
    p.work_type_id,
    -- Initiated/no-schedule slot (0) has no foreman/employee assigned yet
    CASE WHEN p.slot = 0 THEN NULL ELSE p.employee_id END,
    p.status,
    'partner_self_service',
    -- description: tagged so we can clean it up
    '[SEED] '
      || CASE p.status
           WHEN 'initiated'           THEN 'New job request — '
           WHEN 'in_progress'         THEN 'Crew on-site — '
           WHEN 'submitted'           THEN 'Submitted for review — '
           WHEN 'pending_review'      THEN 'Office reviewing line items — '
           WHEN 'approved'            THEN 'Approved, ready to invoice — '
           WHEN 'awaiting_acceptance' THEN 'Awaiting vendor handshake — '
           WHEN 'kicked_back'         THEN 'Kicked back to vendor — '
           WHEN 'funds_dispersed'     THEN 'Paid — '
           WHEN 'cancelled'           THEN 'Cancelled — '
           ELSE p.status || ' — '
         END
      || (SELECT name FROM work_types WHERE id = p.work_type_id),
    CASE p.slot WHEN 0 THEN NULL ELSE 'Seeded sample for QA. Slot ' || p.slot || ' / ' || p.status END,
    CASE p.status WHEN 'kicked_back'
      THEN 'Line-item rates exceed AFE allotment. Please re-submit with adjusted hours.'
      ELSE NULL END,
    -- check_in_time: present for slots ≥ 2 (in_progress and beyond, except cancelled)
    CASE WHEN p.slot BETWEEN 2 AND 10
      THEN now() - (interval '1 day' * (p.slot + 1))
      ELSE NULL END,
    -- check_out_time: present for slots ≥ 4 (submitted and beyond)
    CASE WHEN p.slot BETWEEN 4 AND 10
      THEN now() - (interval '1 day' * (p.slot + 1)) + interval '7 hours'
      ELSE NULL END,
    CASE WHEN p.slot BETWEEN 2 AND 10 THEN 31.9973 + (p.slot * 0.01) ELSE NULL END,
    CASE WHEN p.slot BETWEEN 2 AND 10 THEN -102.0779 + (p.slot * 0.01) ELSE NULL END,
    CASE WHEN p.slot BETWEEN 4 AND 10 THEN 31.9973 + (p.slot * 0.01) + 0.002 ELSE NULL END,
    CASE WHEN p.slot BETWEEN 4 AND 10 THEN -102.0779 + (p.slot * 0.01) + 0.002 ELSE NULL END,
    -- scheduled_start_at: present for every slot except 0 and 11
    CASE WHEN p.slot NOT IN (0, 11)
      THEN now() - (interval '1 day' * (p.slot + 1)) + interval '8 hours'
      ELSE NULL END,
    CASE WHEN p.slot NOT IN (0, 11) THEN 480 ELSE NULL END,
    CASE WHEN p.slot NOT IN (0, 11) THEN p.foreman_user_id ELSE NULL END,
    CASE WHEN p.slot NOT IN (0, 11)
      THEN now() - (interval '1 day' * (p.slot + 2))
      ELSE NULL END,
    CASE WHEN p.slot NOT IN (0, 11) THEN p.partner_admin_user_id ELSE NULL END,
    -- approved_at: slots 7, 10 (approved + funds_dispersed)
    CASE WHEN p.slot IN (7, 10)
      THEN now() - (interval '1 day' * (p.slot - 1))
      ELSE NULL END,
    -- payment fields: only slot 10 (funds_dispersed)
    CASE WHEN p.slot = 10 THEN 'ach' ELSE NULL END,
    CASE WHEN p.slot = 10 THEN 'ACH-' || (10000 + p.vendor_id*1000 + p.partner_id*100 + p.slot)::text ELSE NULL END,
    CASE WHEN p.slot = 10 THEN 'Net-30 payment processed by AP' ELSE NULL END,
    CASE WHEN p.slot = 10 THEN now() - interval '2 days' ELSE NULL END,
    CASE WHEN p.slot = 10 THEN p.partner_admin_user_id ELSE NULL END,
    -- cancelled fields: slot 11
    CASE WHEN p.slot = 11 THEN 'initiated' ELSE NULL END,
    CASE WHEN p.slot = 11 THEN now() - interval '1 day' ELSE NULL END,
    CASE WHEN p.slot = 11 THEN p.partner_admin_user_id ELSE NULL END,
    p.partner_admin_user_id,
    now() - (interval '1 day' * (p.slot + 3)),
    now() - (interval '1 day' * GREATEST(p.slot - 1, 0))
  FROM plan p
  RETURNING id, status, vendor_id, site_location_id, work_type_id, field_employee_id,
            check_in_time, scheduled_start_at, foreman_user_id, created_by_id, created_at
)
SELECT 'tickets inserted: ' || COUNT(*) AS report FROM inserted;

-- -------------------------------------------------------------
-- 5. Ticket crew rows (one ack-accepted crew member per ticket
--    that has a field_employee_id set).
-- -------------------------------------------------------------
INSERT INTO ticket_crew (ticket_id, employee_id, added_by_user_id, added_at, ack_status, ack_at)
SELECT t.id,
       t.field_employee_id,
       COALESCE(t.foreman_user_id, t.created_by_id),
       t.created_at + interval '1 hour',
       CASE WHEN t.status IN ('initiated') AND t.scheduled_start_at IS NULL THEN 'pending'
            WHEN t.status = 'cancelled' THEN 'pending'
            ELSE 'accepted' END,
       CASE WHEN t.status IN ('initiated','cancelled') THEN NULL
            ELSE t.created_at + interval '2 hours' END
  FROM tickets t
 WHERE t.description LIKE '[SEED]%'
   AND t.field_employee_id IS NOT NULL;

-- A second crew member for the in_progress / submitted / approved tickets,
-- to make the crew tracker UI feel populated.
INSERT INTO ticket_crew (ticket_id, employee_id, added_by_user_id, added_at, ack_status, ack_at)
SELECT t.id,
       -- pick a sibling employee (same vendor) deterministically
       (SELECT vp.id FROM vendor_people vp
         WHERE vp.vendor_id = t.vendor_id AND vp.is_active = true
           AND vp.id <> t.field_employee_id AND vp.deleted_at IS NULL
           AND vp.vendor_role IN ('field','foreman','both')
         ORDER BY vp.id
         OFFSET (t.id % 3) LIMIT 1),
       COALESCE(t.foreman_user_id, t.created_by_id),
       t.created_at + interval '90 minutes',
       'accepted',
       t.created_at + interval '3 hours'
  FROM tickets t
 WHERE t.description LIKE '[SEED]%'
   AND t.status IN ('in_progress','submitted','pending_review','approved',
                    'awaiting_acceptance','kicked_back','funds_dispersed')
   AND t.field_employee_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM vendor_people vp
      WHERE vp.vendor_id = t.vendor_id AND vp.is_active = true
        AND vp.id <> t.field_employee_id AND vp.deleted_at IS NULL
        AND vp.vendor_role IN ('field','foreman','both')
   );

-- -------------------------------------------------------------
-- 6. Ticket line items for everything submitted+
-- -------------------------------------------------------------
INSERT INTO ticket_line_items (ticket_id, type, description, quantity, unit_price)
SELECT t.id, 'labor', wt.name || ' — field hours', 8.0, COALESCE(vwt.unit_price, 175.00)
  FROM tickets t
  JOIN work_types wt        ON wt.id  = t.work_type_id
  LEFT JOIN vendor_work_types vwt ON vwt.vendor_id = t.vendor_id AND vwt.work_type_id = t.work_type_id
 WHERE t.description LIKE '[SEED]%'
   AND t.status IN ('submitted','pending_review','approved','awaiting_acceptance',
                    'kicked_back','funds_dispersed');

INSERT INTO ticket_line_items (ticket_id, type, description, quantity, unit_price)
SELECT t.id, 'material', 'Consumables and PPE', 1.0, 145.00
  FROM tickets t
 WHERE t.description LIKE '[SEED]%'
   AND t.status IN ('submitted','pending_review','approved','awaiting_acceptance',
                    'kicked_back','funds_dispersed');

INSERT INTO ticket_line_items (ticket_id, type, description, quantity, unit_price)
SELECT t.id, 'mileage', 'Truck mileage round-trip', 220.0, 0.67
  FROM tickets t
 WHERE t.description LIKE '[SEED]%'
   AND t.status IN ('approved','awaiting_acceptance','funds_dispersed');

-- -------------------------------------------------------------
-- 7. Ticket status history (compact transition log per ticket)
-- -------------------------------------------------------------
-- initiated row for every ticket
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'initiated', 'initiated', t.created_by_id, 'partner', 'Ticket created', t.created_at
  FROM tickets t WHERE t.description LIKE '[SEED]%';

-- in_progress and beyond
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'initiated', 'in_progress', t.foreman_user_id, 'vendor', 'Crew checked in on site', t.check_in_time
  FROM tickets t
 WHERE t.description LIKE '[SEED]%'
   AND t.status IN ('in_progress','submitted','pending_review','approved',
                    'awaiting_acceptance','kicked_back','funds_dispersed')
   AND t.check_in_time IS NOT NULL;

-- submitted and beyond
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'in_progress', 'submitted', t.foreman_user_id, 'vendor', 'Submitted for partner review', t.check_out_time
  FROM tickets t
 WHERE t.description LIKE '[SEED]%'
   AND t.status IN ('submitted','pending_review','approved','awaiting_acceptance',
                    'kicked_back','funds_dispersed')
   AND t.check_out_time IS NOT NULL;

-- pending_review
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'submitted', 'pending_review', t.created_by_id, 'partner', 'Office reviewing line-items',
       t.check_out_time + interval '1 hour'
  FROM tickets t
 WHERE t.description LIKE '[SEED]%' AND t.status = 'pending_review';

-- approved (and beyond)
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'submitted', 'approved', t.created_by_id, 'partner', 'Approved by partner', t.approved_at
  FROM tickets t
 WHERE t.description LIKE '[SEED]%' AND t.status IN ('approved','funds_dispersed') AND t.approved_at IS NOT NULL;

-- awaiting_acceptance
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'submitted', 'awaiting_acceptance', t.created_by_id, 'partner', 'Sent to vendor for handshake',
       t.check_out_time + interval '2 hours'
  FROM tickets t
 WHERE t.description LIKE '[SEED]%' AND t.status = 'awaiting_acceptance';

-- kicked_back
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'submitted', 'kicked_back', t.created_by_id, 'partner',
       'Line items exceed AFE allotment', t.check_out_time + interval '3 hours'
  FROM tickets t
 WHERE t.description LIKE '[SEED]%' AND t.status = 'kicked_back';

-- funds_dispersed
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'approved', 'funds_dispersed', t.payment_dispersed_by_id, 'partner',
       'AP recorded ACH payment', t.payment_dispersed_at
  FROM tickets t
 WHERE t.description LIKE '[SEED]%' AND t.status = 'funds_dispersed';

-- cancelled
INSERT INTO ticket_status_history (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
SELECT t.id, 'initiated', 'cancelled', t.cancelled_by_id, 'partner',
       'Cancelled by partner before scheduling', t.cancelled_at
  FROM tickets t
 WHERE t.description LIKE '[SEED]%' AND t.status = 'cancelled';

-- -------------------------------------------------------------
-- 8. Ticket assignment rates (applied hourly rates per crew member
--    on submitted+ tickets — drives the rate-card snapshot views)
-- -------------------------------------------------------------
INSERT INTO ticket_assignment_rates (ticket_id, employee_id, hourly_rate, set_by_id)
SELECT tc.ticket_id, tc.employee_id,
       CASE WHEN t.vendor_id = 2 THEN 175.00 ELSE 155.00 END,
       t.foreman_user_id
  FROM ticket_crew tc
  JOIN tickets t ON t.id = tc.ticket_id
 WHERE t.description LIKE '[SEED]%'
   AND tc.removed_at IS NULL
   AND t.status IN ('submitted','pending_review','approved','awaiting_acceptance',
                    'kicked_back','funds_dispersed');

-- -------------------------------------------------------------
-- 9. Hotlist jobs across both partners + bids from both vendors
-- -------------------------------------------------------------
INSERT INTO hotlist_jobs (
  partner_id, title, description, location_address, latitude, longitude,
  deadline, estimated_duration_days, status, awarded_vendor_id, created_at
) VALUES
  (1,  'Permian Wellhead Pressure Test (Urgent)',
        '[SEED] Need certified crew for emergency pressure test on offset well.',
        'Loving County, TX', 31.847, -103.534,
        (current_date + 7), 2,  'open', NULL, now() - interval '2 days'),
  (1,  'Pipeline Cathodic Protection Survey',
        '[SEED] Annual CP survey, ~18 miles of gathering line.',
        'Ward County, TX', 31.491, -103.142,
        (current_date + 21), 5, 'open', NULL, now() - interval '5 days'),
  (1,  'Tank Battery Coating & Inspection',
        '[SEED] Two 500 bbl tanks need internal inspection + recoat.',
        'Reeves County, TX', 31.337, -103.475,
        (current_date + 14), 4, 'open', NULL, now() - interval '1 day'),
  (1,  'Hot Oil Treatment — 6 Wells',
        '[SEED] Paraffin issues on producing string. Hot oil units only.',
        'Winkler County, TX', 31.811, -103.018,
        (current_date + 5), 2,  'awarded', 3, now() - interval '8 days'),
  (1,  'Emergency Spill Cleanup',
        '[SEED] Produced-water spill — environmental remediation needed.',
        'Loving County, TX', 31.821, -103.501,
        (current_date + 2), 1,  'open', NULL, now() - interval '12 hours'),
  (1,  'Drilling Rig Move (Pad-to-Pad)',
        '[SEED] 1500HP triple, 3.4 miles between pads. CDL crews + lowboys.',
        'Andrews County, TX', 32.301, -102.547,
        (current_date + 10), 3, 'open', NULL, now() - interval '3 days'),
  (19, 'Mach SCOOP Wireline Logging Run',
        '[SEED] Cased-hole logging, 2 wells in same section.',
        'Grady County, OK', 35.012, -97.974,
        (current_date + 9), 2,  'open', NULL, now() - interval '4 days'),
  (19, 'Anadarko Pad Construction & Leveling',
        '[SEED] New 4-well pad, ~2.5 acres. Need dirt crews + survey.',
        'Custer County, OK', 35.521, -98.971,
        (current_date + 30), 14, 'open', NULL, now() - interval '6 days'),
  (19, 'STACK Frac Spread — 12 stages',
        '[SEED] Frac sleeves 12 stages. Want unified pump+flowback bid.',
        'Kingfisher County, OK', 35.852, -97.939,
        (current_date + 18), 7, 'awarded', 2, now() - interval '10 days'),
  (19, 'Western Anadarko Water Hauling',
        '[SEED] 30,000 bbl produced water, recurring 2 weeks.',
        'Hemphill County, TX', 35.842, -100.270,
        (current_date + 4), 3,  'open', NULL, now() - interval '2 days'),
  (19, 'SCOOP Cementing — Surface + Intermediate',
        '[SEED] Two strings, surface & 9-5/8 intermediate. Need PPE-compliant crews.',
        'Stephens County, OK', 34.501, -97.852,
        (current_date + 11), 2, 'open', NULL, now() - interval '1 day'),
  (19, 'Kingfisher Wellhead Installation',
        '[SEED] 4 wellheads + christmas trees, sequential install.',
        'Kingfisher County, OK', 35.870, -97.945,
        (current_date + 16), 6, 'open', NULL, now() - interval '36 hours');

-- Bids: each open job gets 1–2 competing bids; awarded jobs get a winning bid.
WITH seed_jobs AS (SELECT id, partner_id, awarded_vendor_id, status FROM hotlist_jobs WHERE description LIKE '[SEED]%')
INSERT INTO hotlist_bids (job_id, vendor_id, amount_usd, eta_days, notes, status, created_at)
SELECT j.id, 2, 18500.00, 4, '[SEED] Crew available end of week. Includes mob/demob.',
       CASE WHEN j.awarded_vendor_id = 2 THEN 'accepted' ELSE 'pending' END,
       now() - interval '1 day'
  FROM seed_jobs j;

WITH seed_jobs AS (SELECT id, partner_id, awarded_vendor_id, status FROM hotlist_jobs WHERE description LIKE '[SEED]%')
INSERT INTO hotlist_bids (job_id, vendor_id, amount_usd, eta_days, notes, status, created_at)
SELECT j.id, 3, 17200.00, 3, '[SEED] Foreman + 3-man crew. Will hit deadline.',
       CASE WHEN j.awarded_vendor_id = 3 THEN 'accepted' ELSE 'pending' END,
       now() - interval '18 hours'
  FROM seed_jobs j;

-- A handful of comments on a few jobs per partner (use partner-admin users for
-- partner-side comments and vendor-admin users for vendor-side replies). We
-- partition the seeded jobs per-partner so both Exxon and Mach get coverage.
INSERT INTO hotlist_comments (job_id, content, created_by_id, created_at)
SELECT j.id,
       '[SEED] Two crews can mobilize Monday, one Tuesday. Need site map ASAP.',
       CASE WHEN j.partner_id = 1 THEN 2 ELSE 342 END,
       now() - interval '12 hours'
  FROM (
    SELECT id, partner_id,
           row_number() OVER (PARTITION BY partner_id ORDER BY id) AS rn
      FROM hotlist_jobs WHERE description LIKE '[SEED]%'
  ) j
 WHERE j.rn <= 3;

INSERT INTO hotlist_comments (job_id, content, created_by_id, created_at)
SELECT j.id,
       '[SEED] Confirming PEC certs are current for both foreman and lead hand.',
       CASE WHEN j.partner_id = 1 THEN 341 ELSE 340 END,
       now() - interval '6 hours'
  FROM (
    SELECT id, partner_id,
           row_number() OVER (PARTITION BY partner_id ORDER BY id) AS rn
      FROM hotlist_jobs WHERE description LIKE '[SEED]%'
  ) j
 WHERE j.rn <= 3;

-- -------------------------------------------------------------
-- 9. Reset passwords for the test admin / field accounts so dev and
--    prod stay in sync. The hash below is bcrypt('winchester2', 10).
--    session_version is bumped so any stale session tokens 401 and
--    force a fresh login.
-- -------------------------------------------------------------
UPDATE users
   SET password_hash   = '$2b$10$uhjzyYsYxmR7rr5p2KIhjeaqR9XKCA8ofSwWY.ZrSv1VrsD5KQ4eS',
       session_version = COALESCE(session_version, 0) + 1
 WHERE lower(username) IN (
   'exxon@vndrly.com','mach@vndrly.com','baker@vndrly.com','winchester@vndrly.com',
   'tristan','daniel','joe.boggs@winchester.com','matt@elerick.com',
   'exxon','mach','baker','winchester'
 );

COMMIT;

-- -------------------------------------------------------------
-- Verification report
-- -------------------------------------------------------------
\echo
\echo === Seeded ticket distribution ===
SELECT v.name AS vendor, p.name AS partner, t.status, COUNT(*)
  FROM tickets t
  JOIN site_locations sl ON sl.id = t.site_location_id
  JOIN vendors v  ON v.id = t.vendor_id
  JOIN partners p ON p.id = sl.partner_id
 WHERE t.description LIKE '[SEED]%'
 GROUP BY v.name, p.name, t.status
 ORDER BY v.name, p.name, t.status;

\echo
\echo === Seeded hotlist jobs ===
SELECT p.name AS partner, j.title, j.status, j.awarded_vendor_id,
       (SELECT COUNT(*) FROM hotlist_bids b WHERE b.job_id = j.id) AS bids,
       (SELECT COUNT(*) FROM hotlist_comments c WHERE c.job_id = j.id) AS comments
  FROM hotlist_jobs j JOIN partners p ON p.id = j.partner_id
 WHERE j.description LIKE '[SEED]%'
 ORDER BY p.name, j.id;

\echo
\echo === Totals ===
SELECT
  (SELECT COUNT(*) FROM tickets        WHERE description LIKE '[SEED]%') AS seed_tickets,
  (SELECT COUNT(*) FROM ticket_crew    WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%')) AS seed_crew,
  (SELECT COUNT(*) FROM ticket_line_items WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%')) AS seed_line_items,
  (SELECT COUNT(*) FROM ticket_status_history WHERE ticket_id IN (SELECT id FROM tickets WHERE description LIKE '[SEED]%')) AS seed_history,
  (SELECT COUNT(*) FROM hotlist_jobs   WHERE description LIKE '[SEED]%') AS seed_hotlist_jobs,
  (SELECT COUNT(*) FROM hotlist_bids   WHERE job_id IN (SELECT id FROM hotlist_jobs WHERE description LIKE '[SEED]%')) AS seed_hotlist_bids,
  (SELECT COUNT(*) FROM hotlist_comments WHERE job_id IN (SELECT id FROM hotlist_jobs WHERE description LIKE '[SEED]%')) AS seed_hotlist_comments;
