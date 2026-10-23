import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Platform } from "react-native";

vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }) }));
const env = vi.hoisted(() => ({ api: vi.fn(), raw: vi.fn(), changeOver: vi.fn(), share: vi.fn(), write: vi.fn(), params: {} as Record<string, unknown>, membershipId: 2 }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, apiFetchRaw: env.raw }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: env.changeOver }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 }, activeMembershipId: env.membershipId }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black", mutedForeground: "gray", background: "white", card: "white", border: "gray", destructive: "red", primary: "blue" }) }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/BrandTitleRow", () => ({ default: ({ title, subtitle }: any) => <><h1>{title}</h1><p>{subtitle}</p></> }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: ({ inline }: any) => <div data-inline={String(Boolean(inline))}>AskV voice</div> }));
vi.mock("@/components/SphereBackButton", () => ({ default: ({ onPress }: any) => <button onClick={onPress}>Back</button> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, color, disabled, onPress, solid, style, testID }: any) => <button data-testid={testID} data-color={color} data-solid={String(Boolean(solid))} disabled={disabled} onClick={onPress} style={style}>{children}</button> }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => env.params, router: { back: vi.fn(), canGoBack: () => true, replace: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" }, writeAsStringAsync: env.write }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: env.share }));
import GateHistory from "./GateHistory";

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateHistory /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  env.params = {}; env.membershipId = 2;
  env.changeOver.mockImplementation(async (path: string) => path.startsWith("/sites") ? { sites: [{ id: 7, name: "Big Cs Deep" }] } : { stations: [{ id: "station-1", name: "Main gate" }] });
  env.api.mockImplementation(async (path: string) => path.includes("/recipients") ? { recipients: [{ userId: 1, name: "Me" }, { userId: 2, name: "Supervisor" }] } : path.includes("/query") ? { rows: [{ id: 9, name: "Bob Villa", vehiclePlate: "ABC123" }] } : { deliveries: [] });
  env.raw.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(2) });
});

it("defaults to Current Shift and drives the visible report with type and range filters", async () => {
  mount(); expect((await screen.findAllByText("Bob Villa")).length).toBeGreaterThan(0);
  expect(env.changeOver).toHaveBeenCalledWith("/sites?mode=history");
  expect(env.changeOver).toHaveBeenCalledWith("/stations?siteId=7&mode=history");
  fireEvent.click(screen.getByTestId("gate-history-record-type-toggle"));
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.type.check_ins" }));
  fireEvent.click(screen.getByTestId("gate-history-time-period-toggle"));
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.range.7d" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"range":"7d"') })));
  expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"recordType":"check_ins"') }));
});

it("uses one filtered log and keeps reports out of the way until opened",async()=>{
 mount();const history=await screen.findByTestId("gate-history-live-card");expect(await within(history).findByText("Bob Villa")).toBeTruthy();expect(screen.getAllByText("Bob Villa")).toHaveLength(1);expect(screen.queryByTestId("gate-history-report-card")).toBeNull();const filters=screen.getByTestId("gate-history-filter-card");expect(await within(filters).findByRole("button",{name:"Big Cs Deep"})).toBeTruthy();expect(within(filters).getByLabelText("gatekeeper.historySearch")).toBeTruthy();fireEvent.click(screen.getByTestId("gate-history-reports-toggle"));expect(screen.getByTestId("gate-history-report-card")).toBeTruthy();expect(screen.getAllByText("Bob Villa")).toHaveLength(1);
});
it("keeps two-pixel brand borders on the filters, log and report drawer",async()=>{
 mount();await screen.findByText("Bob Villa");fireEvent.click(screen.getByTestId("gate-history-reports-toggle"));for(const id of ["gate-history-live-card","gate-history-filter-card","gate-history-report-card"]){expect(screen.getByTestId(id).style.borderTopWidth).toBe("2px");expect(screen.getByTestId(id).style.borderTopColor).toBe("rgb(0, 0, 255)");}
});
it("opens only selected visit details and closes them",async()=>{
 mount();await screen.findByText("Bob Villa");fireEvent.click(screen.getByRole("button",{name:"gateHistory.openVisit"}));expect(await screen.findByText("gateHistory.plate")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"gateHistory.closeDetails"}));expect(screen.queryByText("gateHistory.plate")).toBeNull();
});
it("exports the selected view and emails only selected authorized recipients", async () => {
  vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
  mount(); await screen.findAllByText("Bob Villa");fireEvent.click(screen.getByTestId("gate-history-reports-toggle"));
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  fireEvent.click(screen.getByTestId("gate-history-save"));
  await waitFor(() => expect(env.share).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId("gate-history-recipients-toggle"));
  fireEvent.click(screen.getByRole("button", { name: "Supervisor" }));
  fireEvent.click(screen.getByTestId("gate-history-email"));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/email", expect.objectContaining({ body: expect.stringContaining('"recipientUserIds":[1,2]') })));
});

