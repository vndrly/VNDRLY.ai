import { beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({
  push: vi.fn(),
  openURL: vi.fn(),
  api: vi.fn(),
  current: vi.fn(() => true),
}));
vi.mock("expo-router", () => ({ router: { push: ui.push } }));
vi.mock("react-native", () => ({ Linking: { openURL: ui.openURL } }));
vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://vndrly.ai",
  apiFetch: ui.api,
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: ui.current,
}));
import {
  ASKV_NATIVE_CLIENT_INTENT_NAMES,
  executeAskVClientIntent,
  readAskVSafetyDraft,
  registerAskVControl,
  registerAskVControlAliases,
  subscribeAskVGateCreateDraft,
} from "../askv-client-tools";
import {
  ASKV_SERVER_CLIENT_INTENT_NAMES,
  runClientTool,
} from "../../../api-server/src/assistant/client-tools";
import { registerVoicePageContext } from "@workspace/gate-booth";
beforeEach(() => {
  ui.push.mockReset();
  ui.openURL.mockReset().mockResolvedValue(undefined);
  ui.api.mockReset().mockResolvedValue({});
  ui.current.mockReturnValue(true);
});
describe("AskV native client capabilities", () => {
  it("routes a validated Gate creation draft into the page bridge without saving", async () => {
    const seen = vi.fn(async draft => ({ requestId: draft.requestId, ok: true, state: { mode: "create", siteId: draft.siteId, missing: ["gate name"], readyToReview: false } }));
    const remove = subscribeAskVGateCreateDraft(seen);
    try {
      const emitted = JSON.parse(runClientTool("prefill_draft", { form: "gate-create", values: JSON.stringify({ siteId: 411, latitude: 35.2, longitude: -97.4 }) }, { userId: 10, role: "vendor" }));
      expect(await executeAskVClientIntent(emitted.intent, "/askv")).toMatchObject({ ok: true, message: expect.stringContaining("gate name") });
      expect(ui.push).toHaveBeenCalledWith("/(tabs)/gate-map?view=tools");
      expect(seen).toHaveBeenCalledWith(expect.objectContaining({ target: "administration", siteId: 411, latitude: 35.2, longitude: -97.4 }));
      expect(ui.api).not.toHaveBeenCalled();
    } finally { remove(); }
  });
  it("rejects malformed Gate drafts before touching the page bridge", async () => {
    const seen = vi.fn();
    const remove = subscribeAskVGateCreateDraft(seen);
    try {
      expect(await executeAskVClientIntent({ name: "prefill_draft", arguments: { form: "gate-create", values: { siteId: 411, removeGate: true } } }, "/gate-map")).toMatchObject({ ok: false });
      expect(seen).not.toHaveBeenCalled();
    } finally { remove(); }
  });
  it("reveals the same staff target in the native map and confirms its returned view", async () => {
    const unregister = registerVoicePageContext(() => ({ path: "/gate/map", mapView: { target: "staff:23", state: "displayed" } }));
    try {
      const emitted = JSON.parse(runClientTool("open_screen", { screen: "gate-map", staffUserId: 23 }, { userId: 10, role: "vendor" }));
      expect(await executeAskVClientIntent(emitted.intent, "/askv")).toMatchObject({ ok: true });
      expect(ui.push).toHaveBeenLastCalledWith("/(tabs)/gate-map?staffUserId=23");
    } finally { unregister(); }
  });
  it("keeps a requested Gate Log time window and page in the native route", async () => {
    const stationId = "e00cb909-a716-4a65-9375-dd84f337bf6b";
    const from = "2026-11-17T22:00:00.000Z", to = "2026-11-17T23:00:00.000Z";
    const unregister = registerVoicePageContext(() => ({ path: "/gate/history", parameters: { siteId: "42", stationId, range: "custom", from, to, recordType: "all" }, recordsView: { loading: false, error: false, page: 2, total: 60, records: ["Sharon"] } }));
    try {
      const emitted = JSON.parse(runClientTool("open_screen", { screen: "gate-log", siteId: 42, stationId, from, to, page: 2 }, { userId: 10, role: "vendor" }));
      expect(await executeAskVClientIntent(emitted.intent, "/askv")).toMatchObject({ ok: true, page: 2, total: 60 });
      expect(ui.push.mock.lastCall?.[0]).toContain("page=2");
    } finally { unregister(); }
  });
  it("opens Gate Map, Gate Dashboard and Calendar from the server's actual client intents", async () => {
    for (const [screen, route] of [
      ["gate-map", "/(tabs)/gate-map"],
      ["gate", "/(tabs)/gate"],
      ["gate-dashboard", "/(tabs)/change-over"],
      ["work-hub-calendar", "/work-hub/calendar"],
    ]) {
      const emitted = JSON.parse(
        runClientTool(
          "open_screen",
          { screen },
          { userId: 10, role: "vendor" },
        ),
      );
      expect(
        await executeAskVClientIntent(emitted.intent, "/askv"),
      ).toMatchObject({ ok: true, opened: true });
      expect(ui.push).toHaveBeenLastCalledWith(route);
      expect(ui.openURL).not.toHaveBeenCalled();
    }
  });
  it("keeps the exact resolved gate when opening the native dashboard or map", async () => {
    const stationId = "e00cb909-a716-4a65-9375-dd84f337bf6b";
    for (const [screen, route] of [
      ["gate-dashboard", "/(tabs)/change-over"],
      ["gate-map", "/(tabs)/gate-map"],
    ]) {
      const emitted = JSON.parse(
        runClientTool(
          "open_screen",
          { screen, siteId: 411, stationId },
          { userId: 10, role: "vendor" },
        ),
      );
      expect(
        await executeAskVClientIntent(emitted.intent, "/askv"),
      ).toMatchObject({ ok: true });
      expect(ui.push).toHaveBeenLastCalledWith(
        `${route}?siteId=411&stationId=${stationId}`,
      );
    }
  });
  it("keeps every server-emitted client intent wired on native", () => {
    const expected = new Set([
      "open_screen",
      "focus_control",
      "prefill_draft",
      "prefill_gate_visit",
      "launch_camera",
      "launch_maps",
      "launch_scanner",
      "start_ticket_entry",
    ]);
    expect(new Set(ASKV_SERVER_CLIENT_INTENT_NAMES)).toEqual(expected);
    expect(new Set(ASKV_NATIVE_CLIENT_INTENT_NAMES)).toEqual(expected);
  });
  it("opens a managed document from real server arguments while preserving legacy files", async () => {
    for (const [subjectType, readPath] of [
      [
        "document",
        "/api/work-hub/file-library/7be22c7d-4638-4144-bb18-0d2a66996a43",
      ],
      [
        "file",
        "/api/work-hub/search/items/file/7be22c7d-4638-4144-bb18-0d2a66996a43",
      ],
    ]) {
      const emitted = JSON.parse(
        runClientTool(
          "open_screen",
          {
            screen: "work-hub-item",
            subjectType,
            itemId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
          },
          { userId: 10, role: "field_employee" },
        ),
      );
      expect(emitted.ok).toBe(true);
      expect(
        await executeAskVClientIntent(emitted.intent, "/askv"),
      ).toMatchObject({ ok: true });
      expect(ui.api).toHaveBeenLastCalledWith(readPath);
    }
  });
  it("opens the complete search query emitted by the server", async () => {
    const emitted = JSON.parse(
      runClientTool(
        "open_screen",
        {
          screen: "work-hub-search",
          query: "pump",
          types: ["asset", "note"],
          start: "2026-09-01",
        },
        { userId: 10, role: "field_employee" },
      ),
    );
    expect(
      await executeAskVClientIntent(emitted.intent, "/askv"),
    ).toMatchObject({ ok: true });
    expect(ui.push).toHaveBeenCalledWith(
      "/work-hub/search?q=pump&start=2026-09-01&type=asset%2Cnote",
    );
  });
  it("reauthorizes exact Work Hub navigation and refuses revoked access", async () => {
    const emitted = JSON.parse(
      runClientTool(
        "open_screen",
        {
          screen: "work-hub-item",
          subjectType: "task",
          itemId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
        },
        { userId: 10, role: "field_employee" },
      ),
    );
    expect(emitted.ok).toBe(true);
    const intent = emitted.intent;
    expect(await executeAskVClientIntent(intent, "/askv")).toMatchObject({
      ok: true,
      saved: false,
    });
    expect(ui.api).toHaveBeenCalledWith(
      "/api/work-hub/search/items/task/7be22c7d-4638-4144-bb18-0d2a66996a43",
    );
    expect(ui.push).toHaveBeenCalledWith(
      "/work-hub/search-item/task/7be22c7d-4638-4144-bb18-0d2a66996a43",
    );
    ui.push.mockClear();
    ui.api.mockRejectedValue(new Error("Access revoked"));
    expect(await executeAskVClientIntent(intent, "/askv")).toMatchObject({
      ok: false,
    });
    expect(ui.push).not.toHaveBeenCalled();
    ui.api.mockResolvedValue({});
    ui.current.mockReturnValue(false);
    expect(await executeAskVClientIntent(intent, "/askv")).toMatchObject({
      ok: false,
    });
    expect(ui.push).not.toHaveBeenCalled();
  });
  it("rejects Field ticket entry while retaining the supported scanner route", async () => {
    expect(
      await executeAskVClientIntent(
        {
          name: "start_ticket_entry",
          arguments: { ticketId: 42, kind: "labor", path: "/tickets/42" },
        },
        "/askv",
      ),
    ).toMatchObject({ ok: false });
    expect(ui.push).not.toHaveBeenCalled();
    await executeAskVClientIntent(
      { name: "launch_scanner", arguments: {} },
      "/askv",
    );
    expect(ui.push).toHaveBeenCalledWith("/work-hub/my-work");
  });
  it("hydrates a safety draft without submitting it or carrying arbitrary fields", async () => {
    const result = await executeAskVClientIntent(
      {
        name: "prefill_draft",
        arguments: {
          form: "safety-report",
          values: JSON.stringify({
            title: "Loose cable",
            eventType: "unsafe_condition",
            siteLocationId: 3,
            description: "At the gate",
            submitted: true,
          }),
        },
      },
      "/askv",
    );
    expect(result).toMatchObject({ ok: true, saved: false });
    expect(ui.push.mock.calls[0][0].params).toMatchObject({
      title: "Loose cable",
      eventType: "unsafe_condition",
      siteLocationId: "3",
    });
    expect(ui.push.mock.calls[0][0].params).not.toHaveProperty("submitted");
    expect(() => readAskVSafetyDraft({ eventType: "made_up" })).toThrow();
  });
  it("does not claim success for unknown controls, unbound camera capture, or failed maps", async () => {
    expect(
      await executeAskVClientIntent(
        { name: "focus_control", arguments: { controlId: "hidden" } },
        "/askv",
      ),
    ).toMatchObject({ ok: false });
    expect(
      await executeAskVClientIntent(
        { name: "launch_camera", arguments: {} },
        "/askv",
      ),
    ).toMatchObject({ ok: false });
    ui.openURL.mockRejectedValue(new Error("Maps unavailable"));
    expect(
      await executeAskVClientIntent(
        { name: "launch_maps", arguments: { query: "Alpha" } },
        "/askv",
      ),
    ).toMatchObject({ ok: false });
  });
  it("only focuses controls registered for the current screen", async () => {
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControl("/askv", "message", focus);
    expect(
      await executeAskVClientIntent(
        { name: "focus_control", arguments: { controlId: "message" } },
        "/askv",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await executeAskVClientIntent(
        { name: "focus_control", arguments: { controlId: "message" } },
        "/safety-report",
      ),
    ).toMatchObject({ ok: false });
    remove();
  });
  it("focuses a Gate field after its native page registers during navigation", async () => {
    expect(await executeAskVClientIntent(
      { name: "open_screen", arguments: { screen: "gate" } },
      "/askv",
    )).toMatchObject({ ok: true });
    const pending = executeAskVClientIntent(
      { name: "focus_control", arguments: { controlId: "firstName" } },
      "/askv",
    );
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControl("/(tabs)/gate", "firstName", focus);
    try {
      expect(await pending).toMatchObject({ ok: true });
      expect(focus).toHaveBeenCalledOnce();
    } finally { remove(); }
  });
  it("normalizes tab routes before focusing Work Hub search", async () => {
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControl("/work-hub", "search", focus);
    try {
      expect(await executeAskVClientIntent(
        { name: "focus_control", arguments: { controlId: "search" } },
        "/(tabs)/work-hub?source=askv",
      )).toMatchObject({ ok: true });
      expect(focus).toHaveBeenCalledOnce();
    } finally { remove(); }
  });
  it("follows the Work Hub tasks redirect to the mounted task form", async () => {
    expect(await executeAskVClientIntent(
      { name: "open_screen", arguments: { screen: "work-hub-tasks" } },
      "/askv",
    )).toMatchObject({ ok: true });
    expect(ui.push).toHaveBeenLastCalledWith("/work-hub/tasks-forms");
    const pending = executeAskVClientIntent(
      { name: "focus_control", arguments: { controlId: "taskTitle" } },
      "/askv",
    );
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControl("/work-hub/managed-crews", "taskTitle", focus);
    try {
      expect(await pending).toMatchObject({ ok: true });
      expect(focus).toHaveBeenCalledOnce();
    } finally { remove(); }
  });
  it("does not focus a just-opened control after the active account changes", async () => {
    await executeAskVClientIntent({ name: "open_screen", arguments: { screen: "gate" } }, "/askv");
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControl("/gate", "company", focus);
    ui.current.mockReturnValue(false);
    try {
      expect(await executeAskVClientIntent(
        { name: "focus_control", arguments: { controlId: "company" } },
        "/askv",
      )).toMatchObject({ ok: false });
      expect(focus).not.toHaveBeenCalled();
    } finally { remove(); }
  });
  it("focuses the AskV composer from either dedicated native route", async () => {
    const focus = vi.fn().mockReturnValue(true);
    const remove = registerAskVControlAliases(
      ["/askv", "/work-hub/askv"],
      "message",
      focus,
    );
    for (const path of ["/askv", "/work-hub/askv"]) {
      expect(
        await executeAskVClientIntent(
          { name: "focus_control", arguments: { controlId: "message" } },
          path,
        ),
      ).toMatchObject({ ok: true });
    }
    expect(focus).toHaveBeenCalledTimes(2);
    remove();
  });
});
