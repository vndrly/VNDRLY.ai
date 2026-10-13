import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Platform } from "react-native";

const env = vi.hoisted(() => ({ api: vi.fn(), raw: vi.fn(), changeOver: vi.fn(), share: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, apiFetchRaw: env.raw }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: env.changeOver }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black", mutedForeground: "gray", background: "white", card: "white", border: "gray", destructive: "red", primary: "blue" }) }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/BrandTitleRow", () => ({ default: ({ title, subtitle }: any) => <><h1>{title}</h1><p>{subtitle}</p></> }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: ({ inline }: any) => <div data-inline={String(Boolean(inline))}>AskV voice</div> }));
vi.mock("@/components/SphereBackButton", () => ({ default: ({ onPress }: any) => <button onClick={onPress}>Back</button> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, color, disabled, onPress, solid, style, testID }: any) => <button data-testid={testID} data-color={color} data-solid={String(Boolean(solid))} disabled={disabled} onClick={onPress} style={style}>{children}</button> }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), canGoBack: () => true, replace: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" }, writeAsStringAsync: env.write }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: env.share }));
import GateHistory from "./GateHistory";

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateHistory /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
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
