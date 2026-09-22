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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  api.mockImplementation(async (path: string) =>
    path === "/sites"
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
afterEach(cleanup);
function mount(history = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
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
    expect(label.parentElement?.className).toContain("border-[color:var(--brand-primary)]");
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
    (screen.getByRole("button", { name: "changeOver.switchUser" }) as HTMLButtonElement).disabled,
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
