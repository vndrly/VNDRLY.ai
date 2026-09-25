import { beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ push: vi.fn(), openURL: vi.fn(), api: vi.fn(), current: vi.fn(() => true) }));
vi.mock("expo-router", () => ({ router: { push: ui.push } }));
vi.mock("react-native", () => ({ Linking: { openURL: ui.openURL } }));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://vndrly.ai", apiFetch: ui.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: ui.current }));
import { executeAskVClientIntent, readAskVSafetyDraft, registerAskVControl } from "../askv-client-tools";
import { runClientTool } from "../../../api-server/src/assistant/client-tools";
beforeEach(() => { ui.push.mockReset(); ui.openURL.mockReset().mockResolvedValue(undefined); ui.api.mockReset().mockResolvedValue({}); ui.current.mockReturnValue(true); });
describe("AskV native client capabilities", () => {
  it("opens a managed document from real server arguments while preserving legacy files", async () => {
    for (const [subjectType, readPath] of [["document", "/api/work-hub/file-library/7be22c7d-4638-4144-bb18-0d2a66996a43"], ["file", "/api/work-hub/search/items/file/7be22c7d-4638-4144-bb18-0d2a66996a43"]]) {
      const emitted = JSON.parse(runClientTool("open_screen", { screen: "work-hub-item", subjectType, itemId: "7be22c7d-4638-4144-bb18-0d2a66996a43" }, { userId: 10, role: "field_employee" }));
      expect(emitted.ok).toBe(true);
      expect(await executeAskVClientIntent(emitted.intent, "/askv")).toMatchObject({ ok: true });
      expect(ui.api).toHaveBeenLastCalledWith(readPath);
    }
  });
  it("opens the complete search query emitted by the server", async () => {
    const emitted = JSON.parse(runClientTool("open_screen", { screen: "work-hub-search", query: "pump", types: ["asset", "note"], start: "2026-09-01" }, { userId: 10, role: "field_employee" }));
    expect(await executeAskVClientIntent(emitted.intent, "/askv")).toMatchObject({ ok: true });
    expect(ui.push).toHaveBeenCalledWith("/work-hub/search?q=pump&start=2026-09-01&type=asset%2Cnote");
  });
  it("reauthorizes exact Work Hub navigation and refuses revoked access", async () => {
    const emitted = JSON.parse(runClientTool("open_screen", { screen: "work-hub-item", subjectType: "task", itemId: "7be22c7d-4638-4144-bb18-0d2a66996a43" }, { userId: 10, role: "field_employee" }));
    expect(emitted.ok).toBe(true);
    const intent = emitted.intent;
    expect(await executeAskVClientIntent(intent, "/askv")).toMatchObject({ ok: true, saved: false });
    expect(ui.api).toHaveBeenCalledWith("/api/work-hub/search/items/task/7be22c7d-4638-4144-bb18-0d2a66996a43");
    expect(ui.push).toHaveBeenCalledWith("/work-hub/search-item/task/7be22c7d-4638-4144-bb18-0d2a66996a43");
    ui.push.mockClear(); ui.api.mockRejectedValue(new Error("Access revoked"));
    expect(await executeAskVClientIntent(intent, "/askv")).toMatchObject({ ok: false });
    expect(ui.push).not.toHaveBeenCalled();
    ui.api.mockResolvedValue({}); ui.current.mockReturnValue(false);
    expect(await executeAskVClientIntent(intent, "/askv")).toMatchObject({ ok: false });
    expect(ui.push).not.toHaveBeenCalled();
  });
  it("opens real mobile ticket/scanner routes rather than returning the web path as success", async () => {
    await executeAskVClientIntent({ name: "start_ticket_entry", arguments: { ticketId: 42, kind: "labor", path: "/tickets/42" } }, "/askv");
    expect(ui.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/ticket/[id]", params: expect.objectContaining({ id: "42", askvEntry: "labor" }) }));
    await executeAskVClientIntent({ name: "launch_scanner", arguments: {} }, "/askv");
    expect(ui.push).toHaveBeenCalledWith("/(tabs)/scan");
  });
  it("hydrates a safety draft without submitting it or carrying arbitrary fields", async () => {
    const result = await executeAskVClientIntent({ name: "prefill_draft", arguments: { form: "safety-report", values: JSON.stringify({ title: "Loose cable", eventType: "unsafe_condition", siteLocationId: 3, description: "At the gate", submitted: true }) } }, "/askv");
    expect(result).toMatchObject({ ok: true, saved: false });
    expect(ui.push.mock.calls[0][0].params).toMatchObject({ title: "Loose cable", eventType: "unsafe_condition", siteLocationId: "3" });
    expect(ui.push.mock.calls[0][0].params).not.toHaveProperty("submitted");
    expect(() => readAskVSafetyDraft({ eventType: "made_up" })).toThrow();
  });
  it("does not claim success for unknown controls, unbound camera capture, or failed maps", async () => {
    expect(await executeAskVClientIntent({ name: "focus_control", arguments: { controlId: "hidden" } }, "/askv")).toMatchObject({ ok: false });
    expect(await executeAskVClientIntent({ name: "launch_camera", arguments: {} }, "/askv")).toMatchObject({ ok: false });
    ui.openURL.mockRejectedValue(new Error("Maps unavailable"));
    expect(await executeAskVClientIntent({ name: "launch_maps", arguments: { query: "Alpha" } }, "/askv")).toMatchObject({ ok: false });
  });
  it("only focuses controls registered for the current screen", async () => {
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControl("/askv", "message", focus);
    expect(await executeAskVClientIntent({ name: "focus_control", arguments: { controlId: "message" } }, "/askv")).toMatchObject({ ok: true });
    expect(await executeAskVClientIntent({ name: "focus_control", arguments: { controlId: "message" } }, "/safety-report")).toMatchObject({ ok: false });
    remove();
  });
});
