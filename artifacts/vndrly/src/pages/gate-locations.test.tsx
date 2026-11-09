import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/content-pane-back-link", () => ({ default: () => <a href="/">Back</a> }));
vi.mock("@/components/gate-coverage-map", () => ({ GateCoverageMap: () => <section aria-label="Gate coverage map">Coverage map</section> }));
vi.mock("@/components/mapbox-map", () => ({ MapboxMap: () => <div aria-label="Gate position map">Map</div> }));
import GateLocationsPage from "./gate-locations";

const guide = vi.hoisted(() => ({ next: null as any, target: vi.fn(), refresh: vi.fn(async () => {}) }));
vi.mock("@/components/next-steps", () => ({ useNextSteps: () => guide.next }));
vi.mock("@/components/guided-target", () => ({ useGuidedTarget: (...args: unknown[]) => guide.target(...args) }));
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset(); guide.next = null; guide.target.mockReset(); guide.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/sites")) return { ok: true, json: async () => ({ sites: [{ id: 7, name: "North Yard" }] }) };
    if (url.includes("?siteId=7")) return { ok: true, json: async () => ({ gates: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", siteId: 7, name: "Main Gate", latitude: 35.1, longitude: -97.2, geofenceRadiusM: 500, active: true, version: 2 }] }) };
    if (url.endsWith("/preview")) return { ok: true, json: async () => ({ values: JSON.parse(String(init?.body)), confirmation: "review-token" }) };
    return { ok: true, json: async () => ({ id: "saved" }) };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><GateLocationsPage /></QueryClientProvider>);
}

it("shows gate setup above the live monitoring map and uses review before save", async () => {
  mount();
  expect(await screen.findByText("Main Gate")).not.toBeNull();
  expect(screen.getByRole("region", { name: "Gate coverage map" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Add Gate Location/ }));
  fireEvent.change(screen.getByLabelText("Gate name"), { target: { value: "West Gate" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "35.2" } });
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-97.3" } });
  fireEvent.click(screen.getByRole("button", { name: "Review Gate Location" }));
  expect(await screen.findByText(/Confirm:/)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledWith("/api/gate-locations/preview", expect.objectContaining({ method: "POST" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/gate-locations", expect.objectContaining({ method: "POST" })));
});

function firstWatch(context: { siteId?: number } = { siteId: 7 }) {
 guide.next = { scope: "user7:vendor4:membership2", selected: { id:"first-watch", action:{href:"/gate-locations"}, context }, refresh: guide.refresh };
}
it("coaches the actual station controls and never treats preview as a saved gate", async () => {
 firstWatch(); mount(); await screen.findByText("Main Gate");
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"add-gate"}),true,30);
 const add = screen.getByRole("button", {name:/Add Gate Location/}); expect(add.getAttribute("data-guidance-id")).toBe("add-gate"); fireEvent.click(add);
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"name"}),true,30);
 fireEvent.change(screen.getByLabelText("Gate name"),{target:{value:"West Gate"}});
 expect((screen.getByRole("button",{name:"Review Gate Location"}) as HTMLButtonElement).disabled).toBe(true);
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"latitude"}),true,30);
 fireEvent.change(screen.getByLabelText("Latitude"),{target:{value:"35.2"}});
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"longitude"}),true,30);
 fireEvent.change(screen.getByLabelText("Longitude"),{target:{value:"-97.3"}});
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"review"}),true,30);
 fireEvent.click(screen.getByRole("button",{name:"Review Gate Location"})); await screen.findByText(/Confirm:/);
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"confirm-save"}),true,30);
 expect(guide.refresh).not.toHaveBeenCalled(); expect(fetchMock.mock.calls.filter(([url,init])=>url==="/api/gate-locations"&&init?.method==="POST")).toHaveLength(0);
 fireEvent.click(screen.getByRole("button",{name:"Confirm & Save"})); await screen.findByText(/Gate location saved. Continue/);
 expect(guide.refresh).toHaveBeenCalledOnce(); expect(screen.queryByLabelText("Gate name")).toBeNull();
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"saved-status"}),true,30);
});
it("requires an explicit authorized site when the saved workflow has no selected site", async () => {
 firstWatch({}); mount(); await waitFor(()=>expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"choose-site"}),true,30));
 expect((screen.getByRole("button",{name:/Add Gate Location/}) as HTMLButtonElement).disabled).toBe(true);
 expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
});
it("waits for real site authorization instead of inventing a site or save action", async () => {
 firstWatch({}); fetchMock.mockImplementation(async()=>({ok:true,json:async()=>({sites:[]})})); mount();
 expect(await screen.findByText(/No authorized sites are available for this company/)).toBeTruthy();
 expect(guide.target).toHaveBeenLastCalledWith(expect.objectContaining({targetId:"waiting-for-site"}),true,30);
 expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
 expect(guide.refresh).not.toHaveBeenCalled();
});
it("does not advance after a failed actual station save", async () => {
 firstWatch(); const normal = fetchMock.getMockImplementation()!;
 fetchMock.mockImplementation(async(url:string,init?:RequestInit)=>url==="/api/gate-locations"&&init?.method==="POST"?{ok:false,json:async()=>({code:"gate_locations.forbidden"})}:normal(url,init));
 mount(); await screen.findByText("Main Gate"); fireEvent.click(screen.getByRole("button",{name:/Add Gate Location/}));
 fireEvent.change(screen.getByLabelText("Gate name"),{target:{value:"West Gate"}}); fireEvent.change(screen.getByLabelText("Latitude"),{target:{value:"35.2"}}); fireEvent.change(screen.getByLabelText("Longitude"),{target:{value:"-97.3"}});
 fireEvent.click(screen.getByRole("button",{name:"Review Gate Location"})); await screen.findByText(/Confirm:/); fireEvent.click(screen.getByRole("button",{name:"Confirm & Save"}));
 expect(await screen.findByText("gate_locations.forbidden")).toBeTruthy(); expect(guide.refresh).not.toHaveBeenCalled(); expect(screen.getByRole("button",{name:"Confirm & Save"})).toBeTruthy();
});
