import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const VENDOR_PERSON_ACCESS_MIGRATION = `
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

const ALLOWED_STATEMENT_PREFIXES = [
  "CREATE TABLE IF NOT EXISTS vendor_person_operational_roles",
  "CREATE INDEX IF NOT EXISTS vendor_person_operational_roles_person_active_idx",
  "CREATE TABLE IF NOT EXISTS vendor_person_site_access",
  "CREATE INDEX IF NOT EXISTS vendor_person_site_access_person_active_idx",
  "INSERT INTO vendor_person_operational_roles (vendor_people_id, role, is_active) SELECT id, 'office'",
  "INSERT INTO vendor_person_operational_roles (vendor_people_id, role, is_active) SELECT id, 'field_employee'",
  "INSERT INTO vendor_person_operational_roles (vendor_people_id, role, is_active) SELECT id, vendor_role",
  "INSERT INTO vendor_person_site_access (vendor_people_id, site_location_id, is_active) SELECT DISTINCT person.id",
] as const;

export function validateVendorPersonAccessMigration(source: string): void {
  const statements = source
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (
    statements.length !== ALLOWED_STATEMENT_PREFIXES.length ||
    statements.some(
      (statement, index) => !statement.startsWith(ALLOWED_STATEMENT_PREFIXES[index]),
    )
  ) {
    throw new Error("Unsafe vendor person access migration refused");
  }
}

async function main(): Promise<void> {
  validateVendorPersonAccessMigration(VENDOR_PERSON_ACCESS_MIGRATION);
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(VENDOR_PERSON_ACCESS_MIGRATION);
    await client.query("COMMIT");
    console.log("Vendor person access guarded additive migration passed");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
