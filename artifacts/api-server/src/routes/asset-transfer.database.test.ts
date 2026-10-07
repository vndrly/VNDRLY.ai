import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "scoped Inventory transfer persistence",
  () => {
    it("lists only active owner recipients and saves one exact transfer with current-session replay authority", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const {
        db,
        pool,
        usersTable,
        vendorsTable,
        userOrgMembershipsTable,
        assetsTable,
        assetCustodyEventsTable,
      } = await import("@workspace/db");
      const address = await pool.query(
        "SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port",
      );
      const url = new URL(process.env.DATABASE_URL!);
      expect(address.rows[0]).toMatchObject({
        name: decodeURIComponent(url.pathname.slice(1)),
        host: "127.0.0.1",
        port: Number(url.port || 5432),
      });
      const [
        { default: express },
        { default: cookieParser },
        { default: request },
        { default: router },
        { buildTestCookie },
        { eq },
      ] = await Promise.all([
        import("express"),
        import("cookie-parser"),
        import("supertest"),
        import("./implementationAAssets"),
        import("../test-utils/session"),
        import("drizzle-orm"),
      ]);
      const tag = randomUUID();
      const owners = await db
        .insert(vendorsTable)
        .values(
          [0, 1].map((i) => ({
            name: `Transfer ${tag}-${i}`,
            contactName: "Synthetic",
            contactEmail: `${tag}-${i}@example.invalid`,
          })),
        )
        .returning();
      const people = await db
        .insert(usersTable)
        .values(
          [0, 1, 2, 3].map((i) => ({
            username: `transfer-${tag}-${i}`,
            passwordHash: "not-a-login-hash",
            role: "vendor",
            displayName: `Synthetic recipient ${i}`,
            ...(i === 2 ? { suspendedAt: new Date() } : {}),
          })),
        )
        .returning();
      const members = await db
        .insert(userOrgMembershipsTable)
        .values(
          people.map((person, i) => ({
            userId: person.id,
            orgType: "vendor",
            vendorId: owners[i === 3 ? 1 : 0].id,
            role: "admin",
          })),
        )
        .returning();
      const [asset] = await db
        .insert(assetsTable)
        .values({
          name: `Synthetic transfer ${tag}`,
          category: "equipment",
          legalOwnerName: "Synthetic",
          responsibleOrgType: "vendor",
          responsibleOrgId: owners[0].id,
          currentHolderUserId: people[0].id,
          status: "checked_out",
        })
        .returning();
      const cookie = buildTestCookie({
        userId: people[0].id,
        sv: people[0].sessionVersion,
        role: "vendor",
        vendorId: owners[0].id,
        activeMembershipId: members[0].id,
        membershipRole: "admin",
      });
      const app = express().use(express.json()).use(cookieParser()).use(router),
        path = `/implementation-a/assets/${asset.id}`;
      const choices = await request(app)
        .get(`${path}/transfer-recipients`)
        .set("Cookie", cookie);
      expect(choices.status).toBe(200);
      expect(
        choices.body.recipients.map((row: { userId: number }) => row.userId),
      ).toEqual([people[1].id]);
      const input = {
        operationId: randomUUID(),
        expectedVersion: asset.version,
        toHolderUserId: people[1].id,
        condition: "good",
        confirmed: true,
        photos: [],
      };
      expect(
        (
          await request(app)
            .post(`${path}/transfer`)
            .set("Cookie", cookie)
            .send({ ...input, toHolderUserId: people[3].id })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .post(`${path}/transfer`)
            .set("Cookie", cookie)
            .send(input)
        ).body.status,
      ).toBe("applied");
      expect(
        (
          await request(app)
            .post(`${path}/transfer`)
            .set("Cookie", cookie)
            .send(input)
        ).body.status,
      ).toBe("applied");
      const saved = await request(app)
        .get(`${path}/transfers/${input.operationId}`)
        .set("Cookie", cookie);
      expect(saved.body.receipt).toMatchObject({
        actorUserId: people[0].id,
        fromHolderUserId: people[0].id,
        toHolderUserId: people[1].id,
        physicalHandoffVerified: false,
      });
      const events = await db
        .select()
        .from(assetCustodyEventsTable)
        .where(eq(assetCustodyEventsTable.assetId, asset.id));
      expect(
        events.filter((event) => event.operationId === input.operationId),
      ).toHaveLength(1);
      await db
        .update(usersTable)
        .set({ sessionVersion: people[0].sessionVersion + 1 })
        .where(eq(usersTable.id, people[0].id));
      expect(
        (
          await request(app)
            .get(`${path}/transfers/${input.operationId}`)
            .set("Cookie", cookie)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post(`${path}/transfer`)
            .set("Cookie", cookie)
            .send(input)
        ).status,
      ).toBe(403);
    });
  },
);
