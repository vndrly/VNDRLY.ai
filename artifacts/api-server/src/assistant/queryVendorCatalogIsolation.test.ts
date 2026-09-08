import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SessionPayload } from "../lib/session";

const mock = vi.hoisted(() => ({ scope: vi.fn(), select: vi.fn(), where: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const query = { from: () => query, innerJoin: () => query,
    where: (condition: unknown) => { mock.where(condition); return query; }, limit: async () => [] };
  mock.select.mockImplementation(() => query);
  return { ...original, db: { select: mock.select } };
});
vi.mock("../lib/partner-catalog-access", () => ({ vendorCatalogPartnerIds: mock.scope }));
import { runOpsDataTool } from "./data-tools-ops";

describe("AskV catalog company isolation", () => {
  const partner = { userId: 1, role: "partner", partnerId: 21 } as SessionPayload;
  beforeEach(() => { mock.scope.mockReset(); mock.select.mockClear(); mock.where.mockClear(); });
  it("uses the active partner's approved scope in the actual catalog query", async () => {
    mock.scope.mockResolvedValue([21]);
    await runOpsDataTool("query_vendor_catalog", { vendorId: 10, partnerId: 22 }, partner);
    expect(mock.scope).toHaveBeenCalledWith(partner, 10);
    const query = new PgDialect().sqlToQuery(mock.where.mock.calls[0][0]);
    expect(query.params).toEqual([10, 21]);
    expect(query.params).not.toContain(22);
  });
  it("does not query any prices when the vendor relationship is inaccessible", async () => {
    mock.scope.mockResolvedValue(null);
    const result = await runOpsDataTool("query_vendor_catalog", { vendorId: 10 }, partner);
    expect(result).toContain("Authorized vendor catalog access required");
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("does not query global prices for a vendor with no approved partners", async () => {
    mock.scope.mockResolvedValue([]);
    const result = JSON.parse(await runOpsDataTool("query_vendor_catalog", { vendorId: 999 },
      { userId: 1, role: "vendor", vendorId: 10 } as SessionPayload));
    expect(result.rows).toEqual([]);
    expect(result.vendorId).toBe(10);
    expect(mock.select).not.toHaveBeenCalled();
  });
});
