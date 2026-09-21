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
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: api }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1 } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/components/brand-pill-button", () => ({
  default: ({ children, onClick, disabled, type }: any) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
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
  api.mockImplementation(async (path: string) =>
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
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <GateChangeOverPage />
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
it("authenticates separately and only reveals Switch User after acknowledgment", async () => {
  mount();
  await authenticate();
  await screen.findByText("Incoming");
  expect(screen.queryByText("changeOver.switchUser")).toBeNull();
  expect(screen.queryByLabelText("changeOver.password")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    (screen.getByText("changeOver.switchUser") as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(api.mock.calls.some(([path]) => path.endsWith("/transfer"))).toBe(
    false,
  );
});
it("keeps the outgoing page after failed incoming credentials and clears password", async () => {
  const base = api.getMockImplementation()!;
  api.mockImplementation((path, body) =>
    path.endsWith("/authenticate")
      ? Promise.reject(new Error("Invalid credentials"))
      : base(path, body),
  );
  mount();
  await authenticate();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Invalid credentials",
  );
  expect(
    (screen.getByLabelText("changeOver.password") as HTMLInputElement).value,
  ).toBe("");
  expect(screen.queryByText("changeOver.switchUser")).toBeNull();
});
it("invalidates authenticated review when fresh activity arrives", async () => {
  const cache = mount();
  await authenticate();
  await screen.findByText("Incoming");
  fireEvent.click(screen.getByRole("checkbox"));
  cache.setQueryData(["change-over-state", 1, "gate"], {
    ...state(),
    stale: true,
    snapshot: { ...snapshot, revision: "b" },
  });
  await waitFor(() =>
    expect(screen.queryByText("changeOver.switchUser")).toBeNull(),
  );
  expect(screen.getByText("changeOver.stale")).not.toBeNull();
});
it("clears incoming review on loss of connectivity", async () => {
  mount();
  await authenticate();
  await screen.findByText("Incoming");
  fireEvent.click(screen.getByRole("checkbox"));
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  fireEvent(window, new Event("offline"));
  await screen.findByText("changeOver.offline");
  expect(screen.queryByText("changeOver.switchUser")).toBeNull();
});
