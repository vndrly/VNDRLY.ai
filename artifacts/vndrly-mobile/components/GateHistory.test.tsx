import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const env = vi.hoisted(() => ({ api: vi.fn(), raw: vi.fn(), changeOver: vi.fn(), share: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, apiFetchRaw: env.raw }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: env.changeOver }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black", mutedForeground: "gray", background: "white", card: "white", border: "gray", destructive: "red", primary: "blue" }) }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/BrandTitleRow", () => ({ default: ({ title, subtitle }: any) => <><h1>{title}</h1><p>{subtitle}</p></> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" }, writeAsStringAsync: env.write }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: env.share }));
import GateHistory from "./GateHistory";

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateHistory /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  env.changeOver.mockImplementation(async (path: string) => path === "/sites" ? { sites: [{ id: 7, name: "Big Cs Deep" }] } : { stations: [{ id: "station-1", name: "Main gate" }] });
  env.api.mockImplementation(async (path: string) => path.includes("/recipients") ? { recipients: [{ userId: 1, name: "Me" }, { userId: 2, name: "Supervisor" }] } : path.includes("/query") ? { rows: [{ id: 9, name: "Bob Villa", vehiclePlate: "ABC123" }] } : { deliveries: [] });
  env.raw.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(2) });
});

it("defaults to Current Shift and drives the visible report with type and range filters", async () => {
  mount(); expect(await screen.findByText("Bob Villa")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.type.check_ins" }));
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.range.7d" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"range":"7d"') })));
  expect(env.api).toHaveBeenCalledWith("/api/gate-report/query", expect.objectContaining({ body: expect.stringContaining('"recordType":"check_ins"') }));
});

it("exports the selected view and emails only selected authorized recipients", async () => {
  mount(); await screen.findByText("Bob Villa");
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  await waitFor(() => expect(env.share).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Supervisor" }));
  fireEvent.click(screen.getByRole("button", { name: "gateHistory.email" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith("/api/gate-report/deliver", expect.objectContaining({ body: expect.stringContaining('"recipientUserIds":[1,2]') })));
});
