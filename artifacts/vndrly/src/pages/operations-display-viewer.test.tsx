import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import OperationsDisplayViewer from "./operations-display-viewer";
const auth = vi.hoisted(() => ({ user: { userId: 17, role: "vendor", vendorId: 4, partnerId: null, activeMembershipId: 12 } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));
vi.mock("@/components/mapbox-map", () => ({ MapboxMap: () => <div data-testid="actual-map" /> }));
const id = "00000000-0000-4000-8000-000000000001", monitor = "00000000-0000-4000-8000-000000000002";
const data = { displayId: id, monitorId: monitor, displayName: "Dispatch", monitorName: "Left", view: "gate_log", siteLocationId: 392, meetingOccurrenceId: null, privacyMode: true, configuredAt: "2026-10-07T10:00:00.000Z", receivedAt: "2026-10-07T10:01:00.000Z", records: [{ id: "visit:1", title: "Visit 1", status: "checked_in", detail: "Recorded Gate visit", sourceRecordedAt: "2026-10-07T10:00:30.000Z" }], truncated: false, physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false };
beforeEach(() => { auth.user.userId = 17; vi.restoreAllMocks(); });
it("renders exact canonical records and freshness without claiming screen connection", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => data } as Response);
  render(<OperationsDisplayViewer displayId={id} monitorId={monitor} />);
  expect(await screen.findByText("Visit 1")).toBeTruthy(); expect(screen.getByText("Checked in")).toBeTruthy();
  expect(screen.getByText(/Last refresh/)).toBeTruthy(); expect(screen.queryByText(/is connected/)).toBeNull();
  expect(request.mock.calls[0][0]).toContain(`/operations-display-view/${id}/${monitor}`);
});
it("drops late record responses after account identity changes", async () => {
  let resolve!: (value: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })).mockResolvedValue({ ok: false } as Response);
  const mounted = render(<OperationsDisplayViewer displayId={id} monitorId={monitor} />);
  auth.user.userId = 18; mounted.rerender(<OperationsDisplayViewer displayId={id} monitorId={monitor} />);
  await act(async () => { resolve({ ok: true, json: async () => data } as Response); });
  await waitFor(() => expect(screen.getByText(/Display unavailable/)).toBeTruthy()); expect(screen.queryByText("Visit 1")).toBeNull();
});
it("refuses wrong monitor projection and shows truthful empty records", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ ...data, monitorId: id }) } as Response);
  render(<OperationsDisplayViewer displayId={id} monitorId={monitor} />);
  expect(await screen.findByText(/Display unavailable/)).toBeTruthy(); expect(screen.queryByText("Visit 1")).toBeNull();
});
