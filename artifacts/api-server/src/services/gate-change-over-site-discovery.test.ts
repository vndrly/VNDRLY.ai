import { beforeEach, describe, expect, it, vi } from "vitest";

type Site = {
  id: number;
  name: string;
  partner_id: number;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  hidden: boolean;
};

const state = vi.hoisted(() => ({
  queries: [] as string[],
  sites: [] as Site[],
  user: { id: 7, role: "admin", session_version: 4, suspended_at: null as Date | null },
  memberships: [] as Array<{ id: number; user_id: number; org_type: "partner" | "vendor"; partner_id?: number; vendor_id?: number; vendor_people_id?: number; role: string }>,
  assignments: [] as Array<{ id: number; site_location_id: number; vendor_id: number; is_gate_contractor: boolean }>,
  normalized: [] as Array<{ vendor_people_id: number; site_location_id: number; role: "gatekeeper" | "gate_supervisor"; is_active: boolean }>,
  staff: [] as Array<{ user_id: number; vendor_id: number; vendor_role: "gatekeeper" | "gate_supervisor"; is_active: boolean; deleted_at: Date | null }>,
  grants: [] as Array<{ worker_user_id: number; sponsor_vendor_id: number; site_id: number; role: "gatekeeper" | "gate_supervisor"; sponsorship_status: string; grant_status: string }>,
}));

function ids(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : [Number(value)];
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push(sql);
      if (sql.includes("WITH current_account AS")) {
        const [userId, sessionVersion, role, partnerId, vendorId, membershipId, membershipRole, managed] = values;
        if (state.user.id !== userId || state.user.session_version !== sessionVersion || state.user.suspended_at)
          return result([]);
        const membership = state.memberships.filter((candidate) => candidate.user_id === userId
          && (membershipId == null || candidate.id === membershipId)
          && (role === "partner"
            ? candidate.org_type === "partner" && candidate.partner_id === partnerId && ["admin", "member"].includes(candidate.role)
            : candidate.org_type === "vendor" && candidate.vendor_id === vendorId));
        const candidates = state.sites
          .filter((site) => site.is_active && !site.hidden)
          .filter((site) => role === "admin"
            || (role === "partner" && site.partner_id === partnerId)
            || state.assignments.some((assignment) => assignment.site_location_id === site.id
              && assignment.vendor_id === vendorId && assignment.is_gate_contractor));
        const visible = candidates.flatMap((site) => {
          if (role === "admin") return state.user.role === "admin" ? [{ site, supervisor: true }] : [];
          if (role === "partner") return membership.length ? [{ site, supervisor: true }] : [];
          if (!["vendor", "field_employee"].includes(String(role)) || !membership.length) return [];
          if (role === "vendor" && membershipRole === "admin" && membership.some((row) => row.role === "admin"))
            return [{ site, supervisor: true }];
          if (managed) {
            const roles = state.grants.filter((grant) => grant.worker_user_id === userId
              && grant.sponsor_vendor_id === vendorId && grant.site_id === site.id
              && grant.sponsorship_status === "active" && grant.grant_status === "active");
            return roles.length ? [{ site, supervisor: roles.some((grant) => grant.role === "gate_supervisor") }] : [];
          }
          const personIds = membership.map((row) => row.vendor_people_id).filter((id): id is number => id !== undefined);
          const normalized = state.normalized.filter((entry) => personIds.includes(entry.vendor_people_id)
            && entry.site_location_id === site.id && entry.is_active);
          const legacy = state.staff.filter((person) => person.user_id === userId && person.vendor_id === vendorId
            && person.is_active && person.deleted_at == null);
          const roles = normalized.length ? normalized.map((entry) => entry.role) : legacy.map((person) => person.vendor_role);
          return roles.length ? [{ site, supervisor: roles.includes("gate_supervisor") }] : [];
        }).sort((left, right) => left.site.name.localeCompare(right.site.name));
        return result(visible.length
          ? visible.map(({ site, supervisor }) => ({ session_user_id: userId, id: site.id, name: site.name, latitude: site.latitude, longitude: site.longitude, supervisor }))
          : [{ session_user_id: userId, id: null, name: null, latitude: null, longitude: null, supervisor: null }]);
      }
      if (sql.startsWith("SELECT id, role, session_version")) {
        return result(state.user.id === values[0] ? [state.user] : []);
      }
      if (sql.startsWith("SELECT s.id, s.name")) {
        const [role, partnerId, vendorId] = values;
        return result(state.sites
          .filter((site) => site.is_active && !site.hidden)
          .filter((site) => role === "admin"
            || (role === "partner" && site.partner_id === partnerId)
            || state.assignments.some((assignment) => assignment.site_location_id === site.id
              && assignment.vendor_id === vendorId && assignment.is_gate_contractor))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(({ id, name, latitude, longitude }) => ({ id, name, latitude, longitude })));
      }
      if (sql.startsWith("SELECT id, name, partner_id")) {
        const site = state.sites.find((candidate) => candidate.id === values[0]
          && (values[1] === true || candidate.is_active) && !candidate.hidden);
        return result(site ? [site] : []);
      }
      if (sql.startsWith("SELECT id FROM site_work_assignments")) {
        return result(state.assignments.filter((assignment) => assignment.vendor_id === values[0]
          && assignment.site_location_id === values[1] && assignment.is_gate_contractor).slice(0, 1));
      }
      if (sql.includes("FROM user_org_memberships")) {
        const [userId, orgId, membershipId] = values;
        const orgType = sql.includes("org_type='partner'") ? "partner" : "vendor";
        return result(state.memberships.filter((membership) => membership.user_id === userId
          && membership.org_type === orgType
          && membership[orgType === "partner" ? "partner_id" : "vendor_id"] === orgId
          && (membershipId == null || membership.id === membershipId)
          && (orgType === "vendor" || ["admin", "member"].includes(membership.role)))
          .map((membership) => orgType === "partner"
            ? { id: membership.id }
            : { id: membership.id, vendor_people_id: membership.vendor_people_id, role: membership.role }));
      }
      if (sql.includes("FROM managed_subcontractor_worker_sponsorships")) {
        const siteIds = ids(values[2]);
        return result(state.grants.filter((grant) => grant.worker_user_id === values[0]
          && grant.sponsor_vendor_id === values[1] && siteIds.includes(grant.site_id)
          && grant.sponsorship_status === "active" && grant.grant_status === "active")
          .map((grant) => ({ site_id: grant.site_id, role: grant.role })));
      }
      if (sql.includes("FROM vendor_person_operational_roles")) {
        const siteIds = ids(values[1]);
        return result(state.normalized.filter((role) => role.vendor_people_id === values[0]
          && siteIds.includes(role.site_location_id) && role.is_active)
          .map((role) => ({ site_id: role.site_location_id, role: role.role })));
      }
      if (sql.startsWith("SELECT vendor_role")) {
        return result(state.staff.filter((person) => person.user_id === values[0]
          && person.vendor_id === values[1] && person.is_active && person.deleted_at == null)
          .map((person) => ({ vendor_role: person.vendor_role })));
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  },
}));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: async () => {} }));

