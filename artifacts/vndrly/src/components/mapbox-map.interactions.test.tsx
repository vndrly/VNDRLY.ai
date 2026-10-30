import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ ease: vi.fn(), zoom:9, zoomChanged:()=>{} }));
vi.mock("@/lib/maps", () => ({ loadMapboxAccessToken: async () => "test", readMapboxAccessToken: () => "test", getMapboxStyleUrl: () => "test-style" }));
vi.mock("mapbox-gl", () => {
  class Map {
    container: HTMLElement;
    scrollZoom = { disable() {} };
    constructor(options: any) { this.container = options.container; Object.defineProperties(this.container, { clientWidth: { value: 280 }, clientHeight: { value: 420 } }); }
    addControl() {} on(event:string,handler:()=>void) {if(event==="zoom")mock.zoomChanged=handler;} once() {} remove() {} isStyleLoaded() { return false; }
    getZoom() { return mock.zoom; }
    getContainer() { return this.container; } project() { return { x: 100, y: 100 }; }
    easeTo = mock.ease;
  }
  class Popup {
    node = document.createElement("div");
    on() { return this; } off() { return this; }
    setDOMContent(node: HTMLElement) { this.node.append(node); return this; }
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

it("keeps G at overview zoom and reveals the full gate label at the configured zoom",async()=>{
 mock.zoom=9;
 const point:MapboxPoint={id:"gate:west",label:"G",fullLabel:"Antelope Draw | West Gate",fullLabelMinZoom:9.9,title:"West Gate",latitude:32,longitude:-102};
 const view=render(<QueryClientProvider client={new QueryClient()}><MapboxMap points={[point]} fitToData={false}/></QueryClientProvider>);
 const marker=await screen.findByRole("button",{name:"West Gate"});
 expect(marker.querySelector("span")?.textContent).toBe("G");expect(marker.classList.contains("has-visible-label")).toBe(false);
 mock.zoom=9.97;mock.zoomChanged();expect(marker.classList.contains("has-visible-label")).toBe(true);
 expect(marker.querySelector(".vndrly-mapbox-marker-caption")?.textContent).toBe("Antelope Draw | West Gate");
 mock.zoom=9;mock.zoomChanged();expect(marker.classList.contains("has-visible-label")).toBe(false);
 view.unmount();
});

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

it("anchors React activity content inside the map, switches pins, and closes on outside pointer or Escape", async () => {
  const close = vi.fn(), hover = vi.fn(), leave = vi.fn();
  const points = [{ id: "a", title: "Gate A", latitude: 31, longitude: -102, onHover: hover, onLeave: leave }, { id: "b", title: "Gate B", latitude: 32, longitude: -103 }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (pointId: string, text: string) => <QueryClientProvider client={client}><MapboxMap points={points} fitToData={false} selectedPointId={pointId} panToSelectedPoint anchoredPopup={{ pointId, content: <div>{text}</div>, onClose: close }} /></QueryClientProvider>;
  const view = render(tree("a", "Gate A activity"));
  expect(await screen.findByText("Gate A activity")).toBeTruthy();
  expect(mock.ease).toHaveBeenCalledWith({ center: [-102, 31], zoom: 14, offset: [0, 188] });
  fireEvent.mouseEnter(screen.getByRole("button", { name: "Gate A" })); expect(hover).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByRole("button", { name: "Gate A" })); expect(hover).toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("button", { name: "Gate A" })); expect(leave).toHaveBeenCalled();
  view.rerender(tree("b", "Gate B activity"));
  expect(await screen.findByText("Gate B activity")).toBeTruthy();
  expect(screen.queryByText("Gate A activity")).toBeNull();
  fireEvent.pointerDown(screen.getByText("Gate B activity")); expect(close).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body); expect(close).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(2);
});
