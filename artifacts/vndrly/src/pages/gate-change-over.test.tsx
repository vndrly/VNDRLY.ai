import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
vi.mock("@/components/workday-controls", () => ({ default: ({watchControl}: {watchControl?: React.ReactNode}) => <section aria-label="Workday"><button type="button" role="switch" aria-label="Shift" aria-checked="false" /><button type="button" role="switch" aria-label="On Call" aria-checked="false" />{watchControl}</section> }));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: api }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1 } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#0095a8", name: "MidCon Solutions" }),
}));
import { PILL_BRAND, PILL_IDLE } from "@/lib/pill-palette-assets";
import GateChangeOverPage from "./gate-change-over";
const snapshot = {
  generatedAt: new Date().toISOString(),
  revision: "a",
  metrics: {
    checkIns: 2,
    checkOuts: 1,
    onSiteVisitorRecords: 1,
    onSiteEmployeeRecords: 0,
    onSiteVehicles: 1,
    pendingAdmission: 0,
  },
  outstanding: [],
  exceptions: [],
  openItems: [],
  facts: [],
};
const state = () => ({
  station: { id: "gate", name: "Main gate" },
  site: { id: 1, name: "Site" },
  supervisor: false,
  shift: {
    operator_id: 1,
    operator_name: "Outgoing",
    started_at: new Date().toISOString(),
  },
  preparation: {
    id: "prep",
    snapshot,
    notes: "Barrier note",
    summary: { source: "structured_facts", facts: [] },
  },
  snapshot,
  stale: false,
  items: [],
});
beforeEach(() => {
  api.mockReset();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  onlineManager.setOnline(true);
  api.mockImplementation(async (path: string) =>
    path.startsWith("/sites")
      ? { sites: [{ id: 1, name: "Site" }] }
      : path.startsWith("/stations")
        ? { stations: [{ id: "gate", name: "Main gate" }] }
        : path.includes("/notes?")
          ? { rows: [], actions: [] }
        : path.endsWith("/state")
          ? state()
          : path.endsWith("/authenticate")
            ? { proof: "signed", incoming: { id: 2, displayName: "Incoming" } }
            : {},
  );
});
const caches: QueryClient[] = [];
afterEach(() => { cleanup(); for (const cache of caches.splice(0)) cache.clear(); });
it("keeps the coverage map off the Dashboard", () => {
  mount(false);
  expect(screen.queryByRole("region", { name: "Gate coverage map" })).toBeNull();
});
it("requests separate history discovery for inactive gates without reusing operational selectors", async () => {
  mount(true);
  await waitFor(() => expect(api).toHaveBeenCalledWith("/sites?mode=history"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/stations?siteId=1&mode=history"));
});
function mount(history = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  caches.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <GateChangeOverPage history={history} />
    </QueryClientProvider>,
  );
  return cache;
}
it("shows the standard back control and branded Dashboard icon", () => {
  mount();
  expect(screen.getByTestId("button-back")).not.toBeNull();
  expect(screen.getByTestId("gate-dashboard-header-icon").getAttribute("class")).not.toContain("card-icon-drop-shadow");
  expect(screen.getByRole("heading", { level: 1, name: "changeOver.title" })).not.toBeNull();
});
it("keeps Prepare Handoff gray at rest and branded on hover without requiring notes", async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith("/state")
    ? { ...state(), preparation: null }
    : base(path, body));
  mount();
  const button = await screen.findByRole("button", { name: "changeOver.prepare" });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  const sources = Array.from(button.querySelectorAll("img"), (image) => image.getAttribute("src"));
  expect(sources).toContain(PILL_IDLE);
  expect(sources).toContain(PILL_BRAND.midcon);
});
it("shows open carry-forward items separately from resolved history", async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith("/state")
    ? {
        ...state(),
        items: [
          { id: "open-item", text: "Identify driver for OK ABC123", status: "open" },
          { id: "resolved-item", text: "North barrier inspected", status: "resolved" },
        ],
      }
    : base(path, body));
  mount();
  expect(await screen.findByText("changeOver.shiftFollowUps")).not.toBeNull();
  expect(screen.getByRole("tab", { name: "changeOver.openItems" })).not.toBeNull();
  expect(await screen.findByText("Identify driver for OK ABC123")).not.toBeNull();
  expect(screen.queryByText("North barrier inspected")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "changeOver.resolvedItems" }));
  expect(screen.getByText("North barrier inspected")).not.toBeNull();
  expect(screen.queryByText("Identify driver for OK ABC123")).toBeNull();
});
it("combines outgoing notes with Shift follow-ups and places Incoming shift review beside it", async () => {
  mount();
  const followUps = await screen.findByRole("region", { name: "changeOver.shiftFollowUps" });
  const notes = screen.getByText("changeOver.outgoingNotes");
  expect(followUps.contains(notes)).toBe(true);
  expect(screen.queryByRole("region", { name: "changeOver.outgoingNotes" })).toBeNull();
  const incoming = screen.getByRole("region", { name: "changeOver.review" });
  expect(incoming.previousElementSibling).toBe(followUps);
});
it("moves an item out of the open list only after a resolution note, and can reopen it", async () => {
  const base = api.getMockImplementation()!;
  let item = { id: "truck", text: "Identify driver for OK ABC123", status: "open" };
  api.mockImplementation(async (path, body) => {
    if (path.endsWith("/state")) return { ...state(), items: [item] };
    if (path.endsWith("/items")) {
      const action = body as { itemId: string; kind: string; text: string };
      if (action.itemId === item.id && action.kind === "resolve") {
        item = { ...item, text: `${item.text}\nResolution: ${action.text}`, status: "resolved" };
      } else if (action.itemId === item.id && action.kind === "reopen") {
        item = { ...item, text: `${item.text}\nReopened: ${action.text}`, status: "open" };
      }
      return {};
    }
    return base(path, body);
  });
  mount();
  const openItem = await screen.findByTestId("carry-forward-item-truck");
  const resolve = within(openItem).getByRole("button", { name: "changeOver.markResolved" });
  expect((resolve as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(openItem).getByRole("textbox", { name: "changeOver.resolutionNote" }), {
    target: { value: "Driver is Jack Smith, Grady Farms" },
  });
  fireEvent.click(resolve);
  await waitFor(() => expect(screen.queryByTestId("carry-forward-item-truck")).toBeNull());
  fireEvent.click(screen.getByRole("tab", { name: "changeOver.resolvedItems" }));
  const resolvedItem = screen.getByTestId("carry-forward-item-truck");
  expect(resolvedItem.textContent).toContain("Driver is Jack Smith, Grady Farms");
  fireEvent.change(within(resolvedItem).getByRole("textbox", { name: "changeOver.reopenNote" }), {
    target: { value: "Driver details need rechecking" },
  });
  fireEvent.click(within(resolvedItem).getByRole("button", { name: "changeOver.reopen" }));
  await waitFor(() => expect(screen.queryByTestId("carry-forward-item-truck")).toBeNull());
  fireEvent.click(screen.getByRole("tab", { name: "changeOver.openItems" }));
  expect(await screen.findByTestId("carry-forward-item-truck")).not.toBeNull();
});
it("outlines each live snapshot counter in the organization brand", async () => {
  mount();
  await screen.findByText("changeOver.checkIns");
  for (const metric of Object.keys(snapshot.metrics)) {
    const label = screen.getByText(`changeOver.${metric}`);
    const row = screen.getByTestId(`dashboard-metric-${metric}`);
    expect(row.contains(label)).toBe(true);
    expect(row.getAttribute("href")).toContain("range=current_shift");
  }
});
it("limits Shift Notes to one year and uses branded compact fields", async () => {
  mount(true);
  const card = screen.getByTestId("shift-notes-main-card");
  expect(screen.getByTestId("button-back")).not.toBeNull();
  expect(screen.getByTestId("shift-notes-header-icon").getAttribute("class")).not.toContain("card-icon-drop-shadow");
  expect(card.className).toContain("bg-white");
  expect(card.contains(screen.getByRole("combobox", { name: "changeOver.site" }))).toBe(true);
  expect(card.contains(screen.getByRole("textbox", { name: "changeOver.search" }))).toBe(true);
  expect(card.contains(await screen.findByText("changeOver.noNotes"))).toBe(true);
  const range = screen.getByRole("combobox", { name: "changeOver.range" });
  expect(Array.from(range.querySelectorAll("option"), (option) => option.value)).toEqual([
    "7", "30", "90", "365",
  ]);
  for (const field of [
    screen.getByRole("combobox", { name: "changeOver.site" }),
    screen.getByRole("combobox", { name: "changeOver.gate" }),
    range,
    screen.getByRole("textbox", { name: "changeOver.search" }),
  ]) {
    expect(field.className).toContain("rounded-full");
    expect(field.className).toContain("border-[color:var(--brand-primary)]");
    expect(field.className).toContain("bg-white");
  }
});

function incomingState() { return { ...state(), shift: { ...state().shift, operator_id: 2 } }; }
function useIncoming() {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) => path.endsWith('/state') ? incomingState() : base(path, body));
}
it('assumes a reviewed watch using the signed-in account without credentials or a session switch', async () => {
  useIncoming(); mount();
  const review = await screen.findByLabelText('changeOver.acknowledge');
  const confirm = () => within(document.getElementById('watch-review')!).getByRole('button', { name: 'watch.assume' }) as HTMLButtonElement;
  expect(confirm().disabled).toBe(true);
  expect(screen.queryByLabelText('changeOver.password')).toBeNull();
  fireEvent.click(review); fireEvent.click(confirm());
  await waitFor(() => expect(api).toHaveBeenCalledWith('/gate/watch/assume', expect.objectContaining({ source: 'web', preparationId: 'prep', reviewedRevision: 'a', acknowledged: true, operationId: expect.any(String) })));
  expect(api.mock.calls.some(([path]) => /\/(authenticate|transfer|start)$/.test(path))).toBe(false);
});
it('requires another acknowledgment when current watch activity changes', async () => {
  useIncoming(); const cache = mount();
  fireEvent.click(await screen.findByLabelText('changeOver.acknowledge'));
  cache.setQueryData(['change-over-state', 1, 'gate'], { ...incomingState(), snapshot: { ...snapshot, revision: 'b' } });
  await waitFor(() => expect((screen.getByLabelText('changeOver.acknowledge') as HTMLInputElement).checked).toBe(false));
});
it('clears review and disables watch assumption when offline', async () => {
  useIncoming(); mount();
  fireEvent.click(await screen.findByLabelText('changeOver.acknowledge'));
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  fireEvent(window, new Event('offline'));
  await screen.findByText('changeOver.offline');
  expect((screen.getByLabelText('changeOver.acknowledge') as HTMLInputElement).checked).toBe(false);
  for (const button of screen.getAllByRole('button', { name: 'watch.assume' })) expect((button as HTMLButtonElement).disabled).toBe(true);
});
it('keeps the top Workday card limited to shift and on-call controls', async () => {
  mount();
  const workday = await screen.findByRole('region', { name: 'Workday' });
  expect(within(workday).getByRole('switch', { name: 'Shift' })).toBeTruthy();
  expect(within(workday).getByRole('switch', { name: 'On Call' })).toBeTruthy();
  for (const name of ['changeOver.site', 'changeOver.gate']) {
    const select = within(workday).getByRole('combobox', { name });
    expect(select.className).toContain('gate-dashboard-location-select');
  }
  expect(within(workday).queryByRole('button', { name: 'watch.handover' })).toBeNull();
  expect(within(workday).queryByRole('button', { name: 'watch.assume' })).toBeNull();
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
});

