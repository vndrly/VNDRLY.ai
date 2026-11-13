import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TicketVisitMap } from "./ticket-visit-map";
import type { SiteVisitSummary } from "./ticket-site-visit-summary-card";
const viewport = vi.hoisted(() => ({ mobile: false, lines: [] as any[], fitToData: true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#12abcd", logoSquareUrl: "/logo.png" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("./mapbox-map", () => ({ MapboxMap: (p: any) => { viewport.lines = p.lines; viewport.fitToData = p.fitToData; return <div data-testid="map">{p.bottomControls}{p.topControls}{p.points.map((point: any) => <button key={point.id} onClick={point.onClick}>{point.title}</button>)}{p.anchoredPopup?.content}</div>; } }));
afterEach(() => { cleanup(); viewport.mobile = false; });
const data: SiteVisitSummary = { ticketId: 1, trackingNumber: "V-1", status: "completed", lifecycleState: "off_site", finished: true, finishedAt: "2026-11-12T18:00:00Z",
  site: { name: "Warwick San Roman Completions", latitude: 27, longitude: -99, siteCode: "S", siteRadiusMeters: 100 },
  timeline: { enRouteAt: null, onLocationAt: null, arrivedAt: null, checkInTime: "2026-11-12T06:00:00Z", checkOutTime: "2026-11-12T18:00:00Z" },
  people: [], route: [], totals: { peopleCount: 2, totalOnSiteMinutes: 1440, leadTravelMinutes: null, routePointCount: 0, routeSpanMinutes: null },
  personLocations: [{ id: "person:1", name: "Worker One", latitude: 27, longitude: -99, recordedAt: "2026-11-12T17:00:00Z", source: "check_out" }],
  equipment: [{ id: "asset:1", name: "Truck One", latitude: 27, longitude: -99, recordedAt: "2026-11-12T16:00:00Z", source: "fleet_driver_phone" }],
  details: { workType: "Gatekeeping", vendorName: "MidCon", partnerName: "Warwick", description: "Gatekeeping", notes: null, createdAt: "2026-11-12T05:00:00Z" },
};
it("opens a branded ticket flyout and settings without route point controls", () => {
  render(<TicketVisitMap data={data} />);
  fireEvent.click(screen.getByText("Warwick San Roman Completions"));
  expect(screen.getByText("MidCon")).toBeTruthy();
  expect(viewport.fitToData).toBe(false);
  expect(screen.getByText("24h 0m")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Map settings" }));
  fireEvent.click(screen.getByRole("switch", { name: "Map / Satellite" }));
  expect(screen.getByRole("switch", { name: "Map / Satellite" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByText("Route points")).toBeNull();
});
it("reveals ticket people and equipment with historical timestamps and supports expanded close", () => {
  render(<TicketVisitMap data={data} />);
  expect(screen.queryByText("Worker One")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reveal people" }));
  expect(screen.getByText("Historical locations at completion")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Worker One/ }));
  expect(screen.getByText("Historical recorded location")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reveal equipment" }));
  fireEvent.click(screen.getByRole("button", { name: /Truck One/ }));
  expect(screen.getByText("fleet driver phone")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand map" }));
  expect(screen.getByRole("dialog", { name: "Ticket map" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close expanded map" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("uses an in-frame closeable details card on iPhone instead of a clipped side popup", () => {
  viewport.mobile = true;
  render(<TicketVisitMap data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "Center ticket" }));
  expect(screen.getByText("MidCon").closest(".ticket-map-mobile-flyout")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close ticket map details" }));
  expect(screen.queryByText("MidCon")).toBeNull();
});

it("draws the returned road geometry in the company color, never a synthetic straight line", () => {
  const coordinates: [number,number][] = [[-100,28],[-99.7,27.8],[-99,27]];
  render(<TicketVisitMap data={{...data,roadRoute:{origin:{name:"Company yard",latitude:28,longitude:-100},coordinates}}} />);
  expect(viewport.lines).toEqual([expect.objectContaining({coordinates:coordinates.map(([lng,lat]) => [lat,lng]),color:"#12abcd",width:4})]);
  expect(screen.getByText("Company yard")).toBeTruthy();
  cleanup();
  render(<TicketVisitMap data={data} />);
  expect(viewport.lines).toEqual([]);
});
