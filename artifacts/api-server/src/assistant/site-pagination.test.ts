import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mock = vi.hoisted(() => ({ rows: [] as { id: number }[], select: vi.fn(), where: vi.fn(), limit: vi.fn(), offset: vi.fn(), order: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const query = {
    from: () => query,
    where: (condition: unknown) => { mock.where(condition); return query; },
    orderBy: (...columns: unknown[]) => { mock.order(...columns); return query; },
    limit: (limit: number) => { mock.limit(limit); return query; },
    offset: async (offset: number) => { mock.offset(offset); return mock.rows; },
  };
  mock.select.mockImplementation(() => query);
  return { ...original, db: { select: mock.select } };
});
import { runOpsDataTool } from "./data-tools-ops";
const partner = { userId: 1, role: "partner", partnerId: 21 };
beforeEach(() => { vi.clearAllMocks(); mock.rows = [{ id: 1 }, { id: 2 }, { id: 3 }]; });
describe("Ask V site pagination", () => {
  it("returns a continuation without leaking the lookahead row", async () => {
    const first = JSON.parse(await runOpsDataTool("query_site_locations", { limit: 2, search: "Roman" }, partner));
    expect(first).toMatchObject({ rows: [{ id: 1 }, { id: 2 }], hasMore: true, nextOffset: 2 });
    expect(mock.limit).toHaveBeenCalledWith(3);
    expect(mock.order.mock.calls[0]).toHaveLength(2);
    mock.rows = [{ id: 3 }];
    const last = JSON.parse(await runOpsDataTool("query_site_locations", { limit: 2, offset: first.nextOffset, search: "Roman" }, partner));
    expect(last).toMatchObject({ rows: [{ id: 3 }], offset: 2, hasMore: false, nextOffset: null });
    expect(mock.offset).toHaveBeenLastCalledWith(2);
    for (const [filter] of mock.where.mock.calls) {
      expect(new PgDialect().sqlToQuery(filter).params).toEqual([false, 21, "%Roman%"]);
    }
  });
  it.each([-1, 1.5, "2"])("rejects invalid offsets %s before querying", async offset => {
    expect(JSON.parse(await runOpsDataTool("query_site_locations", { offset }, partner))).toHaveProperty("error");
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("keeps the existing field-employee access restriction", async () => {
    expect(JSON.parse(await runOpsDataTool("query_site_locations", { offset: 2 }, { userId: 2, role: "field_employee" }))).toHaveProperty("error");
    expect(mock.select).not.toHaveBeenCalled();
  });
});
