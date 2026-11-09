import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GateStaffingAlert } from "@workspace/gate-booth";
import NotificationsBell from "./notifications-bell";
import { NotificationsModalProvider } from "./notifications-modal-context";
import GateWatchRadar from "./gate-watch-radar";
import GateCalendarStaffingWatch from "./gate-calendar-staffing-watch";

const state = vi.hoisted(() => ({
  user: { userId: 7, role: "vendor", vendorRole: "office", vendorId: 4, partnerId: null, activeMembershipId: 2 },
  stream: undefined as undefined | ((type: string, event: MessageEvent<string>) => void),
  browserShow: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ name: "Test company", primary: "#3260CD" }) }));
vi.mock("@/lib/portal-branding", () => ({ portalDisplayLogo: () => "/logo.png" }));
vi.mock("@/hooks/use-browser-notifications", () => ({ useBrowserNotifications: () => ({ show: state.browserShow }) }));
vi.mock("@/lib/shared-notification-stream", () => ({ subscribeNotificationStream: (_url: string, _identity: string, listener: typeof state.stream) => { state.stream = listener; return () => { state.stream = undefined; }; } }));

const href = "/work-hub/calendar?siteId=21&stationId=gate-west&shiftId=night-1&date=2026-11-09";
const incident = (patch: Partial<GateStaffingAlert> = {}): GateStaffingAlert => ({
  id: "incident-1", code: "GA-123", status: "open", severity: "critical", kind: "uncovered",
  siteId: 21, stationId: "gate-west", shiftId: "night-1", siteName: "West site", gateName: "West Gate", title: "Night watch",
  startsAt: "2026-11-09T06:00:00.000Z", endsAt: "2026-11-10T06:00:00.000Z", timezone: "America/Chicago",
  requiredCount: 2, actualCount: 0, acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null,
  createdAt: "2026-11-09T06:05:00.000Z", escalatedAt: "2026-11-09T06:05:00.000Z", href,
  canAcknowledge: true, notificationsPaused: false, ...patch,
});
const caches: QueryClient[] = [];
let alerts: GateStaffingAlert[], paused: boolean, failed: boolean, gateNotificationsEnvelope: boolean, denyOrdinaryGateReads: boolean;
let acknowledge: () => Promise<Response>;
let writes: { path: string; body: unknown }[];
let reads: string[];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  state.user = { userId: 7, role: "vendor", vendorRole: "office", vendorId: 4, partnerId: null, activeMembershipId: 2 };
  state.browserShow.mockReset(); state.stream = undefined;
  alerts = [incident()]; paused = false; failed = false; gateNotificationsEnvelope = false; denyOrdinaryGateReads = false; writes = []; reads = [];
  acknowledge = async () => response({ alert: incident({ status: "acknowledged", acknowledgedBy: { userId: 8, name: "First Admin" }, acknowledgedAt: "2026-11-09T07:00:00.000Z" }) });
  vi.stubGlobal("EventSource", class {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/acknowledge")) { writes.push({ path, body: JSON.parse(String(init?.body)) }); return acknowledge(); }
    if (path.endsWith("/api/gate-staffing-alerts")) { reads.push(path); return failed ? response({ message: "Staffing status unavailable" }, 503) : response({ alerts, notificationsPaused: paused }); }
    if (path.includes("unread-count")) return response({ count: 0 });
    if (path.endsWith("/api/notifications") && gateNotificationsEnvelope) return response({ items: [], nextCursor: null, categories: [] });
    if (path.includes("watch-timeline")) return response({ radar: [], sites: [] });
    if (path.endsWith("/gate-west/state?purpose=assume")) return response({ station: { id: "gate-west", name: "West Gate" }, site: { id: 21, name: "West site" }, shift: null, preparation: null, snapshot: { revision: "a", facts: [] } });
    if (denyOrdinaryGateReads && path.includes("/api/gate-change-over/")) return response({ message: "No operational Gate scope before saved watch" }, 403);
    return response([]);
  }));
});
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); vi.useRealTimers(); });
function mount(calendarSearch?: string) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  caches.push(cache);
  const tree = () => <QueryClientProvider client={cache}><NotificationsModalProvider><NotificationsBell /><GateWatchRadar />{calendarSearch !== undefined && <GateCalendarStaffingWatch search={calendarSearch} />}</NotificationsModalProvider></QueryClientProvider>;
  return { cache, ...render(tree()), refresh: tree };
}
async function openBell() { fireEvent.click(screen.getByTestId("button-notifications-bell")); return screen.findByTestId("modal-notifications"); }

