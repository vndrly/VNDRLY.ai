import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn(), membership: 1, generation: 1, language: "en" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: state.language } }) }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/api", () => ({ apiFetch: (path: string) => state.fetch(path) }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: state.generation }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, vendorId: 7 }, activeMembershipId: state.membership }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "cyan", foreground: "white", card: "black", mutedForeground: "grey", border: "grey" }) }));
vi.mock("./TogglePillButton", () => ({ default: ({ children, onPress, accessibilityLabel, accessibilityState }: any) => <button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button> }));
vi.mock("./WorkHubConversation", () => ({ default: ({ channel, onClose }: any) => <div>Conversation {channel.id}<button onClick={onClose}>Close conversation</button></div> }));
import CalendarOverview from "./CalendarOverview";

const now = new Date(2026, 9, 22, 12);
const date = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();
const shiftId = "00000000-0000-4000-8000-000000000001";
const meetingId = "00000000-0000-4000-8000-000000000002";
const taskId = "00000000-0000-4000-8000-000000000003";
const home = () => ({
  shifts: [
    { shift: { id: shiftId, title: "Assigned Gate", startsAt: date(1), endsAt: date(2), timezone: "America/Chicago" }, assignment: { status: "assigned" } },
    { shift: { id: "cancelled", title: "Cancelled assignment", startsAt: date(1) }, assignment: { status: "cancelled" } },
  ],
  meetings: [{ occurrence: { id: meetingId, startsAt: date(2) }, meeting: { title: "Crew briefing" } }],
  tasks: [
    { id: taskId, title: "Urgent inspection", status: "open", dueAt: date(1), priority: "high" },
    { id: "done", title: "Completed inspection", status: "completed", dueAt: date(1) },
    { id: "later", title: "Later inspection", status: "open", dueAt: date(15) },
  ],
});
const project = { id: shiftId, title: "Well handoff", startsAt: date(40), endsAt: date(41), calendarType: "project", projectName: "North site", percentComplete: 35, ownerDisplayName: "Sam", instructions: "Confirm readiness", blockers: "Permit pending" };
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(<QueryClientProvider client={client}><CalendarOverview initialDate={now} /></QueryClientProvider>);
}
beforeEach(() => {
  state.membership = 1;
  state.generation = 1;
  state.language = "en";
  state.push.mockReset();
  state.fetch.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/work-hub/home") return home();
    if (path.startsWith("/api/work-hub/calendar?")) return { shifts: [{ item: project }] };
    if (path.startsWith("/api/work-hub/channels?")) return [{ id: "chat-1", name: "Operations", unreadCount: 3 }];
    throw Error(path);
  });
});
afterEach(cleanup);

it("expands four summaries from assigned work and opens canonical native records", async () => {
  mount();
  await screen.findByText("Assigned Gate");
  expect(screen.getByText("At a glance")).toBeTruthy();
  expect(screen.queryByText("Cancelled assignment")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open My next shift" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Assigned Gate" }));
  expect(state.push).toHaveBeenCalledWith(`/work-hub/record?kind=shift&id=${shiftId}`);
  fireEvent.click(screen.getByRole("button", { name: "Open Next meeting" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Crew briefing" }));
  expect(state.push).toHaveBeenCalledWith(`/work-hub/meeting/${meetingId}`);
  fireEvent.click(screen.getByRole("button", { name: "Open Tasks due soon" }));
  expect(screen.queryByText("Completed inspection")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Urgent inspection" }));
  expect(state.push).toHaveBeenCalledWith(`/work-hub/record?kind=task&id=${taskId}`);
  fireEvent.click(screen.getByRole("button", { name: "This week" }));
  expect(screen.queryByText("Later inspection")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Unread conversations" }));
  expect(screen.getByText("Operations")).toBeTruthy();
  expect(screen.getByText("3 unread")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Operations" }));
  expect(screen.getByText("Conversation chat-1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close conversation" }));
  expect(screen.queryByText("Conversation chat-1")).toBeNull();
});

it("uses real project milestones, range filters and expandable details", async () => {
  mount();
  await screen.findByText("Well handoff");
  fireEvent.click(screen.getByRole("button", { name: "Preview Well handoff" }));
  expect(screen.getByText("Confirm readiness")).toBeTruthy();
  expect(screen.getByText("Permit pending")).toBeTruthy();
  expect(screen.getByText("Owner: Sam")).toBeTruthy();
  expect(screen.getByText("35% complete")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "30 days" }));
  expect(screen.queryByText("Well handoff")).toBeNull();
  expect(screen.getByText("No shared project milestones in this range.")).toBeTruthy();
});

it("keeps source failures distinct from zero records", async () => {
  state.fetch.mockRejectedValue(Error("offline"));
  mount();
  await waitFor(() => expect(screen.getAllByText("Unavailable")).toHaveLength(4));
  fireEvent.click(screen.getByRole("button", { name: "Open My next shift" }));
  expect(screen.getByText("This source could not load. Try again when connected.")).toBeTruthy();
  expect(screen.getByText("Project schedule unavailable. Try again when connected.")).toBeTruthy();
  expect(screen.queryByText("Nothing scheduled")).toBeNull();
});

it("pages unread channels instead of undercounting a full first page", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: `group-${i}`, name: `Group ${i}`, unreadCount: 1, updatedAt: date(-1), continuationCursor: "next-page" }));
  state.fetch.mockImplementation(async (path: string) => path === "/api/work-hub/home" ? home() : path.startsWith("/api/work-hub/calendar?") ? { shifts: [] } : path.includes("cursor=next-page") ? [{ id: "last", name: "Last group", unreadCount: 5 }] : first);
  mount();
  const row = screen.getByRole("button", { name: "Open Unread conversations" });
  await waitFor(() => expect(within(row).getByText("105")).toBeTruthy());
  expect(state.fetch.mock.calls.some(([path]) => path.includes("cursor=next-page"))).toBe(true);
});

