import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const capture = vi.hoisted(() => ({ points: [] as any[], lines: [] as any[] }));
vi.mock("./mapbox-map", () => ({ MapboxMap: (props: any) => { capture.points = props.points; capture.lines = props.lines; return <div>Replay map</div>; } }));
vi.mock("./png-pill-rollover", () => ({ PngPillButton: ({ children, color: _color, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("./work-hub/chrome", () => ({ BrandedSelect: (props: any) => <select {...props} /> }));
import { FleetRouteReplay } from "./fleet-route-replay";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("queries only a selected authorized run and does not invent positions across gaps", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ points: [
    { latitude: 31, longitude: -102, recordedAt: "2026-10-13T10:00:00Z" },
    { latitude: 32, longitude: -103, recordedAt: "2026-10-13T10:10:00Z" },
  ], events: [], truncated: true }) });
  vi.stubGlobal("fetch", request);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (runs: { id: string; title: string; status: string }[]) => <QueryClientProvider client={client}><FleetRouteReplay identity="1:2:3" runs={runs} /></QueryClientProvider>;
  const { rerender } = render(view([{ id: "run-a", title: "Synthetic run", status: "completed" }]));
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Replay run"), { target: { value: "run-a" } });
  await screen.findByText("History is truncated; this is a partial route.");
  expect(request.mock.calls[0][0]).toBe("/api/fleet/runs/run-a/location-history");
  fireEvent.change(screen.getByLabelText("Replay time"), { target: { value: "300000" } });
  expect(capture.points).toEqual([]);
  expect(capture.lines).toEqual([]);
  expect(screen.getByText(/Location unknown/)).toBeTruthy();
  rerender(view([]));
  await waitFor(() => expect(screen.queryByText("Replay map")).toBeNull());
});
