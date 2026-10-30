import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({ read: vi.fn(), points: [] as any[], mapProps: {} as any, mapRenders: 0 }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, vendorId: 2, activeMembershipId: 3 } }) }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: mocks.read }));
vi.mock("@/components/mapbox-map", () => ({ MapboxMap: (props: any) => { mocks.mapRenders++; mocks.points = props.points; mocks.mapProps = props; return <div>Map{props.topControls}{props.bottomControls}</div>; } }));
vi.mock("@/components/work-hub/chrome", () => ({ BrandedInput: (props: any) => <input {...props} />, BrandedSelect: (props: any) => <select {...props} /> }));
vi.mock("./gate-map-activity-panel", () => ({ GateMapActivityPanel: () => <section aria-label="Gate activity">Gate activity</section> }));
import { GateCoverageMap } from "./gate-coverage-map";
it("reveals a group of current staff, fits their locations and closes the picker",async()=>{
 const location={latitude:32,longitude:-102,capturedAt:new Date().toISOString()};
 mocks.read.mockResolvedValue({at:new Date().toISOString(),gates:[{id:"g",siteId:1,name:"Gate",siteName:"Site",latitude:30,longitude:-100}],duties:[],staff:[
  {userId:1,name:"Person A",role:"office",fresh:true,location,assignment:"Office",locationReason:"current"},
  {userId:2,name:"Person B",role:"gatekeeper",fresh:true,location:{...location,latitude:33},assignment:"Gate",locationReason:"current"},
  {userId:3,name:"No GPS",fresh:false,location:null,assignment:"",locationReason:"no_report"},
 ]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap/></QueryClientProvider>);
 const toggle=await screen.findByRole("button",{name:"Reveal Staff"});
 expect(toggle.getAttribute("aria-expanded")).toBe("false");
 fireEvent.click(toggle);await waitFor(()=>expect(screen.getByText("All (3)")).toBeTruthy());fireEvent.click(screen.getByRole("button",{name:"Reveal All"}));
 expect(screen.getByRole("button",{name:"Reveal Staff"}).getAttribute("aria-expanded")).toBe("false");
 expect(mocks.mapProps.fitPoints.map((point:any)=>point.id)).toEqual(["staff:1","staff:2"]);expect(mocks.mapProps.fitToData).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Reveal Staff"}));fireEvent.click(screen.getByText("Individuals (3)"));fireEvent.click(screen.getAllByRole("button",{name:"Person B"}).at(-1)!);
 expect(screen.getByRole("button",{name:"Reveal Staff"}).getAttribute("aria-expanded")).toBe("false");expect(mocks.mapProps).toMatchObject({selectedPointId:"staff:2",center:[-102,33],fitToData:false});
 expect(mocks.points.filter(point=>point.id.startsWith("staff:")).map(point=>point.id)).toEqual(["staff:2"]);
 fireEvent.click(screen.getByRole("button",{name:"Reveal Staff"}));fireEvent.click(screen.getByRole("button",{name:"Reveal Staff"}));expect(screen.queryByRole("heading",{name:"Reveal Staff"})).toBeNull();
});
it("starts in Street view and independently switches linked gates and quarter-mile coverage",async()=>{
 mocks.read.mockResolvedValue({at:new Date().toISOString(),staff:[],duties:[],gates:[
  {id:"east",siteId:1,name:"East",siteName:"Site",linkGroupId:"spur",latitude:32,longitude:-102},
  {id:"west",siteId:2,name:"West",siteName:"Linked site",linkGroupId:"spur",latitude:32.01,longitude:-102},
 ]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap/></QueryClientProvider>);
 const settings=await screen.findByRole("button",{name:"Map settings"});
 expect(settings.getAttribute("aria-expanded")).toBe("false");
 expect(screen.queryByRole("switch",{name:"Dark Mode"})).toBeNull();
 fireEvent.click(settings);
 expect(settings.getAttribute("aria-expanded")).toBe("true");
 expect(mocks.mapProps.styleKind).toBe("dark");expect(mocks.mapProps.lines).toHaveLength(1);expect(mocks.mapProps.circles).toHaveLength(2);
 expect(mocks.mapProps.circles[0].radiusMeters).toBeCloseTo(402.336);
 expect(screen.getByRole("switch",{name:"Dark Mode"}).getAttribute("aria-checked")).toBe("true");
 expect(mocks.mapProps.className).toContain("is-dark-mode");
 fireEvent.click(screen.getByRole("switch",{name:"Dark Mode"}));expect(mocks.mapProps.styleKind).toBe("street");
 expect(mocks.mapProps.className).not.toContain("is-dark-mode");
 expect(mocks.mapProps.enhancedStreetContrast).toBe(true);
 fireEvent.click(screen.getByRole("switch",{name:"Dark Mode"}));expect(mocks.mapProps.styleKind).toBe("dark");
 fireEvent.click(screen.getByRole("switch",{name:"Links"}));expect(mocks.mapProps.lines).toHaveLength(0);expect(mocks.mapProps.circles).toHaveLength(2);
 fireEvent.click(screen.getByRole("switch",{name:"Coverage"}));expect(mocks.mapProps.circles).toHaveLength(0);
 fireEvent.click(screen.getByRole("switch",{name:"Street / Satellite"}));expect(mocks.mapProps.styleKind).toBe("satellite");
 fireEvent.click(screen.getByRole("switch",{name:"Links"}));expect(mocks.mapProps.lines).toHaveLength(1);
 fireEvent.click(settings);expect(screen.queryByRole("switch",{name:"Dark Mode"})).toBeNull();
 fireEvent.click(settings);expect(screen.getByRole("switch",{name:"Links"}).getAttribute("aria-checked")).toBe("true");
});
it("keeps on-call contact links usable without GPS and reflects a started shift with no assignment", async()=>{
 mocks.read.mockResolvedValue({at:new Date().toISOString(),gates:[],duties:[],staff:[{userId:8,name:"On-call worker",phone:"(432) 555-1234",email:"worker@example.invalid",onCall:true,onShift:true,fresh:false,location:null,assignment:"No active assignment recorded",locationReason:"no_report"}]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap /></QueryClientProvider>);
 const call=(await screen.findByText("On Call")).closest("details")!;fireEvent.click(call.querySelector("summary")!);
 expect(screen.getByRole("link",{name:"(432) 555-1234"}).getAttribute("href")).toBe("tel:4325551234");
 expect(screen.getByRole("link",{name:"worker@example.invalid"}).closest("li")?.getAttribute("data-on-shift")).toBe("true");
 expect(screen.getByRole("button",{name:"On-call worker"}).hasAttribute("disabled")).toBe(true);
 expect(screen.getByText(/No active assignment recorded/)).toBeTruthy();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); window.history.replaceState(null,"","/"); vi.unstubAllGlobals(); });
it("closes the expanded header back action without navigating away",async()=>{
 mocks.read.mockResolvedValue({at:new Date().toISOString(),gates:[],staff:[],duties:[]});
 const back=vi.spyOn(window.history,"back");
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap expandedHeader={close=><button onClick={close}>Close expanded map</button>}/></QueryClientProvider>);
 fireEvent.click(await screen.findByRole("button",{name:"Expand map"}));
 fireEvent.click(screen.getByRole("button",{name:"Close expanded map"}));
 expect(screen.queryByRole("button",{name:"Close expanded map"})).toBeNull();
 expect(screen.getByRole("button",{name:"Expand map"})).toBeTruthy();
 expect(back).not.toHaveBeenCalled();
 back.mockRestore();
});
it("opens the authorized exact pin from a notification link",async()=>{
 const id="00000000-0000-4000-8000-000000000001";window.history.replaceState(null,"",`/gate/map?pinId=${id}&siteId=1`);
 mocks.read.mockResolvedValue({at:new Date().toISOString(),gates:[],staff:[],duties:[],pins:[{id,siteId:1,label:"Meeting point",notes:"",latitude:32,longitude:-102,createdAt:new Date().toISOString(),createdById:1}]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap/></QueryClientProvider>);
 await screen.findByText("Staff locations");expect(mocks.mapProps).toMatchObject({selectedPointId:`pin:${id}`,center:[-102,32],fitToData:false});
 expect(mocks.mapProps.anchoredPopup.pointId).toBe(`pin:${id}`);
});
it("keeps inactive gates selectable but uses a grey marker and an inactive flyout", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), staff: [], duties: [], gates: [
    { id: "east", siteId: 1, name: "East Gate", siteName: "Antelope", active: true, latitude: 32, longitude: -102 },
    { id: "north", siteId: 1, name: "North Gate", siteName: "Antelope", active: false, latitude: 32.01, longitude: -102 },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap showGateSelector /></QueryClientProvider>);
  await screen.findByRole("option", { name: "Antelope | North Gate" });
  const north = mocks.points.find(point => point.id === "gate:north");
  expect(north.color).toBe("#9ca3af");
  expect(north.title).toContain("Inactive");
  expect(mocks.points.find(point => point.id === "gate:east").color).not.toBe("#9ca3af");
  act(() => north.onClick());
  expect(mocks.mapProps.anchoredPopup.content.props.active).toBe(false);
});
it("uses the viewing selector to focus one gate without creating or editing a gate", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), staff: [], gates: [
    { id: "a", siteId: 1, name: "North gate", siteName: "Site A", latitude: 31, longitude: -102 },
    { id: "b", siteId: 1, name: "South gate", siteName: "Site A", latitude: 32, longitude: -103 },
    { id: "c", siteId: 2, name: "Main gate", siteName: "Site B", siteLatitude: 33, siteLongitude: -104 },
  ], duties: [] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap showGateSelector /></QueryClientProvider>);
  const selector = await screen.findByTestId("select-gate-map-location");
  expect(screen.getByTestId("gate-gps-indicator").contains(selector)).toBe(true);
  expect(screen.getByTestId("gate-gps-indicator").getAttribute("data-gps-status")).toBe("unavailable");
  expect(screen.getByText("GPS not evaluated on this map")).toBeTruthy();
  expect(screen.getByRole("option", { name: "Site A | South gate" })).toBeTruthy();
  fireEvent.change(selector, { target: { value: "b" } });
  expect(mocks.mapProps).toMatchObject({ selectedPointId: "gate:b", center: [-103, 32], zoom: 16, fitToData: false });
  expect(screen.queryByText("Select a gate on the map")).toBeNull();
  fireEvent.change(selector, { target: { value: "c" } });
  expect(mocks.mapProps.center).toEqual([-104, 33]);
  fireEvent.click(screen.getByRole("button", { name: "Center on Selection" }));
  expect(mocks.mapProps.center).toEqual([-104, 33]);
  fireEvent.change(selector, { target: { value: "" } });
  expect(mocks.mapProps.fitToData).toBe(true);
  expect(mocks.mapProps.selectedPointId).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Center on Selection" }));
  expect(mocks.mapProps.fitPoints.map((point:any)=>point.id)).toEqual(["gate:a","gate:b","gate:c"]);
  expect(mocks.read.mock.calls.every(call => call.length === 1 && (call[0] === "/coverage-map" || /^\/linked-gates\?siteId=[12]$/.test(call[0])))).toBe(true);
});
it("centers on current GPS without replacing the chosen gate, then returns to that selection",async()=>{
 const geo=vi.fn((success:PositionCallback)=>success({coords:{latitude:30,longitude:-100}} as GeolocationPosition));
 vi.stubGlobal("navigator",{geolocation:{getCurrentPosition:geo}});
 mocks.read.mockResolvedValue({at:new Date().toISOString(),gates:[{id:"a",siteId:1,name:"East",siteName:"Antelope",latitude:32,longitude:-102}],staff:[],duties:[]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap showGateSelector/></QueryClientProvider>);
 const select=await screen.findByTestId("select-gate-map-location");fireEvent.change(select,{target:{value:"a"}});
 const me=screen.getByRole("button",{name:"Center on Me"});expect(me.closest(".gate-map-tool-center")).toBeTruthy();
 fireEvent.click(me);expect(mocks.mapProps).toMatchObject({center:[-100,30],selectedPointId:"my-location",fitToData:false});
 expect((select as HTMLSelectElement).value).toBe("a");
 fireEvent.click(screen.getByRole("button",{name:"Center on Selection"}));expect(mocks.mapProps).toMatchObject({center:[-102,32],selectedPointId:"gate:a"});
 vi.unstubAllGlobals();
});
it("keeps the camera at the selected gate when GPS access fails",async()=>{
 vi.stubGlobal("navigator",{geolocation:{getCurrentPosition:vi.fn((_success,error)=>error({code:1}))}});
 mocks.read.mockResolvedValue({at:new Date().toISOString(),gates:[{id:"a",siteId:1,name:"East",siteName:"Antelope",latitude:32,longitude:-102}],staff:[],duties:[]});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateCoverageMap showGateSelector/></QueryClientProvider>);
 fireEvent.change(await screen.findByTestId("select-gate-map-location"),{target:{value:"a"}});
 fireEvent.click(screen.getByRole("button",{name:"Center on Me"}));expect(screen.getByText("Your location could not be obtained.")).toBeTruthy();
 expect(mocks.mapProps.center).toEqual([-102,32]);expect(mocks.points.some(point=>point.id==="my-location")).toBe(false);vi.unstubAllGlobals();
});
it("keeps stale staff off the map and exposes missing observations without an action", async () => {
  mocks.read.mockResolvedValue({ at: "2026-10-13T15:00:00Z", gates: [], duties: [], staff: [
    { userId: 4, name: "Fresh", fresh: true, assignment: "Gate A", locationReason: "current", location: { latitude: 31, longitude: -102, capturedAt: "2026-10-13T15:00:00Z" } },
    { userId: 5, name: "Stale", fresh: false, assignment: "Gate B", locationReason: "stale_or_inaccurate", location: { latitude: 32, longitude: -103, capturedAt: "2026-10-13T12:00:00Z" } },
    { userId: 6, name: "Missing", fresh: false, assignment: "Gate C", locationReason: "no_report", location: null },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await screen.findByText("Fresh");
  expect(mocks.points.map(point => point.id)).toEqual(["staff:4"]);
  expect(screen.getByText(/stale or inaccurate/)).toBeTruthy();
  expect(screen.getByText(/no report/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Day of" }));
  fireEvent.input(screen.getByLabelText("Date and time (Central Time)"), { target: { value: "2026-10-12T10:00" } });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith("/coverage-map?at=2026-10-12T15%3A00%3A00.000Z"));
  expect(mocks.read.mock.calls.every(call => call.length === 1)).toBe(true);
});

it("ticks beneath the Live controls without rerendering the map or fetching each second", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T23:57:01Z"));
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), gates: [], staff: [], duties: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await client.prefetchQuery({ queryKey: ["gate-coverage-map", 1, 3, null], queryFn: () => mocks.read("/coverage-map") });
  await act(async () => {
    render(<QueryClientProvider client={client}><GateCoverageMap /></QueryClientProvider>);
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  const renders = mocks.mapRenders;
  const clock = screen.getByLabelText("Coverage clock");
  expect(clock.closest('[aria-label="Coverage time controls"]')?.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Live");
  expect(screen.queryByText(/^As of/)).toBeNull();
  expect(screen.queryByLabelText(/Coverage time \(leave blank/)).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(clock.textContent).toBe("10/28/26, 6:57:03 PM CT");
  expect(mocks.mapRenders).toBe(renders);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(27000); });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mocks.read).toHaveBeenCalledTimes(2);
  client.clear();
});
it("groups all app employees, sorts names, and pans to a selected current staff location", async () => {
  const location = { latitude: 31, longitude: -102, capturedAt: new Date().toISOString() };
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), gates: [], duties: [], staff: [
    { userId: 8, name: "Zoe", onWatch: true, onCall: true, fresh: true, assignment: "Site A | Main Gate", locationReason: "current", location },
    { userId: 9, name: "Ben", onCall: true, fresh: true, assignment: "On call", locationReason: "current", location: { ...location, latitude: 32 } },
    { userId: 10, name: "Zach", fresh: true, assignment: "Field ticket", locationReason: "current", location },
    { userId: 11, name: "Amy", fresh: true, assignment: "Field ticket", locationReason: "current", location },
    { userId: 12, name: "Unavailable", fresh: false, assignment: "None", locationReason: "sharing_off", location: null },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  const watch = (await screen.findByText("On Watch")).closest("details")!;
  expect(watch.querySelector("strong")?.textContent).toBe("Zoe");
  const others = screen.getByText("Everyone else").closest("details")!;
  fireEvent.click(others.querySelector("summary")!);
  expect([...others.querySelectorAll("strong")].map(row => row.textContent)).toEqual(["Amy", "Unavailable", "Zach"]);
  fireEvent.click(screen.getByRole("button", { name: /^Amy/ }));
  expect(mocks.mapProps).toMatchObject({ selectedPointId: "staff:11", center: [-102, 31], panToSelectedPoint: true, fitToData: false });
  expect((screen.getByRole("button", { name: /^Unavailable/ }) as HTMLButtonElement).disabled).toBe(true);
});
it("adds tracked vehicle hover details without treating routing failure as zero speed or ETA", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), gates: [], duties: [], staff: [], vehicles: [
    { runId: "run", latitude: 31, longitude: -102, vehicleLabel: "Truck 24", driverName: "Driver", title: "Water haul", companyName: "Hauler", ticketNumber: "T24", destinationName: "Site A", originName: "Yard", speedMph: null, etaMinutes: null, accuracyMeters: 8, headingDegrees: 90, observedAt: new Date().toISOString() },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await screen.findByText("Staff locations");
  expect(mocks.points[0]).toMatchObject({ id: "vehicle:run", popupOnHover: true, popupClassName: "gate-map-vehicle-popup" });
  expect(mocks.points[0].popupHtml).toContain("Yard");
  expect(mocks.points[0].popupHtml).toContain("Not available");
});
it("uses plain on-map icons without coverage filters and preserves refresh and expand", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), staff: [], gates: [
    { id: "a", name: "North gate", siteName: "Site A", latitude: 31, longitude: -102 },
    { id: "b", name: "South gate", siteName: "Site A", latitude: 32, longitude: -103 },
  ], duties: [{ id: "d", stationId: "a", name: "Operator", startedAt: new Date().toISOString(), coverage: {} }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await waitFor(() => expect(mocks.points.map(point => point.id)).toEqual(["gate:a", "gate:b"]));
  expect(screen.queryByRole("button", { name: "Staffed" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^All$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "No recorded duty" })).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Map settings"}));
  const street = screen.getByRole("switch", { name: "Street / Satellite" });
  expect(street.className).toContain("gate-map-style-toggle");
  expect(street.closest('[aria-label="Map style"]')).toBeTruthy();
  expect(street.closest('.gate-map-layer-controls')).toBeTruthy();
  const settings=street.closest('.gate-map-layer-toggles')!;
  expect(Array.from(settings.querySelectorAll('[role="switch"]')).map(control=>control.getAttribute('aria-label'))).toEqual(['Links','Coverage','Street / Satellite','Dark Mode']);
  expect(mocks.mapProps.customZoomControls).toBe(true);
  expect((screen.getByRole("combobox",{name:"Sort On Call"}) as HTMLSelectElement).value).toBe("nearest");
  expect(street.querySelector("svg")).toBeTruthy();
  fireEvent.click(street);
  expect(mocks.mapProps.styleKind).toBe("satellite");
  expect(street.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(street);
  expect(mocks.mapProps.styleKind).toBe("dark");
  expect(street.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("button", { name: "Fit to coverage" }).closest(".gate-map-view-controls")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand map" }));
  expect(screen.getByRole("button", { name: "Collapse map" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Expand map" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThan(1));
});
