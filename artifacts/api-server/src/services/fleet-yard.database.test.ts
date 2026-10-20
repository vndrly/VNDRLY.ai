import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { emptyFleetState } from "./fleet-repository";
import { createFleetYardOperations } from "./fleet-yard";

const id = () => randomUUID();

it("persists multi-yard intake, assignment, substitution, version conflicts, replay and company isolation", async () => {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const { pool } = await import("@workspace/db");
  const tag = id();
  const company = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
      [`Yard ${tag}`, `${tag}@example.invalid`],
    )
  ).rows[0].id as number;
  const other = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
      [`Other ${tag}`, `other-${tag}@example.invalid`],
    )
  ).rows[0].id as number;
  async function person(
    name: string,
    companyId: number,
    role: "admin" | "field_employee",
  ) {
    const user = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'not-a-login',$2,$3) RETURNING id,session_version",
        [
          `${name}-${tag}@example.invalid`,
          role === "admin" ? "vendor" : "field_employee",
          name,
        ],
      )
    ).rows[0];
    const membership = (
      await pool.query(
        "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,$3) RETURNING id",
        [user.id, companyId, role === "admin" ? "admin" : "field_employee"],
      )
    ).rows[0];
    const vp = (
      await pool.query(
        "INSERT INTO vendor_people(user_id,vendor_id,first_name,email) VALUES($1,$2,$3,$4) RETURNING id",
        [user.id, companyId, name, `${name}-${tag}@example.invalid`],
      )
    ).rows[0];
    return {
      userId: user.id as number,
      companyId,
      activeMembershipId: membership.id as number,
      membershipRole: role === "admin" ? "admin" : "field_employee",
      role: role === "admin" ? "vendor" : "field_employee",
      vendorPeopleId: vp.id as number,
      sv: user.session_version as number,
    };
  }
  const dispatcher = await person("dispatch", company, "admin");
  const yardWorker = await person("yard", company, "field_employee");
  const outsider = await person("outsider", other, "admin");
  const assets: string[] = [];
  for (const name of ["truck", "trailer", "spare"]) {
    const asset = (
      await pool.query(
        "INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id) VALUES($1,$2,'Synthetic','vendor',$3) RETURNING id",
        [name, name === "truck" ? "truck" : "trailer", company],
      )
    ).rows[0];
    assets.push(asset.id);
    await pool.query(
      "INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)",
      [asset.id, String(company), dispatcher.userId],
    );
  }
  const fleetId = id();
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: fleetId,
        name: "Synthetic fleet",
        siteIds: [],
        equipmentAssetIds: assets,
        requiredCertifications: [],
      },
    ],
    grants: [dispatcher, yardWorker].map((p) => ({
      userId: p.userId,
      fleetIds: [fleetId],
      siteIds: [],
      roles: p.userId === dispatcher.userId ? ["fleet_manager"] : ["driver"],
      safetyRelease: false,
      financeRead: false,
    })),
  };
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    company,
    JSON.stringify(state),
  ]);
  await pool.query(
    "INSERT INTO fleet_person_capabilities(company_id,user_id,capabilities,version,granted_by_user_id) VALUES($1,$2,ARRAY['yard']::text[],1,$3)",
    [company, yardWorker.userId, dispatcher.userId],
  );
  const service = createFleetYardOperations();
  const scope = (actor: typeof dispatcher) => ({
    owner: { type: "vendor" as const, id: actor.companyId },
    userId: actor.userId,
    membershipId: actor.activeMembershipId,
    sessionVersion: actor.sv,
  });
  const baseYard = {
    companyId: company,
    timeZone: "America/Chicago",
    destinationId: null,
    isHomeBase: false,
    active: true,
  };
  const firstInput = {
    operationId: id(),
    expectedVersion: 0,
    scope: scope(dispatcher),
    yard: { ...baseYard, name: "North" },
  };
  const north = await service.saveYard(dispatcher, firstInput);
  const south = await service.saveYard(dispatcher, {
    ...firstInput,
    operationId: id(),
    yard: { ...baseYard, name: "South" },
  });
  expect((await service.yards(dispatcher)).yards.map((y) => y.name)).toEqual([
    "North",
    "South",
  ]);
  expect(await service.saveYard(dispatcher, firstInput)).toEqual(north);
  await expect(
    service.saveYard(dispatcher, {
      ...firstInput,
      yard: { ...baseYard, name: "Changed" },
    }),
  ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
  const observedAt = "2026-10-19T12:00:00Z";
  const intake = (
    assetId: string,
    yardId: string,
    method: "gate_scan" | "gps_geofence" | "manual",
  ) => ({
    operationId: id(),
    expectedVersion: 0,
    scope: scope(yardWorker),
    observation: {
      companyId: company,
      assetId,
      state: "intake" as const,
      method,
      observedAt,
      observedByUserId: yardWorker.userId,
      yardId,
      runId: null,
      detailId: null,
      latitude: method === "gps_geofence" ? 35 : null,
      longitude: method === "gps_geofence" ? -97 : null,
      notes: "Verified at intake",
    },
  });
  const gate = intake(assets[0], north.id, "gate_scan");
  const firstReceipt = await service.observeCustody(yardWorker, gate);
  expect(await service.observeCustody(yardWorker, gate)).toEqual(firstReceipt);
  await expect(
    service.observeCustody(yardWorker, {
      ...gate,
      observation: { ...gate.observation, notes: "Changed replay" },
    }),
  ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
  await service.observeCustody(
    yardWorker,
    intake(assets[1], south.id, "gps_geofence"),
  );
  await service.observeCustody(
    yardWorker,
    intake(assets[2], north.id, "manual"),
  );
  const move = { ...intake(assets[1], north.id, "manual"), expectedVersion: 1 };
  expect((await service.observeCustody(yardWorker, move)).version).toBe(2);
  await expect(
    service.observeCustody(yardWorker, { ...move, operationId: id() }),
  ).rejects.toMatchObject({ code: "fleet.version_conflict" });
  const orderId = id();
  const request = {
    operationId: id(),
    expectedVersion: 0,
    scope: scope(dispatcher),
    order: {
      id: orderId,
      companyId: company,
      version: 1,
      yardId: north.id,
      detailId: null,
      runId: null,
      status: "requested" as const,
      outcome: null,
      requestedByUserId: dispatcher.userId,
      assignedToUserId: null,
      requestedAt: observedAt,
      scheduledAt: "2026-10-20T12:00:00Z",
      startedAt: null,
      reportedAt: null,
      requestedAssetIds: assets.slice(0, 2),
      actualAssetIds: [],
      findings: [],
      notes: "Stage for schedule",
    },
  };
  expect((await service.createYardOrder(dispatcher, request)).version).toBe(1);
  const assigned = await service.actOnYardOrder(dispatcher, orderId, {
    kind: "assign",
    operationId: id(),
    expectedVersion: 1,
    scope: scope(dispatcher),
    orderId,
    assignedToUserId: yardWorker.userId,
  });
  expect(assigned.assignedToUserId).toBe(yardWorker.userId);
  const started = await service.actOnYardOrder(yardWorker, orderId, {
    kind: "start",
    operationId: id(),
    expectedVersion: 2,
    scope: scope(yardWorker),
    orderId,
  });
  expect(started.status).toBe("in_progress");
  const report = {
    kind: "report" as const,
    operationId: id(),
    expectedVersion: 3,
    scope: scope(yardWorker),
    orderId,
    outcome: "needs_attention" as const,
    actualAssetIds: [assets[0], assets[2]],
    findings: [
      {
        assetId: assets[1],
        kind: "substituted" as const,
        note: "Spare staged",
      },
    ],
    notes: "Spare staged",
  };
  const done = await service.actOnYardOrder(yardWorker, orderId, report);
  expect(done).toMatchObject({
    status: "reported",
    outcome: "needs_attention",
    actualAssetIds: [assets[0], assets[2]],
    version: 4,
  });
  expect(await service.actOnYardOrder(yardWorker, orderId, report)).toEqual(
    done,
  );
  expect(
    (await service.yardOrder(dispatcher, orderId)).events.map((e) => e.type),
  ).toEqual(["requested", "assign", "start", "report"]);
  await expect(service.yardOrder(outsider, orderId)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    service.observeCustody(yardWorker, {
      ...intake(assets[0], north.id, "manual"),
      observation: {
        ...gate.observation,
        companyId: other,
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
});
