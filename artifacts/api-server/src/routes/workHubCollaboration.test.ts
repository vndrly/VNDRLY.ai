import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db, usersTable, vendorsTable, userOrgMembershipsTable, workHubChannelsTable, workHubChannelMembersTable } from "@workspace/db";
import collaboration from "./workHubCollaboration";
import channels from "./workHubChannels";
import { buildTestCookie } from "../test-utils/session";
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(collaboration).use(channels);
// These integration fixtures may only be inserted by the fresh-local wrapper.
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("collaboration durable authorization", () => {
  let ownerId: number, otherOrg: number, adminId: number, memberId: number, externalId: number;
  let adminCookie: string, memberCookie: string, externalCookie: string, crewId: string;
  beforeAll(async () => {
    const suffix = randomUUID();
    const companies = await db.insert(vendorsTable).values(["A", "B"].map(n => ({ name: `Collaboration ${n} ${suffix}`, contactName: "Test", contactEmail: `${n}.${suffix}@example.invalid` }))).returning();
    ownerId = companies[0]!.id; otherOrg = companies[1]!.id;
    const people = await db.insert(usersTable).values(["Admin", "Member", "External"].map(n => ({ username: `${n}.${suffix}@example.invalid`, email: `${n}.${suffix}@example.invalid`, displayName: n, passwordHash: "unused-test-hash", role: "vendor" }))).returning();
    [adminId, memberId, externalId] = people.map(p => p.id) as [number, number, number];
    await db.insert(userOrgMembershipsTable).values([{ userId: adminId, orgType: "vendor", vendorId: ownerId, role: "admin" }, { userId: memberId, orgType: "vendor", vendorId: ownerId, role: "member" }, { userId: externalId, orgType: "vendor", vendorId: otherOrg, role: "admin" }]);
    adminCookie = buildTestCookie({ userId: adminId, role: "vendor", vendorId: ownerId, membershipRole: "admin" });
    // Deliberately stale elevation claim must be ignored in favor of DB membership.
    memberCookie = buildTestCookie({ userId: memberId, role: "vendor", vendorId: ownerId, membershipRole: "admin" });
    externalCookie = buildTestCookie({ userId: externalId, role: "vendor", vendorId: otherOrg, membershipRole: "admin" });
  });
  it("rejects stale admin claims and foreign owner spoofing; retries create only one Crew", async () => {
    const body = { owner: { type: "vendor", id: ownerId }, name: "Durable crew", operationId: randomUUID() };
    expect((await request(app).post("/work-hub/crews").set("Cookie", memberCookie).send(body)).status).toBe(403);
    expect((await request(app).post("/work-hub/crews").set("Cookie", externalCookie).send(body)).status).toBe(403);
    const first = await request(app).post("/work-hub/crews").set("Cookie", adminCookie).send(body);
    expect(first.status).toBe(201); crewId = first.body.id;
    const replay = await request(app).post("/work-hub/crews").set("Cookie", adminCookie).send(body);
    expect(replay.status).toBe(200); expect(replay.body.id).toBe(crewId);
  });
  it("enforces Crew membership and private-channel invitations", async () => {
    expect((await request(app).get(`/work-hub/crews/${crewId}/members`).set("Cookie", externalCookie)).status).toBe(404);
    expect((await request(app).post(`/work-hub/crews/${crewId}/members`).set("Cookie", adminCookie).send({ userId: externalId })).status).toBe(403);
    expect((await request(app).post(`/work-hub/crews/${crewId}/members`).set("Cookie", adminCookie).send({ userId: memberId })).status).toBe(200);
    const privateChannel = await request(app).post(`/work-hub/crews/${crewId}/channels`).set("Cookie", adminCookie).send({ name: "Private", visibility: "private", operationId: randomUUID() });
    expect(privateChannel.status).toBe(201);
    expect((await request(app).get(`/work-hub/channels/${privateChannel.body.id}/messages`).set("Cookie", memberCookie)).status).toBe(404);
    const wide = await request(app).post(`/work-hub/crews/${crewId}/channels`).set("Cookie", adminCookie).send({ name: "Everyone", visibility: "crew" });
    expect((await request(app).get(`/work-hub/channels/${wide.body.id}/messages`).set("Cookie", memberCookie)).status).toBe(200);
  });
  it("does not expose cross-company chats until the recipient accepts", async () => {
    const [relationship] = await db.insert(workHubChannelsTable).values({ ownerOrgType: "vendor", ownerOrgId: ownerId, contextKind: "organization", contextId: randomUUID(), name: "Authorized relationship", visibility: "private", createdById: adminId }).returning();
    await db.insert(workHubChannelMembersTable).values([{ channelId: relationship!.id, userId: adminId, mode: "owner" }, { channelId: relationship!.id, userId: externalId, mode: "member" }]);
    const created = await request(app).post("/work-hub/chats").set("Cookie", adminCookie).send({ recipientUserId: externalId });
    expect(created.status).toBe(201); const invitation = created.body.invitation;
    expect((await request(app).get(`/work-hub/channels/${invitation.channelId}/messages`).set("Cookie", adminCookie)).status).toBe(404);
    expect((await request(app).post(`/work-hub/invitations/${invitation.id}/respond`).set("Cookie", memberCookie).send({ accept: true })).status).toBe(404);
    expect((await request(app).post(`/work-hub/invitations/${invitation.id}/respond`).set("Cookie", externalCookie).send({ accept: true })).status).toBe(200);
    expect((await request(app).get(`/work-hub/channels/${invitation.channelId}/messages`).set("Cookie", adminCookie)).status).toBe(200);
    const replay = await request(app).post("/work-hub/chats").set("Cookie", adminCookie).send({ recipientUserId: externalId });
    expect(replay.body.channel.id).toBe(invitation.channelId);
  });
});
