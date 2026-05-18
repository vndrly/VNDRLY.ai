import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import type pg from "pg";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createPartner,
  createSiteLocation,
  createSiteWorkAssignment,
  createTicket,
  createUser,
  createUserOrgMembership,
  createVendor,
  createVendorPerson,
  createWorkType,
  setActiveMembership,
} from "../helpers/fixtures";

// End-to-end smoke test for Task #524: the office-deactivate /
// field-refresh crew flow.
//
// Both halves of Task #524 already have unit-level coverage:
//   - Server: artifacts/api-server/src/routes/crew-employee-inactive.test.ts
//     pins the new 409 + `code: "crew.employee_inactive"` contract.
//   - Mobile: artifacts/vndrly-mobile/components/CrewTimeSection.test.tsx
//     pins the inline-error UX and the 60s-sync-tick refetch that prunes
//     the deactivated worker from the foreman in/out roster.
//
// What was missing is a wire-level test that walks the whole flow against
// a real api-server + database fixture, so a regression in either half
// (server changes the code; mobile changes the URL it polls) is caught
// even when the two unit suites still pass independently. That's what
// this spec does. It uses Playwright's APIRequestContext (no browser is
// needed — the mobile UI piece is exercised by the unit test above) and
// goes through the shared dev proxy (baseURL → /api/...) so the request
// path matches what the mobile client actually sends.
//
// The spec deliberately mirrors the four-step sequence in the task brief:
//   1. office (vendor admin) deactivates a crew member
//   2. mobile (foreman) attempts to check that worker in
//   3. mobile sees the 409 + `crew.employee_inactive` code (the body the
//      mobile component pins under the row as the localized inline error)
//   4. on the next /api/field-employees poll (the same query the mobile
//      sync tick fires every 60s) the worker is pruned from the active
//      list, so the row would disappear in the UI.

type Seed = {
  partnerId: number;
  vendorId: number;
  workTypeId: number;
  siteId: number;
  ticketId: number;
  // Vendor admin acting as the "office" — performs the deactivation.
  vendorAdminUserId: number;
  vendorAdminUsername: string;
  vendorAdminMembershipId: number;
  // Field-employee user acting as the "foreman" — attempts the check-in.
  foremanUserId: number;
  foremanUsername: string;
  foremanVendorPersonId: number;
};

const PASSWORD = "e524pass123";

let pool: pg.Pool;
let seed: Seed;

async function seedFixture(): Promise<Seed> {
  const stamp = makeStamp();
  const passwordHash = hashPassword(PASSWORD);
  const siteCode = `E524${stamp.toUpperCase()}`.slice(0, 16);

  const partner = await createPartner(pool, {
    name: `E524 Partner ${stamp}`,
    contactName: "E524 Contact",
    contactEmail: `e524-partner-${stamp}@example.com`,
  });
  const vendor = await createVendor(pool, {
    name: `E524 Vendor ${stamp}`,
    contactName: "E524 Vendor Contact",
    contactEmail: `e524-vendor-${stamp}@example.com`,
  });
  const workType = await createWorkType(pool, {
    name: `E524 Work Type ${stamp}`,
    category: "general",
  });
  const site = await createSiteLocation(pool, {
    partnerId: partner.id,
    name: `E524 Site ${stamp}`,
    address: "1 Deactivate Way",
    latitude: 40.0,
    longitude: -74.0,
    siteCode,
    siteRadiusMeters: 150,
  });
  await createSiteWorkAssignment(pool, {
    siteLocationId: site.id,
    workTypeId: workType.id,
    vendorId: vendor.id,
  });

  // Vendor admin "office" user. ensureCrewMutate / the field-employees
  // PATCH route both require role=vendor + membershipRole=admin, scoped
  // to the same vendorId as the target row.
  const vendorAdminUsername = `e524-office-${stamp}@example.com`;
  const vendorAdminUser = await createUser(pool, {
    username: vendorAdminUsername,
    email: vendorAdminUsername,
    passwordHash,
    role: "vendor",
    displayName: `E524 Office ${stamp}`,
  });
  const vendorAdminMembership = await createUserOrgMembership(pool, {
    userId: vendorAdminUser.id,
    orgType: "vendor",
    vendorId: vendor.id,
    role: "admin",
  });
  await setActiveMembership(pool, {
    userId: vendorAdminUser.id,
    membershipId: vendorAdminMembership.id,
  });

  // Foreman field_employee user. The crew check-in route allows a
  // field_employee session through ensureCrewMutate iff their
  // vendor_people row has vendorRole in {foreman, both} and the same
  // vendorId as the ticket. resolveContext for a field_employee with no
  // membership row falls back to the vendor_people row by userId, so we
  // intentionally don't create a membership for this user.
  const foremanUsername = `e524-foreman-${stamp}@example.com`;
  const foremanUser = await createUser(pool, {
    username: foremanUsername,
    email: foremanUsername,
    passwordHash,
    role: "field_employee",
    displayName: `E524 Foreman ${stamp}`,
  });
  const foremanVp = await createVendorPerson(pool, {
    vendorId: vendor.id,
    vendorRole: "foreman",
    firstName: "E524Foreman",
    lastName: stamp,
    email: foremanUsername,
    isActive: true,
    userId: foremanUser.id,
  });

  // The ticket the foreman has open in the mobile app. Status must be in
  // MUTABLE_TICKET_STATUSES so ensureCrewMutate doesn't 409 on
  // ticket.not_editable before we get to the inactive guard.
  const ticket = await createTicket(pool, {
    siteLocationId: site.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    status: "in_progress",
    intakeChannel: "partner_self_service",
    description: "E524 ticket",
  });

  return {
    partnerId: partner.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    siteId: site.id,
    ticketId: ticket.id,
    vendorAdminUserId: vendorAdminUser.id,
    vendorAdminUsername,
    vendorAdminMembershipId: vendorAdminMembership.id,
    foremanUserId: foremanUser.id,
    foremanUsername,
    foremanVendorPersonId: foremanVp.id,
  };
}

