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
  workHubShiftsTable,
  workHubShiftAssignmentsTable,
  partnersTable,
  siteLocationsTable,
  workTypesTable,
  siteWorkAssignmentsTable,
  gateStationsTable,
} from "@workspace/db";
import scheduling from "./workHubScheduling";
import operations from "./workHubOperations";
import { buildTestCookie } from "../test-utils/session";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
vi.mock("./notifications", () => ({ notifyUsers: vi.fn() }));
const app = express().use(express.json()).use(cookieParser()).use(scheduling).use(operations);
describe("authenticated scheduling reservations", () => {
    let hostCookie: string,
      memberCookie: string,
      otherCookie: string,
      typeId: string;
    let hostUserId: number, memberUserId: number, foreignUserId: number, vendorId: number, gateSiteId: number, gateStationId: string;
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
      [hostUserId, memberUserId, foreignUserId] = people.map((person) => person.id) as [number, number, number];
      vendorId = companies[0]!.id;
      const [partner] = await db.insert(partnersTable).values({ name: `Gate partner ${suffix}`, contactName: "Test", contactEmail: `gate.${suffix}@example.invalid` }).returning();
      const [site] = await db.insert(siteLocationsTable).values({ partnerId: partner!.id, name: `Gate site ${suffix}`, address: "Fixture", latitude: 30, longitude: -100, siteCode: `GATE-${suffix}` }).returning();
      const [workType] = await db.insert(workTypesTable).values({ name: `Gate ${suffix}`, category: "gate" }).returning();
      await db.insert(siteWorkAssignmentsTable).values({ siteLocationId: site!.id, workTypeId: workType!.id, vendorId });
      const [station] = await db.insert(gateStationsTable).values({ siteId: site!.id, name: `Scheduling gate ${suffix}` }).returning();
      gateSiteId = site!.id;
      gateStationId = station!.id;
    });
    it("checks assigned shifts and returns privacy-safe earliest openings", async () => {
      const shiftStart = new Date(Date.now() + 86400000 * 50);
      shiftStart.setUTCMinutes(0, 0, 0);
      const shiftEnd = new Date(shiftStart.getTime() + 60 * 60_000);
      const [shift] = await db.insert(workHubShiftsTable).values({
        ownerOrgType: "vendor",
        ownerOrgId: vendorId,
        title: "Private customer job",
        startsAt: shiftStart,
        endsAt: shiftEnd,
        timezone: "America/Chicago",
        createdById: hostUserId,
      }).returning();
      await db.insert(workHubShiftAssignmentsTable).values({
        shiftId: shift!.id,
        userId: memberUserId,
        assignedById: hostUserId,
      });

      const response = await request(app)
        .post("/work-hub/scheduling/availability-check")
        .set("Cookie", hostCookie)
        .send({
          participantUserIds: [hostUserId, memberUserId],
          requestedStart: new Date(shiftStart.getTime() + 15 * 60_000).toISOString(),
          searchStart: shiftStart.toISOString(),
          searchEnd: new Date(shiftStart.getTime() + 3 * 60 * 60_000).toISOString(),
          durationMinutes: 30,
          timezone: "America/Chicago",
          limit: 2,
        });

      expect(response.status).toBe(200);
      expect(response.body.requested).toMatchObject({ available: false });
      expect(response.body.requested.conflicts).toEqual([
        expect.objectContaining({ userId: memberUserId, kind: "shift" }),
      ]);
      expect(JSON.stringify(response.body)).not.toContain("Private customer job");
      expect(response.body.suggestions[0]).toEqual({
        startsAt: shiftEnd.toISOString(),
        endsAt: new Date(shiftEnd.getTime() + 30 * 60_000).toISOString(),
      });

      const foreign = await request(app)
        .post("/work-hub/scheduling/availability-check")
        .set("Cookie", hostCookie)
        .send({
          participantUserIds: [foreignUserId],
          searchStart: shiftStart.toISOString(),
          searchEnd: shiftEnd.toISOString(),
          timezone: "America/Chicago",
        });
      expect(foreign.status).toBe(404);
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
    it("persists Gate staffing and paid-travel policy on a Work Hub shift", async () => {
      const body = {
        operationId: randomUUID(),
        owner: { type: "vendor", id: vendorId },
        context: { kind: "gate", id: gateSiteId },
        expectedVersion: null,
        payloadVersion: 1,
        payload: {
          title: "Main Gate day shift",
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 12 * 60 * 60_000).toISOString(),
          timezone: "America/Chicago",
          assigneeUserIds: [memberUserId],
          qualificationCodes: [],
          calendarType: "company",
          siteLocationId: gateSiteId,
          gateStationId,
          requiredStaffCount: 2,
          workStartPolicy: "paid_travel",
        },
      };
      const created = await request(app).post("/work-hub/shifts").set("Cookie", hostCookie).send(body);
      expect(created.status).toBe(201);
      expect(created.body.resource).toMatchObject({
        siteLocationId: gateSiteId,
        gateStationId,
        requiredStaffCount: 2,
        workStartPolicy: "paid_travel",
      });
    });
});
