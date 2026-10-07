import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  db,
  pool,
  vendorsTable,
  partnersTable,
  usersTable,
  vendorPeopleTable,
  userOrgMembershipsTable,
  siteLocationsTable,
  workTypesTable,
  ticketsTable,
} from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware } from "../test-utils/route-app";
const objects = vi.hoisted(() => new Map<string, any>());
vi.mock("../lib/objectStore", () => ({
  getObjectStore: () => ({
    getObject: async (path: string) => objects.get(path) ?? null,
  }),
}));
import router from "./tickets";
import { resolveContext } from "./auth";
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "current canonical ticket photo role matrix",
  () => {
    it.each([
      "foreman",
      "gate_supervisor",
      "office",
      "platform_admin",
    ] as const)(
      "%s uses current canonical ticket scope and cannot replay after revocation",
      async (role) => {
        assertFreshLocalTestDatabaseEnvironment(process.env);
        const tag = randomUUID();
        const vendors = await db
          .insert(vendorsTable)
          .values(
            [1, 2].map((n) => ({
              name: `Synthetic role photo ${n} ${tag}`,
              contactName: "Synthetic",
              contactEmail: `${n}${tag}@example.invalid`,
            })),
          )
          .returning();
        const [partner] = await db
          .insert(partnersTable)
          .values({
            name: "Synthetic role photo owner " + tag,
            contactName: "Synthetic",
            contactEmail: tag + "@example.invalid",
          })
          .returning();
        const [user] = await db
          .insert(usersTable)
          .values({
            username: "role-photo-" + tag,
            passwordHash: "not-a-login-hash",
            role: role === "platform_admin" ? "admin" : "vendor",
            displayName: "Synthetic " + role,
          })
          .returning();
        const field = role === "foreman" || role === "gate_supervisor";
        let personId: number | null = null;
        if (role !== "platform_admin") {
          const [person] = await db
            .insert(vendorPeopleTable)
            .values({
              vendorId: vendors[0].id,
              userId: user.id,
              vendorRole: role,
              firstName: "Synthetic",
              lastName: role,
              email: tag + "@example.invalid",
            })
            .returning();
          personId = person.id;
          await db
            .insert(userOrgMembershipsTable)
            .values({
              userId: user.id,
              orgType: "vendor",
              vendorId: vendors[0].id,
              role: field ? "field_employee" : "member",
              vendorPeopleId: person.id,
            });
        }
        const ctx = await resolveContext(user),
          session = { ...ctx, userId: user.id, sv: user.sessionVersion };
        expect(ctx.role).toBe(
          role === "platform_admin"
            ? "admin"
            : field
              ? "field_employee"
              : "vendor",
        );
        const [site] = await db
          .insert(siteLocationsTable)
          .values({
            partnerId: partner.id,
            name: "Synthetic role photo site",
            address: "Synthetic",
            latitude: 0,
            longitude: 0,
            siteCode: "RP-" + tag,
          })
          .returning();
        const [work] = await db
          .insert(workTypesTable)
          .values({
            name: "Synthetic role photo work " + tag,
            category: "test",
          })
          .returning();
        const records = await db
          .insert(ticketsTable)
          .values([
            {
              vendorId: vendors[0].id,
              siteLocationId: site.id,
              workTypeId: work.id,
              status: "in_progress",
              lifecycleState: "on_site",
              ...(role === "foreman"
                ? { foremanUserId: user.id }
                : role === "gate_supervisor"
                  ? { fieldEmployeeId: personId }
                  : {}),
            },
            {
              vendorId: vendors[0].id,
              siteLocationId: site.id,
              workTypeId: work.id,
              status: "in_progress",
              lifecycleState: "on_site",
            },
            {
              vendorId: vendors[1].id,
              siteLocationId: site.id,
              workTypeId: work.id,
              status: "in_progress",
              lifecycleState: "on_site",
            },
          ])
          .returning();
        const objectPath = "/objects/uploads/" + randomUUID(),
          bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        objects.set(objectPath, {
          body: bytes,
          size: bytes.length,
          contentType: "image/png",
          acl: { owner: String(user.id), visibility: "private" },
        });
        const app = express()
          .use(express.json())
          .use(cookieParser())
          .use(router);
        attachTestErrorMiddleware(app);
        const cookie = buildTestCookie(session),
          body = { operationId: randomUUID(), objectPath };
        const own = await request(app)
          .post(`/tickets/${records[0].id}/photo-associations`)
          .set("Cookie", cookie)
          .send(body);
        expect(own.status).toBe(200);
        expect(own.body).toMatchObject({
          ticketId: records[0].id,
          status: "applied",
          physicalCaptureVerified: false,
        });
        // Foreman/supervisor role alone never confers access to another unassigned ticket.
        const unassigned = await request(app)
          .post(`/tickets/${records[1].id}/photo-associations`)
          .set("Cookie", cookie)
          .send({ ...body, operationId: randomUUID() });
        expect(unassigned.status).toBe(field ? 403 : 200);
        const foreign = await request(app)
          .post(`/tickets/${records[2].id}/photo-associations`)
          .set("Cookie", cookie)
          .send({ ...body, operationId: randomUUID() });
        expect(foreign.status).toBe(role === "platform_admin" ? 200 : 403);
        if (field)
          await pool.query(
            "UPDATE vendor_people SET is_active=false WHERE id=$1",
            [personId],
          );
        else if (role === "platform_admin")
          await pool.query("UPDATE users SET role='vendor' WHERE id=$1", [
            user.id,
          ]);
        else
          await pool.query(
            "UPDATE users SET session_version=session_version+1 WHERE id=$1",
            [user.id],
          );
        const revoked = await request(app)
          .post(`/tickets/${records[0].id}/photo-associations`)
          .set("Cookie", cookie)
          .send(body);
        expect(revoked.status).toBe(403);
        const count = await pool.query(
          "SELECT count(*)::int AS count FROM ticket_note_logs WHERE ticket_id=$1",
          [records[0].id],
        );
        expect(count.rows[0].count).toBe(1);
      },
    );
  },
);
