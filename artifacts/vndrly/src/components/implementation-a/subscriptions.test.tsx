import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import type { EmployeeSubscription } from "@workspace/api-zod";
import { Subscriptions } from "./subscriptions";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, vendorId: 22, activeMembershipId: 3 } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("./surface", () => ({ ImplementationSurface: ({ children }: any) => <section>{children}</section> }));
vi.mock("@/components/image-pill", () => ({ default: ({ children }: any) => <span>{children}</span> }));
let rows: EmployeeSubscription[], canManage: boolean;
const fetcher = vi.fn();
beforeEach(() => {
  rows = []; canManage = true;
  fetcher.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const { operationId, ...fields } = JSON.parse(String(init.body));
      rows.push({ ...fields, id: operationId, version: 1, employeeName: "John", companyName: "Company", workerUserId: 7 });
      return { ok: true, json: async () => ({ subscription: rows[0] }) };
    }
    return { ok: true, json: async () => ({ canManage, companyName: "Company", employees: [{ key: "person:5", userId: 7, name: "John", email: "john@example.invalid" }], subscriptions: rows }) };
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><Subscriptions /></QueryClientProvider>); }
it("creates an actual named subscription and employee assignment with the entered annual cost", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Add subscription" }));
  fireEvent.change(screen.getByLabelText("Subscription name"), { target: { value: "Popular Mechanics" } });
  fireEvent.change(screen.getByLabelText("Assigned employee"), { target: { value: "person:5" } });
  fireEvent.change(screen.getByLabelText("Cost per billing period"), { target: { value: "19.00" } });
  fireEvent.change(screen.getByLabelText("Billing period"), { target: { value: "year" } });
  fireEvent.change(screen.getByLabelText("Work purpose / notes"), { target: { value: "Workshop reference" } });
  fireEvent.click(screen.getByRole("button", { name: "Save subscription" }));
  await screen.findByText("Subscription saved.");
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe("/api/implementation-a/subscriptions");
  expect(JSON.parse(String(writes[0][1].body))).toMatchObject({ name: "Popular Mechanics", employeeKey: "person:5", amountCents: 1900, billingInterval: "year", purpose: "Workshop reference" });
  expect(JSON.parse(String(writes[0][1].body))).not.toHaveProperty("plan");
  await screen.findByText("Popular Mechanics");
});
it("uses server employee-management authority and leaves non-managers read-only", async () => {
  canManage = false; mount(); await screen.findByText("No subscriptions yet.");
  expect(screen.queryByRole("button", { name: "Add subscription" })).toBeNull();
});
it("filters the cost total by category and preserves the annual billing period", async () => {
  rows = [
    { id: "a", name: "Mailbox", employeeKey: "person:5", employeeName: "John", amountCents: 12000, currency: "USD", billingInterval: "year", category: "Email", purpose: "", status: "active" },
    { id: "b", name: "Magazine", employeeKey: "person:5", employeeName: "John", amountCents: 1900, currency: "USD", billingInterval: "year", category: "Reference", purpose: "", status: "active" },
  ] as EmployeeSubscription[];
  mount(); await screen.findByText("Mailbox");
  fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Email" } });
  expect(screen.queryByText("Magazine")).toBeNull();
  expect(screen.getByLabelText("Filtered cost totals").textContent).toContain("$10.00");
  expect(screen.getByText("$120.00 USD / year")).toBeTruthy();
});
it("does not save when cost precision would silently round the amount", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Add subscription" }));
  fireEvent.change(screen.getByLabelText("Subscription name"), { target: { value: "Mail" } });
  fireEvent.change(screen.getByLabelText("Assigned employee"), { target: { value: "person:5" } });
  fireEvent.change(screen.getByLabelText("Cost per billing period"), { target: { value: "19.999" } });
  fireEvent.click(screen.getByRole("button", { name: "Save subscription" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("two decimal"));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});