it("opens the shared staffing card when Gate notifications use the paginated response", async () => {
  gateNotificationsEnvelope = true;
  mount(); const modal = await openBell();
  expect(await within(modal).findByTestId("staffing-alert-incident-1")).toBeTruthy();
  expect(within(modal).getByRole("link", { name: "Open staffing calendar" }).getAttribute("href")).toBe(href);
});

it("shows one shared red gap in the bell and Radar, keeps the exact calendar link, and acknowledges only after confirmation", async () => {
  mount();
  await waitFor(() => expect(screen.getByTestId("button-notifications-bell").getAttribute("data-staffing-pulse")).toBe("true"));
  const modal = await openBell();
  const card = await within(modal).findByTestId("staffing-alert-incident-1");
  expect(card.getAttribute("data-severity")).toBe("critical");
  expect(card.classList.contains("motion-safe:animate-pulse")).toBe(true);
  expect(within(card).getByText(/0.*2.*on watch/i)).toBeTruthy();
  expect(within(card).getByRole("link", { name: /open staffing calendar/i }).getAttribute("href")).toBe(href);
  expect(writes).toEqual([]);
  fireEvent.click(within(card).getByRole("button", { name: "Acknowledge responsibility" }));
  expect(writes).toEqual([]);
  let complete!: (value: Response) => void;
  acknowledge = () => new Promise(resolve => { complete = resolve; });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm acknowledgment" }));
  await within(card).findByText("Saving acknowledgment…");
  expect(within(card).queryByText(/Acknowledged by/)).toBeNull();
  expect(writes).toEqual([{ path: "/api/gate-staffing-alerts/incident-1/acknowledge", body: { channel: "web" } }]);
  const winner = incident({ status: "acknowledged", acknowledgedBy: { userId: 8, name: "First Admin" }, acknowledgedAt: "2026-11-09T07:00:00.000Z" });
  alerts = [winner]; await act(async () => { complete(response({ alert: winner })); });
  expect(await within(card).findByText(/Acknowledged by First Admin/)).toBeTruthy();
  expect(card.classList.contains("motion-safe:animate-pulse")).toBe(false);
  expect(card.getAttribute("data-severity")).toBe("critical");
  expect(reads.length).toBeLessThanOrEqual(2);
});

it("refreshes another admin's acknowledgment and removes a gap only after saved coverage resolves it", async () => {
  const { cache } = mount(); const modal = await openBell();
  const card = await within(modal).findByTestId("staffing-alert-incident-1");
  alerts = [incident({ status: "acknowledged", acknowledgedBy: { userId: 9, name: "Other Admin" }, acknowledgedAt: "2026-11-09T08:00:00.000Z" })];
  await act(async () => { state.stream?.("notification.state_changed", new MessageEvent("notification.state_changed", { data: "{}" })); });
  expect(await within(card).findByText(/Acknowledged by Other Admin/)).toBeTruthy();
  expect(screen.getByTestId("button-notifications-bell").getAttribute("data-staffing-pulse")).toBe("false");
  alerts = [incident({ status: "resolved", actualCount: 2, resolvedAt: "2026-11-09T08:05:00.000Z" })];
  await act(async () => { await cache.invalidateQueries({ queryKey: ["gate-staffing-alerts"] }); });
  await waitFor(() => expect(within(modal).queryByTestId("staffing-alert-incident-1")).toBeNull());
});

