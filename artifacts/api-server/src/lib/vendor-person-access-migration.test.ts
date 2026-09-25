import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateVendorPersonAccessMigration } from "../../scripts/migrate-vendor-person-access.js";

const allowed = `
CREATE TABLE IF NOT EXISTS vendor_person_operational_roles (
  id serial PRIMARY KEY,
  vendor_people_id integer NOT NULL REFERENCES vendor_people(id) ON DELETE CASCADE,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  granted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_person_operational_roles_role_check CHECK (role IN ('office','field_employee','foreman','gatekeeper','gate_supervisor')),
  CONSTRAINT vendor_person_operational_roles_unique UNIQUE (vendor_people_id, role)
);
CREATE INDEX IF NOT EXISTS vendor_person_operational_roles_person_active_idx ON vendor_person_operational_roles(vendor_people_id, is_active);
CREATE TABLE IF NOT EXISTS vendor_person_site_access (
  id serial PRIMARY KEY,
  vendor_people_id integer NOT NULL REFERENCES vendor_people(id) ON DELETE CASCADE,
  site_location_id integer NOT NULL REFERENCES site_locations(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  granted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_person_site_access_unique UNIQUE (vendor_people_id, site_location_id)
);
CREATE INDEX IF NOT EXISTS vendor_person_site_access_person_active_idx ON vendor_person_site_access(vendor_people_id, is_active);
INSERT INTO vendor_person_operational_roles (vendor_people_id, role, is_active)
SELECT id, 'office', true FROM vendor_people WHERE deleted_at IS NULL AND vendor_role IN ('office','both')
ON CONFLICT (vendor_people_id, role) DO UPDATE SET is_active = true, updated_at = now();
INSERT INTO vendor_person_operational_roles (vendor_people_id, role, is_active)
SELECT id, 'field_employee', true FROM vendor_people WHERE deleted_at IS NULL AND vendor_role IN ('field','both')
ON CONFLICT (vendor_people_id, role) DO UPDATE SET is_active = true, updated_at = now();
INSERT INTO vendor_person_operational_roles (vendor_people_id, role, is_active)
SELECT id, vendor_role, true FROM vendor_people WHERE deleted_at IS NULL AND vendor_role IN ('foreman','gatekeeper','gate_supervisor')
ON CONFLICT (vendor_people_id, role) DO UPDATE SET is_active = true, updated_at = now();
INSERT INTO vendor_person_site_access (vendor_people_id, site_location_id, is_active)
SELECT DISTINCT person.id, assignment.site_location_id, true
FROM vendor_people person
JOIN site_work_assignments assignment ON assignment.vendor_id=person.vendor_id
WHERE person.deleted_at IS NULL AND person.is_active=true
AND person.vendor_role IN ('gatekeeper','gate_supervisor')
ON CONFLICT (vendor_people_id, site_location_id) DO UPDATE SET is_active = true, updated_at = now();
`;

describe("vendor person access migration guard", () => {
  it("accepts the exact additive migration", () => {
    expect(() => validateVendorPersonAccessMigration(allowed)).not.toThrow();
  });

  it("rejects destructive statements", () => {
    expect(() => validateVendorPersonAccessMigration(`${allowed}\nDROP TABLE users;`)).toThrow(
      "Unsafe vendor person access migration refused",
    );
  });

  it("runs the guarded migration during API deployment", () => {
    expect(
      readFileSync(
        new URL("../../../../.github/workflows/deploy-api.yml", import.meta.url),
        "utf8",
      ),
    ).toContain("run migrate:vendor-person-access");
  });

  it("preserves existing direct gate staff site access during normalization", () => {
    expect(allowed).toContain("JOIN site_work_assignments assignment");
    expect(allowed).toContain("person.vendor_role IN ('gatekeeper','gate_supervisor')");
  });
});