it("clears expanded records when the current company changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = mount(client);
  await screen.findByText("Assigned Gate");
  fireEvent.click(screen.getByRole("button", { name: "Open My next shift" }));
  state.membership = 2;
  state.fetch.mockRejectedValue(Error("new company unavailable"));
  rendered.rerender(<QueryClientProvider client={client}><CalendarOverview initialDate={now} /></QueryClientProvider>);
  expect(screen.queryByRole("button", { name: "Open Assigned Gate" })).toBeNull();
  await waitFor(() => expect(screen.queryByText("Assigned Gate")).toBeNull());
});

it("requires fresh overview data when the same account signs in again", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = mount(client);
  await screen.findByText("Assigned Gate");
  fireEvent.click(screen.getByRole("button", { name: "Open My next shift" }));
  state.generation = 2;
  state.fetch.mockImplementation(() => new Promise(() => {}));
  rendered.rerender(<QueryClientProvider client={client}><CalendarOverview initialDate={now} /></QueryClientProvider>);
  expect(screen.queryAllByText("Assigned Gate")).toHaveLength(0);
  expect(screen.queryByText("Well handoff")).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Assigned Gate" })).toBeNull();
});

it("renders Spanish headings, summaries, details and range controls without translating company records", async () => {
  state.language = "es";
  mount();
  expect(screen.getAllByText("Cargando…")).toHaveLength(4);
  await screen.findByText("Assigned Gate");
  expect(screen.getByText("De un vistazo")).toBeTruthy();
  expect(screen.getByText("Cronograma de proyectos")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Tareas próximas a vencer" }));
  expect(screen.getByRole("button", { name: "Esta semana" })).toBeTruthy();
  expect(screen.getByText("Hasta 10 registros de los últimos 50 registros de trabajo personal.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ver todas las tareas y formularios" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Conversaciones sin leer" }));
  expect(screen.getByText("3 sin leer")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Vista previa de Well handoff" }));
  expect(screen.getByText("Responsable: Sam")).toBeTruthy();
  expect(screen.getByText("35% completado")).toBeTruthy();
  expect(screen.getByRole("button", { name: "30 días" })).toBeTruthy();
});

it("shows Spanish unavailable messages instead of an empty personal schedule", async () => {
  state.language = "es";
  state.fetch.mockRejectedValue(Error("offline"));
  mount();
  await waitFor(() => expect(screen.getAllByText("No disponible")).toHaveLength(4));
  fireEvent.click(screen.getByRole("button", { name: "Abrir Mi próximo turno" }));
  expect(screen.getByText("No se pudo cargar esta fuente. Inténtelo de nuevo cuando tenga conexión.")).toBeTruthy();
  expect(screen.getByText("El cronograma del proyecto no está disponible. Inténtelo de nuevo cuando tenga conexión.")).toBeTruthy();
});