it('uses browser history for the Dashboard back button', async () => {
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  mount();
  fireEvent.click(await screen.findByTestId('button-back'));
  expect(back).toHaveBeenCalledOnce();
  back.mockRestore();
});

it('does not duplicate the original watch command while canonical recovery is pending', async () => {
  const base=api.getMockImplementation()!;
  let current=incomingState(), attempts=0;
  api.mockImplementation(async (path,body) => {
    if(path.endsWith('/state')) return current;
    if(path.includes('/watch/operations/')) return {receipt:null};
    if(path.endsWith('/watch/assume')) { attempts++; if(attempts===1) { current={...incomingState(),preparation:{...state().preparation,id:'later-prep'},snapshot:{...snapshot,revision:'later'}}; throw new Error('Lost response'); } return {id:'original'}; }
    return base(path,body);
  });
  const cache=mount();
  fireEvent.click(await screen.findByLabelText('changeOver.acknowledge'));
  fireEvent.click(within(document.getElementById('watch-review')!).getByRole('button',{name:'watch.assume'}));
  await screen.findByText('Lost response');
  await cache.invalidateQueries({queryKey:['change-over-state']});
  await waitFor(()=>expect(api.mock.calls.some(([path])=>path.includes('/watch/operations/'))).toBe(true));
  const writes=api.mock.calls.filter(([path])=>path.endsWith('/watch/assume'));
  expect(writes).toHaveLength(1);
});
