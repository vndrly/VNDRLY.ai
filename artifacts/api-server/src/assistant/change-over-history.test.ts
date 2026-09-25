import { expect, it, vi } from "vitest";
const reads = vi.hoisted(() => ({ stations: vi.fn(async () => [{ id: "inactive-gate", active: false }]), sites: vi.fn(async () => [{ id: 9 }]) }));
vi.mock("../services/gate-change-over", async () => ({ ...(await vi.importActual("../services/gate-change-over")), listChangeOverStations: reads.stations, listChangeOverSites: reads.sites }));
import { runDataTool } from "./data-tools";
it("discovers historical gates without requiring active operational gates", async () => {
  const session = { userId: 10, role: "vendor", vendorId: 42, vendorRole: "gatekeeper" };
  expect(JSON.parse(await runDataTool("query_gate_stations", { siteId: 9, mode: "history" }, session)).stations).toEqual([{ id: "inactive-gate", active: false }]);
  expect(reads.stations).toHaveBeenCalledWith(session, 9, "history");
});
