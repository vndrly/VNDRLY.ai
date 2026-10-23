import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeWorkforce from "./NativeWorkforce";
const m = vi.hoisted(() => ({ api: vi.fn(), storage: new Map<string, string>(), current: true, generation: 1, user: { id: 6, vendorId: 11, role: "vendor", vendorRole: "office", activeMembershipId: 2, availableMemberships: [{ id: 2, orgType: "vendor", orgId: 11, role: "admin" }] } }));
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => m.api(...args) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: m.generation }), isAuthScopeCurrent: (scope: { generation: number }) => m.current && scope.generation === m.generation }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", primary: "blue", card: "white" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => m.storage.get(key) ?? null, setItem: async (key: string, value: string) => { m.storage.set(key, value); }, removeItem: async (key: string) => { m.storage.delete(key); } } }));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, randomUUID: () => "10000000-0000-4000-8000-000000000002", digestStringAsync: async (_: string, value: string) => (await import("node:crypto")).createHash("sha256").update(value).digest("hex") }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/components/WorkHubConversation", () => ({ default: () => null }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
const person = (id: number, onShift: boolean | null, onCall: string) => ({ userId: id, vendorPeopleId: id, name: `Worker ${id}`, onShift, onCall, shiftStartedAt: null, assignment: null, profileHref: null, canMessage: false });
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NativeWorkforce /></QueryClientProvider>); }
beforeEach(() => { m.current = true; m.generation = 1; m.storage.clear(); m.user.activeMembershipId = 2; m.api.mockReset(); m.api.mockImplementation(async (path: string) => {
  if (path === "/api/company-operations") return { vendorId: 11, categories: ["gate"] };
  if (path.endsWith("/roster")) return { owner: { type: "vendor", id: 11 }, scope: "company", observedAt: "2026-10-22T12:00:00Z", employees: [person(8, true, "active"), person(9, false, "inactive"), person(10, null, "unknown")], canManageOffers: true };
  if (path === "/api/work-hub/workforce/offers") return { offers: [] };
  if (path === "/api/implementation-a/workforce/coverage") return { coverage: [] };
  throw Error("unexpected request");
}); });
afterEach(cleanup);
it("keeps unknown shift and availability separate from confirmed unavailable staff", async () => {
  mount(); await screen.findByText("Workforce");
  fireEvent.click(screen.getByRole("button", { name: /On Shift Now/ }));
  await screen.findByText("Worker 8");
  expect(screen.queryByText("Worker 10")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Unknown.*1/ }));
  expect(screen.getByText("Worker 10")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^On Call/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Unavailable.*1/ }));
  expect(screen.getByText("Worker 9")).toBeTruthy();
  expect(screen.queryByText("Worker 10")).toBeNull();
});
it("reports an unavailable roster without presenting unknown records as zero", async () => {
  const implementation = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (path: string) => { if (path.endsWith("/roster")) throw Error("offline"); return implementation(path); });
  mount(); await screen.findByRole("button", { name: /On Shift Now.*Unavailable/ });
  expect(screen.queryByText("0 on shift")).toBeNull();
});
it("clears expanded employee records immediately when membership changes", async () => {
  const view = mount(); fireEvent.click(await screen.findByRole("button", { name: /On Shift Now/ }));
  await screen.findByText("Worker 8");
  m.user = { ...m.user, activeMembershipId: 3 };
  m.api.mockImplementation(() => new Promise(() => {}));
  view.rerender(<QueryClientProvider client={new QueryClient()}><NativeWorkforce /></QueryClientProvider>);
  await waitFor(() => expect(screen.queryByText("Worker 8")).toBeNull());
});
it("requires fresh company authorization after the same actor signs in again", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => <QueryClientProvider client={client}><NativeWorkforce /></QueryClientProvider>;
  const view = render(content());
  await screen.findByRole("button", { name: /On Shift Now.*1 on shift/ });
  m.generation = 2;
  m.api.mockImplementation(() => new Promise(() => {}));
  view.rerender(content());
  expect(screen.queryByRole("button", { name: /On Shift Now/ })).toBeNull();
});
it("does not navigate to a profile for a different worker or expose unauthorized messaging", async () => {
  const prior = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (path: string, init?: RequestInit) => {
    const result = await prior(path, init);
    if (path.endsWith("/roster")) return { ...result, employees: [{ ...person(8, true, "active"), profileHref: "/field-employees/99" }] };
    return result;
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /On Shift Now.*1 on shift/ }));
  fireEvent.click(screen.getByRole("button", { name: "Worker 8" }));
  expect(screen.queryByRole("button", { name: "Open employee profile" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Message employee" })).toBeNull();
});
it("keeps an uncertain offer and recovers its original receipt without assigning the employee", async () => {
  const shiftId = "10000000-0000-4000-8000-000000000001";
  const prior = m.api.getMockImplementation()!;
  const commands: Array<{ path: string; input: any }> = [];
  let recovered = false;
  m.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/implementation-a/workforce/coverage") return { coverage: [{ id: "gap", shiftId, shiftTitle: "Future shift", startsAt: "2030-01-01T12:00:00Z", requiredCount: 1, assignedCount: 0, state: "uncovered" }] };
    if (path.endsWith("staffing-candidates")) return { shiftId, shiftVersion: 2, siteId: 1, startsAt: "2030-01-01T12:00:00Z", endsAt: "2030-01-01T14:00:00Z", observedAt: "2026-10-22T12:00:00Z", qualificationConfiguration: "configured", coverage: null, assignmentMade: false, messageSent: false, limitations: [], truncated: false, candidates: [{ vendorPeopleId: 8, userId: 8, name: "Worker 8", requirements: [], qualificationState: "recorded_requirements_verified", availability: "recorded_available", eligibility: { allowed: true, code: "workforce.assignment_allowed", warnings: [], overrideRequired: false }, contact: { workHubUserId: 8, reachability: "unknown" }, sourceReference: "vendor_people:8" }] };
    if (path.includes("/operations/")) {
      if (!recovered) return { receipt: null };
      const saved = JSON.parse([...m.storage.values()][0]);
      return { receipt: { operationId: saved.input.operationId, actorUserId: 6, shiftId, offerId: "10000000-0000-4000-8000-000000000003", workerUserId: 8, status: "pending", previousVersion: 2, resultingVersion: 3, assignmentRecorded: false, commandFingerprint: saved.commandFingerprint, recordedAt: "2026-10-22T12:00:00Z" } };
    }
    if (path === `/api/work-hub/shifts/${shiftId}/offers`) {
      if (init?.method === "POST") { commands.push({ path, input: JSON.parse(String(init.body)) }); throw Error("response lost"); }
      return { shiftVersion: 2, offers: [] };
    }
    return prior(path, init);
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Coverage Gaps.*1 open/ }));
  fireEvent.click(screen.getByRole("button", { name: /Future shift/ }));
  const button = await screen.findByRole("button", { name: "Offer Shift" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText(/result could not be verified/);
  expect(m.storage.size).toBe(1);
  expect((screen.getByRole("button", { name: "Offer Shift" }) as HTMLButtonElement).disabled).toBe(true);
  recovered = true;
  fireEvent.click(screen.getByRole("button", { name: "Check saved offer request" }));
  await screen.findByText(/Awaiting the employee/);
  expect(commands).toEqual([{ path: `/api/work-hub/shifts/${shiftId}/offers`, input: { operationId: "10000000-0000-4000-8000-000000000002", expectedVersion: 2, workerUserId: 8 } }]);
  expect(m.storage.size).toBe(0);
});
