import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: read }));
import { GateMapActivityPopup } from "./gate-map-activity-popup";
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("labels an inactive gate beside its name", async () => {
  read.mockResolvedValue({ stationId: "north", siteId: 1, scope: "linked_gates", generatedAt: "2026-10-30T16:00:00Z", startedAt: "2026-10-30T11:00:00Z", window: "24h", metrics: { checkIns: 0, checkOuts: 0, pendingAdmission: 0, itemsToReview: 0 } });
  render(<QueryClientProvider client={new QueryClient()}><GateMapActivityPopup stationId="north" siteId={1} siteName="Antelope" gateName="North Gate" active={false} userId={1} historical={false} es={false} onEnter={() => {}} onLeave={() => {}} /></QueryClientProvider>);
  expect(screen.getByText("Inactive").closest("strong")?.textContent).toBe("Antelope · North Gate · Inactive");
  await screen.findByText("Check-in records");
});
const data = { stationId: "a", siteId: 1, scope: "gate_attributed", generatedAt: "2026-10-28T20:00:00Z", startedAt: "2026-10-28T08:00:00Z", window: "current_shift", metrics: { checkIns: 4, checkOuts: 1, pendingAdmission: 5, itemsToReview: 6 } };
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateMapActivityPopup stationId="a" siteId={1} siteName="Site A" gateName="Main Gate" userId={1} historical es={false} onEnter={() => {}} onLeave={() => {}} /></QueryClientProvider>);
it("fetches the clicked gate, shows dashboard field counts and honestly labels current counts on a historical map", async () => {
  read.mockResolvedValue(data); show();
  expect(await screen.findByText("Check-in records")).toBeTruthy();
  expect(read).toHaveBeenCalledWith("/a/map-activity");
  expect(screen.getByText("Current counts; map shows a historical time.")).toBeTruthy();
  expect(screen.getByText("Site A · Main Gate ·")).toBeTruthy();
  expect([...document.querySelectorAll("dd")].map(e => e.textContent)).toEqual(["4", "1", "5", "6"]);
});
it("shows loading and failure instead of invented zeroes", async () => {
  read.mockReturnValue(new Promise(() => {})); const view = show();
  expect(screen.getByRole("status").textContent).toContain("Loading"); view.unmount();
  read.mockRejectedValue(new Error("Unavailable")); show();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Activity unavailable"));
  expect(document.querySelectorAll("dd").length).toBe(0);
});
it("rejects metrics returned for a different gate", async () => {
  read.mockResolvedValue({ ...data, stationId: "b" }); show();
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(document.querySelectorAll("dd").length).toBe(0);
});
it("renders genuine empty counts as zero", async () => {
  read.mockResolvedValue({ ...data, metrics: { checkIns: 0, checkOuts: 0, pendingAdmission: 0, itemsToReview: 0 } }); show();
  await screen.findByText("Check-in records"); expect([...document.querySelectorAll("dd")].map(e => e.textContent)).toEqual(["0", "0", "0", "0"]);
});
it("shows compact confirmation in place of metrics and restores them on Cancel",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({gates:[{id:"a",siteId:1,name:"Main Gate",latitude:32,longitude:-102,geofenceRadiusM:150,active:true,version:2}]})})));
  read.mockResolvedValue(data);
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateMapActivityPopup stationId="a" siteId={1} siteName="Site A" gateName="Main Gate" active userId={1} historical={false} es={false} onEnter={()=>{}} onLeave={()=>{}}/></QueryClientProvider>);
  await screen.findByText("Check-in records");
  fireEvent.click(await screen.findByRole("button",{name:"Deactivate Main Gate"}));
  expect(screen.getByText(/Are you sure/)).toBeTruthy();expect(screen.queryByText("Check-in records")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));expect(screen.getByText("Check-in records")).toBeTruthy();
});
