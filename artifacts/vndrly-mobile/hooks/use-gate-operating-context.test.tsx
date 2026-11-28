import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: read }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
vi.mock("@/lib/work-hub-queue-native", () => ({
  getNativeWorkHubQueueStore: async () => ({
    getItem: async (key: string) => rows.get(key) ?? null,
    setItem: async (key: string, value: string) => { rows.set(key, value); },
  }),
}));
vi.mock("@/lib/gate-selection", () => ({ useGateSelection: () => ({ selection: { siteId: 42, stationId: "g-main" }, save: vi.fn() }) }));
vi.mock("./use-auth", () => ({
  useAuth: () => ({ user: { id: 7, vendorId: 3, activeMembershipId: 12, availableMemberships: [{ id: 12, orgType: "vendor", orgId: 3 }] }, activeMembershipId: 12 }),
}));

import { useGateOperatingContext } from "./use-gate-operating-context";

const GATE = { siteId: 42, stationId: "g-main", siteName: "Acme HQ", gateName: "Main Gate" };
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderHook(() => useGateOperatingContext(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
};

beforeEach(() => { rows.clear(); read.mockReset(); });

it("keeps operating the last known gate when there is no connection", async () => {
  read.mockResolvedValueOnce({ operatingGate: GATE, reason: null });
  const online = mount();
  await waitFor(() => expect(online.result.current.canOperate(42, "g-main")).toBe(true));
  online.unmount();

  read.mockRejectedValue(Object.assign(new Error("Network request failed"), { code: "network.unreachable" }));
  const offline = mount();
  await waitFor(() => expect(offline.result.current.canOperate(42, "g-main")).toBe(true));
  expect(offline.result.current.canOperate(42, "g-other")).toBe(false);
});

it("does not operate a gate the server refuses, whatever was saved", async () => {
  read.mockResolvedValueOnce({ operatingGate: GATE, reason: null });
  const online = mount();
  await waitFor(() => expect(online.result.current.canOperate(42, "g-main")).toBe(true));
  online.unmount();

  read.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  const refused = mount();
  await waitFor(() => expect(refused.result.current.isError).toBe(true));
  expect(refused.result.current.canOperate(42, "g-main")).toBe(false);
});
