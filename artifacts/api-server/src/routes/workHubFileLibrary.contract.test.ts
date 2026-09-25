import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "../assistant/work-hub-tool-runtime";

const state = vi.hoisted(() => ({ actor: { userId: 1, role: "vendor", vendorId: 42 } as any, member: true, doc: {} as any, links: [] as any[], updates: [] as any[], inserted: [] as any[], channel: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.actor }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("../work-hub/queries", () => ({ resolveChannelAccess: state.channel }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: async () => {} }));
vi.mock("@workspace/db", async original => {
  const actual = await original<any>();
  return { ...actual, db: {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const rows = table === actual.userOrgMembershipsTable ? state.member ? [{ role: "admin" }] : [] : [state.doc];
      return { limit: async () => rows, then: (resolve: any) => resolve(state.links) };
    } }) }),
    execute: async () => {},
    insert: () => ({ values: (value: any) => { state.inserted.push(value); return { returning: async () => [{ id: shareId, ...value }] }; } }),
    update: () => ({ set: (value: any) => ({ where: () => { state.updates.push(value); return { returning: async () => [{ ...state.doc, ...value }], then: (resolve: any) => resolve([]) }; } }) }),
  } };
});
vi.mock("../work-hub/commands", async () => ({ executeWorkHubCommand: async (_actor: unknown, _name: string, _envelope: unknown, run: any) => ({ replayed: false, resource: await run((await import("@workspace/db")).db) }) }));
import router from "./workHubFileLibrary";
const app = express().use(express.json()).use(router);
const docId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
const shareId = "7be22c7d-4638-4144-bb18-0d2a66996a44";
const otherShareId = "7be22c7d-4638-4144-bb18-0d2a66996a45";
beforeEach(() => {
  state.actor = { userId: 1, role: "vendor", vendorId: 42 }; state.member = true; state.updates = []; state.inserted = []; state.links = [];
  state.doc = { id: docId, kind: "document", recordKey: docId, orgType: "vendor", orgId: 42, createdBy: 1, createdAt: new Date(), updatedAt: new Date(), data: { scope: "company", name: "Managed handoff.txt", state: "active", currentFileId: otherShareId, contentType: "text/plain", byteSize: 7, versions: [otherShareId] } };
  state.channel.mockReset().mockResolvedValue({ channel: { ownerOrgType: "vendor", ownerOrgId: 42 } });
});
describe("managed file exact reads and conversational sharing at the route boundary", () => {
  it("reads an authorized managed document by document ID without leaking storage data", async () => {
    const response = await request(app).get(`/work-hub/file-library/${docId}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: docId, subjectType: "document", title: "Managed handoff.txt", status: "active", capabilities: { canDownload: true } });
    expect(response.body).not.toHaveProperty("data");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("denies anonymous, revoked organization, foreign personal and revoked channel reads", async () => {
    state.actor = null;
    expect((await request(app).get(`/work-hub/file-library/${docId}`)).status).toBe(401);
    state.actor = { userId: 1, role: "vendor", vendorId: 42 }; state.member = false;
    expect((await request(app).get(`/work-hub/file-library/${docId}`)).status).toBe(404);
    state.member = true; state.doc.data.scope = "personal"; state.doc.createdBy = 2;
    expect((await request(app).get(`/work-hub/file-library/${docId}`)).status).toBe(404);
    state.doc.data.scope = "channel"; state.doc.data.channelId = otherShareId;
    state.channel.mockRejectedValue(new Error("No access"));
    const denied = await request(app).get(`/work-hub/file-library/${docId}`);
    expect(denied.status).not.toBe(200); expect(denied.body).not.toHaveProperty("title");
  });
  it("executes the normalized share request with its reviewed expiry", async () => {
    const command = resolveExecutableWorkHubToolRequest("share_work_hub_file", { operationId: docId, owner: { type: "vendor", id: 42 }, context: { kind: "organization", id: 42 }, fileId: docId, action: "share", payload: { expiresInDays: 3, shareId: null } }, true)!;
    if (!("body" in command)) throw new Error("Expected request");
    const started = Date.now();
    const response = await request(app).post(command.path).send(command.body);
    expect(response.status).toBe(201);
    expect(Date.parse(response.body.resource.expiresAt)).toBeGreaterThanOrEqual(started + 3 * 86400000);
    expect(Date.parse(response.body.resource.expiresAt)).toBeLessThan(Date.now() + 3 * 86400000 + 1000);
  });
  it("revokes only the reviewed share ID, leaving other links intact", async () => {
    state.links = [otherShareId, shareId].map(id => ({ id, data: { documentId: docId, versionId: id, revoked: false } }));
    const command = resolveExecutableWorkHubToolRequest("share_work_hub_file", { operationId: docId, owner: { type: "vendor", id: 42 }, context: { kind: "organization", id: 42 }, fileId: docId, action: "revoke", payload: { shareId, expiresInDays: null } }, true)!;
    if (!("body" in command)) throw new Error("Expected request");
    expect((await request(app).post(command.path).send(command.body)).status).toBe(201);
    expect(state.updates.filter(value => value.data.revoked === true)).toHaveLength(1);
    expect(state.updates.find(value => value.data.revoked === true).data.versionId).toBe(shareId);
  });
  it("does not modify any link when the reviewed share is outside this document", async () => {
    state.links = [{ id: otherShareId, data: { documentId: docId, revoked: false } }];
    const command = resolveExecutableWorkHubToolRequest("share_work_hub_file", { operationId: docId, owner: { type: "vendor", id: 42 }, context: { kind: "organization", id: 42 }, fileId: docId, action: "revoke", payload: { shareId, expiresInDays: null } }, true)!;
    if (!("body" in command)) throw new Error("Expected request");
    expect((await request(app).post(command.path).send(command.body)).status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
