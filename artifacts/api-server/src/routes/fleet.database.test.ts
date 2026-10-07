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
  assetHoldsTable,
} from "@workspace/db";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import router from "./fleet";

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
          operationId: randomUUID(),
          fleetId,
          title: "Synthetic hauling day",
          driverUserId: users[1].id,
          vehicleAssetId: vehicle.id,
          stops,
        });
      expect(created.status).toBe(200);
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
      await act(1, "submit_closeout");
      const completed = await act(0, "review", {
        decision: "accept",
        reason: "Reviewed actual user-reported entries",
      });
      expect(completed.status).toBe("completed");
      expect(completed.loads).toHaveLength(2);
      expect(completed.linkedTicketId).toBeNull();
      expect(
        (await request(app).get("/fleet/overview").set("Cookie", cookies[1]))
          .body.observations,
      ).toEqual([]);
      await db.insert(assetHoldsTable).values({
        assetId: vehicle.id,
        reason: "Synthetic hold",
        placedByUserId: users[0].id,
      });
      const held = await request(app)
        .post("/fleet/runs")
        .set("Cookie", cookies[0])
        .send({
          operationId: randomUUID(),
          fleetId,
          title: "Blocked held truck",
          driverUserId: users[1].id,
          vehicleAssetId: vehicle.id,
          stops,
        });
      expect(held.status).toBe(409);
      expect(held.body.code).toBe("fleet.equipment_on_hold");
      await db
        .update(partnerVendorRelationshipsTable)
        .set({ status: "pending" })
        .where(eq(partnerVendorRelationshipsTable.id, relationship.id));
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
