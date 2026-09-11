import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ selectCount: 0, whereClause: undefined as unknown }));

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
        if (table === schema.workHubChannelsTable) return Promise.resolve(resolve([authorized]));
        if (table === schema.workHubChannelMembersTable) return Promise.resolve(resolve([{ id: "member" }]));
        return Promise.resolve(resolve([]));
      };
      return builder;
    }),
  };
  return { ...schema, db };
});

import { listOwnedWorkHubChannels } from "./queries";

describe("bounded Work Hub channel listing", () => {
  beforeEach(() => { state.selectCount = 0; state.whereClause = undefined; });

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
