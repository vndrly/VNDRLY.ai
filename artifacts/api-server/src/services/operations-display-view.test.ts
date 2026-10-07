import { expect, it, vi } from "vitest";
import { createOperationsDisplayViewer } from "./operations-display-view";
const state = { displayId: "00000000-0000-4000-8000-000000000001", monitorId: "00000000-0000-4000-8000-000000000002", displayName: "Desk", monitorName: "Left", view: "gate_log" as const, siteLocationId: 392, meetingOccurrenceId: null, privacyMode: true, configuredAt: "2026-10-07T10:00:00.000Z" };
it("reads only saved monitor scope and rechecks current authority after source read", async () => {
  const authorize = vi.fn(async () => state), read = vi.fn(async () => [{ id: "visit:1", title: "Visit 1", status: "checked_in", detail: "Recorded visitor entry", sourceRecordedAt: null }]);
  const viewer = createOperationsDisplayViewer({ authorize, read, now: () => new Date("2026-10-07T10:01:00.000Z") });
  const result = await viewer.read(state.displayId, state.monitorId);
  expect(read).toHaveBeenCalledExactlyOnceWith(state); expect(authorize).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ ...state, records: [{ id: "visit:1" }], physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false });
});
it("denies late source results after revocation or monitor rerouting", async () => {
  for (const changed of [null, { ...state, siteLocationId: 393 }, { ...state, configuredAt: "2026-10-07T10:00:01.000Z" }]) {
    let calls = 0;
    const viewer = createOperationsDisplayViewer({ authorize: async () => ++calls === 1 ? state : changed, read: async () => [], now: () => new Date() });
    await expect(viewer.read(state.displayId, state.monitorId)).rejects.toThrow("display_view.unavailable");
  }
});
it("refuses unresolved or foreign identity before reading any records", async () => {
  const read = vi.fn(async () => []);
  const viewer = createOperationsDisplayViewer({ authorize: async () => null, read, now: () => new Date() });
  await expect(viewer.read(state.displayId, state.monitorId)).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
});
