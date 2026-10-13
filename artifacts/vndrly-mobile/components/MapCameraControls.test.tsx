import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const capture = vi.hoisted(() => vi.fn());
// Exercise the web route overlay without loading the native SVG bridge.
vi.mock("react-native-svg",()=>({default:({children,...props}:any)=><svg {...props}>{children}</svg>,Polyline:(props:any)=><polyline {...props}/> }));
vi.mock("@/lib/gate-location-capture", () => ({
  captureGatePosition: capture,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#123", text: "#fff", card: "#000" }),
}));
import {
  clampMapZoom,
  mapWorld,
  mapCoordinate,
  panMapCamera,
  useMapLocation,
  MapControls,
} from "./MapCameraControls";
function Harness({ viewKey = "site:1" }: { viewKey?: string }) {
  const location = useMapLocation(
    (point) => ((capture as any).center = point),
    viewKey,
  );
  return (
    <MapControls zoomIn={() => {}} zoomOut={() => {}} location={location} />
  );
}
afterEach(() => {
  cleanup();
  capture.mockReset();
});
it("Mercator pan preserves zoom and converts a right drag to west center", () => {
  const original = { center: [-97, 35] as [number, number], zoom: 10 };
  const result = panMapCamera(original, 100, 0);
  expect(result.zoom).toBe(10);
  expect(result.center[0]).toBeLessThan(-97);
  expect(result.center[1]).toBeCloseTo(35);
  expect(mapCoordinate(...mapWorld(35, -97))).toEqual(
    expect.arrayContaining([expect.closeTo(-97, 5), expect.closeTo(35, 5)]),
  );
  expect(clampMapZoom(99)).toBe(18);
  expect(clampMapZoom(-1)).toBe(0);
  expect(
    panMapCamera({ center: [179, 85], zoom: 0 }, -512, 9999).center.every(
      Number.isFinite,
    ),
  ).toBe(true);
});
it("requests device location only on press and cancels request on view change", async () => {
  capture.mockImplementation(() => new Promise(() => {}));
  const view = render(<Harness />);
  expect(capture).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Center current location" }),
  );
  expect(capture).toHaveBeenCalledTimes(1);
  const signal = capture.mock.calls[0][0];
  expect(signal.aborted).toBe(false);
  view.rerender(<Harness viewKey="ticket:2" />);
  expect(signal.aborted).toBe(true);
  expect(
    screen.getByRole("button", { name: "Center current location" }),
  ).toBeTruthy();
});
it("allows explicit cancellation and reports manual fallback after failure", async () => {
  capture
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockRejectedValueOnce(new Error("denied"));
  render(<Harness />);
  fireEvent.click(
    screen.getByRole("button", { name: "Center current location" }),
  );
  const signal = capture.mock.calls[0][0];
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel current location" }),
  );
  expect(signal.aborted).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Center current location" }),
  );
  expect(
    await screen.findByText(
      "Location unavailable: denied. Pan the map manually.",
    ),
  ).toBeTruthy();
});
it("ignores a late location result after unmount", async () => {
  let resolve!: (v: any) => void;
  capture.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<Harness />);
  fireEvent.click(
    screen.getByRole("button", { name: "Center current location" }),
  );
  const signal = capture.mock.calls[0][0];
  view.unmount();
  resolve({ latitude: 35, longitude: -97 });
  await waitFor(() => expect(signal.aborted).toBe(true));
  expect((capture as any).center).toBeUndefined();
});

vi.mock("@/lib/maps", () => ({
  readMapboxAccessToken: () => "public-map-token",
}));
import WebMap from "./MapboxNativeMap.web";
it("web zoom retains the camera after live points refresh and resets only for a new view", () => {
  const point = { id: "p", latitude: 35, longitude: -97 };
  const view = render(<WebMap controls points={[point]} viewKey="site:1" />);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  const before = screen
    .getByLabelText("Coverage map")
    .querySelector("img")
    ?.getAttribute("src");
  view.rerender(
    <WebMap
      controls
      points={[{ ...point, latitude: 36, longitude: -98 }]}
      viewKey="site:1"
    />,
  );
  expect(
    screen
      .getByLabelText("Coverage map")
      .querySelector("img")
      ?.getAttribute("src"),
  ).toBe(before);
  view.rerender(
    <WebMap
      controls
      points={[{ ...point, latitude: 36, longitude: -98 }]}
      viewKey="site:2"
    />,
  );
  expect(
    screen
      .getByLabelText("Coverage map")
      .querySelector("img")
      ?.getAttribute("src"),
  ).not.toBe(before);
});