it("keeps future warnings distinct from current gaps and links both Radar entries to their saved calendar context", async () => {
  alerts.push(incident({ id: "future", severity: "warning", kind: "watch_radar", title: "Tomorrow watch", href: `${href}&future=1` }));
  mount(); fireEvent.click(screen.getByText("Watch Radar"));
  const radar = screen.getByText("Watch Radar").closest("details")!;
  expect(await within(radar).findByText("Tomorrow watch")).toBeTruthy();
  const cards = within(radar).getAllByRole("article");
  expect(cards.map(card => card.getAttribute("data-severity"))).toEqual(["critical", "warning"]);
  expect(within(cards[1]).getByText(/No one is assigned/)).toBeTruthy();
  expect(within(cards[1]).queryByText(/on watch/i)).toBeNull();
  expect(within(radar).getAllByRole("link", { name: /open staffing calendar/i }).map(link => link.getAttribute("href"))).toEqual([href, `${href}&future=1`]);
});

it("keeps held staffing facts neutral and suppresses bell alarm cards, pulse, and browser popups", async () => {
  paused = true; alerts = [incident({ notificationsPaused: true })];
  mount(); fireEvent.click(screen.getByText("Watch Radar"));
  const radar = screen.getByText("Watch Radar").closest("details")!;
  const fact = await within(radar).findByTestId("staffing-alert-incident-1");
  expect(fact.getAttribute("data-severity")).toBe("neutral");
  expect(fact.classList.contains("motion-safe:animate-pulse")).toBe(false);
  const modal = await openBell();
  expect(within(modal).queryByTestId("staffing-alert-incident-1")).toBeNull();
  expect(screen.getByTestId("button-notifications-bell").getAttribute("data-staffing-pulse")).toBe("false");
  await act(async () => { state.stream?.("notification.created", new MessageEvent("notification.created", { data: JSON.stringify({ type: "notification.created", notifType: "gate_uncovered", title: "Staffing gap" }) })); });
  expect(state.browserShow).not.toHaveBeenCalled();
});
it("preserves unrelated browser notifications when the optional staffing query fails", async () => {
  failed = true; mount();
  await screen.findAllByText(/Watch Radar is unavailable/);
  await act(async () => { state.stream?.("notification.created", new MessageEvent("notification.created", { data: JSON.stringify({ type: "notification.created", notifType: "ticket_assigned", title: "Assigned ticket", link: "/tickets/8" }) })); });
  expect(state.browserShow).toHaveBeenCalledWith(expect.objectContaining({ title: "Assigned ticket" }));
});

it("offers retry after reads and acknowledgments fail without claiming responsibility", async () => {
  failed = true; mount(); const modal = await openBell();
  fireEvent.click(await within(modal).findByRole("button", { name: "Retry staffing status" }));
  failed = false;
  fireEvent.click(await within(modal).findByRole("button", { name: "Retry staffing status" }));
  const card = await within(modal).findByTestId("staffing-alert-incident-1");
  acknowledge = async () => response({ message: "Membership changed. Reload and retry." }, 403);
  fireEvent.click(within(card).getByRole("button", { name: "Acknowledge responsibility" }));
  fireEvent.click(within(card).getByRole("button", { name: "Confirm acknowledgment" }));
  expect(await within(card).findByText("Membership changed. Reload and retry.")).toBeTruthy();
  expect(within(card).queryByText(/Acknowledged by/)).toBeNull();
  expect(card.classList.contains("motion-safe:animate-pulse")).toBe(true);
  acknowledge = async () => {
    const winner = incident({ status: "acknowledged", acknowledgedBy: { userId: 8, name: "Retry Admin" }, acknowledgedAt: "2026-11-09T08:00:00.000Z" });
    alerts = [winner]; return response({ alert: winner });
  };
  fireEvent.click(within(card).getByRole("button", { name: "Confirm acknowledgment" }));
  expect(await within(card).findByText(/Acknowledged by Retry Admin/)).toBeTruthy();
});

