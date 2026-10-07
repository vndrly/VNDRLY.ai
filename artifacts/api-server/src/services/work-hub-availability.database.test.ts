import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);
describe.skipIf(!isolated)(
  "own nonFleet availability actual PostgreSQL",
  () => {
    it("serializes one exact replay and stale distinct operations; revocation denies historical receipt; failed atomic effect rolls back", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const s = await import("@workspace/db"),
        { eq } = await import("drizzle-orm"),
        { createWorkHubAvailabilityService } =
          await import("./work-hub-availability"),
        { databaseFleetRepository } = await import("./fleet-repository");
      const target = new URL(process.env.DATABASE_URL!);
      expect(
        (
          await s.pool.query(
            "SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port",
          )
        ).rows[0],
      ).toEqual({
        database: process.env.VNDRLY_FRESH_TEST_DB_NAME,
        address: "127.0.0.1",
        port: Number(target.port),
      });
      const tag = randomUUID(),
        [vendor] = await s.db
          .insert(s.vendorsTable)
          .values({
            name: `SYNTHETIC own availability ${tag}`,
            contactName: "Synthetic",
            contactEmail: `${tag}@example.invalid`,
          })
          .returning();
      const [user] = await s.db
        .insert(s.usersTable)
        .values({
          username: `own-av-${tag}`,
          passwordHash: "synthetic-unusable",
          role: "field_employee",
          displayName: "Synthetic nonFleet worker",
        })
        .returning();
      const [person] = await s.db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: user.id,
          firstName: "Synthetic",
          email: `w.${tag}@example.invalid`,
          vendorRole: "gatekeeper",
        })
        .returning();
      const [member] = await s.db
        .insert(s.userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: "vendor",
          vendorId: vendor.id,
          vendorPeopleId: person.id,
          role: "field_employee",
        })
        .returning();
      const session = {
        userId: user.id,
        vendorId: vendor.id,
        role: "field_employee" as const,
        membershipRole: "field_employee",
        vendorPeopleId: person.id,
        activeMembershipId: member.id,
        sv: user.sessionVersion,
      };
      const service = createWorkHubAvailabilityService(),
        initial = await service.read(session),
        start = new Date(Date.now() + 86400000),
        window = {
          plannedStartAt: start.toISOString(),
          plannedEndAt: new Date(start.getTime() + 3600000).toISOString(),
          timezone: "UTC",
        },
        body = {
          operationId: randomUUID(),
          recordId: null,
          expectedFingerprint: initial.fingerprint,
          window,
          available: true,
        };
      const responses = await Promise.all([
        service.save(session, body),
        service.save(session, body),
        service.save(session, body),
      ]);
      for (const response of responses) expect(response).toEqual(responses[0]);
      expect(
        (
          await s.pool.query(
            "SELECT count(*)::int AS count FROM assistant_action_audit WHERE target_type='work-hub-availability-operation' AND target_id=$1",
            [body.operationId],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(await service.readOperation(session, body.operationId)).toEqual({
        receipt: responses[0],
      });
      await expect(
        service.save(session, { ...body, available: false }),
      ).rejects.toThrow("operation_conflict");
      const fresh = await service.read(session),
        next = {
          ...body,
          recordId: responses[0].record.id,
          expectedFingerprint: fresh.fingerprint,
          available: false,
        };
      const race = await Promise.allSettled([
        service.save(session, { ...next, operationId: randomUUID() }),
        service.save(session, { ...next, operationId: randomUUID() }),
      ]);
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(race.filter((r) => r.status === "rejected")).toHaveLength(1);
      const beforeRollback = await service.read(session),
        rollbackBody = {
          ...body,
          operationId: randomUUID(),
          recordId: responses[0].record.id,
          expectedFingerprint: beforeRollback.fingerprint,
        };
      const failing = createWorkHubAvailabilityService({
        transaction: (companyId, userId, op, authority) =>
          databaseFleetRepository.transaction(
            companyId,
            userId,
            async (state, client) => {
              await op(state, client);
              throw Error("synthetic rollback");
            },
            authority,
          ),
      });
      await expect(failing.save(session, rollbackBody)).rejects.toThrow(
        "synthetic rollback",
      );
      expect((await service.read(session)).fingerprint).toBe(
        beforeRollback.fingerprint,
      );
      expect(
        await service.readOperation(session, rollbackBody.operationId),
      ).toEqual({ receipt: null });
      await s.db
        .update(s.vendorPeopleTable)
        .set({ isActive: false })
        .where(eq(s.vendorPeopleTable.id, person.id));
      await expect(
        service.readOperation(session, body.operationId),
      ).rejects.toThrow("current_person_required");
      await expect(service.save(session, body)).rejects.toThrow(
        "current_person_required",
      );
    });
  },
);
