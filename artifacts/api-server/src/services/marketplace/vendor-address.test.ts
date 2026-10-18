import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { updateVendorAddressAndCoverage } from "./vendor-address";

function setup(fail = false) {
  const state = {
    vendor: { id: 3, physicalAddress: "Old base", latitude: 35, longitude: -97, geocodedAt: new Date("2026-01-01") } as any,
    areas: [null, 7].map(vendorCapabilityId => ({ vendorId: 3, vendorCapabilityId, active: true, effectiveUntil: null as Date | null })),
    calls: [] as { table: string; sql: string; params: unknown[]; lock?: string }[],
  };
  state.areas.push({ vendorId: 99, vendorCapabilityId: null, active: true, effectiveUntil: null });
  const database = { transaction: async (run: any) => {
    const before = structuredClone(state);
    const tx = {
      select: () => ({ from: (table: any) => ({ where: (where: any) => ({ for: async (lock: string) => {
        state.calls.push({ table: getTableName(table), ...new PgDialect().sqlToQuery(where), lock });
        return [state.vendor];
      } }) }) }),
      update: (table: any) => ({ set: (data: any) => ({ where: (where: any) => {
        const name = getTableName(table);
        const query = new PgDialect().sqlToQuery(where);
        state.calls.push({ table: name, ...query });
        if (name === "vendor_service_areas") {
          for (const area of state.areas) if (area.vendorId === query.params[0] && area.active === query.params[1]) Object.assign(area, data);
          return Promise.resolve();
        }
        return { returning: async () => {
          if (fail) throw new Error("vendor update failed");
          Object.assign(state.vendor, data); return [state.vendor];
        } };
      } }) }),
    };
    try { return await run(tx); } catch (error) { Object.assign(state, before); throw error; }
  } } as any;
  return { state, database };
}

describe("vendor base coverage invalidation", () => {
  it("locks the saved vendor and atomically retires its default and override areas", async () => {
    const x = setup();
    await updateVendorAddressAndCoverage(x.database, 3, { physicalAddress: "New base" });
    expect(x.state.calls[0]).toMatchObject({ table: "vendors", lock: "update", params: [3] });
    expect(x.state.areas.slice(0, 2).every(row => !row.active && row.effectiveUntil instanceof Date)).toBe(true);
    expect(x.state.areas[2].active).toBe(true);
    expect(x.state.vendor).toMatchObject({ physicalAddress: "New base", latitude: null, longitude: null, geocodedAt: null });
    expect(x.state.calls[1].sql).toContain('"vendor_service_areas"."vendor_id"');
  });
  it("keeps unchanged-address coverage and geocoding intact", async () => {
    const x = setup();
    await updateVendorAddressAndCoverage(x.database, 3, { physicalAddress: "Old base", contactName: "New contact" });
    expect(x.state.areas.every(row => row.active)).toBe(true);
    expect(x.state.vendor.latitude).toBe(35);
    expect(x.state.calls.some(row => row.table === "vendor_service_areas")).toBe(false);
  });
  it("rolls back coverage retirement when the vendor update fails", async () => {
    const x = setup(true);
    await expect(updateVendorAddressAndCoverage(x.database, 3, { physicalAddress: "New base" })).rejects.toThrow("vendor update failed");
    expect(x.state.areas.every(row => row.active)).toBe(true);
    expect(x.state.vendor.physicalAddress).toBe("Old base");
  });
});
