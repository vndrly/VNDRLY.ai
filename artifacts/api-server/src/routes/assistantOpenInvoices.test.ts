import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SessionPayload } from "../lib/session";

vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {} }));

describe("Ask V open-invoice company boundary", () => {
  let runTool: typeof import("./assistant").runTool;
  let database: typeof import("@workspace/db");
  const where = vi.fn();
  const limit = vi.fn(async () => []);
  const query = { from: () => query, where: (predicate: unknown) => { where(predicate); return query; }, orderBy: () => query, limit };
  beforeAll(async () => {
    database = await import("@workspace/db");
    runTool = (await import("./assistant")).runTool;
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    where.mockClear(); limit.mockClear();
    vi.spyOn(database.db, "select").mockImplementation(() => query as never);
  });
  const read = (identity: object) => runTool("lookup_open_invoices", {}, { userId: 17, ...identity } as SessionPayload, "").then(JSON.parse);
  it("does not query global invoices for missing or invalid company context", async () => {
    for (const role of ["vendor", "partner"]) {
      const key = role === "vendor" ? "vendorId" : "partnerId";
      for (const value of [undefined, null, 0, -1, 1.5, NaN]) {
        expect(await read({ role, [key]: value })).toHaveProperty("error", "No authorized invoice scope on this session.");
      }
    }
    expect(database.db.select).not.toHaveBeenCalled();
  });
  it.each([["vendor", "vendorId"], ["partner", "partnerId"]])("scopes %s reads to its trusted company without a creation-age cutoff", async (role, key) => {
    expect(await read({ role, [key]: 42 })).toEqual({ invoices: [] });
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(sql.params).toEqual(["paid", 42]);
    expect(sql.sql).toContain(key === "vendorId" ? "vendor_id" : "partner_id");
    expect(sql.sql).not.toContain("created_at");
    expect(limit).toHaveBeenCalledWith(10);
  });
  it("preserves the administrative capped lookup and field-worker denial", async () => {
    expect(await read({ role: "field_employee", vendorId: 42 })).toHaveProperty("note");
    expect(database.db.select).not.toHaveBeenCalled();
    expect(await read({ role: "admin" })).toEqual({ invoices: [] });
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(sql.params).toEqual(["paid"]);
    expect(limit).toHaveBeenCalledWith(10);
  });
});