import { listChangeOverSites } from "./gate-change-over";

const baseSites: Site[] = [
  { id: 1, name: "Alpha", partner_id: 20, latitude: 35, longitude: -97, is_active: true, hidden: false },
  { id: 2, name: "Inactive", partner_id: 20, latitude: null, longitude: null, is_active: false, hidden: false },
  { id: 3, name: "Hidden", partner_id: 20, latitude: null, longitude: null, is_active: true, hidden: true },
  { id: 4, name: "Bravo", partner_id: 21, latitude: 36, longitude: -98, is_active: true, hidden: false },
  { id: 5, name: "Charlie", partner_id: 20, latitude: null, longitude: null, is_active: true, hidden: false },
];

beforeEach(() => {
  state.queries = [];
  state.sites = baseSites.map((site) => ({ ...site }));
  state.user = { id: 7, role: "admin", session_version: 4, suspended_at: null };
  state.memberships = [];
  state.assignments = [
    { id: 101, site_location_id: 1, vendor_id: 30, is_gate_contractor: true },
    { id: 102, site_location_id: 2, vendor_id: 30, is_gate_contractor: true },
    { id: 103, site_location_id: 3, vendor_id: 30, is_gate_contractor: true },
    { id: 104, site_location_id: 4, vendor_id: 30, is_gate_contractor: true },
    { id: 105, site_location_id: 5, vendor_id: 30, is_gate_contractor: false },
  ];
  state.normalized = [];
  state.staff = [];
  state.grants = [];
});

