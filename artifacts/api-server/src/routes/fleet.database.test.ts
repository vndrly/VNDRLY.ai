import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  vendorsTable,
  partnersTable,
  usersTable,
  userOrgMembershipsTable,
  vendorPeopleTable,
  siteLocationsTable,
  partnerVendorRelationshipsTable,
  assetsTable,
  workTypesTable,
  ticketsTable,
  vendorWorkTypesTable,
  partnerVendorWorkTypeApprovalsTable,
  siteWorkAssignmentsTable,
  assetHoldsTable,
  siteVisitsTable,
  locationConsentsTable,
} from "@workspace/db";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import router from "./fleet";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("Fleet capability routes", () => {
  it("maps legacy roles, updates one employee with a version, and rejects stale or revoked authority", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const tag = randomUUID();
    const [vendor, other] = await db.insert(vendorsTable).values([0, 1].map(i => ({ name: `Fleet capability ${i} ${tag}`, contactName: "Synthetic", contactEmail: `${i}-${tag}@example.invalid` }))).returning();
    const [manager, driver] = await db.insert(usersTable).values(["vendor", "field_employee"].map((role, i) => ({ username: `fleet-cap-${i}-${tag}`, displayName: "Synthetic", passwordHash: "unused-isolated-fixture", role }))).returning();
    const [person] = await db.insert(vendorPeopleTable).values({ vendorId: vendor.id, userId: driver.id, firstName: "Synthetic", email: `cap-${tag}@example.invalid`, vendorRole: "field" }).returning();
    const [managerMember, driverMember] = await db.insert(userOrgMembershipsTable).values([
      { userId: manager.id, orgType: "vendor", vendorId: vendor.id, role: "admin" },
      { userId: driver.id, orgType: "vendor", vendorId: vendor.id, role: "field_employee", vendorPeopleId: person.id },
    ]).returning();
    const fleetId = randomUUID();
    await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [vendor.id, JSON.stringify({ version: 1, enabled: true, fleets: [{ id: fleetId, name: "Synthetic", siteIds: [], requiredCertifications: [], equipmentAssetIds: [] }], grants: [
      { userId: manager.id, fleetIds: [fleetId], siteIds: [], roles: ["fleet_manager"], safetyRelease: false, financeRead: false },
      { userId: driver.id, fleetIds: [fleetId], siteIds: [], roles: ["driver"], safetyRelease: false, financeRead: false },
    ], supportGrants: [], runs: [], preferences: [], operations: [] })]);
    const app = express().use(express.json()).use(cookieParser()).use(router);
    const managerCookie = buildTestCookie({ userId: manager.id, role: "vendor", vendorId: vendor.id, membershipRole: "admin", activeMembershipId: managerMember.id, sv: manager.sessionVersion });
    const driverCookie = buildTestCookie({ userId: driver.id, role: "field_employee", vendorId: vendor.id, membershipRole: "field_employee", activeMembershipId: driverMember.id, vendorPeopleId: person.id, sv: driver.sessionVersion });
    const managerRead = await request(app).get("/fleet/capabilities").set("Cookie", managerCookie);
    expect(managerRead.status).toBe(200);
    expect(managerRead.body).toMatchObject({ companyId: vendor.id, capabilities: ["admin", "dispatch"], source: "legacy" });
    expect((await request(app).get("/fleet/capabilities").set("Cookie", driverCookie)).body.capabilities).toEqual(["driver"]);
    const input = { operationId: randomUUID(), expectedVersion: 0, scope: { owner: { type: "vendor", id: vendor.id }, userId: manager.id, membershipId: managerMember.id, sessionVersion: manager.sessionVersion }, assignment: { companyId: vendor.id, userId: driver.id, version: 1, capabilities: ["driver", "yard", "self_dispatch"] } };
    const saved = await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send(input);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ userId: driver.id, version: 1, capabilities: ["driver", "yard", "self_dispatch"] });
    expect((await request(app).get(`/fleet/capabilities?userId=${driver.id}`).set("Cookie", managerCookie)).body).toMatchObject({ userId: driver.id, version: 1, capabilities: ["driver", "yard", "self_dispatch"] });
    expect((await request(app).get(`/fleet/capabilities?userId=${manager.id}`).set("Cookie", driverCookie)).status).toBe(403);
    const replay = await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send(input);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(saved.body);
    expect((await request(app).get("/fleet/capabilities").set("Cookie", driverCookie)).body).toMatchObject({ source: "stored", version: 1, capabilities: ["driver", "yard", "self_dispatch"] });
    expect((await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send({ ...input, operationId: randomUUID() })).status).toBe(409);
    expect((await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send({ ...input, operationId: randomUUID(), assignment: { ...input.assignment, companyId: other.id } })).status).toBe(403);
    const myDay = { expectedVersion: 1, defaultWorkspace: "fleet_my_day", selectedFleetId: fleetId };
    expect((await request(app).post("/fleet/preferences").set("Cookie", driverCookie).send(myDay)).status).toBe(200);
    const revoked = { ...input, operationId: randomUUID(), expectedVersion: 1, assignment: { ...input.assignment, version: 2, capabilities: [] } };
    expect((await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send(revoked)).status).toBe(200);
    expect((await request(app).post("/fleet/preferences").set("Cookie", driverCookie).send({ ...myDay, expectedVersion: 2 })).status).toBe(403);
    const dispatch = { ...input, operationId: randomUUID(), expectedVersion: 2, assignment: { ...input.assignment, version: 3, capabilities: ["dispatch"] } };
    expect((await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send(dispatch)).status).toBe(200);
    expect((await request(app).post("/fleet/preferences").set("Cookie", driverCookie).send({ expectedVersion: 2, defaultWorkspace: "fleet_desk", selectedFleetId: fleetId })).status).toBe(200);
    expect((await request(app).post("/fleet/preferences").set("Cookie", driverCookie).send({ ...myDay, expectedVersion: 3 })).status).toBe(403);
    const office = { ...input, operationId: randomUUID(), expectedVersion: 3, assignment: { ...input.assignment, version: 4, capabilities: ["office"] } };
    expect((await request(app).put(`/fleet/capabilities/${driver.id}`).set("Cookie", managerCookie).send(office)).status).toBe(200);
    expect((await request(app).post("/fleet/preferences").set("Cookie", driverCookie).send({ expectedVersion: 3, defaultWorkspace: "fleet_desk", selectedFleetId: fleetId })).status).toBe(403);
    await db.delete(userOrgMembershipsTable).where(eq(userOrgMembershipsTable.id, driverMember.id));
    expect((await request(app).get("/fleet/capabilities").set("Cookie", driverCookie)).status).toBe(403);
  }, 30000);
});

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "Fleet canonical routes on isolated records",
  () => {
    it("persists two hauling cycles, serializes replay and fails closed after current authority revocation", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const tag = randomUUID();
      const [vendor] = await db
        .insert(vendorsTable)
        .values({
          name: "Fleet " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [partner] = await db
        .insert(partnersTable)
        .values({
          name: "Fleet site owner " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [site] = await db
        .insert(siteLocationsTable)
        .values({
          partnerId: partner.id,
          name: "Fleet site " + tag,
          address: "Synthetic",
          latitude: 0,
          longitude: 0,
          siteCode: "FLT-" + tag,
        })
        .returning();
      const [relationship] = await db
        .insert(partnerVendorRelationshipsTable)
        .values({
          partnerId: partner.id,
          vendorId: vendor.id,
          status: "approved",
        })
        .returning();
      const [workType]=await db.insert(workTypesTable).values({name:`Synthetic hauling ${tag}`,category:"hauling"}).returning();
      await db.insert(vendorWorkTypesTable).values({vendorId:vendor.id,workTypeId:workType.id,unit:"per_job",unitPrice:"12.34",currency:"USD"});
      await db.insert(partnerVendorWorkTypeApprovalsTable).values({partnerId:partner.id,vendorId:vendor.id,workTypeId:workType.id});
      await db.insert(siteWorkAssignmentsTable).values({vendorId:vendor.id,workTypeId:workType.id,siteLocationId:site.id});
      const users = await db
        .insert(usersTable)
        .values(
          ["manager", "driver"].map((role) => ({
            username: role + tag,
            displayName: "Synthetic " + role,
            passwordHash: "unused-isolated-fixture",
            role: role === "manager" ? "vendor" : "field_employee",
          })),
        )
        .returning();
      const [person] = await db
        .insert(vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: users[1].id,
          firstName: "Synthetic driver",
          email: "driver" + tag + "@example.invalid",
          vendorRole: "field",
        })
        .returning();
      const memberships = await db
        .insert(userOrgMembershipsTable)
        .values(
          users.map((u, i) => ({
            userId: u.id,
            orgType: "vendor",
            vendorId: vendor.id,
            role: i === 0 ? "admin" : "field_employee",
            vendorPeopleId: i === 1 ? person.id : null,
          })),
        )
        .returning();
      const cookies = users.map((u, i) =>
        buildTestCookie({
          userId: u.id,
          role: u.role,
          vendorId: vendor.id,
          membershipRole: memberships[i].role,
          activeMembershipId: memberships[i].id,
          vendorPeopleId: i === 1 ? person.id : null,
          sv: u.sessionVersion,
        }),
      );
      const [vehicle] = await db
        .insert(assetsTable)
        .values({
          name: "Synthetic truck",
          category: "truck",
          legalOwnerName: "Synthetic",
          responsibleOrgType: "vendor",
          responsibleOrgId: vendor.id,
        })
        .returning();
      const app = express().use(express.json()).use(cookieParser()).use(router);
      await pool.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)", [vehicle.id, String(vendor.id), users[0].id]);
      const fleetId = randomUUID();
      const setup = await request(app)
        .post("/fleet/setup")
        .set("Cookie", cookies[0])
        .send({
          expectedVersion: 1,
          enabled: true,
          fleets: [
            {
              id: fleetId,
              name: "Synthetic hauling",
              siteIds: [site.id],
              requiredCertifications: [],
              equipmentAssetIds: [vehicle.id],
            },
          ],
          grants: users.map((u, i) => ({
            userId: u.id,
            fleetIds: [fleetId],
            siteIds: [site.id],
            roles: [i === 0 ? "fleet_manager" : "driver"],
            safetyRelease: false,
            financeRead: false,
          })),
        });
      expect(setup.status).toBe(200);
      // A realistic month of settled work must not disable the equipment picker.
      await db.insert(ticketsTable).values(Array.from({ length: 201 }, () => ({
        vendorId: vendor.id, siteLocationId: site.id,
        workTypeId: workType.id, status: "approved", lifecycleState: "off_site",
        createdById: users[0].id, description: "Synthetic settled history",
      })));
      const [openTicket] = await db.insert(ticketsTable).values({
        vendorId: vendor.id, siteLocationId: site.id,
        workTypeId: workType.id, status: "initiated", lifecycleState: "pending_arrival",
        createdById: users[0].id, description: "Synthetic dispatch candidate",
      }).returning();
      const resourcePicker = await request(app).get("/fleet/resources").set("Cookie", cookies[0]);
      expect(resourcePicker.status).toBe(200);
      expect(resourcePicker.body.tickets).toEqual([{ id: openTicket.id, siteId: site.id, status: "initiated" }]);
      expect(resourcePicker.body.equipment).toHaveLength(1);

      const stops = ["pickup", "delivery", "pickup", "delivery"].map(
        (kind, sequence) => ({
          id: randomUUID(),
          kind,
          sequence,
          siteId: site.id,
        }),
      );
      const created = await request(app)
        .post("/fleet/runs")
        .set("Cookie", cookies[0])
        .send({
          billing:{mode:"new_ticket",workTypeId:workType.id,afeNumber:"",workDate:"2026-10-16"},
          operationId: randomUUID(),
          fleetId,
          title: "Synthetic hauling day",
          driverUserId: users[1].id,
          vehicleAssetId: vehicle.id,
          stops,
        });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const id = created.body.id;
      let version = created.body.version;
      const endpoint = "/fleet/runs/" + id + "/actions";
      const dispatch = {
        operationId: randomUUID(),
        expectedVersion: version,
        action: "dispatch",
      };
      const repeated = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app).post(endpoint).set("Cookie", cookies[0]).send(dispatch),
        ),
      );
      expect(repeated.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect(new Set(repeated.map((r) => r.body.version)).size).toBe(1);
      version = repeated[0].body.version;
      const notices = await pool.query("SELECT user_id,link FROM notifications WHERE dedupe_key=$1",[`fleet:${vendor.id}:${dispatch.operationId}`]);
      expect(notices.rows).toEqual([{user_id:users[1].id,link:`/fleet/runs/${id}`}]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM assistant_action_audit WHERE target_type='fleet-operation' AND target_id=$1 AND vendor_id=$2",
            [dispatch.operationId, vendor.id],
          )
        ).rows[0].n,
      ).toBe(1);
      const act = async (
        i: number,
        action: string,
        extra: Record<string, unknown> = {},
      ) => {
        const response = await request(app)
          .post(endpoint)
          .set("Cookie", cookies[i])
          .send({
            operationId: randomUUID(),
            expectedVersion: version,
            action,
            ...extra,
          });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        version = response.body.version;
        return response.body;
      };
      await act(1, "acknowledge");
      await act(1, "inspect", {
        inspectionOutcome: "passed",
        notes: "Actual user report",
      });
      await act(1, "record_meter", {
        reading: 100,
        unit: "miles",
        notes: "Beginning actual reading",
      });
      await act(1, "start");
      const deviceId = "isolated-fleet-phone-" + tag,
        locationInput = {
          operationId: randomUUID(),
          expectedVersion: version,
          deviceId,
          latitude: 31,
          longitude: -101,
          accuracyMeters: 10,
          recordedAt: new Date().toISOString(),
        };
      expect(
        (
          await request(app)
            .post(`/fleet/runs/${id}/location`)
            .set("Cookie", cookies[1])
            .send(locationInput)
        ).status,
      ).toBe(403);
      const [consent] = await db
        .insert(locationConsentsTable)
        .values({ userId: users[1].id, deviceId })
        .returning();
      expect(
        (
          await request(app)
            .post(`/fleet/runs/${id}/location`)
            .set("Cookie", cookies[0])
            .send(locationInput)
        ).status,
      ).toBe(404);
      const location = await request(app)
        .post(`/fleet/runs/${id}/location`)
        .set("Cookie", cookies[1])
        .send(locationInput);
      expect(location.status).toBe(200);
      expect(location.body).toMatchObject({
        source: "driver_phone",
        physicalProofVerified: false,
        runId: id,
      });
      expect(
        (
          await request(app)
            .post(`/fleet/runs/${id}/location`)
            .set("Cookie", cookies[1])
            .send(locationInput)
        ).body,
      ).toEqual(location.body);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-location-operation' AND target_id=$2",
            [vendor.id, locationInput.operationId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (await request(app).get("/fleet/overview").set("Cookie", cookies[0]))
          .body.observations,
      ).toHaveLength(1);
      await db
        .update(locationConsentsTable)
        .set({ revokedAt: new Date() })
        .where(eq(locationConsentsTable.id, consent.id));
      expect(
        (await request(app).get("/fleet/overview").set("Cookie", cookies[0]))
          .body.observations,
      ).toEqual([]);
      expect(
        (
          await request(app)
            .post(`/fleet/runs/${id}/location`)
            .set("Cookie", cookies[1])
            .send(locationInput)
        ).status,
      ).toBe(403);
      await db
        .update(locationConsentsTable)
        .set({ revokedAt: null })
        .where(eq(locationConsentsTable.id, consent.id));
      await db
        .update(usersTable)
        .set({ sessionVersion: users[1].sessionVersion + 1 })
        .where(eq(usersTable.id, users[1].id));
      expect(
        (
          await request(app)
            .post(`/fleet/runs/${id}/location`)
            .set("Cookie", cookies[1])
            .send({ ...locationInput, operationId: randomUUID() })
        ).status,
      ).toBe(403);
      users[1].sessionVersion++;
      cookies[1] = buildTestCookie({
        userId: users[1].id,
        role: "field_employee",
        vendorId: vendor.id,
        membershipRole: memberships[1].role,
        activeMembershipId: memberships[1].id,
        vendorPeopleId: person.id,
        sv: users[1].sessionVersion,
      });
      const visits = await db
        .insert(siteVisitsTable)
        .values(
          [1, 2].map((index) => ({
            siteLocationId: site.id,
            firstName: "Synthetic",
            lastName: "Gate fixture " + index,
            hostType: "partner",
            hostPartnerId: partner.id,
            provisionalVehicleAssetId: vehicle.id,
          })),
        )
        .returning();
      const observations = await request(app)
        .get(`/fleet/runs/${id}/gate-observations`)
        .set("Cookie", cookies[1]);
      expect(observations.status).toBe(200);
      expect(observations.body.ambiguous).toBe(true);
      expect(observations.body.observations).toHaveLength(2);
      expect(JSON.stringify(observations.body)).not.toContain("Gate fixture");
      const gateInput = {
        operationId: randomUUID(),
        expectedVersion: version,
        stopId: stops[0].id,
        visitId: visits[0].id,
        reason: "Synthetic operator selects exact recorded candidate",
      };
      const gateLinked = await request(app)
        .post(`/fleet/runs/${id}/gate-links`)
        .set("Cookie", cookies[1])
        .send(gateInput);
      expect(gateLinked.status).toBe(200);
      version = gateLinked.body.version;
      expect(gateLinked.body.automaticAdmissionCreated).toBe(false);
      const gateReplay = await request(app)
        .post(`/fleet/runs/${id}/gate-links`)
        .set("Cookie", cookies[1])
        .send(gateInput);
      expect(gateReplay.body).toEqual(gateLinked.body);
      const savedLinks = await request(app)
        .get(`/fleet/runs/${id}/gate-observations`)
        .set("Cookie", cookies[1]);
      expect(savedLinks.body.links).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(siteVisitsTable)
            .where(eq(siteVisitsTable.siteLocationId, site.id))
        ).map((v) => v.checkOutTime),
      ).toEqual([null, null]);
      for (let cycle = 0; cycle < 2; cycle++) {
        const pickup = stops[cycle * 2],
          delivery = stops[cycle * 2 + 1],
          loadId = randomUUID();
        await act(1, "arrive_stop", { stopId: pickup.id });
        await act(1, "record_load", {
          loadId,
          commodity: "Synthetic sand",
          quantity: 20,
          unit: "tons",
          manifestReference: "Synthetic manifest " + cycle,
        });
        await act(1, "depart_stop", { stopId: pickup.id });
        await act(1, "arrive_stop", { stopId: delivery.id });
        await act(1, "record_delivery", {
          loadId,
          deliveryReference: "Synthetic receipt " + cycle,
        });
        await act(1, "depart_stop", { stopId: delivery.id });
      }
      await act(1, "record_meter", {
        reading: 150,
        unit: "miles",
        notes: "Ending actual reading",
      });
      await act(1, "record_fuel", {
        quantity: 10,
        unit: "gallons",
        notes: "Synthetic recorded fuel entry",
      });
      const packet = await request(app).get(`/fleet/runs/${id}/review-packet`).set("Cookie",cookies[1]);
      expect(packet.status).toBe(200);
      expect(packet.body).toMatchObject({runId:id,runVersion:version,missingRequiredCount:0,readyForOperationalReview:true,physicalProofVerified:false,signatureIdentityVerified:false});
      await act(1, "submit_closeout");
      const completed = await act(0, "review", {
        decision: "accept",
        reason: "Reviewed actual user-reported entries",
      });
      expect(completed.status).toBe("completed");
      expect(completed.loads).toHaveLength(2);
      expect(completed.linkedTicketId).toBe(created.body.linkedTicketId);
      const retained = await request(app)
        .get(`/fleet/runs/${id}`)
        .set("Cookie", cookies[1]);
      expect(retained.status).toBe(200);
      expect(retained.body.status).toBe("completed");
      const aggregate = (
        await db
          .select()
          .from(vendorsTable)
          .where(eq(vendorsTable.id, vendor.id))
      )[0].fleetOpsState as { runs: { id: string }[] };
      expect(aggregate.runs.some((r) => r.id === id)).toBe(false);
      const report = await request(app)
        .get("/fleet/reports")
        .set("Cookie", cookies[0]);
      expect(report.status).toBe(200);
      expect(report.body).toMatchObject({
        runCount: 1,
        completedRunCount: 1,
        dateBasis: "run_created_at",
        fuelTotals: null,
        loadTotals: [
          {
            commodity: "Synthetic sand",
            unit: "tons",
            quantity: 40,
            deliveredQuantity: 40,
          },
        ],
        distanceTotals: [{ unit: "miles", distance: 50 }],
      });
      const viewInput = {
        operationId: randomUUID(),
        action: "save",
        name: "Synthetic personal view",
        filters: { fleetId, siteId: site.id },
      };
      const view = await request(app)
        .post("/fleet/views")
        .set("Cookie", cookies[1])
        .send(viewInput);
      expect(view.status, JSON.stringify(view.body)).toBe(200);
      expect(view.body.lastOperationId).toBe(viewInput.operationId);
      expect(
        (
          await request(app)
            .post("/fleet/views")
            .set("Cookie", cookies[1])
            .send(viewInput)
        ).body,
      ).toEqual(view.body);
      expect(
        (await request(app).get("/fleet/views").set("Cookie", cookies[0])).body
          .views,
      ).toEqual([]);
      const [siteOwner] = await db
        .insert(usersTable)
        .values({
          username: "site-owner-" + tag,
          displayName: "Synthetic site owner",
          passwordHash: "unused-isolated-fixture",
          role: "partner",
        })
        .returning();
      const [ownerMembership] = await db
        .insert(userOrgMembershipsTable)
        .values({
          userId: siteOwner.id,
          orgType: "partner",
          partnerId: partner.id,
          role: "admin",
        })
        .returning();
      const ownerCookie = buildTestCookie({
        userId: siteOwner.id,
        role: "partner",
        partnerId: partner.id,
        membershipRole: "admin",
        activeMembershipId: ownerMembership.id,
        sv: siteOwner.sessionVersion,
      });
      const activity = await request(app)
        .get(`/fleet/site-activity/${site.id}`)
        .set("Cookie", ownerCookie);
      expect(activity.status).toBe(200);
      expect(activity.body.records).toHaveLength(1);
      expect(activity.body.coordinateDisclosure).toBe(false);
      expect(JSON.stringify(activity.body)).not.toContain("driverUserId");
      expect(JSON.stringify(activity.body)).not.toContain("record_fuel");
      expect(
        (
          await request(app)
            .get(`/fleet/site-activity/${site.id}`)
            .set("Cookie", cookies[0])
        ).status,
      ).toBe(403);
      const [supportUser] = await db
        .insert(usersTable)
        .values({
          username: "fleet-support-" + tag,
          displayName: "Synthetic support",
          passwordHash: "unused-isolated-fixture",
          role: "admin",
        })
        .returning();
      const supportCookie = buildTestCookie({
        userId: supportUser.id,
        role: "admin",
        sv: supportUser.sessionVersion,
      });
      expect(
        (
          await request(app)
            .get(`/fleet/support/${vendor.id}`)
            .set("Cookie", supportCookie)
        ).status,
      ).toBe(404);
      const beforeSupport = await request(app)
        .get("/fleet/setup")
        .set("Cookie", cookies[0]);
      const supportGrant = {
        userId: supportUser.id,
        fleetIds: [fleetId],
        siteIds: [site.id],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reason: "Company explicitly requests synthetic support",
        financeRead: false,
      };
      expect(
        (
          await request(app)
            .post("/fleet/setup")
            .set("Cookie", cookies[0])
            .send({
              expectedVersion: beforeSupport.body.expectedVersion,
              enabled: true,
              fleets: beforeSupport.body.fleets,
              grants: beforeSupport.body.grants,
              supportGrants: [supportGrant],
            })
        ).status,
      ).toBe(200);
      const support = await request(app)
        .get(`/fleet/support/${vendor.id}`)
        .set("Cookie", supportCookie);
      expect(support.status).toBe(200);
      expect(support.body.readOnly).toBe(true);
      expect(support.body.coordinateDisclosure).toBe(false);
      expect(support.body.runs).toHaveLength(1);
      expect(support.body.runs[0].allowedActions).toEqual([]);
      expect(
        support.body.runs[0].records.some(
          (record: { kind: string }) => record.kind === "fuel",
        ),
      ).toBe(false);
      expect(
        support.body.runs[0].events.some(
          (event: { type: string }) => event.type === "record_fuel",
        ),
      ).toBe(false);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM assistant_action_audit WHERE tool_name='fleet_support_read' AND vendor_id=$1 AND user_id=$2",
            [vendor.id, supportUser.id],
          )
        ).rows[0].n,
      ).toBe(1);
      // Completed runs retain authorized last-known history, visibly stale.
      // This never permits collecting a new off-duty driver-phone location.
      const completedObservations = (await request(app).get("/fleet/overview").set("Cookie", cookies[1])).body.observations;
      expect(completedObservations).toEqual([{ ...location.body, freshness: "stale" }]);
      expect((await request(app).post(`/fleet/runs/${id}/location`).set("Cookie", cookies[1]).send({ ...locationInput, operationId: randomUUID(), expectedVersion: version, recordedAt: new Date().toISOString() })).status).toBe(403);
      const [unrelatedHold] = await db
        .insert(assetHoldsTable)
        .values({
          assetId: vehicle.id,
          reason: "Synthetic hold",
          placedByUserId: users[0].id,
        })
        .returning();
      const held = await request(app)
        .post("/fleet/runs")
        .set("Cookie", cookies[0])
        .send({
          operationId: randomUUID(),
          fleetId,
          title: "Blocked held truck",
          billing:{mode:"new_ticket",workTypeId:workType.id,afeNumber:"",workDate:"2026-10-16"},
          driverUserId: users[1].id,
          vehicleAssetId: vehicle.id,
          stops,
        });
      expect(held.status).toBe(409);
      expect(held.body.code).toBe("fleet.equipment_on_hold");
      const defectInput = {
        operationId: randomUUID(),
        fleetId,
        assetId: vehicle.id,
        runId: id,
        kind: "defect",
        title: "Synthetic driver defect",
        notes: "Synthetic reported issue; no physical attestation",
      };
      const defect = await request(app)
        .post("/fleet/maintenance")
        .set("Cookie", cookies[1])
        .send(defectInput);
      expect(defect.status).toBe(200);
      expect(defect.body.allowedActions).toEqual([]);
      expect(
        (
          await request(app)
            .post("/fleet/maintenance")
            .set("Cookie", cookies[1])
            .send(defectInput)
        ).body.id,
      ).toBe(defect.body.id);
      const repair = await request(app)
        .post(`/fleet/maintenance/${defect.body.id}/actions`)
        .set("Cookie", cookies[0])
        .send({
          operationId: randomUUID(),
          expectedVersion: 1,
          action: "record_repair",
          notes: "Manager records user-reported repair",
        });
      expect(repair.status).toBe(200);
      expect(
        (
          await request(app)
            .post(`/fleet/maintenance/${defect.body.id}/actions`)
            .set("Cookie", cookies[0])
            .send({
              operationId: randomUUID(),
              expectedVersion: 2,
              action: "release",
              notes: "Not authorized",
            })
        ).status,
      ).toBe(403);
      const settings = await request(app)
        .get("/fleet/setup")
        .set("Cookie", cookies[0]);
      expect(settings.status).toBe(200);
      const revised = await request(app)
        .post("/fleet/setup")
        .set("Cookie", cookies[0])
        .send({
          expectedVersion: settings.body.expectedVersion,
          enabled: settings.body.enabled,
          fleets: settings.body.fleets,
          grants: settings.body.grants.map((grant: { userId: number }) => ({
            ...grant,
            safetyRelease: grant.userId === users[0].id,
          })),
        });
      expect(revised.status).toBe(200);
      const releaseInput = {
        operationId: randomUUID(),
        expectedVersion: 2,
        action: "release",
        notes: "Explicit authorized hold release after repair review",
      };
      const released = await request(app)
        .post(`/fleet/maintenance/${defect.body.id}/actions`)
        .set("Cookie", cookies[0])
        .send(releaseInput);
      expect(released.status).toBe(200);
      expect(released.body.status).toBe("released");
      expect(
        (
          await request(app)
            .post(`/fleet/maintenance/${defect.body.id}/actions`)
            .set("Cookie", cookies[0])
            .send(releaseInput)
        ).body,
      ).toEqual({ ...released.body, allowedActions: [] });
      expect(
        (
          await db
            .select()
            .from(assetHoldsTable)
            .where(eq(assetHoldsTable.id, unrelatedHold.id))
        )[0].releasedAt,
      ).toBeNull();
      expect(
        (
          await db
            .select()
            .from(assetHoldsTable)
            .where(eq(assetHoldsTable.id, defect.body.holdId))
        )[0].releasedByUserId,
      ).toBe(users[0].id);
      const revokeSupport = await request(app)
        .get("/fleet/setup")
        .set("Cookie", cookies[0]);
      expect(revokeSupport.body.supportGrants).toEqual([supportGrant]);
      expect(
        (
          await request(app)
            .post("/fleet/setup")
            .set("Cookie", cookies[0])
            .send({
              expectedVersion: revokeSupport.body.expectedVersion,
              enabled: true,
              fleets: revokeSupport.body.fleets,
              grants: revokeSupport.body.grants,
              supportGrants: [],
            })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get(`/fleet/support/${vendor.id}`)
            .set("Cookie", supportCookie)
        ).status,
      ).toBe(404);
      await db
        .update(partnerVendorRelationshipsTable)
        .set({ status: "pending" })
        .where(eq(partnerVendorRelationshipsTable.id, relationship.id));
      expect(
        (
          await request(app)
            .get(`/fleet/site-activity/${site.id}`)
            .set("Cookie", ownerCookie)
        ).body.records,
      ).toEqual([]);
      expect(
        (
          await request(app)
            .get("/fleet/runs/" + id)
            .set("Cookie", cookies[1])
        ).status,
      ).toBe(404);
      await db
        .update(usersTable)
        .set({ sessionVersion: users[0].sessionVersion + 1 })
        .where(eq(usersTable.id, users[0].id));
      expect(
        (await request(app).get("/fleet/overview").set("Cookie", cookies[0]))
          .status,
      ).toBe(403);
    }, 30000);
  },
);
