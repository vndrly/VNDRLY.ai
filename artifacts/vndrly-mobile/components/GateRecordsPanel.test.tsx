import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: auth.generation }) }));
vi.mock("@expo/vector-icons", () => ({ Feather: ({ name }: any) => <span data-testid={`icon-${name}`} /> }));
vi.mock("@/lib/api", () => ({ apiFetch: api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 9 }, activeMembershipId: 7 }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black", mutedForeground: "gray", primary: "blue", border: "gray" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled, testID }: any) => <button data-testid={testID} disabled={disabled} onClick={onPress}>{children}</button> }));
import GateRecordsPanel from "./GateRecordsPanel";
beforeEach(() => { auth.generation = 1; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("aborts an unfinished incoming-run read when the selected site changes", async () => {
  let signal: AbortSignal | undefined;
  api.mockImplementation((_path, options) => { signal = options?.signal; return new Promise(() => {}); });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const panel = (siteId: number) => <QueryClientProvider client={client}><GateRecordsPanel key={siteId} siteId={siteId} active={[]} recent={[]} loading={false} busy={false} onRefresh={() => {}} onAdmit={() => {}} onCheckout={() => {}} /></QueryClientProvider>;
  const view = render(panel(42));
  fireEvent.click(screen.getByTestId("gate-tab-arrivals"));
  await waitFor(() => expect(api).toHaveBeenCalled());
  expect(signal).toBeDefined();
  view.rerender(panel(43));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByTestId("gate-tab-onsite").getAttribute("aria-selected")).toBe("true");
});

it("refreshes the open canonical record and its explicit linked runs", async () => {
  let revision = 0;
  api.mockImplementation(async (path: string) => {
    if (path === "/api/visits/88") return { id: 88, siteLocationId: 42, firstName: revision ? "Updated" : "Original", lastName: "Visitor", checkInTime: "2026-10-22T10:00:00Z", checkOutTime: null };
    if (path.startsWith("/api/gate-arrivals/visit/88?")) return { runs: revision ? [{ id: "link-1", runId: "run-1", title: "Updated linked run", ticketNumber: "100" }] : [] };
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><GateRecordsPanel siteId={42} active={[{ id: 88, siteLocationId: 42, firstName: "Original", lastName: "Visitor", checkInTime: "2026-10-22T10:00:00Z" } as any]} recent={[]} loading={false} busy={false} onRefresh={() => {}} onAdmit={() => {}} onCheckout={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByTestId("gate-visit-88"));
  await screen.findByText("gatekeeper.recordDetails");
  revision = 1;
  fireEvent.click(screen.getByTestId("gate-record-refresh"));
  expect(await screen.findByText("Updated Visitor")).toBeTruthy();
  expect(await screen.findByTestId("gate-linked-run-run-1")).toBeTruthy();
});

it("offers an accessible icon refresh without a visible text pill", () => {
  render(<QueryClientProvider client={new QueryClient()}><GateRecordsPanel siteId={42} active={[]} recent={[]} loading={false} busy={false} onRefresh={() => {}} onAdmit={() => {}} onCheckout={() => {}} /></QueryClientProvider>);
  const refresh = screen.getByRole("button", { name: "common.refresh" });
  expect(refresh.textContent).toBe("");
  expect(screen.getByTestId("icon-refresh-cw")).toBeTruthy();
});
it("clears open details and starts a fresh list scope after same-user sign-in replacement", async () => {
  api.mockImplementation(async (path: string) => path === "/api/visits/88" ? { id: 88, siteLocationId: 42, firstName: "Prior", lastName: "Context", checkInTime: "2026-10-22T10:00:00Z" } : { runs: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = () => <QueryClientProvider client={client}><GateRecordsPanel siteId={42} active={[{ id: 88, siteLocationId: 42, firstName: "Prior", lastName: "Context", checkInTime: "2026-10-22T10:00:00Z" } as any]} recent={[]} loading={false} busy={false} onRefresh={() => {}} onAdmit={() => {}} onCheckout={() => {}} /></QueryClientProvider>;
  const view = render(app()); fireEvent.click(screen.getByTestId("gate-visit-88"));
  await screen.findByText("gatekeeper.recordDetails");
  auth.generation = 2; view.rerender(app());
  expect(screen.queryByText("gatekeeper.recordDetails")).toBeNull();
  api.mockImplementation((path: string) => path === "/api/visits/88" ? new Promise(() => {}) : Promise.resolve({ runs: [] }));
  fireEvent.click(screen.getByTestId("gate-visit-88"));
  expect(screen.queryByText("Prior Context")).toBeNull();
  expect(screen.getByRole("progressbar")).toBeTruthy();
});
