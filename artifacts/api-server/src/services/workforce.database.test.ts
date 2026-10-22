import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

async function fixture() {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const s = await import("@workspace/db"), { resolveContext } = await import("../routes/auth");
  const tag = randomUUID();
  const [vendor] = await s.db.insert(s.vendorsTable).values({ name: `Workforce ${tag}`, contactName: "Synthetic", contactEmail: `${tag}@example.invalid` }).returning();
  const [partner] = await s.db.insert(s.partnersTable).values({ name: `Workforce Partner ${tag}`, contactName: "Synthetic", contactEmail: `p.${tag}@example.invalid` }).returning();
  const sites = await s.db.insert(s.siteLocationsTable).values(["A", "B"].map(name => ({ name, partnerId: partner.id, address: "Synthetic", latitude: 30, longitude: -100, siteCode: `${name}-${tag}` }))).returning();
  const [station] = await s.db.insert(s.gateStationsTable).values({ siteId: sites[0].id, name: "Synthetic Gate" }).returning();
  const [type] = await s.db.insert(s.workTypesTable).values({ name: `Gate ${tag}`, category: "gate" }).returning();
  await s.db.insert(s.siteWorkAssignmentsTable).values(sites.map(site => ({ siteLocationId: site.id, vendorId: vendor.id, workTypeId: type.id, isGateContractor: true })));
  await s.db.insert(s.partnerVendorRelationshipsTable).values({ partnerId: partner.id, vendorId: vendor.id, status: "approved" });
  const users = await s.db.insert(s.usersTable).values(["Admin", "Office", "Supervisor", "Prior", "Candidate1", "Candidate2", "SiteB"].map(name => ({ username: `${name}-${tag}`, passwordHash: "synthetic-not-a-login", displayName: name, role: name === "Admin" || name === "Office" ? "vendor" : "field_employee" }))).returning();
  const people = await s.db.insert(s.vendorPeopleTable).values(users.slice(1).map((user, index) => ({ userId: user.id, vendorId: vendor.id, firstName: user.displayName, lastName: "Synthetic", email: `${index}.${tag}@example.invalid`, phone: "private-phone", vendorRole: index === 0 ? "office" : index === 1 ? "gate_supervisor" : "gatekeeper" }))).returning();
  for (const person of people.slice(1)) {
    await s.db.insert(s.vendorPersonOperationalRolesTable).values({ vendorPeopleId: person.id, role: person.vendorRole as "gatekeeper" | "gate_supervisor" });
    await s.db.insert(s.vendorPersonSiteAccessTable).values({ vendorPeopleId: person.id, siteLocationId: sites[person.firstName === "SiteB" ? 1 : 0].id });
  }
  const memberships = await s.db.insert(s.userOrgMembershipsTable).values(users.map((user, index) => ({ userId: user.id, orgType: "vendor", vendorId: vendor.id, role: index === 0 ? "admin" : index === 1 ? "member" : "field_employee", vendorPeopleId: index ? people[index - 1].id : null }))).returning();
  const actors = [];
  for (const user of users) actors.push({ userId: user.id, ...(await resolveContext(user)), sv: user.sessionVersion });
  const startsAt = new Date(Date.now() + 24 * 3600000), endsAt = new Date(startsAt.getTime() + 3600000);
  await s.db.insert(s.workHubAvailabilityTable).values(users.slice(3, 6).map(user => ({ ownerOrgType: "vendor", ownerOrgId: vendor.id, userId: user.id, startsAt, endsAt, available: true })));
  const [shift] = await s.db.insert(s.workHubShiftsTable).values({ ownerOrgType: "vendor", ownerOrgId: vendor.id, title: "Synthetic staffing", startsAt, endsAt, timezone: "UTC", createdById: users[0].id, siteLocationId: sites[0].id, gateStationId: station.id, qualificationCodes: [], requiredStaffCount: 2 }).returning();
  await s.db.insert(s.workHubShiftAssignmentsTable).values({ shiftId: shift.id, userId: users[3].id, assignedById: users[0].id });
  return { s, vendor, sites, station, users, people, actors, shift, memberships };
}

