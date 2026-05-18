import type pg from "pg";

// Shared fixture row builders for every Playwright spec under
// lib/e2e/tests/.
//
// Each helper wraps exactly one INSERT and returns the new row's id.
// The point isn't to hide SQL — every column the spec cares about is
// still passed in by the caller — it's to keep the column list /
// table name / RETURNING shape in one place so a future schema
// change is fixed once instead of grepping every spec for raw
// `INSERT INTO partners` strings.
//
// Conventions:
//   - Every helper takes the `pg.Pool` as the first argument so it
//     plays nicely with the `createPool()` factory in `./db`.
//   - Every helper returns `{ id }` so call sites can keep their
//     `.id` chain readable. If a spec ever needs more columns back
//     we add a typed return; for now id-only matches the existing
//     usage in the two specs this skill targets.

export interface CreatePartnerInput {
  name: string;
  contactName: string;
  contactEmail: string;
}

/**
 * Insert a partners row. Used as the parent for site_locations and
 * for partner-side user_org_memberships in both the
 * org-members-flow and deactivated-field-employee-pickers specs.
 */
export async function createPartner(
  pool: pg.Pool,
  input: CreatePartnerInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO partners (name, contact_name, contact_email)
     VALUES ($1, $2, $3) RETURNING id`,
    [input.name, input.contactName, input.contactEmail],
  );
  return rows[0];
}

export interface CreateVendorInput {
  name: string;
  contactName: string;
  contactEmail: string;
}

/**
 * Insert a vendors row. Used as the parent for vendor_people,
 * tickets, site_work_assignments, and vendor-side
 * user_org_memberships.
 */
export async function createVendor(
  pool: pg.Pool,
  input: CreateVendorInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO vendors (name, contact_name, contact_email)
     VALUES ($1, $2, $3) RETURNING id`,
    [input.name, input.contactName, input.contactEmail],
  );
  return rows[0];
}

export interface CreateWorkTypeInput {
  name: string;
  category: string;
}

/**
 * Insert a work_types row. Required so every ticket can carry a
 * work_type_id and so site_work_assignments can connect a vendor to
 * a (site, work_type) pair.
 */
export async function createWorkType(
  pool: pg.Pool,
  input: CreateWorkTypeInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO work_types (name, category) VALUES ($1, $2) RETURNING id`,
    [input.name, input.category],
  );
  return rows[0];
}

export interface CreateSiteLocationInput {
  partnerId: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  siteCode: string;
  siteRadiusMeters: number;
}

/**
 * Insert a site_locations row. The `siteCode` is what the Field
 * Operations Portal URL keys off (`/portal/:siteCode`) so callers
 * pick it themselves to keep the URL stable across the fixture life.
 */
export async function createSiteLocation(
  pool: pg.Pool,
  input: CreateSiteLocationInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO site_locations
       (partner_id, name, address, latitude, longitude, site_code, site_radius_meters)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.partnerId,
      input.name,
      input.address,
      input.latitude,
      input.longitude,
      input.siteCode,
      input.siteRadiusMeters,
    ],
  );
  return rows[0];
}

export interface CreateSiteWorkAssignmentInput {
  siteLocationId: number;
  workTypeId: number;
  vendorId: number;
}

/**
 * Insert a site_work_assignments row — the join that says "vendor V
 * is eligible for work-type W at site S". Without it the
 * phone-intake and Create-New-Job pickers won't surface the vendor
 * at all.
 */
export async function createSiteWorkAssignment(
  pool: pg.Pool,
  input: CreateSiteWorkAssignmentInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO site_work_assignments (site_location_id, work_type_id, vendor_id)
     VALUES ($1, $2, $3)`,
    [input.siteLocationId, input.workTypeId, input.vendorId],
  );
}

export interface CreateUserInput {
  username: string;
  /**
   * Optional email column. Most call sites pass the same value as
   * `username` (matching the existing `$1, $1` shape inside the
   * raw SQL the specs used to inline) but the org-members spec
   * leaves email NULL on a couple of rows, so this is opt-in.
   */
  email?: string;
  passwordHash: string;
  role: "admin" | "vendor" | "partner" | "field_employee";
  displayName: string;
}

/**
 * Insert a users row. The two specs hash with bcrypt via the
 * `hashPassword` helper in `./db` and then pass the hash in here.
 */
export async function createUser(
  pool: pg.Pool,
  input: CreateUserInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (username, email, password_hash, role, display_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.username,
      input.email ?? null,
      input.passwordHash,
      input.role,
      input.displayName,
    ],
  );
  return rows[0];
}

export interface CreateUserOrgMembershipInput {
  userId: number;
  orgType: "partner" | "vendor";
  partnerId?: number;
  vendorId?: number;
  role: string;
}

/**
 * Insert a user_org_memberships row. The caller picks which of
 * partner_id / vendor_id is non-null to match the orgType, mirroring
 * the api-server's column rules.
 */
export async function createUserOrgMembership(
  pool: pg.Pool,
  input: CreateUserOrgMembershipInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO user_org_memberships (user_id, org_type, partner_id, vendor_id, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.userId,
      input.orgType,
      input.partnerId ?? null,
      input.vendorId ?? null,
      input.role,
    ],
  );
  return rows[0];
}

/**
 * Pin `users.active_membership_id` so the post-login org picker is
 * skipped on the first request. resolveContext only auto-sets this
 * for single-membership users on first login otherwise — preseeding
 * it makes the test's first navigation deterministic.
 */
export async function setActiveMembership(
  pool: pg.Pool,
  input: { userId: number; membershipId: number },
): Promise<void> {
  await pool.query(
    `UPDATE users SET active_membership_id = $1 WHERE id = $2`,
    [input.membershipId, input.userId],
  );
}

export interface CreateVendorPersonInput {
  vendorId: number;
  vendorRole: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  /**
   * Optional users.id link. The schedule-dialog foreman picker only
   * lists crew members whose vendor_people row has a userId, so
   * tests that need a "real" foreman must pass it.
   */
  userId?: number;
}

/**
 * Insert a vendor_people row — the canonical "field employee on
 * this vendor" record. `is_active = false` is what makes a row
 * disappear from every vendor-side picker.
 */
export async function createVendorPerson(
  pool: pg.Pool,
  input: CreateVendorPersonInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO vendor_people
       (vendor_id, vendor_role, first_name, last_name, email, is_active, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.vendorId,
      input.vendorRole,
      input.firstName,
      input.lastName,
      input.email,
      input.isActive,
      input.userId ?? null,
    ],
  );
  return rows[0];
}

export interface CreateTicketInput {
  siteLocationId: number;
  vendorId: number;
  workTypeId: number;
  status: string;
  intakeChannel: string;
  description: string;
}

/**
 * Insert a tickets row. The ticket id is what the deactivated
 * pickers spec navigates to with `/tickets/:id` to render every
 * editable picker on the ticket detail page.
 */
export async function createTicket(
  pool: pg.Pool,
  input: CreateTicketInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO tickets
       (site_location_id, vendor_id, work_type_id, status, intake_channel, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.siteLocationId,
      input.vendorId,
      input.workTypeId,
      input.status,
      input.intakeChannel,
      input.description,
    ],
  );
  return rows[0];
}
