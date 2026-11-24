import { describe, expect, it } from "vitest";
import { isClientTool, runClientTool } from "./client-tools";
const field = { userId: 10, role: "field_employee" };
describe("AskV client tools", () => {
  it("validates Gate creation drafts without authorizing a save", () => {
    const intent = JSON.parse(runClientTool("prefill_draft", { form: "gate-create", values: JSON.stringify({ siteId: 411, name: "North gate", latitude: 35.2, longitude: -97.4 }) }, { userId: 10, role: "vendor" }));
    expect(intent).toMatchObject({ ok: true, execution: "client", intent: { name: "prefill_draft", arguments: { form: "gate-create", path: "/gate/map", values: { siteId: 411, name: "North gate", latitude: 35.2, longitude: -97.4 } } } });
    expect(JSON.parse(runClientTool("prefill_draft", { form: "gate-create", values: { siteId: 411, latitude: 95 } }, { userId: 10, role: "vendor" })).ok).toBe(false);
    expect(JSON.parse(runClientTool("prefill_draft", { form: "gate-create", values: { siteId: 411, removeGate: true } }, { userId: 10, role: "vendor" })).ok).toBe(false);
    expect(JSON.parse(runClientTool("prefill_draft", { form: "gate-create", values: { siteId: 411 } }, { userId: 10, role: "partner" })).ok).toBe(false);
  });
  it("opens the same staff/equipment reveal targets as the map controls", () => {
    const equipmentId = "11111111-1111-4111-8111-111111111111";
    for (const [target, value] of [["staffUserId", 23], ["equipmentId", equipmentId]] as const) {
      const result = JSON.parse(runClientTool("open_screen", { screen: "gate-map", [target]: value }, field));
      expect(result.ok).toBe(true);
      for (const key of ["path", "mobilePath"]) expect(new URL(result.intent.arguments[key], "https://vndrly.ai").searchParams.get(target)).toBe(String(value));
    }
    expect(JSON.parse(runClientTool("open_screen", { screen: "gate-map", staffUserId: -1 }, field)).ok).toBe(false);
    expect(JSON.parse(runClientTool("open_screen", { screen: "gate-map", staffUserId: 23, equipmentId }, field)).ok).toBe(false);
  });
  it("opens the exact Gate Log window and requested records page on both devices", () => {
    const stationId = "e00cb909-a716-4a65-9375-dd84f337bf6b";
    const result = JSON.parse(runClientTool("open_screen", { screen: "gate-log", siteId: 411, stationId, from: "2026-11-18T02:00:00Z", to: "2026-11-18T03:00:00Z", recordType: "check_ins", page: 2 }, field));
    expect(result.ok).toBe(true);
    for (const [key, path] of [["path", "/gate/history"], ["mobilePath", "/(tabs)/gate-history"]]) {
      const url = new URL(result.intent.arguments[key], "https://vndrly.ai");
      expect(url.pathname).toBe(path);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ siteId: "411", stationId, range: "custom", from: "2026-11-18T02:00:00.000Z", to: "2026-11-18T03:00:00.000Z", recordType: "check_ins", page: "2" });
    }
  });
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
