import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { createInventoryManagementService } from "./inventory-management";
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "Inventory management isolated persistence",
  () => {
    it("orders merge locks behind an existing asset command and refuses revocation without a three-party auth wait", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const {
        db,
        pool,
        vendorsTable,
        usersTable,
        userOrgMembershipsTable,
        assetsTable,
      } = await import("@workspace/db");
      const tag = randomUUID();
      const [vendor] = await db
        .insert(vendorsTable)
        .values({
          name: "Lock " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [user] = await db
        .insert(usersTable)
        .values({
          username: "management-lock-" + tag,
          passwordHash: "not-a-login-hash",
          role: "vendor",
          displayName: "Synthetic lock manager",
        })
        .returning();
      const [member] = await db
        .insert(userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: "vendor",
          vendorId: vendor.id,
          role: "admin",
        })
        .returning();
      const assets = await db
        .insert(assetsTable)
        .values(
          [0, 1].map((n) => ({
            name: tag + n,
            category: "synthetic",
            legalOwnerName: "Synthetic",
            responsibleOrgType: "vendor",
            responsibleOrgId: vendor.id,
          })),
        )
        .returning();
      const session = {
        userId: user.id,
        sv: user.sessionVersion,
        role: "vendor",
        vendorId: vendor.id,
        activeMembershipId: member.id,
        membershipRole: "admin",
      };
      const input = {
        operationId: randomUUID(),
        expectedVersion: 1,
        mergedAssetId: assets[1].id,
        mergedExpectedVersion: 1,
        reason: "Synthetic lock ordering",
        confirmed: true,
      };
      let reached!: () => void;
      const atAsset = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const wrapper = {
        connect: async () => {
          const c = await pool.connect();
          return {
            query: (text: string, values?: unknown[]) => {
              if (
                text.includes("SELECT * FROM assets") &&
                text.includes("FOR UPDATE")
              )
                reached();
              return c.query(text, values);
            },
            release: () => c.release(),
          };
        },
      };
      const hold = await pool.connect(),
        revoker = await pool.connect();
      let merge: Promise<unknown> | undefined,
        revocation: Promise<unknown> | undefined;
      try {
        await hold.query("BEGIN");
        await hold.query("SET LOCAL lock_timeout='3s'");
        await hold.query("SELECT id FROM assets WHERE id=$1 FOR UPDATE", [
          assets[0].id,
        ]);
        const service = createInventoryManagementService(
          wrapper as unknown as typeof pool,
        );
        // Capture failures immediately so barrier failures cannot leave an unhandled rejection.
        merge = service.merge(session, assets[0].id, input).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await Promise.race([
          atAsset,
          merge.then(() => {
            throw Error("Merge ended before asset barrier");
          }),
        ]);
        await revoker.query("BEGIN");
        await revoker.query("SET LOCAL lock_timeout='2s'");
        revocation = revoker.query(
          "UPDATE users SET session_version=session_version+1 WHERE id=$1 RETURNING session_version",
          [user.id],
        );
        // In the previous user-first implementation this update times out behind
        // the waiting merge's auth SHARE lock. No timing-based polling is needed.
        await revocation;
        // The existing asset-first command must remain free to acquire its current-auth lock.
        const currentRead = hold.query(
          "SELECT id FROM users WHERE id=$1 AND session_version=$2 FOR SHARE",
          [user.id, user.sessionVersion],
        );
        await revoker.query("COMMIT");
        const current = await currentRead;
        expect(current.rows).toEqual([]);
        await hold.query("ROLLBACK");
        expect(await merge).toMatchObject({
          error: { code: "asset.current_session_required" },
        });
        await expect(
          service.merge(session, assets[0].id, input),
        ).rejects.toHaveProperty("code", "asset.current_session_required");
        await expect(
          service.readReceipt(session, input.operationId),
        ).rejects.toHaveProperty("code", "asset.current_session_required");
        expect(
          (
            await pool.query(
              "SELECT version,status FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id",
              [assets.map((a) => a.id)],
            )
          ).rows,
        ).toEqual([
          { version: 1, status: "available" },
          { version: 1, status: "available" },
        ]);
        expect(
          (
            await pool.query(
              "SELECT id FROM asset_merges WHERE merged_asset_id=$1",
              [assets[1].id],
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await hold.query("ROLLBACK").catch(() => {});
        await revoker.query("ROLLBACK").catch(() => {});
        await Promise.allSettled([merge, revocation].filter(Boolean));
        hold.release();
        revoker.release();
      }
    }, 15000);
    it("serializes exact policy and two-asset retries, preserves provenance and rejects stale/foreign/current-revoked writes", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const {
        db,
        pool,
        vendorsTable,
        usersTable,
        userOrgMembershipsTable,
        assetsTable,
      } = await import("@workspace/db");
      const tag = randomUUID();
      const [vendor] = await db
        .insert(vendorsTable)
        .values({
          name: "Management " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [user] = await db
        .insert(usersTable)
        .values({
          username: "management-" + tag,
          passwordHash: "not-a-login-hash",
          role: "vendor",
          displayName: "Synthetic manager",
        })
        .returning();
      const [member] = await db
        .insert(userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: "vendor",
          vendorId: vendor.id,
          role: "admin",
        })
        .returning();
      const session = {
        userId: user.id,
        sv: user.sessionVersion,
        role: "vendor",
        vendorId: vendor.id,
        activeMembershipId: member.id,
        membershipRole: "admin",
      };
      const service = createInventoryManagementService(pool);
      const category = "synthetic-" + tag;
      const [
        { default: express },
        { default: cookieParser },
        { default: request },
        { default: router },
        { buildTestCookie },
      ] = await Promise.all([
        import("express"),
        import("cookie-parser"),
        import("supertest"),
        import("../routes/implementationAAssets"),
        import("../test-utils/session"),
      ]);
      const app = express().use(express.json()).use(cookieParser()).use(router),
        cookie = buildTestCookie(session);
      expect(
        (
          await request(app)
            .put(`/implementation-a/assets/policies/${category}`)
            .set("Cookie", cookie)
            .send({ identifierRequired: true })
        ).status,
      ).toBe(400);
      const p = {
        operationId: randomUUID(),
        expectedVersion: 0,
        confirmed: true,
        policy: {
          identifierRequired: true,
          photosRequiredOnCheckout: false,
          photosRequiredOnReturn: true,
          supervisorApprovalRequired: false,
          expectedReturnRequired: true,
        },
      };
      const policies = await Promise.all(
        Array.from({ length: 4 }, () =>
          service.configurePolicy(session, category, p),
        ),
      );
      for (const r of policies) expect(r).toEqual(policies[0]);
      expect(await service.readPolicy(session, category)).toMatchObject({
        version: 1,
        policy: p.policy,
      });
      await expect(
        service.configurePolicy(session, category, {
          ...p,
          operationId: randomUUID(),
        }),
      ).rejects.toHaveProperty("code", "asset.version_conflict");
      await expect(
        service.configurePolicy(session, category, {
          ...p,
          policy: { ...p.policy, identifierRequired: false },
        }),
      ).rejects.toHaveProperty("code", "asset.operation_reused");
      const competingPolicies = await Promise.allSettled(
        [true, false].map((value) =>
          service.configurePolicy(session, category, {
            ...p,
            operationId: randomUUID(),
            expectedVersion: 1,
            policy: { ...p.policy, photosRequiredOnCheckout: value },
          }),
        ),
      );
      expect(
        competingPolicies.filter((r) => r.status === "fulfilled"),
      ).toHaveLength(1);
      expect(competingPolicies.filter((r) => r.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: "asset.version_conflict" }),
        }),
      ]);
      expect(await service.configurePolicy(session, category, p)).toEqual(
        policies[0],
      );
      const currentPolicy = await request(app)
        .get(`/implementation-a/assets/policies/${category}`)
        .set("Cookie", cookie);
      expect(currentPolicy.status, currentPolicy.text).toBe(200);
      expect(currentPolicy.body).toMatchObject({
        version: 2,
        owner: { type: "vendor", id: vendor.id },
      });
      const pair = await db
        .insert(assetsTable)
        .values(
          [0, 1, 2].map((n) => ({
            name: "Duplicate " + tag + "-" + n,
            category,
            legalOwnerName: "Synthetic",
            responsibleOrgType: "vendor",
            responsibleOrgId: vendor.id,
          })),
        )
        .returning();
      const source = pair[1],
        survivor = pair[0],
        third = pair[2],
        historyOp = randomUUID();
      await pool.query(
        "INSERT INTO asset_aliases(asset_id,kind,normalized_value,display_value) VALUES($1,'serial',$2,$2)",
        [source.id, tag.replaceAll("-", "")],
      );
      await pool.query(
        "INSERT INTO asset_custody_events(asset_id,event_type,actor_user_id,operation_id,asset_version) VALUES($1,'return',$2,$3,1)",
        [source.id, user.id, historyOp],
      );
      await pool.query(
        "INSERT INTO asset_condition_evidence(asset_id,condition,reported_by_user_id) VALUES($1,'good',$2)",
        [source.id, user.id],
      );
      await pool.query(
        "INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id) VALUES($1,'test',$2)",
        [source.id, tag],
      );
      const body = {
        operationId: randomUUID(),
        expectedVersion: 1,
        mergedAssetId: source.id,
        mergedExpectedVersion: 1,
        reason: "Reviewed synthetic duplicate",
        confirmed: true,
      };
      expect(
        (
          await request(app)
            .post(`/implementation-a/assets/${survivor.id}/merge`)
            .set("Cookie", cookie)
            .send({
              mergedAssetId: source.id,
              reason: "Missing exact CAS and operation",
            })
        ).status,
      ).toBe(400);
      const merges = await Promise.all(
        Array.from({ length: 4 }, () =>
          service.merge(session, survivor.id, body),
        ),
      );
      for (const r of merges) expect(r).toEqual(merges[0]);
      expect(merges[0]).toMatchObject({
        version: 2,
        mergedVersion: 2,
        physicalPossessionVerified: false,
        legalOwnershipVerified: false,
      });
      for (const table of [
        "asset_aliases",
        "asset_custody_events",
        "asset_condition_evidence",
        "asset_attachment_links",
      ]) {
        const rows = await pool.query(
          `SELECT asset_id FROM ${table} WHERE asset_id=$1`,
          [source.id],
        );
        expect(rows.rows.length).toBeGreaterThan(0);
        expect(rows.rows.every((r) => r.asset_id === source.id)).toBe(true);
      }
      expect(
        (
          await pool.query(
            "SELECT status,current_holder_user_id,merged_into_id,version FROM assets WHERE id=$1",
            [source.id],
          )
        ).rows[0],
      ).toEqual({
        status: "merged",
        current_holder_user_id: null,
        merged_into_id: survivor.id,
        version: 2,
      });
      await expect(
        service.merge(session, third.id, {
          ...body,
          operationId: randomUUID(),
        }),
      ).rejects.toHaveProperty("code", "asset.version_conflict");
      await expect(
        service.merge(
          { ...session, vendorId: vendor.id + 100000 },
          survivor.id,
          body,
        ),
      ).rejects.toHaveProperty("code", "asset.current_membership_required");
      expect(await service.readReceipt(session, body.operationId)).toEqual({
        receipt: merges[0],
      });
      const recovered = await request(app)
        .get(
          `/implementation-a/assets/management/operations/${body.operationId}`,
        )
        .set("Cookie", cookie);
      expect(recovered.status, recovered.text).toBe(200);
      expect(recovered.body).toEqual({ receipt: merges[0] });
      const { databaseAssetRepository } =
        await import("./asset-database-repository");
      const projected = await databaseAssetRepository.get(survivor.id);
      expect(projected?.mergedSources).toEqual([
        expect.objectContaining({
          assetId: source.id,
          aliases: [expect.objectContaining({ kind: "serial" })],
          history: [expect.objectContaining({ operationId: historyOp })],
        }),
      ]);
      const [foreignOwner] = await db
        .insert(vendorsTable)
        .values({
          name: "Foreign management " + tag,
          contactName: "Synthetic",
          contactEmail: "foreign-" + tag + "@example.invalid",
        })
        .returning();
      const [foreign] = await db
        .insert(assetsTable)
        .values({
          name: "Foreign source " + tag,
          category,
          legalOwnerName: "Synthetic",
          responsibleOrgType: "vendor",
          responsibleOrgId: foreignOwner.id,
        })
        .returning();
      await expect(
        service.merge(session, survivor.id, {
          ...body,
          operationId: randomUUID(),
          expectedVersion: 2,
          mergedAssetId: foreign.id,
        }),
      ).rejects.toHaveProperty("code", "asset.not_found");
      expect(
        (
          await pool.query("SELECT status,version FROM assets WHERE id=$1", [
            foreign.id,
          ])
        ).rows[0],
      ).toEqual({ status: "available", version: 1 });
      const [fourth] = await db
        .insert(assetsTable)
        .values({
          name: "Another duplicate " + tag,
          category,
          legalOwnerName: "Synthetic",
          responsibleOrgType: "vendor",
          responsibleOrgId: vendor.id,
        })
        .returning();
      const competingMerges = await Promise.allSettled(
        [third, fourth].map((source) =>
          service.merge(session, survivor.id, {
            ...body,
            operationId: randomUUID(),
            expectedVersion: 2,
            mergedAssetId: source.id,
            mergedExpectedVersion: 1,
          }),
        ),
      );
      expect(
        competingMerges.filter((r) => r.status === "fulfilled"),
      ).toHaveLength(1);
      expect(competingMerges.filter((r) => r.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ code: "asset.version_conflict" }),
        }),
      ]);
      await pool.query(
        "UPDATE user_org_memberships SET role='member' WHERE id=$1",
        [member.id],
      );
      await expect(
        service.merge(session, survivor.id, body),
      ).rejects.toHaveProperty("code", "asset.asset_manager_required");
      await expect(
        service.readReceipt(session, body.operationId),
      ).rejects.toHaveProperty("code", "asset.asset_manager_required");
    });
    it("rolls back both revisions and merge links when receipt insertion fails", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const {
        db,
        pool,
        vendorsTable,
        usersTable,
        userOrgMembershipsTable,
        assetsTable,
      } = await import("@workspace/db");
      const tag = randomUUID();
      const [v] = await db
        .insert(vendorsTable)
        .values({
          name: "Rollback " + tag,
          contactName: "Synthetic",
          contactEmail: tag + "@example.invalid",
        })
        .returning();
      const [u] = await db
        .insert(usersTable)
        .values({
          username: "rollback-" + tag,
          passwordHash: "not-a-login-hash",
          role: "vendor",
          displayName: "Synthetic rollback manager",
        })
        .returning();
      const [m] = await db
        .insert(userOrgMembershipsTable)
        .values({
          userId: u.id,
          orgType: "vendor",
          vendorId: v.id,
          role: "admin",
        })
        .returning();
      const assets = await db
        .insert(assetsTable)
        .values(
          [0, 1].map((n) => ({
            name: tag + "-" + n,
            category: "synthetic",
            legalOwnerName: "Synthetic",
            responsibleOrgType: "vendor",
            responsibleOrgId: v.id,
          })),
        )
        .returning();
      const wrapper = {
        connect: async () => {
          const c = await pool.connect();
          return {
            query: (text: string, values?: unknown[]) => {
              if (text.startsWith("INSERT INTO assistant_action_audit"))
                throw Error("Synthetic receipt failure");
              return c.query(text, values);
            },
            release: () => c.release(),
          };
        },
      };
      const service = createInventoryManagementService(
        wrapper as unknown as typeof pool,
      );
      await expect(
        service.merge(
          {
            userId: u.id,
            sv: u.sessionVersion,
            role: "vendor",
            vendorId: v.id,
            activeMembershipId: m.id,
            membershipRole: "admin",
          },
          assets[0].id,
          {
            operationId: randomUUID(),
            expectedVersion: 1,
            mergedAssetId: assets[1].id,
            mergedExpectedVersion: 1,
            reason: "Synthetic rollback",
            confirmed: true,
          },
        ),
      ).rejects.toThrow("Synthetic receipt failure");
      expect(
        (
          await pool.query(
            "SELECT version,status FROM assets WHERE id=ANY($1::uuid[])",
            [assets.map((a) => a.id)],
          )
        ).rows,
      ).toEqual([
        { version: 1, status: "available" },
        { version: 1, status: "available" },
      ]);
      expect(
        (
          await pool.query(
            "SELECT id FROM asset_merges WHERE merged_asset_id=$1",
            [assets[1].id],
          )
        ).rows,
      ).toEqual([]);
    });
  },
);
