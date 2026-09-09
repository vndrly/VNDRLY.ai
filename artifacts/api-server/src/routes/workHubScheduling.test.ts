import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  usersTable,
  vendorsTable,
  userOrgMembershipsTable,
} from "@workspace/db";
import scheduling from "./workHubScheduling";
import { buildTestCookie } from "../test-utils/session";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
const app = express().use(express.json()).use(cookieParser()).use(scheduling);
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")(
  "authenticated scheduling reservations",
  () => {
    let hostCookie: string,
      memberCookie: string,
      otherCookie: string,
      typeId: string;
    const start = new Date(Date.now() + 86400000 * 30),
      end = new Date(start.getTime() + 3600000);
    beforeAll(async () => {
      const suffix = randomUUID();
      const companies = await db
        .insert(vendorsTable)
        .values(
          ["A", "B"].map((name) => ({
            name: `Scheduling ${name} ${suffix}`,
            contactName: "Test",
            contactEmail: `${name}.${suffix}@example.invalid`,
          })),
        )
        .returning();
      const people = await db
        .insert(usersTable)
        .values(
          ["Host", "Member", "Foreign"].map((name) => ({
            username: `${name}.${suffix}@example.invalid`,
            email: `${name}.${suffix}@example.invalid`,
            displayName: name,
            passwordHash: "unused-test-hash",
            role: "vendor",
          })),
        )
        .returning();
      await db
        .insert(userOrgMembershipsTable)
        .values(
          people.map((person, i) => ({
            userId: person.id,
            orgType: "vendor",
            vendorId: companies[i === 2 ? 1 : 0]!.id,
            role: i === 1 ? "member" : "admin",
          })),
        );
      [hostCookie, memberCookie, otherCookie] = people.map((p, i) =>
        buildTestCookie({
          userId: p.id,
          role: "vendor",
          vendorId: companies[i === 2 ? 1 : 0]!.id,
          membershipRole: "admin",
        }),
      ) as [string, string, string];
    });
    it("requires sign-in and persists idempotent shared types", async () => {
      expect(
        (await request(app).get("/work-hub/scheduling/types")).status,
      ).toBe(401);
      const body = {
        operationId: randomUUID(),
        title: "Site review",
        durationMinutes: 30,
        timezone: "America/Chicago",
        visibility: "shared",
      };
      const first = await request(app)
        .post("/work-hub/scheduling/types")
        .set("Cookie", hostCookie)
        .send(body);
      expect(first.status).toBe(201);
      typeId = first.body.id;
      const replay = await request(app)
        .post("/work-hub/scheduling/types")
        .set("Cookie", hostCookie)
        .send(body);
      expect(replay.body.id).toBe(typeId);
      expect(
        (
          await request(app)
            .get(`/work-hub/scheduling/types/${typeId}/availability`)
            .set("Cookie", otherCookie)
        ).status,
      ).toBe(404);
    });
    it("rejects stale administrator elevation and concurrent availability overwrites", async () => {
      const body = {
        operationId: randomUUID(),
        expectedVersion: 1,
        windows: [{ startsAt: start.toISOString(), endsAt: end.toISOString() }],
      };
      expect(
        (
          await request(app)
            .put(`/work-hub/scheduling/types/${typeId}/availability`)
            .set("Cookie", memberCookie)
            .send(body)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .put(`/work-hub/scheduling/types/${typeId}/availability`)
            .set("Cookie", hostCookie)
            .send(body)
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .put(`/work-hub/scheduling/types/${typeId}/availability`)
            .set("Cookie", hostCookie)
            .send({ ...body, operationId: randomUUID() })
        ).status,
      ).toBe(409);
    });
    it("serializes competing bookings and replays the winning operation without another meeting", async () => {
      const firstBody = {
        operationId: randomUUID(),
        startsAt: start.toISOString(),
      };
      const secondBody = {
        operationId: randomUUID(),
        startsAt: start.toISOString(),
      };
      const responses = await Promise.all([
        request(app)
          .post(`/work-hub/scheduling/types/${typeId}/book`)
          .set("Cookie", memberCookie)
          .send(firstBody),
        request(app)
          .post(`/work-hub/scheduling/types/${typeId}/book`)
          .set("Cookie", memberCookie)
          .send(secondBody),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const winner = responses.findIndex((r) => r.status === 201);
      const replay = await request(app)
        .post(`/work-hub/scheduling/types/${typeId}/book`)
        .set("Cookie", memberCookie)
        .send(winner === 0 ? firstBody : secondBody);
      expect(replay.status).toBe(200);
      expect(replay.body.occurrence.id).toBe(
        responses[winner]!.body.occurrence.id,
      );
      const slots = await request(app)
        .get(`/work-hub/scheduling/types/${typeId}/availability`)
        .set("Cookie", memberCookie);
      expect(slots.body.slots).not.toContain(start.toISOString());
      expect(slots.body.windows).toEqual([]);
    });
  },
);
