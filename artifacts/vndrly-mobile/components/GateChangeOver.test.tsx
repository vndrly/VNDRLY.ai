import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  accept: vi.fn(),
  replace: vi.fn(),
  params: {} as { siteId?: string; stationId?: string },
}));
vi.mock("@/lib/change-over-api", () => ({
  changeOverRequest: env.api,
  acceptChangeOverSession: env.accept,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "black",
    background: "white",
    card: "white",
    border: "gray",
    mutedForeground: "gray",
    destructive: "red",
  }),
}));
vi.mock("@/components/ScreenSafeArea", () => ({
  default: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-router", () => ({
  router: { replace: env.replace },
  useLocalSearchParams: () => env.params,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "operation-id" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
import GateChangeOver from "./GateChangeOver";
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
  vi.clearAllMocks();
  env.api.mockImplementation(async (path: string) =>
    path === "/sites"
      ? { sites: [{ id: 1, name: "Site" }] }
      : path.startsWith("/stations")
        ? { stations: [{ id: "gate", name: "Main gate" }] }
        : path.endsWith("/state")
          ? state()
          : path.endsWith("/authenticate")
            ? { proof: "signed", incoming: { id: 2, displayName: "Incoming" } }
            : {},
  );
});
afterEach(cleanup);
it("updates a mounted notes tab to the gate selected by a new transfer", async () => {
  env.params = { siteId: "1", stationId: "old-gate" };
  const base = env.api.getMockImplementation()!;
  env.api.mockImplementation((path, body) =>
    path.includes("/notes?")
      ? Promise.resolve({ rows: [], actions: [] })
      : base(path, body),
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = () => (
    <QueryClientProvider client={cache}>
      <GateChangeOver history />
    </QueryClientProvider>
  );
  const mounted = render(view());
  await waitFor(() =>
    expect(
      env.api.mock.calls.some(([path]) => path.startsWith("/old-gate/notes?")),
    ).toBe(true),
  );
  env.params = { siteId: "2", stationId: "new-gate" };
  mounted.rerender(view());
  await waitFor(() =>
    expect(
      env.api.mock.calls.some(([path]) => path.startsWith("/new-gate/notes?")),
    ).toBe(true),
  );
  env.params = {};
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <GateChangeOver />
    </QueryClientProvider>,
  );
  return cache;
}
async function authenticate() {
  fireEvent.change(await screen.findByLabelText("changeOver.username"), {
    target: { value: "incoming" },
  });
  fireEvent.change(screen.getByLabelText("changeOver.password"), {
    target: { value: "secret" },
  });
  fireEvent.click(screen.getByText("changeOver.authenticate"));
}
it("does not replace the active native session during incoming authentication", async () => {
  mount();
  await authenticate();
  await screen.findByText("changeOver.incoming: Incoming");
  expect(env.accept).not.toHaveBeenCalled();
  expect(env.replace).not.toHaveBeenCalled();
  expect(screen.queryByText("changeOver.switchUser")).toBeNull();
  expect(screen.queryByLabelText("changeOver.password")).toBeNull();
});
it("preserves cached shift facts on network failure but removes authentication and requires refresh", async () => {
  const cache = mount();
  await authenticate();
  await screen.findByText("changeOver.incoming: Incoming");
  const base = env.api.getMockImplementation()!;
  env.api.mockImplementation((path, body) =>
    path.endsWith("/state")
      ? Promise.reject(
          Object.assign(new Error("Offline"), { code: "network.unreachable" }),
        )
      : base(path, body),
  );
  await cache.invalidateQueries({ queryKey: ["change-over-state"] });
  await waitFor(() =>
    expect(screen.queryByText("changeOver.incoming: Incoming")).toBeNull(),
  );
  expect(screen.getByText("changeOver.checkIns: 2")).not.toBeNull();
  expect(screen.getByText(/changeOver.offline/)).not.toBeNull();
  expect(env.accept).not.toHaveBeenCalled();
  env.api.mockImplementation(base);
  fireEvent.click(screen.getByText("changeOver.refresh"));
  await waitFor(() =>
    expect(screen.queryByText(/changeOver.offline/)).toBeNull(),
  );
  expect(screen.queryByText("changeOver.switchUser")).toBeNull();
});
