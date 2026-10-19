import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { createFleetService, type FleetActor } from "./fleet-ops";
import { databaseFleetRepository, emptyFleetState } from "./fleet-repository";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import fleetRouter from "../routes/fleet";
import { buildTestCookie } from "../test-utils/session";

async function fixture() {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const { db, pool, vendorsTable, usersTable, userOrgMembershipsTable } =
    await import("@workspace/db");
  const tag = randomUUID();
  const [company] = await db
    .insert(vendorsTable)
    .values({
      name: `Workday ${tag}`,
      contactName: "Synthetic",
      contactEmail: `${tag}@example.invalid`,
    })
    .returning();
  const actors: FleetActor[] = [];
  for (const name of ["Office", "Driver", "Other driver"]) {
    const [user] = await db
      .insert(usersTable)
      .values({
        username: `${name}-${tag}`,
        passwordHash: "not-a-login",
        displayName: name,
        role: "vendor",
      })
      .returning();
    const [member] = await db
      .insert(userOrgMembershipsTable)
      .values({
        userId: user.id,
        orgType: "vendor",
        vendorId: company.id,
        role: name === "Office" ? "admin" : "member",
      })
      .returning();
    actors.push({
      companyId: company.id,
      userId: user.id,
      role: "vendor",
      sv: user.sessionVersion,
      activeMembershipId: member.id,
      membershipRole: member.role,
    });
  }
  const groupId = randomUUID();
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: groupId,
        name: "Company pool",
        equipmentAssetIds: [],
        siteIds: [],
        requiredCertifications: [],
      },
    ],
    grants: actors.map((actor, index) => ({
      userId: actor.userId,
      fleetIds: [groupId],
      siteIds: [],
      roles: index === 0 ? ["fleet_manager"] : ["driver"],
      financeRead: false,
      safetyRelease: false,
    })),
  };
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    company.id,
    JSON.stringify(state),
  ]);
  return {
    service: createFleetService(databaseFleetRepository) as any,
    office: actors[0],
    driver: actors[1],
    other: actors[2],
    pool,
  };
}
function command(
  actor: FleetActor,
  shiftId: string,
  action: string,
  capturedAt: string,
) {
  return {
    operationId: randomUUID(),
    shiftId,
    scope: {
      companyId: actor.companyId,
      userId: actor.userId,
      membershipId: actor.activeMembershipId,
      sessionVersion: actor.sv,
    },
    action,
    capturedAt,
    timezone: "America/Chicago",
  };
}
it("keeps a whole driver workday independently of tickets and provides immutable duplicate-safe readback to authorized office", async () => {
  const f = await fixture(),
    shiftId = randomUUID();
  expect(f.service.recordWorkday).toBeDefined();
  const start = command(
    f.driver,
    shiftId,
    "start_shift",
    "2026-10-15T12:00:00Z",
  );
  const first = await f.service.recordWorkday(f.driver, start);
  expect(first.summary).toMatchObject({
    state: "on_shift",
    endedAt: null,
    reportedWorkMilliseconds: null,
  });
  expect(await f.service.recordWorkday(f.driver, start)).toEqual(first);
  await expect(
    f.service.recordWorkday(f.driver, {
      ...start,
      capturedAt: "2026-10-15T12:01:00Z",
    }),
  ).rejects.toMatchObject({ code: "fleet.workday_operation_conflict" });
  await expect(
    f.service.recordWorkday(
      f.driver,
      command(f.driver, randomUUID(), "start_shift", "2026-10-15T12:05:00Z"),
    ),
  ).rejects.toMatchObject({ code: "fleet.workday_already_open" });
  const close = command(f.driver, shiftId, "end_shift", "2026-10-15T22:30:00Z");
  const ended = await f.service.recordWorkday(f.driver, close);
  expect(ended.summary).toMatchObject({
    state: "ended",
    reportedWorkMilliseconds: 37800000,
    payrollApproved: false,
  });
  expect((await f.service.workday(f.office, shiftId)).events).toHaveLength(2);
  expect(await f.service.workdayOperation(f.driver, start.operationId)).toEqual(
    first,
  );
  expect(
    (
      await f.service.driverWorkdays(f.office, f.driver.userId, {
        start: "2026-10-15T00:00:00Z",
        end: "2026-10-16T00:00:00Z",
      })
    ).items,
  ).toHaveLength(1);
  const rows = await f.pool.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='workday-event' AND tool_output->'event'->>'shiftId'=$2 ORDER BY id",
    [f.driver.companyId, shiftId],
  );
  expect(rows.rows).toHaveLength(2);
  expect(rows.rows[0].tool_output.event.capturedAt).toBe(start.capturedAt);
});
it("denies stale-company intents, coworker reads, impersonated shift events, read-only writes and malformed chronology", async () => {
  const f = await fixture(),
    shiftId = randomUUID();
  expect(f.service.recordWorkday).toBeDefined();
  const start = command(
    f.driver,
    shiftId,
    "start_shift",
    "2026-10-15T12:00:00Z",
  );
  await expect(
    f.service.recordWorkday(f.driver, {
      ...start,
      scope: { ...start.scope, companyId: f.driver.companyId + 1 },
    }),
  ).rejects.toMatchObject({ code: "fleet.workday_original_scope_required" });
  await expect(
    f.service.recordWorkday({ ...f.driver, readOnly: true }, start),
  ).rejects.toMatchObject({ status: 403 });
  await f.service.recordWorkday(f.driver, start);
  await expect(f.service.workday(f.other, shiftId)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    f.service.workdayOperation(f.other, start.operationId),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    f.service.driverWorkdays(f.other, f.driver.userId, {
      start: "2026-10-15T00:00:00Z",
      end: "2026-10-16T00:00:00Z",
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    f.service.recordWorkday(
      f.office,
      command(f.driver, shiftId, "end_shift", "2026-10-15T22:00:00Z"),
    ),
  ).rejects.toMatchObject({ code: "fleet.workday_original_scope_required" });
  await expect(
    f.service.recordWorkday(
      f.driver,
      command(f.driver, shiftId, "end_shift", "2026-10-15T11:00:00Z"),
    ),
  ).rejects.toMatchObject({ code: "fleet.workday_clock_conflict" });
  expect((await f.service.workday(f.driver, shiftId)).events).toHaveLength(1);
});
it("exposes no-store authenticated workday records and exact operation receipts without impersonating another driver", async () => {
  const f = await fixture(),
    app = express().use(express.json()).use(cookieParser()).use(fleetRouter);
  const cookie = (actor: FleetActor) =>
    buildTestCookie({
      userId: actor.userId,
      role: "vendor",
      vendorId: actor.companyId,
      activeMembershipId: actor.activeMembershipId,
      membershipRole: actor.membershipRole,
      sv: actor.sv,
    });
  const shiftId = randomUUID(),
    body = command(f.driver, shiftId, "start_shift", "2026-10-15T12:00:00Z");
  expect(
    (await request(app).post("/fleet/workdays/events").send(body)).status,
  ).toBe(401);
  const saved = await request(app)
    .post("/fleet/workdays/events")
    .set("Cookie", cookie(f.driver))
    .send(body);
  expect(saved.status).toBe(200);
  expect(saved.headers["cache-control"]).toBe("no-store");
  const read = await request(app)
    .get(`/fleet/workdays/${shiftId}`)
    .set("Cookie", cookie(f.office));
  expect(read.status).toBe(200);
  expect(read.body.events).toHaveLength(1);
  const receipt = await request(app)
    .get(`/fleet/workdays/operations/${body.operationId}`)
    .set("Cookie", cookie(f.driver));
  expect(receipt.body).toEqual(saved.body);
  const page = await request(app)
    .get(
      `/fleet/drivers/${f.driver.userId}/workdays?start=2026-10-15T00:00:00Z&end=2026-10-16T00:00:00Z`,
    )
    .set("Cookie", cookie(f.office));
  expect(page.status).toBe(200);
  expect(page.body.items).toHaveLength(1);
  expect(
    (
      await request(app)
        .get(`/fleet/workdays/${shiftId}`)
        .set("Cookie", cookie(f.other))
    ).status,
  ).toBe(403);
});
it("keeps the workday open across sign-out and fresh authentication until explicit end of day", async () => {
  const f = await fixture(),
    shiftId = randomUUID();
  const start = command(
    f.driver,
    shiftId,
    "start_shift",
    "2026-10-15T12:00:00Z",
  );
  await f.service.recordWorkday(f.driver, start);
  // Authentication changes independently; no workday event is manufactured.
  const nextSessionVersion = (f.driver.sv ?? 0) + 1;
  await f.pool.query("UPDATE users SET session_version=$2 WHERE id=$1", [
    f.driver.userId,
    nextSessionVersion,
  ]);
  await expect(f.service.workday(f.driver, shiftId)).rejects.toMatchObject({
    status: 403,
  });
  const signedInAgain = { ...f.driver, sv: nextSessionVersion };
  const open = await f.service.workday(signedInAgain, shiftId);
  expect(open.events).toHaveLength(1);
  expect(open.summary.state).toBe("on_shift");
  expect(open.summary.endedAt).toBeNull();
  expect(
    (await f.service.workdayOperation(signedInAgain, start.operationId)).event
      .capturedAt,
  ).toBe(start.capturedAt);
  const ended = await f.service.recordWorkday(
    signedInAgain,
    command(signedInAgain, shiftId, "end_shift", "2026-10-15T22:30:00Z"),
  );
  expect(ended.summary.reportedWorkMilliseconds).toBe(37800000);
  expect(ended.summary.state).toBe("ended");
});
it("returns day-specific reported time for an overnight shift without attributing its full duration to each day", async () => {
  const f = await fixture(),
    shiftId = randomUUID();
  await f.service.recordWorkday(
    f.driver,
    command(f.driver, shiftId, "start_shift", "2026-10-15T23:00:00Z"),
  );
  const firstDay = {
      start: "2026-10-15T00:00:00Z",
      end: "2026-10-16T00:00:00Z",
    },
    secondDay = { start: "2026-10-16T00:00:00Z", end: "2026-10-17T00:00:00Z" };
  const open = await f.service.driverWorkdays(
    f.office,
    f.driver.userId,
    firstDay,
  );
  expect(open.items[0].reportedWorkMillisecondsInRange).toBeNull();
  await f.service.recordWorkday(
    f.driver,
    command(f.driver, shiftId, "end_shift", "2026-10-16T02:00:00Z"),
  );
  const a = await f.service.driverWorkdays(f.office, f.driver.userId, firstDay),
    b = await f.service.driverWorkdays(f.office, f.driver.userId, secondDay);
  expect(a.items[0].reportedWorkMillisecondsInRange).toBe(3600000);
  expect(b.items[0].reportedWorkMillisecondsInRange).toBe(7200000);
  expect(a.items[0].summary.reportedWorkMilliseconds).toBe(10800000);
});
