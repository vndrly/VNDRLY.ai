CREATE TABLE IF NOT EXISTS ticket_number_reservations (
  ticket_number integer PRIMARY KEY,
  vendor_id integer NOT NULL REFERENCES vendors(id),
  partner_id integer NOT NULL REFERENCES partners(id),
  work_type_id integer NOT NULL REFERENCES work_types(id),
  billing_unit text NOT NULL DEFAULT 'day',
  provisional_unit_rate numeric(14,2),
  site_location_id integer REFERENCES site_locations(id),
  service_start_at timestamptz,
  afe_code text,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ticket_number_reservations (
  ticket_number, vendor_id, partner_id, work_type_id, billing_unit,
  provisional_unit_rate, site_location_id, service_start_at, afe_code
)
SELECT 100001, v.id, p.id, wt.id, 'day', 1000.00, NULL, NULL, NULL
FROM vendors v, partners p, work_types wt
WHERE lower(v.name) = 'midcon solutions'
  AND lower(p.name) = 'flywheel energy'
  AND lower(wt.name) = 'gatekeeping'
ON CONFLICT (ticket_number) DO NOTHING;

INSERT INTO ticket_number_reservations (
  ticket_number, vendor_id, partner_id, work_type_id, billing_unit,
  provisional_unit_rate, site_location_id, service_start_at, afe_code
)
SELECT 100002, v.id, p.id, wt.id, 'day', 1000.00, NULL, NULL, NULL
FROM vendors v, partners p, work_types wt
WHERE lower(v.name) = 'midcon solutions'
  AND lower(p.name) = 'warwick energy group'
  AND lower(wt.name) = 'gatekeeping'
ON CONFLICT (ticket_number) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('tickets', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 0) FROM tickets), 100002),
  true
);
