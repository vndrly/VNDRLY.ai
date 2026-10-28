import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ ease: vi.fn() }));
vi.mock("@/lib/maps", () => ({ loadMapboxAccessToken: async () => "test", readMapboxAccessToken: () => "test", getMapboxStyleUrl: () => "test-style" }));
vi.mock("mapbox-gl", () => {
  class Map {
    container: HTMLElement;
    scrollZoom = { disable() {} };
    constructor(options: any) { this.container = options.container; }
    addControl() {} on() {} once() {} remove() {} isStyleLoaded() { return false; }
    easeTo = mock.ease;
  }
  class Popup {
    node = document.createElement("div");
    setHTML(html: string) { this.node.innerHTML = html; return this; }
    setLngLat() { return this; }
    addTo(map: Map) { map.container.append(this.node); return this; }
    remove() { this.node.remove(); return this; }
  }
  class Marker {
    element: HTMLElement;
    constructor(options: any) { this.element = options.element; }
    setLngLat() { return this; } addTo(map: Map) { map.container.append(this.element); return this; }
    getElement() { return this.element; } remove() { this.element.remove(); } setPopup() { return this; }
  }
  return { default: { Map, Marker, Popup, NavigationControl: class {} } };
});
import { MapboxMap, type MapboxPoint } from "./mapbox-map";

it("pans to staff and shows vehicle details on hover or keyboard focus, clearing removed reports", async () => {
  const point: MapboxPoint = { id: "truck", title: "Truck 24", latitude: 31, longitude: -102, popupHtml: "<strong>Driver · 45 mph</strong>", popupOnHover: true };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (points: MapboxPoint[]) => <QueryClientProvider client={client}><MapboxMap points={points} selectedPointId="truck" panToSelectedPoint fitToData={false} zoom={16} /></QueryClientProvider>;
  const view = render(tree([point]));
  const marker = await screen.findByRole("button", { name: "Truck 24" });
  expect(mock.ease).toHaveBeenCalledWith({ center: [-102, 31], zoom: 16 });
  fireEvent.mouseEnter(marker);
  expect(screen.getByText("Driver · 45 mph")).toBeTruthy();
  fireEvent.mouseLeave(marker);
  expect(screen.queryByText("Driver · 45 mph")).toBeNull();
  fireEvent.focus(marker);
  expect(screen.getByText("Driver · 45 mph")).toBeTruthy();
  view.rerender(tree([]));
  await waitFor(() => expect(screen.queryByText("Driver · 45 mph")).toBeNull());
  expect(screen.queryByRole("button", { name: "Truck 24" })).toBeNull();
});
