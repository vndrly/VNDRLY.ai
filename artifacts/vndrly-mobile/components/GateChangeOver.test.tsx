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
  default: ({ askVInactiveStyle, children, disabled, inactive, onPress }: any) => (
    <button data-askv-inactive-style={askVInactiveStyle ? "true" : "false"} data-inactive={inactive ? "true" : "false"} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/GateDutyCard", () => ({ default: () => <div>gate-duty-card</div> }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: () => <div>askv-voice-indicator</div> }));
vi.mock("@/components/BrandTitleRow", () => ({ default: () => <div>company-portal-header</div> }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), apiFetchRaw: vi.fn() }));
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
it("keeps eligible sites compact until the operator opens the selector", async () => {
  const base = env.api.getMockImplementation()!;
  env.api.mockImplementation((path, body) =>
    path === "/sites"
      ? Promise.resolve({ sites: [{ id: 1, name: "Current site" }, { id: 2, name: "Scheduled site" }] })
      : base(path, body),
  );
  mount();
  expect(await screen.findByRole("button", { name: "Current site" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Scheduled site" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Current site" }));
  expect(screen.getByRole("button", { name: "Scheduled site" })).not.toBeNull();
});
it("uses the static gray pill for the requested dashboard actions", async () => {
  mount();

  for (const label of ["changeOver.refresh", "changeOver.resolvedItems", "changeOver.addItem", "changeOver.refreshHandoff"]) {
    const action = await screen.findByRole("button", { name: label });
    expect(action.getAttribute("data-inactive")).toBe("true");
    expect(action.getAttribute("data-askv-inactive-style")).toBe("true");
  }
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
it("separates active carry-forward work from resolved history and can reopen an item", async () => {
  const base = env.api.getMockImplementation()!;
  let item = { id: "truck", text: "Identify driver for OK ABC123", status: "open" };
  env.api.mockImplementation(async (path, body) => {
    if (path.endsWith("/state")) return { ...state(), items: [item] };
    if (path.endsWith("/items")) {
      const action = body as { kind: string; text: string };
      if (action.kind === "resolve") item = { ...item, text: `${item.text}\nResolution: ${action.text}`, status: "resolved" };
      if (action.kind === "reopen") item = { ...item, text: `${item.text}\nReopened: ${action.text}`, status: "open" };
      return {};
    }
    return base(path, body);
  });
  mount();
  expect(await screen.findByText("changeOver.shiftFollowUps")).not.toBeNull();
  expect(screen.getByRole("button", { name: "changeOver.openItems" })).not.toBeNull();
  expect(await screen.findByText(/Identify driver for OK ABC123/)).not.toBeNull();
  expect(screen.getByText("changeOver.markResolved").closest("button")?.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("changeOver.resolutionNote"), {
    target: { value: "Driver is Jack Smith, Grady Farms" },
  });
  fireEvent.click(screen.getByText("changeOver.markResolved"));
  await waitFor(() => expect(screen.queryByText(/Identify driver for OK ABC123/)).toBeNull());
  fireEvent.click(screen.getByText("changeOver.resolvedItems"));
  expect(screen.getByText(/Driver is Jack Smith, Grady Farms/)).not.toBeNull();
  fireEvent.change(screen.getByLabelText("changeOver.reopenNote"), {
    target: { value: "Needs rechecking" },
  });
  fireEvent.click(screen.getByText("changeOver.reopen"));
  await waitFor(() => expect(screen.queryByText(/Driver is Jack Smith, Grady Farms/)).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "changeOver.openItems" }));
  expect(await screen.findByText(/Identify driver for OK ABC123/)).not.toBeNull();
});