async function cleanup(s: Seed): Promise<void> {
  // FK-safe order. Crew sessions cascade off tickets; user_org_memberships
  // cascades off users. We delete vendor_people explicitly before users
  // because vendorPeople.userId references users.id (and the foreman row
  // owns one). work_types is deleted last among the org rows because
  // tickets reference it.
  await pool.query(`DELETE FROM tickets WHERE id = $1`, [s.ticketId]);
  await pool.query(
    `DELETE FROM site_work_assignments WHERE site_location_id = $1`,
    [s.siteId],
  );
  await pool.query(`DELETE FROM site_locations WHERE id = $1`, [s.siteId]);
  await pool.query(`DELETE FROM vendor_people WHERE id = $1`, [
    s.foremanVendorPersonId,
  ]);
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [
    s.vendorAdminUserId,
    s.foremanUserId,
  ]);
  await pool.query(`DELETE FROM work_types WHERE id = $1`, [s.workTypeId]);
  await pool.query(`DELETE FROM vendors WHERE id = $1`, [s.vendorId]);
  await pool.query(`DELETE FROM partners WHERE id = $1`, [s.partnerId]);
}

// Shared APIRequestContexts so each "actor" carries its own session
// cookie. We mint these in beforeAll once login has succeeded and
// dispose them in afterAll.
let officeApi: APIRequestContext;
let foremanApi: APIRequestContext;

async function loginAndBuildContext(
  baseURL: string,
  username: string,
  password: string,
): Promise<APIRequestContext> {
  // Step 1: do the login on a throwaway context so we can read the
  // Set-Cookie header. Playwright's APIRequestContext keeps cookies in
  // its own storageState, but pulling them across contexts is simpler
  // (and matches how the dev proxy stamps the auth cookie) when we
  // capture the response cookies and replay them in the actor context.
  const tmp = await pwRequest.newContext({ baseURL });
  const res = await tmp.post("/api/auth/login", {
    data: { username, password },
  });
  expect(
    res.ok(),
    `login for ${username} should succeed (got ${res.status()})`,
  ).toBe(true);
  const state = await tmp.storageState();
  await tmp.dispose();
  // Step 2: rebuild a long-lived context seeded with the just-captured
  // session cookie. Every subsequent request goes through this context
  // so the cookie is reused automatically.
  return pwRequest.newContext({ baseURL, storageState: state });
}