it("opens the exact staffing calendar without acknowledging the incident", async () => {
  mount(); const modal = await openBell();
  const card = await within(modal).findByTestId("staffing-alert-incident-1");
  const link = within(card).getByRole("link", { name: "Open staffing calendar" });
  link.addEventListener("click", event => event.preventDefault(), { once: true });
  fireEvent.click(link);
  await waitFor(() => expect(screen.queryByTestId("modal-notifications")).toBeNull());
  expect(link.getAttribute("href")).toBe(href);
  expect(writes).toEqual([]);
  expect(screen.getByTestId("button-notifications-bell").getAttribute("data-staffing-pulse")).toBe("true");
});

it("polls shared saved acknowledgment after 30 seconds without a notification event", async () => {
  vi.useFakeTimers(); mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(screen.getByTestId("button-notifications-bell").getAttribute("data-staffing-pulse")).toBe("true");
  alerts = [incident({ status: "acknowledged", acknowledgedBy: { userId: 9, name: "Polling Admin" }, acknowledgedAt: "2026-11-09T08:00:00.000Z" })];
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByTestId("button-notifications-bell").getAttribute("data-staffing-pulse")).toBe("false");
  expect(screen.getByText(/Acknowledged by Polling Admin/)).toBeTruthy();
  expect(reads).toHaveLength(2);
});

it("isolates account changes and discards a previous account's pending acknowledgment UI", async () => {
  const view = mount(); const modal = await openBell();
  const card = await within(modal).findByTestId("staffing-alert-incident-1");
  fireEvent.click(within(card).getByRole("button", { name: "Acknowledge responsibility" }));
  let complete!: (value: Response) => void;
  acknowledge = () => new Promise(resolve => { complete = resolve; });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm acknowledgment" }));
  await within(card).findByText("Saving acknowledgment…");
  state.user = { ...state.user, vendorId: 5, activeMembershipId: 3 };
  alerts = [incident({ id: "other-company", siteName: "Other company site", canAcknowledge: false })];
  view.rerender(view.refresh());
  expect(within(modal).queryByTestId("staffing-alert-incident-1")).toBeNull();
  const other = await within(modal).findByTestId("staffing-alert-other-company");
  expect(within(other).queryByRole("button", { name: "Acknowledge responsibility" })).toBeNull();
  await act(async () => { complete(response({ alert: incident({ status: "acknowledged", acknowledgedBy: { userId: 7, name: "Previous Admin" }, acknowledgedAt: "2026-11-09T08:00:00Z" }) })); });
  expect(within(other).queryByText(/Previous Admin/)).toBeNull();
});

it("offers office staff the existing Assume Watch review only for the calendar's exact saved context", async () => {
  alerts = [incident({ startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString() })];
  mount(href.split("?")[1]);
  const panel = await screen.findByRole("region", { name: "Cover this calendar watch" });
  const action = await within(panel).findByRole("button", { name: "Assume Watch" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(action);
  expect(await screen.findByRole("dialog", { name: "Assume Watch" })).toBeTruthy();
  expect(writes).toEqual([]);
});

it("does not offer a different gate or shift from a stale staffing calendar link", async () => {
  mount("siteId=21&stationId=gate-east&shiftId=night-1&date=2026-11-09");
  expect(await screen.findByText(/This staffing link is no longer current/)).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Cover this calendar watch" })).toBeNull();
  expect(writes).toEqual([]);
});
it("lets office-only staff preview the exact watch without ordinary Gate discovery or roster access", async () => {
  denyOrdinaryGateReads = true;
  alerts = [incident({ startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString() })];
  mount(href.split("?")[1]);
  const panel = await screen.findByRole("region", { name: "Cover this calendar watch" });
  const action = await within(panel).findByRole("button", { name: "Assume Watch" });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));fireEvent.click(action);
  const confirm = await screen.findByRole("button", { name: "ASSUME" });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  expect(vi.mocked(fetch).mock.calls.some(([path]) => /\/gate-change-over\/(sites|stations|[^/]+\/roster)(\?|$)/.test(String(path)))).toBe(false);
  expect(writes).toEqual([]);
});
