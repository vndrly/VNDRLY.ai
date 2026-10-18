import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  results: [] as unknown[][],
  rows: [] as Record<string, unknown>[],
  deletes: 0,
}));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<typeof import("@workspace/db")>();
  const select = () => {
    const chain: any = {
      then: (resolve: (rows: unknown[]) => void) =>
        resolve(state.results.shift() ?? []),
    };
    for (const name of ["from", "where", "innerJoin", "leftJoin", "orderBy"])
      chain[name] = () => chain;
    return chain;
  };
  const database = {
      execute: async () => undefined,
      transaction: async (run: (transaction: unknown) => unknown) => run(database),
      select,
      delete: () => ({
        where: async () => {
          state.deletes++;
        },
      }),
      insert: () => ({
        values: async (rows: Record<string, unknown>[]) => {
          state.rows = rows;
        },
      }),
  };
  return { ...actual, db: database };
});
import { regenerateAutoLaborLines } from "./auto-labor-lines";

beforeEach(() => {
  state.results = [];
  state.rows = [];
  state.deletes = 0;
});
it("bills accepted snapshot pricing and overtime despite changed employee/catalog defaults", async () => {
  state.results = [
    [{ id: 5, jobOfferId: 7, vendorId: 2 }],
    [
      {
        terms: {
          unitPrice: "125.00",
          unit: "hour",
          currency: "USD",
          billingRules: {
            dailyOtHours: "8",
            weeklyOtHours: "40",
            overtimeMultiplier: "2",
          },
        },
      },
    ],
    [{ dailyOt: "12", weeklyOt: "60" }],
    [
      {
        employeeId: 1,
        employeeName: "Synthetic",
        rateKind: "daily",
        dailyRate: "9000",
        defaultRate: "999",
        hourlyRateAtTime: "888",
        checkInAt: new Date("2026-10-18T00:00:00Z"),
        checkOutAt: new Date("2026-10-18T10:00:00Z"),
      },
    ],
  ];
  expect(await regenerateAutoLaborLines(5)).toBe(2);
  expect(state.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ quantity: "8", unitPrice: "125" }),
      expect.objectContaining({ quantity: "2", unitPrice: "250" }),
    ]),
  );
});
it("never deletes existing manual/nonhour lines when automatic billing is unsupported", async () => {
  state.results = [
    [{ id: 5, jobOfferId: 7, vendorId: 2 }],
    [
      {
        terms: {
          unitPrice: "500",
          unit: "day",
          currency: "CAD",
          billingRules: {
            dailyOtHours: "8",
            weeklyOtHours: "40",
            overtimeMultiplier: "1.5",
          },
        },
      },
    ],
  ];
  await expect(regenerateAutoLaborLines(5)).rejects.toThrow(
    "manual_billing_required",
  );
  expect(state.deletes).toBe(0);
  expect(state.rows).toEqual([]);
});