it("downloads each filtered export in the browser with the correct file type", async () => {
  vi.spyOn(Platform, "OS", "get").mockReturnValue("web");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const createObjectURL = vi.fn(() => "blob:gate-report");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  env.raw.mockResolvedValue({ blob: async () => new Blob(["report"]) });

  mount();
  await screen.findAllByText("Bob Villa");
  fireEvent.click(screen.getByTestId("gate-history-reports-toggle"));
  for (const label of ["PDF", "CSV", "DOC"]) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByTestId("gate-history-save"));
  }

  await waitFor(() => expect(click).toHaveBeenCalledTimes(3));
  expect(createObjectURL).toHaveBeenCalledTimes(3);
  expect(revokeObjectURL).toHaveBeenCalledTimes(3);
});

it("opens Dashboard filters only for the selected accessible site and gate", async () => {
  env.params = { siteLocationId: "8", stationId: "station-2", range: "7d", recordType: "employees_on_site", search: "TX" };
  env.changeOver.mockImplementation(async (path: string) => path.startsWith("/sites") ? { sites: [{ id: 7, name: "First Site" }, { id: 8, name: "Target Site" }] } : { stations: [{ id: "station-2", name: "Target Gate" }] });
  mount();
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: JSON.stringify({ reportKind: "history", filters: { siteId: 8, stationId: "station-2", range: "7d", recordType: "employees_on_site", search: "TX" } }) })));
  expect(await screen.findByRole("button", { name: "Target Site" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Target Gate" })).toBeTruthy();
});
it("ignores invalid route filters and inaccessible sites and gates", async () => {
  env.params = { siteId: "9999", stationId: "unknown-gate", range: "forever", recordType: "everything", search: ["bad", "array"] };
  mount(); await screen.findByText("Bob Villa");
  const filters = env.api.mock.calls.filter(([path]) => path === "/api/gate-report/query").map(([, options]) => JSON.parse(options.body).filters);
  expect(filters.every(value => value.siteId === 7 && value.range === "current_shift" && value.recordType === "all" && !value.search && value.stationId !== "unknown-gate")).toBe(true);
});
it("exposes employee and pending record filters and state-qualified list plates", async () => {
  env.api.mockImplementation(async (path: string) => path.includes("/recipients") ? { recipients: [] } : { rows: [{ id: 9, name: "Bob Villa", plateState: "TX", vehiclePlate: "ABC123" }] });
  mount(); await screen.findByText("Bob Villa");
  expect(screen.getByText("TX • ABC123")).toBeTruthy();
  fireEvent.click(screen.getByTestId("gate-history-record-type-toggle"));
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.type.employees_on_site" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"recordType":"employees_on_site"') })));
  fireEvent.click(screen.getByTestId("gate-history-record-type-toggle"));
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.type.pending" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"recordType":"pending"') })));
});

it("clears previous route filters when the active membership changes", async () => {
  env.params = { siteId: "7", stationId: "station-1", range: "7d", recordType: "pending", search: "prior context" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = () => <QueryClientProvider client={client}><GateHistory /></QueryClientProvider>;
  const view = render(app());
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"search":"prior context"') })));
  env.api.mockClear(); env.membershipId = 3;
  view.rerender(app());
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: JSON.stringify({ reportKind: "history", filters: { siteId: 7, stationId: "station-1", range: "current_shift", recordType: "all" } }) })));
  const requests = env.api.mock.calls.filter(([path]) => path === "/api/gate-report/query");
  expect(requests.every(([, options]) => !options.body.includes("prior context"))).toBe(true);
});
it("clears inherited Dashboard filters when another site is selected", async () => {
  env.params = { siteId: "8", range: "7d", recordType: "pending", search: "old site" };
  env.changeOver.mockImplementation(async (path: string) => path.startsWith("/sites") ? { sites: [{ id: 7, name: "First Site" }, { id: 8, name: "Target Site" }] } : { stations: [{ id: "station-1", name: "Main gate" }] });
  mount(); await screen.findByText("Bob Villa");
  fireEvent.click(screen.getByRole("button", { name: "Target Site" }));
  fireEvent.click(screen.getByRole("button", { name: "First Site" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: JSON.stringify({ reportKind: "history", filters: { siteId: 7, stationId: "station-1", range: "current_shift", recordType: "all" } }) })));
});