describe("Gate site discovery", () => {
  it("keeps admin discovery at one database read regardless of visible site count", async () => {
    state.sites = Array.from({ length: 208 }, (_, index) => ({
      id: index + 1,
      name: `Site ${String(index + 1).padStart(3, "0")}`,
      partner_id: 20,
      latitude: null,
      longitude: null,
      is_active: true,
      hidden: false,
    }));

    const sites = await listChangeOverSites({ userId: 7, role: "admin", sv: 4 });

    expect(sites).toHaveLength(208);
    expect(sites.every((site) => site.supervisor)).toBe(true);
    expect(state.queries).toHaveLength(1);
  });

  it("preserves partner membership and vendor admin site authority without exposing inactive, hidden, or non-Gate assignments", async () => {
    state.user.role = "partner";
    state.memberships = [{ id: 70, user_id: 7, org_type: "partner", partner_id: 20, role: "member" }];
    await expect(listChangeOverSites({ userId: 7, role: "partner", partnerId: 20, activeMembershipId: 70, sv: 4 }))
      .resolves.toEqual([
        { id: 1, name: "Alpha", latitude: 35, longitude: -97, supervisor: true },
        { id: 5, name: "Charlie", latitude: null, longitude: null, supervisor: true },
      ]);
    expect(state.queries).toHaveLength(1);

    state.queries = [];
    state.user.role = "vendor";
    state.memberships = [{ id: 71, user_id: 7, org_type: "vendor", vendor_id: 30, vendor_people_id: 90, role: "admin" }];
    await expect(listChangeOverSites({ userId: 7, role: "vendor", vendorId: 30, activeMembershipId: 71, membershipRole: "admin", vendorRole: "office", sv: 4 }))
      .resolves.toEqual([
        { id: 1, name: "Alpha", latitude: 35, longitude: -97, supervisor: true },
        { id: 4, name: "Bravo", latitude: 36, longitude: -98, supervisor: true },
      ]);
    expect(state.queries).toHaveLength(1);
  });

  it("preserves direct and managed worker site grants and supervisor projection", async () => {
    state.user.role = "field_employee";
    state.memberships = [{ id: 72, user_id: 7, org_type: "vendor", vendor_id: 30, vendor_people_id: 90, role: "member" }];
    state.normalized = [
      { vendor_people_id: 90, site_location_id: 1, role: "gatekeeper", is_active: true },
    ];
    state.staff = [{ user_id: 7, vendor_id: 30, vendor_role: "gate_supervisor", is_active: true, deleted_at: null }];
    await expect(listChangeOverSites({ userId: 7, role: "field_employee", vendorId: 30, activeMembershipId: 72, vendorRole: "gatekeeper", sv: 4 }))
      .resolves.toEqual([
        { id: 1, name: "Alpha", latitude: 35, longitude: -97, supervisor: false },
        { id: 4, name: "Bravo", latitude: 36, longitude: -98, supervisor: true },
      ]);
    expect(state.queries).toHaveLength(1);

    state.queries = [];
    state.normalized = [];
    state.grants = [
      { worker_user_id: 7, sponsor_vendor_id: 30, site_id: 1, role: "gatekeeper", sponsorship_status: "active", grant_status: "active" },
      { worker_user_id: 7, sponsor_vendor_id: 30, site_id: 4, role: "gate_supervisor", sponsorship_status: "active", grant_status: "active" },
      { worker_user_id: 7, sponsor_vendor_id: 30, site_id: 5, role: "gate_supervisor", sponsorship_status: "active", grant_status: "active" },
    ];
    await expect(listChangeOverSites({
      userId: 7,
      role: "field_employee",
      vendorId: 30,
      activeMembershipId: 72,
      sv: 4,
      managedSubcontractor: { sponsorVendorId: 30, siteGrants: [] },
    } as never)).resolves.toEqual([
      { id: 1, name: "Alpha", latitude: 35, longitude: -97, supervisor: false },
      { id: 4, name: "Bravo", latitude: 36, longitude: -98, supervisor: true },
    ]);
    expect(state.queries).toHaveLength(1);
  });

  it("fails closed when the signed session is revoked before evaluating sites", async () => {
    state.user.session_version = 5;
    await expect(listChangeOverSites({ userId: 7, role: "admin", sv: 4 }))
      .rejects.toMatchObject({ status: 401, code: "change_over.session_changed" });
    expect(state.queries).toHaveLength(1);
  });
});
