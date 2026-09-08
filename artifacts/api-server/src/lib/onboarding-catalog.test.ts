import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "./session";

const mock = vi.hoisted(() => ({ scope: vi.fn(), rows: [] as { id: number; partnerId: number | null }[] }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: () => ({ from: () => ({ where: async () => mock.rows }) }) } };
});
vi.mock("./partner-catalog-access", () => ({ vendorCatalogPartnerIds: mock.scope }));
import { onboardingCatalogSelection, addOnboardingCatalogSelections } from "./onboarding-catalog";

const session = { userId: 1, role: "vendor", vendorId: 10 } as SessionPayload;
describe("onboarding catalog preservation", () => {
  beforeEach(() => { mock.scope.mockResolvedValue([21]); mock.rows = []; });
  it("keeps master choices as onboarding interests, not vendor price rows", async () => {
    mock.scope.mockResolvedValue([]);
    mock.rows = [{ id: 1, partnerId: null }];
    expect(await onboardingCatalogSelection(session, 10, [1])).toEqual([]);
  });
  it("rejects another partner's service before any catalog writes", async () => {
    mock.rows = [{ id: 2, partnerId: 22 }];
    expect(await onboardingCatalogSelection(session, 10, [2])).toBeNull();
    expect(mock.scope).toHaveBeenCalledWith(session, 10);
  });
  it("rejects missing IDs and unauthorized sessions", async () => {
    expect(await onboardingCatalogSelection(session, 10, [99])).toBeNull();
    mock.scope.mockResolvedValue(null);
    expect(await onboardingCatalogSelection(session, 10, [1])).toBeNull();
  });
  it("adds only approved owned choices without overwriting any existing price or selection", async () => {
    mock.rows = [{ id: 1, partnerId: null }, { id: 2, partnerId: 21 }];
    const ids = await onboardingCatalogSelection(session, 10, [1, 2]);
    expect(ids).toEqual([2]);
    const rows = [{ vendorId: 10, workTypeId: 2, unitPrice: "125" }, { vendorId: 10, workTypeId: 3, unitPrice: "200" }];
    const insert = vi.fn(() => ({ values: (values: typeof rows) => ({ onConflictDoNothing: async () => {
      for (const value of values) if (!rows.some(row => row.workTypeId === value.workTypeId)) rows.push(value);
    } }) }));
    await addOnboardingCatalogSelections({ insert } as never, 10, ids!);
    expect(rows).toEqual([{ vendorId: 10, workTypeId: 2, unitPrice: "125" }, { vendorId: 10, workTypeId: 3, unitPrice: "200" }]);
    expect(insert).toHaveBeenCalledOnce();
  });
});