describe.skipIf(!isolated)("Workforce isolated PostgreSQL", () => {
  it("binds all Workforce reads, operations and chat creation to the mounted account despite a cookie switch", async () => {
    const f = await fixture(), express = (await import("express")).default, cookieParser = (await import("cookie-parser")).default,
      request = (await import("supertest")).default, { buildTestCookie } = await import("../test-utils/session");
    const routers = await Promise.all([import("../routes/workforce"), import("../routes/gateShiftAssignments"), import("../routes/implementationAWorkforce"), import("../routes/workHubCollaboration")]);
    const app = express().use(express.json()).use(cookieParser()); for (const router of routers) app.use(router.default);
    const headers = (actor: typeof f.actors[number]) => ({ "X-VNDRLY-Actor-User": String(actor.userId), "X-VNDRLY-Vendor": String(actor.vendorId), "X-VNDRLY-Membership": String(actor.activeMembershipId) });
    const bound = headers(f.actors[1]), cookie = buildTestCookie(f.actors[0]), operationId = randomUUID(), offerId = randomUUID();
    const feature = process.env.WORK_HUB_ENABLED; process.env.WORK_HUB_ENABLED = "1";
    try {
      for (const [method, path, body] of [
        ["get", "/work-hub/workforce/roster"], ["get", "/work-hub/workforce/offers"],
        ["get", `/work-hub/shifts/${f.shift.id}/staffing-candidates`], ["get", `/work-hub/shifts/${f.shift.id}/offers`],
        ["get", `/work-hub/shifts/${f.shift.id}/offers/operations/${operationId}`],
        ["get", "/implementation-a/workforce/coverage"],
        ["post", `/work-hub/shifts/${f.shift.id}/offers`, { operationId, expectedVersion: 1, workerUserId: f.users[4].id }],
        ["post", `/work-hub/shifts/${f.shift.id}/offers/${offerId}/respond`, { operationId, expectedVersion: 1, decision: "accepted" }],
        ["post", "/work-hub/chats", { recipientUserId: f.users[4].id }],
      ] as const) {
        const pending = request(app)[method](path).set("Cookie", cookie).set(bound);
        const response = await (body ? pending.send(body) : pending);
        expect(response.status, path).toBe(409); expect(response.body.code, path).toBe("workforce.context_changed");
      }
      expect((await f.s.pool.query("SELECT id FROM work_hub_shift_requests WHERE shift_id=$1", [f.shift.id])).rows).toHaveLength(0);
      expect((await f.s.pool.query("SELECT id FROM work_hub_channels WHERE owner_org_type='vendor' AND owner_org_id=$1", [f.vendor.id])).rows).toHaveLength(0);
      const matched = await request(app).get("/work-hub/workforce/roster").set("Cookie", cookie).set(headers(f.actors[0]));
      expect(matched.status).toBe(200); expect(matched.body.owner.id).toBe(f.vendor.id);
      await f.s.pool.query("UPDATE users SET session_version=session_version+1 WHERE id=$1", [f.users[0].id]);
      expect((await request(app).get("/work-hub/workforce/roster").set("Cookie", cookie).set(headers(f.actors[0]))).status).toBe(403);
    } finally { if (feature === undefined) delete process.env.WORK_HUB_ENABLED; else process.env.WORK_HUB_ENABLED = feature; }
  });
  it("uses real company/site/self scope, canonical paid clocks, explicit on-call and authorized profiles", async () => {
    const f = await fixture(), { readWorkforceRoster } = await import("./workforce-roster"), { workdayService } = await import("./workday");
    await f.s.db.insert(f.s.workHubDevicePreferencesTable).values([
      { userId: f.users[3].id, ownerOrgType: "vendor", ownerOrgId: f.vendor.id, nativeOperations: { onCallActive: true, duty: { active: false } } as never },
      { userId: f.users[4].id, ownerOrgType: "vendor", ownerOrgId: f.vendor.id, nativeOperations: { onCallActive: false, duty: { active: true } } as never },
    ]);
    await workdayService.record(f.actors[3], { operationId: randomUUID(), shiftId: randomUUID(), scope: { owner: { type: "vendor", id: f.vendor.id }, userId: f.users[3].id, membershipId: f.memberships[3].id, sessionVersion: f.users[3].sessionVersion }, action: "start_shift", capturedAt: new Date().toISOString(), timezone: "UTC" });
    const admin = await readWorkforceRoster(f.actors[0]);
    expect(admin.scope).toBe("company"); expect(admin.employees).toHaveLength(5);
    expect(admin.employees.find(person => person.userId === f.users[3].id)).toMatchObject({ onCall: "active", onShift: true });
    expect(admin.employees.find(person => person.userId === f.users[4].id)).toMatchObject({ onCall: "inactive", onShift: null });
    expect(admin.employees.find(person => person.userId === f.users[5].id)?.onCall).toBe("unknown");
    expect(JSON.stringify(admin)).not.toContain("private-phone"); expect(JSON.stringify(admin)).not.toContain("example.invalid");
    const office = await readWorkforceRoster(f.actors[1]); expect(office.scope).toBe("company"); expect(office.employees).toHaveLength(5);
    const supervisor = await readWorkforceRoster(f.actors[2]); expect(supervisor.scope).toBe("managed_sites"); expect(supervisor.employees).toHaveLength(4);
    expect(supervisor.employees.some(person => person.userId === f.users[6].id)).toBe(false);
    expect(supervisor.employees.every(person => person.profileHref === null)).toBe(true);
    const member = await readWorkforceRoster(f.actors[4]); expect(member.scope).toBe("self"); expect(member.employees.map(person => person.userId)).toEqual([f.users[4].id]);
    await expect(readWorkforceRoster({ ...f.actors[0], vendorId: f.vendor.id + 9999 })).rejects.toThrow();
  });
  it("serializes duplicate offers and competing acceptances, preserves existing staff, and enforces exact recipient recovery", async () => {
    const f = await fixture(), service = await import("./workforce-offers");
    const input = { operationId: randomUUID(), expectedVersion: 1, workerUserId: f.users[4].id };
    await expect(service.createWorkforceOffer(f.actors[0], f.shift.id, { ...input, workerUserId: f.users[6].id })).rejects.toThrow();
    const [first, replay] = await Promise.all([service.createWorkforceOffer(f.actors[0], f.shift.id, input), service.createWorkforceOffer(f.actors[0], f.shift.id, input)]);
    expect(first).toEqual(replay); expect(first.assignmentRecorded).toBe(false);
    const second = await service.createWorkforceOffer(f.actors[0], f.shift.id, { ...input, operationId: randomUUID(), workerUserId: f.users[5].id });
    expect((await service.listWorkforceShiftOffers(f.actors[0], f.shift.id)).offers).toHaveLength(2);
    await expect(service.listWorkforceShiftOffers(f.actors[4], f.shift.id)).rejects.toThrow();
    expect((await service.listIncomingWorkforceOffers(f.actors[4])).offers.map(offer => offer.id)).toEqual([first.offerId]);
    const responseIds = [randomUUID(), randomUUID()];
    expect(await service.readWorkforceOfferOperation(f.actors[4], f.shift.id, responseIds[0])).toEqual({ receipt: null });
    await expect(service.respondWorkforceOffer(f.actors[5], f.shift.id, first.offerId, { operationId: randomUUID(), expectedVersion: 1, decision: "accepted" })).rejects.toMatchObject({ status: 404 });
    const outcomes = await Promise.allSettled([first, second].map((offer, index) => service.respondWorkforceOffer(f.actors[index + 4], f.shift.id, offer.offerId, { operationId: responseIds[index], expectedVersion: 1, decision: "accepted" })));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const winnerIndex = outcomes.findIndex(outcome => outcome.status === "fulfilled"), winner = outcomes[winnerIndex];
    if (winner.status !== "fulfilled") throw new Error("Expected accepted offer");
    expect(await service.readWorkforceOfferOperation(f.actors[winnerIndex + 4], f.shift.id, responseIds[winnerIndex])).toEqual({ receipt: winner.value });
    expect(await service.respondWorkforceOffer(f.actors[winnerIndex + 4], f.shift.id, [first, second][winnerIndex].offerId,
      { operationId: responseIds[winnerIndex], expectedVersion: 1, decision: "accepted" })).toEqual(winner.value);
    await expect(service.respondWorkforceOffer(f.actors[winnerIndex + 4], f.shift.id, [first, second][winnerIndex].offerId,
      { operationId: responseIds[winnerIndex], expectedVersion: 1, decision: "declined" })).rejects.toMatchObject({ code: "work_hub.operation_conflict" });
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const declined = await service.respondWorkforceOffer(f.actors[loserIndex + 4], f.shift.id, [first, second][loserIndex].offerId,
      { operationId: randomUUID(), expectedVersion: 2, decision: "declined" });
    expect(declined).toMatchObject({ status: "declined", assignmentRecorded: false, resultingVersion: 2 });
    expect((await service.listIncomingWorkforceOffers(f.actors[loserIndex + 4])).offers[0].status).toBe("declined");
    const assigned = (await f.s.pool.query("SELECT user_id FROM work_hub_shift_assignments WHERE shift_id=$1 ORDER BY user_id", [f.shift.id])).rows.map(row => row.user_id);
    expect(assigned).toEqual([f.users[3].id, f.users[winnerIndex + 4].id].sort((a, b) => a - b));
    const coverage = (await f.s.pool.query("SELECT assigned_count,actual_count,state FROM workforce_coverage_records WHERE shift_id=$1", [f.shift.id])).rows[0];
    expect(coverage).toEqual({ assigned_count: 2, actual_count: 0, state: "uncovered" });
    await expect(service.createWorkforceOffer(f.actors[0], f.shift.id, { ...input, workerUserId: f.users[5].id })).rejects.toMatchObject({ code: "work_hub.operation_conflict" });
    await f.s.pool.query("UPDATE vendor_person_site_access SET is_active=false WHERE vendor_people_id=$1 AND site_location_id=$2", [f.people[winnerIndex + 3].id, f.sites[0].id]);
    await expect(service.readWorkforceOfferOperation(f.actors[winnerIndex + 4], f.shift.id, responseIds[winnerIndex])).rejects.toThrow();
  });
});
