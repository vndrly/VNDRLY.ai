import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import GateWatchSummary from "./gate-watch-summary";
const m = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: m.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, vendorId: 4, activeMembershipId: 2 } }) }));
beforeEach(() => { m.request.mockReset(); });
afterEach(cleanup);
function mount(current: any) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateWatchSummary stationId="gate-1" current={current} /></QueryClientProvider>); }
it("expands the last completed watch and its notes at each site, plus the next scheduled watch", async () => {
  const startedAt = new Date(Date.now() - 90 * 60000).toISOString(), endedAt = new Date().toISOString();
  m.request.mockImplementation(async (path: string) => path === "/watch-timeline" ? { sites: [
    { siteId: 21, siteName: "West site", previous: { watchId: "watch-1", stationId: "gate-2", name: "Previous operator", gateName: "West Gate", startedAt, endedAt, notes: "West lane needs attention", filedAt: endedAt, handoffId: "handoff-1" }, next: { shiftId: "shift-1", stationId: "gate-2", gateName: "West Gate", startsAt: endedAt, endsAt: endedAt, timezone: "America/Chicago", people: [{ userId: 8, name: "Next operator" }] } },
    { siteId: 22, siteName: "East site", previous: { watchId: "watch-2", stationId: "gate-3", name: "Released operator", gateName: "East Gate", startedAt, endedAt, notes: "Saved before next watch arrives", filedAt: endedAt, handoffId: null }, next: { shiftId: "shift-2", stationId: "gate-3", gateName: "East Gate", startsAt: endedAt, endsAt: endedAt, timezone: "America/Chicago", people: [] } },
  ] } : { watches: [] });
  mount({ shift: { operator_id: 7, started_at: new Date(Date.now() - 90 * 60000).toISOString() } });
  expect(await screen.findByText("My Watch")).toBeTruthy();
  expect(screen.queryByText("1h 30m")).toBeNull();
  const previous = screen.getByText("Previous watch").closest("details")!;
  expect(previous.open).toBe(false); fireEvent.click(screen.getByText("Previous watch"));
  await waitFor(() => expect(within(previous).getByText("2")).toBeTruthy());
  expect(await screen.findByText("West lane needs attention")).toBeTruthy();
  expect(screen.getByText("Saved before next watch arrives")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open shift notes" }).getAttribute("href")).toBe("/gate/shift-notes?siteId=21&stationId=gate-2&handoffId=handoff-1");
  expect(within(previous).getAllByText(/^Notes filed/)).toHaveLength(2);
  const next = screen.getByText("Next Watch").closest("details")!;
  expect(next.open).toBe(false); fireEvent.click(screen.getByText("Next Watch"));
  expect(within(next).getByText("Next operator")).toBeTruthy(); expect(within(next).getByText("Unassigned")).toBeTruthy();
  expect(m.request).toHaveBeenCalledWith("/watch-timeline");
  expect(m.request).not.toHaveBeenCalledWith("/gate-1/notes?days=30");
});
it("does not count another operator's hours or turn failed notes into an empty handoff", async () => {
  m.request.mockImplementation(async (path: string) => { if (path.endsWith("/roster")) return { roster: [{ userId: 8, startedAt: new Date().toISOString() }] }; throw new Error("offline"); });
  mount({ shift: { operator_id: 8, started_at: new Date(Date.now() - 60 * 60000).toISOString() } });
  expect(await screen.findByText("Schedule unavailable")).toBeTruthy();
  expect(await screen.findAllByText("Watch history and schedule unavailable.")).toHaveLength(2);
  expect(screen.queryByText("No completed watch recorded.")).toBeNull();
});
it("keeps sites with missing history or schedules visible without inventing notes", async () => {
  m.request.mockImplementation(async (path: string) => path === "/watch-timeline" ? { sites: [
    { siteId: 21, siteName: "New site", previous: null, next: null },
    { siteId: 22, siteName: "West site", previous: { watchId: "watch-1", stationId: "gate-2", gateName: "West Gate", name: "Previous operator", endedAt: new Date().toISOString(), notes: null, filedAt: null, handoffId: null }, next: null },
  ] } : { watches: [] });
  mount({ shift: { operator_id: 7 } });
  expect(await screen.findByText("No saved shift notes for this watch.")).toBeTruthy();
  expect(screen.getByText("No completed watch recorded.")).toBeTruthy();
  expect(screen.getAllByText("No upcoming watch scheduled.")).toHaveLength(2);
  expect(screen.queryByRole("link", { name: "Open shift notes", hidden: true })).toBeNull();
});
it("expands the all-gates watch count and uses a text Handoff action for the owner",async()=>{
  const onHandoff=vi.fn(),onAssume=vi.fn();
  m.request.mockImplementation(async(path:string)=>path==="/watches"?{watches:[{userId:7,name:"Tasha Greene",stationId:"gate-1",siteName:"Antelope Draw",gateName:"Main Gate"},{userId:8,name:"Nadia Farouk",stationId:"gate-2",siteName:"Coyote Ridge",gateName:"East Gate"}]}:path.endsWith("/roster")?{roster:[]}:{rows:[]});
  render(<QueryClientProvider client={new QueryClient()}><GateWatchSummary stationId="gate-1" current={{shift:{operator_id:7}} as any} onAssume={onAssume} onHandoff={onHandoff}/></QueryClientProvider>);
  const disclosure=await screen.findByText("On watch");
  await screen.findByText("2");fireEvent.click(disclosure);
  expect(screen.getByText("Nadia Farouk")).toBeTruthy();expect(screen.getByText("Coyote Ridge · East Gate")).toBeTruthy();
  const handoff=screen.getByRole("button",{name:"Handoff"});expect(handoff.getAttribute("data-active")).toBe("true");fireEvent.click(handoff);
  expect(onHandoff).toHaveBeenCalledOnce();expect(onAssume).not.toHaveBeenCalled();
});

const activeWatches=[{userId:8,name:"Tasha Greene",stationId:"gate-1",siteName:"Antelope Draw",gateName:"Main Gate",watchId:"watch-1",canManage:true},{userId:9,name:"Nadia Farouk",stationId:"gate-2",siteName:"Coyote Ridge",gateName:"East Gate",watchId:"watch-2",canManage:true}];
function adminSource(path:string) {
  if(path.endsWith("/state"))return {site:{id:1,name:"Coyote Ridge"},station:{id:"gate-2",name:"East Gate"},shift:{id:"watch-2",operator_id:9,operator_name:"Nadia Farouk",started_at:new Date().toISOString()},preparation:null,snapshot:{revision:"a"},stale:false};
  if(path==="/watches")return {watches:activeWatches};
  if(path.endsWith("/standers"))return {operators:[{userId:10,membershipId:20,name:"Connie Marsh",companyName:"GateGo"}]};
  if(path.endsWith("/roster"))return {roster:[]};return {rows:[]};
}
it("places Assume | Assign on each admin watch row and assigns from that row's flyout",async()=>{
  m.request.mockImplementation(async(path:string)=>path.endsWith("/watch/admin")?{action:"assign",workerName:"Connie Marsh"}:adminSource(path));
  mount({shift:{operator_id:8}});
  fireEvent.click(await screen.findByText("On watch"));
  expect(await screen.findAllByRole("button",{name:"Assume"})).toHaveLength(2);
  expect(screen.queryByRole("button",{name:"Assume Watch"})).toBeNull();
  fireEvent.click(screen.getAllByRole("button",{name:"Assign"})[1]);
  expect(await screen.findByRole("dialog",{name:"Assign watch at Coyote Ridge"})).toBeTruthy();
  fireEvent.click(await screen.findByRole("button",{name:"Assign to Connie Marsh"}));
  await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/gate-2/watch/admin",expect.objectContaining({expectedShiftId:"watch-2",action:"assign",targetMembershipId:20,operationId:expect.any(String)})));
  expect(await screen.findByText("Assigned to Connie Marsh. Notification queued.")).toBeTruthy();
});
it("hides administrative actions when the server does not grant them",async()=>{
  m.request.mockImplementation(async(path:string)=>path==="/watches"?{watches:activeWatches.map(w=>({...w,canManage:false}))}:adminSource(path));
  mount({shift:{operator_id:8}});fireEvent.click(await screen.findByText("On watch"));await screen.findByText("Nadia Farouk");
  expect(screen.queryByRole("button",{name:"Assume"})).toBeNull();expect(screen.queryByRole("button",{name:"Assign"})).toBeNull();
});
it("keeps an uncertain takeover tied to the original watch and operation for readback",async()=>{
  m.request.mockImplementation(async(path:string)=>{if(path.endsWith("/watch/admin"))throw new Error("Lost response");if(path.includes("/admin-operations/"))return {receipt:{action:"assume",workerName:"Admin"}};return adminSource(path);});
  mount({shift:{operator_id:8}});fireEvent.click(await screen.findByText("On watch"));
  fireEvent.click((await screen.findAllByRole("button",{name:"Assume"}))[1]);
  const confirm=await screen.findByRole("button",{name:"ASSUME",exact:true});
  await waitFor(()=>expect((confirm as HTMLButtonElement).disabled).toBe(false));fireEvent.click(confirm);
  const check=await screen.findByRole("button",{name:"Check assumption"});
  const original=m.request.mock.calls.find(([path])=>path.endsWith("/watch/admin"))!;
  expect(original[0]).toBe("/gate-2/watch/admin");expect(original[1]).toMatchObject({expectedShiftId:"watch-2",action:"assume"});
  expect(screen.getAllByRole("button",{name:"Assign",hidden:true}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.click(check);await waitFor(()=>expect(screen.queryByRole("dialog",{name:"Assume Watch"})).toBeNull());
  expect(m.request).toHaveBeenCalledWith(`/gate-2/watch/admin-operations/${original[1].operationId}`);
  expect(m.request.mock.calls.filter(([path])=>path.endsWith("/watch/admin"))).toHaveLength(1);
});
