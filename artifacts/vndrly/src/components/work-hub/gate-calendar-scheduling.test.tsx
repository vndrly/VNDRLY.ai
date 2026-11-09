import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GateCalendarScheduling from "./gate-calendar-scheduling";
import { workHubRequest } from "@/lib/work-hub-client";
const gate = "11111111-1111-4111-a111-111111111111", id = "22222222-2222-4222-a222-222222222222";
const coaching = vi.hoisted(() => ({ selected: null as any }));
vi.mock("@/components/next-steps", () => ({ useNextSteps: () => coaching.selected ? { selected: coaching.selected, enabled: true, startHelper: vi.fn() } : null }));
import { findGuidanceTarget, GuidedTargetProvider } from "../guided-target";
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#eabf38", name: "GateGo", logoSquareUrl: "/logo.png" }) }));
vi.mock("@/components/ui/dialog", async () => ({ Dialog: (await import("@radix-ui/react-dialog")).Root }));
vi.mock("@/components/branded-checkbox", () => ({ BrandedCheckbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={event => onCheckedChange?.(event.target.checked)} {...props} /> }));
vi.mock("@/lib/work-hub-client", async () => ({ ...await vi.importActual("@/lib/work-hub-client"), workHubRequest: vi.fn(async (path: string, options?: { method?: string }) => {
  if (options?.method === "POST") return {};
  if (path.startsWith("/gate-shift-definitions")) return { gates: [{ id: gate, siteName: "North Site", name: "Main Gate" }], definitions: [{ id, version: 3, stationId: gate, siteName: "North Site", gateName: "Main Gate", startsAtLocal: "18:00", endsAtLocal: "06:00", timezone: "America/Chicago", weekdays: [0,1,2,3,4,5,6], requiredCount: 1, notes: "Radio check", watches: [{ id: "watch", startsAt: "2026-10-30T23:00:00Z", people: [{ id: 7, name: "Bob" }] }] }] };
  return [];
}) }));
afterEach(() => { cleanup(); coaching.selected = null; vi.restoreAllMocks(); vi.mocked(workHubRequest).mockClear(); window.history.replaceState({},"","/"); });
function mount(canDefine = true) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCalendarScheduling owner={{ type: "vendor", id: 1115 }} canDefine={canDefine} /></QueryClientProvider>); }
describe("Gate calendar scheduling", () => {
  it("points first-watch creation at the actual authorized gate checkbox before Save without auto-selecting or writing", async () => {
    window.history.replaceState({},"","/work-hub/calendar?siteId=1");
    coaching.selected={id:"first-watch",context:{siteId:1}};
    const rectangle={left:20,top:80,right:220,bottom:120,width:200,height:40,x:20,y:80,toJSON(){}};
    vi.spyOn(HTMLElement.prototype,"getClientRects").mockReturnValue([rectangle] as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue(rectangle);
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GuidedTargetProvider scope="company:1115" active><GateCalendarScheduling owner={{type:"vendor",id:1115}} canDefine /></GuidedTargetProvider></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button",{name:"Add/Edit Shifts"}));
    const checkbox=await screen.findByRole("checkbox",{name:"North Site | Main Gate"});
    const form=screen.getByRole("form",{name:"Add/Edit Shifts"});const scopeId=form.getAttribute("data-guidance-scope")!;
    await screen.findByTestId("guidance-target-ring");
    expect(findGuidanceTarget({scopeId,targetId:`gate-${gate}`,prompt:""})).toBe(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(vi.mocked(workHubRequest).mock.calls.some(([,options])=>options?.method==="POST")).toBe(false);
    fireEvent.click(checkbox);
    const save=screen.getByRole("button",{name:"Create Shift"});
    await waitFor(()=>expect(findGuidanceTarget({scopeId,targetId:"save-shift",prompt:""})).toBe(save));
    expect(vi.mocked(workHubRequest).mock.calls.some(([,options])=>options?.method==="POST")).toBe(false);
  });
  it("opens the next-step station in shift setup without saving anything", async () => {
    window.history.replaceState({},"",`/work-hub/calendar?siteId=1&stationId=${gate}`);
    mount();
    const form=await screen.findByRole("form",{name:"Add/Edit Shifts"});
    await waitFor(()=>expect(within(form).getByRole("option",{name:/North Site/})).toBeTruthy());
    expect(vi.mocked(workHubRequest).mock.calls.some(([,options])=>options?.method==="POST")).toBe(false);
  });
  it("gives staff Add Event without access to shift definitions", () => {
    mount(false);
    expect(screen.queryByRole("button", { name: "Add/Edit Shifts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Event" }));
    expect(screen.getByRole("form", { name: "Add Event" })).toBeTruthy();
    expect(vi.mocked(workHubRequest).mock.calls.some(([path]) => path.startsWith("/gate-shift-definitions"))).toBe(false);
  });
  it("uses one Add/Edit Shifts flyout to create an unassigned recurring shift without redundant fields", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Add/Edit Shifts" }));
    const form = await screen.findByRole("form", { name: "Add/Edit Shifts" });
    await waitFor(() => expect(within(form).getByRole("option", { name: /North Site/ })).toBeTruthy());
    expect(within(form).queryByLabelText("Title")).toBeNull();
    expect(within(form).queryByLabelText("Work type")).toBeNull();
    expect(within(form).queryByLabelText("Calendar")).toBeNull();
    expect(within(form).queryByLabelText("Mandatory")).toBeNull();
    fireEvent.click(within(form).getByRole("checkbox", { name: "North Site | Main Gate" }));
    expect(within(form).getByRole("switch", { name: "Crew / Individual" })).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Create Shift" }));
    await waitFor(() => expect(vi.mocked(workHubRequest).mock.calls.some(([,options]) => options?.method === "POST")).toBe(true));
    const [path, options] = vi.mocked(workHubRequest).mock.calls.find(([,options]) => options?.method === "POST")!;
    expect(path).toBe("/gate-shift-definitions");
    expect(JSON.parse(options!.body as string).payload).toMatchObject({ stationIds: [gate], startsAtLocal: "06:00", endsAtLocal: "18:00", weekdays: [0,1,2,3,4,5,6], userIds: [], crewIds: [] });
  });
  it("prefills an existing night shift and retains its id/version for edits", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Add/Edit Shifts" }));
    await screen.findByRole("option", { name: /North Site/ });
    fireEvent.change(screen.getByLabelText("Shift"), { target: { value: id } });
    expect((screen.getByLabelText("Starts") as HTMLSelectElement).value).toBe("18:00");
    expect((screen.getByLabelText("Ends") as HTMLSelectElement).value).toBe("06:00");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Radio check");
    fireEvent.click(screen.getByText("Scheduled watches · 1"));
    expect(screen.getByText("Bob")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Check barrier" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Shift" }));
    await waitFor(() => expect(vi.mocked(workHubRequest).mock.calls.some(([,options]) => options?.method === "POST")).toBe(true));
    const [,options] = vi.mocked(workHubRequest).mock.calls.find(([,options]) => options?.method === "POST")!;
    expect(JSON.parse(options!.body as string).payload).toMatchObject({ id, version: 3, notes: "Check barrier", userIds: [] });
  });
  it("creates a separate one-off event without recurrence", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Add Event" }));
    const form = within(screen.getByRole("form", { name: "Add Event" }));
    fireEvent.change(form.getByLabelText("Title"), { target: { value: "Safety briefing" } });
    fireEvent.change(form.getByLabelText("Starts"), { target: { value: "11/01/26 08:00 AM" } });
    fireEvent.change(form.getByLabelText("Ends"), { target: { value: "11/01/26 08:30 AM" } });
    fireEvent.click(form.getByRole("button", { name: "Add Event" }));
    await waitFor(() => expect(vi.mocked(workHubRequest).mock.calls.some(([,options]) => options?.method === "POST")).toBe(true));
    const [path, options] = vi.mocked(workHubRequest).mock.calls.find(([,options]) => options?.method === "POST")!;
    expect(path).toBe("/meetings");
    expect(JSON.parse(options!.body as string).payload.recurrence).toBeUndefined();
    expect(JSON.parse(options!.body as string).payload.calendarEvent).toBe(true);
  });
  it("orders edit actions Save, Cancel, Delete and retires only the selected definition", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Add/Edit Shifts" }));
    await screen.findByRole("option", { name: /North Site/ });
    expect(screen.queryByRole("button", { name: "Delete Shift" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Shift"), { target: { value: id } });
    const form = screen.getByRole("form", { name: "Add/Edit Shifts" });
    expect(within(form).getAllByRole("button").slice(-3).map(button => button.textContent)).toEqual(["Save Shift", "Cancel", "Delete Shift"]);
    fireEvent.click(within(form).getByRole("button", { name: "Delete Shift" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [path,options] = vi.mocked(workHubRequest).mock.calls.find(([,options]) => options?.method === "POST")!;
    expect(path).toBe("/gate-shift-definitions/retire");
    expect(JSON.parse(options!.body as string).payload).toEqual({ id, version: 3 });
  });
  it.each(["Cancel", "Close add/edit shifts"])("%s closes without writes", label => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Add/Edit Shifts" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(workHubRequest).mock.calls.some(([,options]) => options?.method === "POST")).toBe(false);
  });
});
