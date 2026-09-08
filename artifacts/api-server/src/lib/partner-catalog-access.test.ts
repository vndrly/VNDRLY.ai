import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SessionPayload } from "./session";

const mock = vi.hoisted(() => ({ rows: [] as unknown[], where: vi.fn(), select: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const query = {
    from: () => query,
    where: (condition: unknown) => { mock.where(condition); return query; },
    limit: async () => mock.rows,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(mock.rows).then(resolve),
  };
  mock.select.mockImplementation(() => query);
  return { ...original, db: { select: mock.select } };
});
import { catalogSaveScope, vendorCatalogPartnerIds } from "./partner-catalog-access";
import { canReadVendorAgreement, projectVendorAgreement } from "./vendor-agreement";
import { deriveStatus, type DeriveStatusInput } from "./approval-derivation";

const session = (values: Partial<SessionPayload>) => ({ userId: 1, role: "vendor", vendorId: 10, ...values }) as SessionPayload;

describe("partner-owned catalogs", () => {
  beforeEach(() => { mock.rows = []; mock.where.mockClear(); mock.select.mockClear(); });
  it("rejects another vendor and field employee before querying catalogs", async () => {
    expect(await vendorCatalogPartnerIds(session({ vendorId: 11 }), 10)).toBeNull();
    expect(await vendorCatalogPartnerIds(session({ role: "field_employee" }), 10)).toBeNull();
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("requires approved relationships for a vendor's combined view", async () => {
    mock.rows = [{ partnerId: 21 }, { partnerId: 22 }];
    expect(await vendorCatalogPartnerIds(session({}), 10)).toEqual([21, 22]);
    const query = new PgDialect().sqlToQuery(mock.where.mock.calls[0][0]);
    expect(query.params).toContain(10);
    expect(query.params).toContain("approved");
  });
  it("binds partner access to the active company", async () => {
    mock.rows = [{ partnerId: 21 }];
    expect(await vendorCatalogPartnerIds(session({ role: "partner", partnerId: 21 }), 10)).toEqual([21]);
    expect(new PgDialect().sqlToQuery(mock.where.mock.calls[0][0]).params).toContain(21);
  });
  it("scopes replacement saves without including another partner or legacy prices", () => {
    const accessible = [{ id: 1, partnerId: null }, { id: 101, partnerId: 21 }, { id: 102, partnerId: 22 }];
    expect([...catalogSaveScope(accessible, 21)]).toEqual([101]);
    expect([...catalogSaveScope(accessible, undefined)]).toEqual([101, 102]);
    expect([...catalogSaveScope(accessible, 999)]).toEqual([]);
  });
  it("rejects cross-vendor historical snapshots before querying", async () => {
    expect(await canReadVendorAgreement(session({ vendorId: 11 }), 10)).toBe(false);
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("projects historical service rows to owned IDs and explicit source mappings", async () => {
    mock.rows = [{ id: 101, sourceId: 1 }];
    const snapshot = { workTypesSnapshot: [{ workTypeId: 1 }, { workTypeId: 101 }, { workTypeId: 202 }], ratesSnapshot: { dailyOtHours: "8" } };
    const result = await projectVendorAgreement(snapshot as Parameters<typeof projectVendorAgreement>[0], session({ role: "partner", partnerId: 21 }));
    expect(result.workTypesSnapshot.map(row => row.workTypeId)).toEqual([1, 101]);
    expect(result.ratesSnapshot.dailyOtHours).toBeNull();
    expect(snapshot.workTypesSnapshot).toHaveLength(3);
  });
});

describe("approval without independent vendor publishing", () => {
  const input: DeriveStatusInput = {
    currentStatus: "approved", approvedCatalogVersionId: 1,
    vendorCurrentCatalogVersionId: 2, hasCurrentEulaAcceptance: false,
    hasQualifiedEmployee: true, now: new Date("2026-09-07T12:00:00Z"),
    compliance: { coiExpirationDate: "2027-01-01", coiDocumentUrl: "/coi", wcExpirationDate: null, wcDocumentUrl: null,
      glExpirationDate: null, glDocumentUrl: null, autoLiabilityExpirationDate: null, autoLiabilityDocumentUrl: null, w9DocumentUrl: "/w9" },
  };
  it("does not revoke approved relationships for catalog version drift", () => {
    expect(deriveStatus(input).status).toBe("approved");
  });
  it("still revokes expired compliance and never promotes pending relationships", () => {
    expect(deriveStatus({ ...input, compliance: { ...input.compliance, coiExpirationDate: "2026-01-01" } }).status).toBe("auto_unapproved");
    expect(deriveStatus({ ...input, currentStatus: "pending_review" }).status).toBe("pending_review");
  });
});
