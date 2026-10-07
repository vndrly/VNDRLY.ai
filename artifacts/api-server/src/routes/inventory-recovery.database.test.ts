import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import {
  assetsTable,
  assetAliasesTable,
  db,
  pool,
  usersTable,
  vendorsTable,
  userOrgMembershipsTable,
} from "@workspace/db";
import { buildTestCookie } from "../test-utils/session";
import { databaseAssetRepository } from "../services/asset-database-repository";
vi.mock("./notifications", () => ({ notifyUsers: vi.fn(async () => []) }));
import router from "./implementationAAssets";
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "Inventory recovery isolated boundaries",
  () => {
    it("preserves two-owner identifiers, loss custody and exact claims through mediated correction", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const tag = randomUUID();
      const owners = await db
        .insert(vendorsTable)
        .values(
          [0, 1].map((index) => ({
            name: `Inventory recovery ${tag}-${index}`,
            contactName: "Synthetic",
            contactEmail: `${tag}-${index}@example.invalid`,
          })),
        )
        .returning();
      const users = await db
        .insert(usersTable)
        .values(
          [0, 1, 2].map((index) => ({
            username: `inventory-${tag}-${index}`,
            passwordHash: "not-a-login-hash",
            role: index === 2 ? "admin" : "vendor",
            displayName: `Synthetic ${index}`,
          })),
        )
        .returning();
      const memberships = await db
        .insert(userOrgMembershipsTable)
        .values(
          [0, 1].map((index) => ({
            userId: users[index].id,
            orgType: "vendor",
            vendorId: owners[index].id,
            role: "admin",
          })),
        )
        .returning();
      const cookies = users.map((user, index) =>
        buildTestCookie({
          userId: user.id,
          sv: user.sessionVersion,
          role: index === 2 ? "admin" : "vendor",
          ...(index < 2
            ? {
                vendorId: owners[index].id,
                activeMembershipId: memberships[index].id,
                membershipRole: "admin",
              }
            : {}),
        }),
      );
      const records = await db
        .insert(assetsTable)
        .values(
          [0, 1].map((index) => ({
            name: `Synthetic radio ${index}`,
            category: "equipment",
            legalOwnerName: "Synthetic",
            responsibleOrgType: "vendor",
            responsibleOrgId: owners[index].id,
            currentHolderUserId: users[index].id,
            status: "checked_out",
          })),
        )
        .returning();
      const serial = `SERIAL-${tag}`;
      await db
        .insert(assetAliasesTable)
        .values({
          assetId: records[0].id,
          kind: "serial",
          normalizedValue: serial.toUpperCase().replace(/[^A-Z0-9]/g, ""),
          displayValue: serial,
        });
      const foreign = (await databaseAssetRepository.get(records[1].id))!;
      foreign.aliases.push({ kind: "serial", value: serial });
    const originalAsset = (await databaseAssetRepository.get(records[0].id))!;
    const concurrent = await Promise.allSettled([
      databaseAssetRepository.save(originalAsset, originalAsset.version),
      databaseAssetRepository.save(foreign, foreign.version),
    ]);
    expect(concurrent[0].status).toBe("fulfilled");
    expect(concurrent[1]).toMatchObject({ status: "rejected", reason: { code: "asset.identifier_in_use" } });
      const alias = await pool.query(
        "SELECT asset_id FROM asset_aliases WHERE display_value=$1",
        [serial],
      );
      expect(alias.rows[0].asset_id).toBe(records[0].id);
      expect((await databaseAssetRepository.get(records[1].id))!.version).toBe(
        1,
      );
      const app = express().use(express.json()).use(cookieParser()).use(router);
      const base = `/implementation-a/assets/${records[1].id}`;
      const loss = {
        operationId: randomUUID(),
        expectedVersion: 1,
        condition: "stolen",
        reason: "Fictional test report; possession not verified",
        confirmed: true,
      };
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(app)
            .post(`${base}/loss-report`)
            .set("Cookie", cookies[1])
            .send(loss),
        ),
      );
      expect(results.every((result) => result.status === 200)).toBe(true);
      expect(results[0].body).toMatchObject({
        version: 2,
        holderUserId: users[1].id,
        physicalLossVerified: false,
      });
      const saved = await pool.query(
        "SELECT current_holder_user_id,status,version FROM assets WHERE id=$1",
        [records[1].id],
      );
      expect(saved.rows[0]).toMatchObject({
        current_holder_user_id: users[1].id,
        status: "held",
        version: 2,
      });
      const lossEvents = await pool.query(
        "SELECT actor_user_id FROM asset_custody_events WHERE operation_id=$1",
        [loss.operationId],
      );
      expect(lossEvents.rows).toEqual([{ actor_user_id: users[1].id }]);
      await request(app)
        .post(`${base}/loss-report`)
        .set("Cookie", cookies[0])
        .send({ ...loss, operationId: randomUUID() })
        .expect(404);
      const claim = {
        operationId: randomUUID(),
        claimId: randomUUID(),
        expectedVersion: 2,
        alias: { kind: "serial", value: serial },
        reason: "Fictional re-registration needs human review",
        confirmed: true,
      };
      const submitted = await request(app)
        .post(`${base}/identifier-claims`)
        .set("Cookie", cookies[1])
        .send(claim)
        .expect(200);
      expect(submitted.body).toMatchObject({
        status: "pending_review",
        ownershipTransferred: false,
        otherOwnerDisclosed: false,
      });
      expect(JSON.stringify(submitted.body)).not.toContain(records[0].id);
      expect(submitted.body.existingAssetId).toBeUndefined();
      const ownerNotices = await request(app)
        .get(`/implementation-a/assets/${records[0].id}/identifier-claims`)
        .set("Cookie", cookies[0])
        .expect(200);
      expect(ownerNotices.body.incoming).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: claim.claimId, assetId: records[0].id, requesterDisclosed: false }),
      ]));
      expect(JSON.stringify(ownerNotices.body.incoming)).not.toContain(records[1].id);
      expect(JSON.stringify(ownerNotices.body.incoming)).not.toContain(claim.reason);
      await request(app)
        .get(`${base}/identifier-claims`)
        .set("Cookie", cookies[0])
        .expect(404);
      await request(app)
        .get("/implementation-a/asset-identifier-claims")
        .set("Cookie", cookies[1])
        .expect(403);
      const queue = await request(app)
        .get("/implementation-a/asset-identifier-claims")
        .set("Cookie", cookies[2])
        .expect(200);
      expect(queue.body.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: claim.claimId }),
        ]),
      );
      const resolution = {
        operationId: randomUUID(),
        expectedVersion: 1,
        decision: "correct_requester_alias",
        reason: "Synthetic exact corrected serial reviewed",
        correctedAlias: { kind: "serial", value: `CORRECTED-${tag}` },
        confirmed: true,
      };
      await request(app)
        .post(`${base}/identifier-claims/${claim.claimId}/resolve`)
        .set("Cookie", cookies[1])
        .send(resolution)
        .expect(403);
      const resolved = await request(app)
        .post(`${base}/identifier-claims/${claim.claimId}/resolve`)
        .set("Cookie", cookies[2])
        .send(resolution)
        .expect(200);
      expect(resolved.body).toMatchObject({
        status: "resolved_requester_corrected",
        version: 2,
        ownershipTransferred: false,
        correctedAlias: resolution.correctedAlias,
      });
      await request(app)
        .post(`${base}/identifier-claims/${claim.claimId}/resolve`)
        .set("Cookie", cookies[2])
        .send(resolution)
        .expect(200);
      const original = await pool.query(
        "SELECT asset_id FROM asset_aliases WHERE display_value=$1",
        [serial],
      );
      expect(original.rows[0].asset_id).toBe(records[0].id);
      expect(
        (await databaseAssetRepository.get(records[1].id))!.holderUserId,
      ).toBe(users[1].id);
      await pool.query(
        "UPDATE users SET session_version=session_version+1 WHERE id=$1",
        [users[1].id],
      );
      await request(app)
        .post(`${base}/loss-report`)
        .set("Cookie", cookies[1])
        .send(loss)
        .expect(403);
    });
  },
);
