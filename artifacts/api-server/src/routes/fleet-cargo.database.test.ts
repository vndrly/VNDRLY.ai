import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
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
} from "@workspace/db";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import router from "./fleet";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "Fleet cargo transfer isolated transaction",
  () => {
    it("commits both acknowledged run records once, preserves provenance and cannot deliver outgoing cargo", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const tag = randomUUID();
      const [vendor] = await db
        .insert(vendorsTable)
        .values({
          name: "Cargo " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [partner] = await db
        .insert(partnersTable)
        .values({
          name: "Cargo site " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [site] = await db
        .insert(siteLocationsTable)
        .values({
          partnerId: partner.id,
          name: "Cargo stop " + tag,
          address: "Synthetic",
          latitude: 0,
          longitude: 0,
          siteCode: "CRG-" + tag,
          hidden: false,
        })
        .returning();
      await db
        .insert(partnerVendorRelationshipsTable)
        .values({
          vendorId: vendor.id,
          partnerId: partner.id,
          status: "approved",
        });
      const users = await db
        .insert(usersTable)
        .values(
          ["manager", "source", "recipient"].map((name, index) => ({
            username: name + tag,
            displayName: "Synthetic " + name,
            passwordHash: "unused-isolated-fixture",
            role: index === 0 ? "vendor" : "field_employee",
          })),
        )
        .returning();
      const people = await db
        .insert(vendorPeopleTable)
        .values(
          users
            .slice(1)
            .map((user) => ({
              vendorId: vendor.id,
              userId: user.id,
              firstName: user.displayName,
              email: user.username + "@example.invalid",
              vendorRole: "field",
            })),
        )
        .returning();
      const memberships = await db
        .insert(userOrgMembershipsTable)
        .values(
          users.map((user, index) => ({
            userId: user.id,
            orgType: "vendor",
            vendorId: vendor.id,
            role: index === 0 ? "admin" : "field_employee",
            vendorPeopleId: index === 0 ? null : people[index - 1].id,
          })),
        )
        .returning();
      const cookies = users.map((user, index) =>
        buildTestCookie({
          userId: user.id,
          role: user.role,
          vendorId: vendor.id,
          membershipRole: memberships[index].role,
          activeMembershipId: memberships[index].id,
          vendorPeopleId: index === 0 ? null : people[index - 1].id,
          sv: user.sessionVersion,
        }),
      );
      const equipment = await db
        .insert(assetsTable)
        .values(
          ["source", "recipient"].map((name) => ({
            name: "Synthetic " + name + " truck",
            category: "truck",
            legalOwnerName: "Synthetic",
            responsibleOrgType: "vendor",
            responsibleOrgId: vendor.id,
          })),
        )
        .returning();
      const app = express().use(express.json()).use(cookieParser()).use(router),
        fleetId = randomUUID();
      expect(
        (
          await request(app)
            .post("/fleet/setup")
            .set("Cookie", cookies[0])
            .send({
              expectedVersion: 1,
              enabled: true,
              fleets: [
                {
                  id: fleetId,
                  name: "Synthetic cargo",
                  siteIds: [site.id],
                  equipmentAssetIds: equipment.map((asset) => asset.id),
                },
              ],
              grants: users.map((user, index) => ({
                userId: user.id,
                fleetIds: [fleetId],
                siteIds: [site.id],
                roles: [index === 0 ? "fleet_manager" : "driver"],
                safetyRelease: false,
                financeRead: false,
              })),
            })
        ).status,
      ).toBe(200);
      const runs: any[] = [],
        sourceLoadId = randomUUID();
      const act = async (
        index: number,
        action: string,
        extra: Record<string, unknown> = {},
      ) => {
        const response = await request(app)
          .post(`/fleet/runs/${runs[index].id}/actions`)
          .set("Cookie", cookies[index + 1])
          .send({
            operationId: randomUUID(),
            expectedVersion: runs[index].version,
            action,
            ...extra,
          });
        expect(response.status).toBe(200);
        runs[index] = response.body;
        return response.body;
      };
      for (let index = 0; index < 2; index++) {
        const stops = [
          { id: randomUUID(), siteId: site.id, kind: "pickup", sequence: 0 },
          { id: randomUUID(), siteId: site.id, kind: "delivery", sequence: 1 },
        ];
        const created = await request(app)
          .post("/fleet/runs")
          .set("Cookie", cookies[0])
          .send({
            operationId: randomUUID(),
            fleetId,
            title: "Synthetic cargo " + index,
            driverUserId: users[index + 1].id,
            vehicleAssetId: equipment[index].id,
            stops,
          });
        expect(created.status).toBe(200);
        runs[index] = created.body;
        const dispatched = await request(app)
          .post(`/fleet/runs/${runs[index].id}/actions`)
          .set("Cookie", cookies[0])
          .send({
            operationId: randomUUID(),
            expectedVersion: runs[index].version,
            action: "dispatch",
          });
        expect(dispatched.status).toBe(200);
        runs[index] = dispatched.body;
        await act(index, "acknowledge");
        await act(index, "inspect", {
          inspectionOutcome: "passed",
          notes: "Actual synthetic inspection",
        });
        await act(index, "record_meter", {
          reading: 100,
          unit: "miles",
          notes: "Synthetic meter",
        });
        await act(index, "start");
        await act(index, "arrive_stop", { stopId: stops[0].id });
        if (index === 0)
          await act(index, "record_load", {
            loadId: sourceLoadId,
            commodity: "Bulk",
            quantity: 20,
            unit: "tons",
            manifestReference: "Fictional original cargo manifest",
          });
        await act(index, "pause", {
          reason: "User-reported same-stop cargo handoff",
        });
      }
      const original = runs[0].loads[0],
        targetLoadId = randomUUID();
      const proposed = await request(app)
        .post("/fleet/cargo-transfers")
        .set("Cookie", cookies[0])
        .send({
          operationId: randomUUID(),
          sourceRunId: runs[0].id,
          targetRunId: runs[1].id,
          sourceExpectedVersion: runs[0].version,
          targetExpectedVersion: runs[1].version,
          sourceLoadId,
          targetLoadId,
          siteId: site.id,
          targetDeliveryStopId: runs[1].stops[1].id,
          quantity: 20,
          reason: "Synthetic user-reported full cargo handoff",
        });
      expect(proposed.status).toBe(200);
      let transfer = proposed.body;
      const command = (action: string) => ({
        operationId: randomUUID(),
        expectedVersion: transfer.version,
        sourceExpectedVersion: runs[0].version,
        targetExpectedVersion: runs[1].version,
        action,
        notes: "Actual synthetic participant action",
      });
      expect(
        (
          await request(app)
            .post(`/fleet/cargo-transfers/${transfer.id}/actions`)
            .set("Cookie", cookies[0])
            .send(command("acknowledge_source"))
        ).status,
      ).toBe(403);
      for (const [index, action] of [
        [1, "acknowledge_source"],
        [2, "acknowledge_target"],
      ] as const) {
        const acknowledged = await request(app)
          .post(`/fleet/cargo-transfers/${transfer.id}/actions`)
          .set("Cookie", cookies[index])
          .send(command(action));
        expect(acknowledged.status).toBe(200);
        transfer = acknowledged.body;
      }
      const complete = command("complete"),
        results = await Promise.all(
          Array.from({ length: 3 }, () =>
            request(app)
              .post(`/fleet/cargo-transfers/${transfer.id}/actions`)
              .set("Cookie", cookies[0])
              .send(complete),
          ),
        );
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((result) => result.body.version)).size).toBe(
        1,
      );
      expect(results[0].body).toMatchObject({
        status: "completed",
        physicalHandoffVerified: false,
        inventoryCustodyChanged: false,
      });
      for (let index = 0; index < 2; index++) {
        const read = await request(app)
          .get(`/fleet/runs/${runs[index].id}`)
          .set("Cookie", cookies[index + 1]);
        expect(read.status).toBe(200);
        runs[index] = read.body;
      }
      expect(runs[0].loads[0]).toMatchObject({
        ...original,
        transferOut: { transferId: transfer.id },
      });
      expect(runs[1].loads).toHaveLength(1);
      expect(runs[1].loads[0]).toMatchObject({
        id: targetLoadId,
        manifestReference: original.manifestReference,
        recordedAt: original.recordedAt,
        recordedByUserId: original.recordedByUserId,
        source: "user_report",
        transferIn: { transferId: transfer.id },
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-cargo-operation' AND target_id=$2",
            [vendor.id, complete.operationId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (await request(app).get("/fleet/reports").set("Cookie", cookies[0]))
          .body.loadTotals,
      ).toEqual([
        { commodity: "Bulk", unit: "tons", quantity: 20, deliveredQuantity: 0 },
      ]);
      await act(0, "resume");
      await act(0, "depart_stop", { stopId: runs[0].stops[0].id });
      await act(0, "arrive_stop", { stopId: runs[0].stops[1].id });
      const refused = await request(app)
        .post(`/fleet/runs/${runs[0].id}/actions`)
        .set("Cookie", cookies[1])
        .send({
          operationId: randomUUID(),
          expectedVersion: runs[0].version,
          action: "record_delivery",
          loadId: sourceLoadId,
          deliveryReference: "Must not duplicate cargo",
        });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("fleet.delivery_fields_required");
      const assetRows = await pool.query(
        "SELECT id,current_holder_user_id,version FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id",
        [equipment.map((asset) => asset.id)],
      );
      expect(
        assetRows.rows.every(
          (asset) =>
            asset.current_holder_user_id === null && asset.version === 1,
        ),
      ).toBe(true);
    }, 30000);
  },
);
