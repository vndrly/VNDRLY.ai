import { describe, expect, it } from "vitest";
import { isClientTool, runClientTool } from "./client-tools";
const field = { userId: 10, role: "field_employee" };
describe("AskV client tools", () => {
  it("provides a web path and preserves the native Gate Map destination", () => {
    expect(JSON.parse(runClientTool("open_screen", { screen: "gate-map" }, { userId: 10, role: "vendor" })))
      .toMatchObject({ ok: true, intent: { arguments: { screen: "gate-map", path: "/gate/map", mobilePath: "/gate-map" } } });
  });
  it("keeps Gate Dashboard separate from the Gate visitor entry form", () => {
    for (const [screen, path] of [["gate", "/gate"], ["gate-dashboard", "/gate/change-over"]]) {
      expect(JSON.parse(runClientTool("open_screen", { screen }, { userId: 10, role: "vendor" })))
        .toMatchObject({ ok: true, intent: { arguments: { screen, path } } });
    }
  });
  it("preserves resolved Gate IDs in both web and native navigation", () => {
    const stationId = "e00cb909-a716-4a65-9375-dd84f337bf6b";
    for (const [screen, path, mobilePath] of [["gate-dashboard", "/gate/change-over", "/(tabs)/change-over"], ["gate-map", "/gate/map", "/gate-map"]]) {
      expect(JSON.parse(runClientTool("open_screen", { screen, siteId: 411, stationId }, { userId: 10, role: "vendor" }))).toMatchObject({ ok: true, intent: { arguments: { path: `${path}?siteId=411&stationId=${stationId}`, mobilePath: `${mobilePath}?siteId=411&stationId=${stationId}` } } });
    }
  });
  it("emits exact Work Hub items and complete validated search filters", () => {
    const exact = JSON.parse(runClientTool("open_screen", { screen: "work-hub-item", subjectType: "task", itemId: "7be22c7d-4638-4144-bb18-0d2a66996a43" }, field));
    expect(exact).toMatchObject({ ok: true, intent: { arguments: { path: "/work-hub/search?type=task&item=7be22c7d-4638-4144-bb18-0d2a66996a43" } } });
    expect(JSON.parse(runClientTool("open_screen", { screen: "work-hub-search", query: "pump", start: "2026-09-01", end: "2026-09-24", types: ["asset", "note"] }, field))).toMatchObject({ intent: { arguments: { path: "/work-hub/search?q=pump&start=2026-09-01&end=2026-09-24&type=asset%2Cnote" } } });
    for (const args of [{ types: ["secret"] }, { start: "not-date" }, { query: {} }, { types: "asset" }]) expect(JSON.parse(runClientTool("open_screen", { screen: "work-hub-search", ...args }, field)).ok).toBe(false);
  });
  it("returns an intent only after validating navigation role and required record", () => {
    expect(
      JSON.parse(runClientTool("open_screen", { screen: "invoices" }, field))
        .ok,
    ).toBe(false);
    expect(
      JSON.parse(
        runClientTool("open_screen", { screen: "ticket-detail" }, field),
      ).ok,
    ).toBe(false);
    expect(
      JSON.parse(
        runClientTool(
          "open_screen",
          { screen: "ticket-detail", id: 42 },
          field,
        ),
      ),
    ).toMatchObject({
      ok: true,
      execution: "client",
      intent: {
        name: "open_screen",
        arguments: { screen: "ticket-detail", id: 42 },
      },
    });
  });
  it("rejects unknown clients, capabilities and malformed entry inputs", () => {
    expect(JSON.parse(runClientTool("launch_camera", {})).ok).toBe(false);
    expect(JSON.parse(runClientTool("invented", {}, field)).ok).toBe(false);
    expect(
      JSON.parse(
        runClientTool(
          "start_ticket_entry",
          { ticketId: 42, kind: "approve" },
          field,
        ),
      ).ok,
    ).toBe(false);
    expect(
      JSON.parse(
        runClientTool(
          "start_ticket_entry",
          { ticketId: -1, kind: "photo" },
          field,
        ),
      ).ok,
    ).toBe(false);
  });
  it("does not claim a client capability already completed", () => {
    expect(isClientTool("launch_camera")).toBe(true);
    expect(JSON.parse(runClientTool("launch_camera", {}, field))).toMatchObject(
      { ok: true, execution: "client", intent: { name: "launch_camera" } },
    );
  });
});
