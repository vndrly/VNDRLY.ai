import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({ pages: [] as any[][], predicates: [] as SQL[], projections: [] as any[] }));
vi.mock("./collaboration-access", () => ({ collaborationChannelAccess: async () => null }));
vi.mock("@workspace/db", async (original) => {
  const schema = await original<typeof import("@workspace/db")>();
  return { ...schema, db: { select: (projection: any) => ({ from: (table: unknown) => {
    if (table !== schema.workHubChannelsTable) return { where: () => ({ limit: async () => [] }) };
    state.projections.push(projection);
    return { where: (predicate: SQL) => { state.predicates.push(predicate); return { orderBy: () => ({ limit: async () => state.pages.shift() ?? [] }) }; } };
  } }) } };
});
import { listOwnedWorkHubChannels } from "./queries";
const stamp = "2026-09-24T12:00:00.123456Z";
const channel = (n: number, owner = 7) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, updatedAt: new Date(stamp), cursorUpdatedAt: stamp, ownerOrgType: "vendor", ownerOrgId: owner, visibility: "organization", contextKind: "organization", contextId: String(owner), status: "active" });
const session = { userId: 11, role: "vendor" as const, vendorId: 7, membershipRole: "member", exp: 9999999999 };
beforeEach(() => { state.pages = []; state.predicates = []; state.projections = []; });
it("returns an opaque timestamp-plus-ID cursor with PostgreSQL microseconds", async () => {
  state.pages = [[channel(2), channel(1)]];
  const rows = await listOwnedWorkHubChannels(session, undefined, 2);
  expect((rows[1] as any).continuationCursor).toEqual(expect.any(String));
  expect(JSON.parse(Buffer.from((rows[1] as any).continuationCursor, "base64url").toString())).toEqual({ updatedAt: stamp, id: channel(1).id });
  const projection = new PgDialect().sqlToQuery(state.projections[0].cursorUpdatedAt);
  expect(projection.sql).toContain('SS.US');
});
it("keeps all microseconds while continuing through managed-filtered pages", async () => {
  state.pages = [[channel(5, 8), channel(4)], [channel(3, 8), channel(2)], [channel(1)]];
  const rows = await listOwnedWorkHubChannels({ ...session, managedSubcontractor: { siteGrants: [{ siteId: 101, role: "gatekeeper" }] } }, undefined, 2);
  expect(rows.map(row => row.id)).toEqual([channel(4).id, channel(2).id]);
  const next = new PgDialect().sqlToQuery(state.predicates[1]);
  expect(next.params).toContain(stamp);
  expect(next.params).not.toContain("2026-09-24T12:00:00.123Z");
});
