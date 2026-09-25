import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ member: true, collaboration: false, selectCount: 0, whereClause: undefined as unknown, channelBatches: null as unknown[][] | null, channelReadIndex: 0 }));

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const authorized = {
    id: "00000000-0000-4000-8000-000000000001",
    ownerOrgType: "vendor",
    ownerOrgId: 10,
    contextKind: "organization",
    contextId: "10",
    name: "Authorized",
    visibility: "private",
    status: "active",
    createdById: 1,
    createdAt: new Date("2026-09-11T10:00:00.000Z"),
    updatedAt: new Date("2026-09-11T10:00:00.000Z"),
  };
  const db = {
    select: vi.fn(() => {
      state.selectCount += 1;
      let table: unknown;
      const builder: Record<string, unknown> = {};
      builder.where = vi.fn((clause: unknown) => { state.whereClause = clause; return builder; });
      for (const method of ["orderBy", "limit"] as const) builder[method] = vi.fn(() => builder);
      builder.from = vi.fn((nextTable: unknown) => { table = nextTable; return builder; });
      builder.then = (resolve: (value: unknown[]) => unknown) => {
        if (table === schema.workHubChannelsTable) return Promise.resolve(resolve(state.channelBatches ? (state.channelBatches[state.channelReadIndex++] ?? []) : [authorized]));
        if (table === schema.workHubChannelMembersTable) return Promise.resolve(resolve(state.member ? [{ id: "member", mode: "member" }] : []));
        if (table === schema.workHubCollaborationChannelsTable) return Promise.resolve(resolve(state.collaboration ? [{ channelId: authorized.id, crewId: null, kind: "shared" }] : []));
        return Promise.resolve(resolve([]));
      };
      return builder;
    }),
  };
  return { ...schema, db };
});

import { listOwnedWorkHubChannels, isWorkHubParticipant, resolveChannelAccess } from "./queries";

describe("bounded Work Hub channel listing", () => {
  beforeEach(() => { state.member = true; state.collaboration = false; state.selectCount = 0; state.whereClause = undefined; state.channelBatches = null; state.channelReadIndex = 0; });

  it("returns authorized channels with one set-based database query", async () => {
    const channels = await listOwnedWorkHubChannels({ userId: 1, role: "vendor", vendorId: 10, membershipRole: "member" }, undefined, 1);
    expect(channels.map((channel) => channel.id)).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(state.selectCount).toBe(1);
  });

  it("keeps collaboration membership constraints for system administrators", async () => {
    await listOwnedWorkHubChannels({ userId: 1, role: "admin", membershipRole: "admin" }, undefined, 1);
    const query = new PgDialect().sqlToQuery(state.whereClause as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(query.sql).toContain("work_hub_collaboration_channels");
    expect(query.sql).toContain("work_hub_channel_members");
  });
});

describe("collaboration note capabilities", () => {
  beforeEach(() => { state.member = true; state.collaboration = true; });
  it("lets a channel member create and edit notes subject to per-note ownership", async () => {
    const session = { userId: 1, role: "vendor" as const, vendorId: 10, membershipRole: "member" as const };
    expect((await resolveChannelAccess(session, "00000000-0000-4000-8000-000000000001", "note.create")).access.capabilities.has("note.create")).toBe(true);
    expect((await resolveChannelAccess(session, "00000000-0000-4000-8000-000000000001", "note.edit")).access.capabilities.has("note.edit")).toBe(true);
    state.member = false;
    await expect(resolveChannelAccess(session, "00000000-0000-4000-8000-000000000001", "note.create")).rejects.toMatchObject({ status: 404 });
  });

  it("uses the channel ID to page through equal update timestamps", async () => {
    await listOwnedWorkHubChannels({ userId: 1, role: "vendor", vendorId: 10, membershipRole: "member" }, new Date("2026-09-24T12:00:00.000Z"), 100, "00000000-0000-4000-8000-000000000050");
    const query = new PgDialect().sqlToQuery(state.whereClause as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(query.sql).toContain("updated_at");
    expect(query.params).toContain("00000000-0000-4000-8000-000000000050");
  });
});

describe("managed subcontractor channel boundaries", () => {
  const session = { userId: 90, role: "field_employee", vendorId: 10, managedSubcontractor: { siteGrants: [{ siteId: 22, role: "gatekeeper" as const }] } };
  const channel = { id: "managed-channel", ownerOrgType: "vendor", ownerOrgId: 10, contextKind: "organization", contextId: "10", visibility: "private" } as Parameters<typeof isWorkHubParticipant>[1];
  it("does not infer private participation from sponsorship", async () => {
    state.member = false;
    expect(await isWorkHubParticipant(session, channel)).toBe(false);
    state.member = true;
    expect(await isWorkHubParticipant(session, channel)).toBe(true);
  });
  it("rejects another owner even with explicit membership", async () => {
    state.member = true;
    expect(await isWorkHubParticipant(session, { ...channel, ownerOrgId: 11 })).toBe(false);
  });
  it("requires granted site and a current sponsor assignment", async () => {
    state.member = true;
    expect(await isWorkHubParticipant(session, { ...channel, contextKind: "site", contextId: "99" })).toBe(false);
    expect(await isWorkHubParticipant(session, { ...channel, contextKind: "site", contextId: "22" })).toBe(false);
  });
  it("fills a page after filtering inaccessible candidate channels", async () => {
    state.channelBatches = [
      [{ ...channel, id: "00000000-0000-4000-8000-000000000071", contextKind: "site", contextId: "22", status: "active", updatedAt: new Date("2026-09-24T12:00:00Z") }],
      [{ ...channel, id: "00000000-0000-4000-8000-000000000070", contextKind: "organization", contextId: "10", status: "active", updatedAt: new Date("2026-09-24T11:59:00Z") }],
    ];
    const result = await listOwnedWorkHubChannels(session, undefined, 1);
    expect(result.map(item => item.id)).toEqual(["00000000-0000-4000-8000-000000000070"]);
    expect(state.channelReadIndex).toBe(2);
  });
});