test.describe.serial(
  "Task #524 — office-deactivate / field-refresh end-to-end smoke",
  () => {
    test.beforeAll(async () => {
      pool = createPool();
      seed = await seedFixture();

      const baseURL =
        process.env.E2E_BASE_URL ?? "http://localhost:23539";
      officeApi = await loginAndBuildContext(
        baseURL,
        seed.vendorAdminUsername,
        PASSWORD,
      );
      foremanApi = await loginAndBuildContext(
        baseURL,
        seed.foremanUsername,
        PASSWORD,
      );
    });

    test.afterAll(async () => {
      await officeApi?.dispose();
      await foremanApi?.dispose();
      if (seed) {
        try {
          await cleanup(seed);
        } catch (e) {
          console.error("E524 cleanup failed:", e);
        }
      }
      await pool?.end();
    });

    test("foreman → office → foreman: deactivation 409s the check-in and the next field-employees poll prunes the row", async () => {
      // ── Baseline: the active-only field-employees listing includes
      // the worker.
      //
      // Mobile CrewTimeSection.tsx (line 218-219) polls
      // `/api/field-employees?vendorId=<v>` on mount and on every 60s
      // sync tick to derive the foreman in/out roster. The route only
      // accepts admin / vendor sessions (line 92 of fieldEmployees.ts),
      // so we verify the listing using the vendor admin's session — the
      // contract the mobile relies on (active-only by default) is the
      // same regardless of which allowed actor is calling. The list
      // must initially include the worker so the "row pruned on next
      // tick" assertion later is meaningful.
      const baselineRes = await officeApi.get(
        `/api/field-employees?vendorId=${seed.vendorId}`,
      );
      expect(baselineRes.ok()).toBe(true);
      const baseline = (await baselineRes.json()) as Array<{ id: number }>;
      expect(
        baseline.some((e) => e.id === seed.foremanVendorPersonId),
        "baseline /api/field-employees should include the active foreman",
      ).toBe(true);

      // ── (1) Office deactivates the crew member ─────────────────────
      //
      // PATCH /api/field-employees/:id with isActive=false is the same
      // endpoint the web admin "Deactivate" button hits. The vendor
      // admin can target this row because session.vendorId matches the
      // employee's vendorId.
      const deactivateRes = await officeApi.patch(
        `/api/field-employees/${seed.foremanVendorPersonId}`,
        { data: { isActive: false } },
      );
      expect(
        deactivateRes.ok(),
        `office deactivation should succeed (got ${deactivateRes.status()}: ${await deactivateRes.text()})`,
      ).toBe(true);
      const deactivated = (await deactivateRes.json()) as { isActive?: boolean };
      expect(deactivated.isActive).toBe(false);

      // Belt-and-braces: the underlying column actually flipped.
      const dbCheck = await pool.query<{ is_active: boolean }>(
        `SELECT is_active FROM vendor_people WHERE id = $1`,
        [seed.foremanVendorPersonId],
      );
      expect(dbCheck.rows[0]?.is_active).toBe(false);

      // ── (2) + (3) Foreman taps In; server replies 409 with the
      // crew.employee_inactive code the mobile component maps to the
      // localized "That crew member was just deactivated…" inline error.
      const checkInRes = await foremanApi.post(
        `/api/tickets/${seed.ticketId}/crew/${seed.foremanVendorPersonId}/check-in`,
        { data: {} },
      );
      expect(checkInRes.status()).toBe(409);
      const checkInBody = (await checkInRes.json()) as {
        error?: string;
        code?: string;
      };
      expect(checkInBody.code).toBe("crew.employee_inactive");
      // The mobile error mapper keys on `code`, but `error` is a useful
      // human-readable signal for log forensics if this ever drifts.
      expect(typeof checkInBody.error).toBe("string");
      expect((checkInBody.error ?? "").length).toBeGreaterThan(0);

      // No session row was created — the inactive guard short-circuits
      // before the insert. The crew_sessions list for this ticket must
      // therefore still be empty.
      const sessionsRes = await foremanApi.get(
        `/api/tickets/${seed.ticketId}/crew-sessions`,
      );
      expect(sessionsRes.ok()).toBe(true);
      const sessions = (await sessionsRes.json()) as unknown[];
      expect(sessions).toHaveLength(0);

      // ── (4) Next mobile sync poll prunes the row ───────────────────
      //
      // The 60s sync tick re-fires the same /api/field-employees query
      // that ran in the baseline assertion. The route defaults to
      // `isActive = true`, so the deactivated worker must be gone from
      // the next poll's payload — that's what makes the in/out row
      // disappear from the foreman's screen without a remount. We
      // re-use the office (vendor admin) session for the same reason
      // as the baseline: the listing route refuses field_employee
      // sessions, so the contract has to be exercised by an allowed
      // actor.
      const polledRes = await officeApi.get(
        `/api/field-employees?vendorId=${seed.vendorId}`,
      );
      expect(polledRes.ok()).toBe(true);
      const polled = (await polledRes.json()) as Array<{
        id: number;
        isActive?: boolean | null;
      }>;
      expect(
        polled.some((e) => e.id === seed.foremanVendorPersonId),
        "after deactivation, /api/field-employees must no longer include the worker",
      ).toBe(false);
      // Anything still in the list must be active — sanity check that the
      // server didn't accidentally start returning inactive rows by default.
      for (const e of polled) {
        expect(e.isActive).not.toBe(false);
      }
    });
  },
);
