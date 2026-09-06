import { beforeEach, describe, expect, it, vi } from "vitest";
const gps = vi.hoisted(() => ({ permission: vi.fn(), position: vi.fn() }));
vi.mock("expo-location", () => ({ Accuracy: { High: 4 }, getForegroundPermissionsAsync: gps.permission,
  requestForegroundPermissionsAsync: gps.permission, getCurrentPositionAsync: gps.position }));
import { withAskVToolLocation } from "../askv-tool-location";
beforeEach(() => {
  gps.permission.mockReset().mockResolvedValue({ status: "granted" });
  gps.position.mockReset().mockResolvedValue({ coords: { latitude: 31.1, longitude: -102.2 } });
});
describe("AskV tool GPS source", () => {
  it("replaces model coordinates with device GPS for field actions", async () => {
    expect(await withAskVToolLocation("set_ticket_lifecycle", { ticketId: 7, latitude: 0, longitude: 0 }))
      .toEqual({ ticketId: 7, latitude: 31.1, longitude: -102.2 });
  });
  it("preserves the exact confirmed GPS snapshot rather than changing bound arguments", async () => {
    expect(await withAskVToolLocation("confirm_visitor_check_in", { firstName: "Pat" }, { latitude: 31, longitude: -102 }))
      .toEqual({ firstName: "Pat", latitude: 31, longitude: -102 });
    expect(gps.position).not.toHaveBeenCalled();
  });
  it("refuses a GPS mutation on denied permission and does not request GPS for shop routing", async () => {
    gps.permission.mockResolvedValue({ status: "denied" });
    await expect(withAskVToolLocation("close_ticket_for_review", { ticketId: 7 })).rejects.toThrow("Nothing was changed");
    expect(await withAskVToolLocation("query_ticket_route_eta", { ticketId: 7, origin: "shop" }))
      .toEqual({ ticketId: 7, origin: "shop" });
    expect(gps.position).not.toHaveBeenCalled();
  });
});
