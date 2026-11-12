import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  clearGateSelections,
  readGateSelection,
  saveGateSelection,
} from "@/lib/gate-selection";
const fixture = vi.hoisted(() => ({
  user: { userId: 7, activeMembershipId: 1 },
  request: vi.fn(),
}));
vi.mock("./use-auth", () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock("@/lib/change-over-api", () => ({
  changeOverRequest: fixture.request,
}));
import { useGateOperatingContext } from "./use-gate-operating-context";
afterEach(() => {
  cleanup();
  clearGateSelections();
  vi.resetAllMocks();
});
it("defaults to the saved watch, preserves browsing, and returns explicitly to My gate", async () => {
  fixture.request.mockResolvedValue({
    operatingGate: {
      siteId: 2,
      stationId: "gate-a",
      siteName: "Site",
      gateName: "A",
    },
    reason: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useGateOperatingContext(), { wrapper });
  await waitFor(() =>
    expect(readGateSelection(fixture.user)?.stationId).toBe("gate-a"),
  );
  act(() => saveGateSelection(fixture.user, 2, "gate-b"));
  expect(hook.result.current.canOperate(2, "gate-b")).toBe(false);
  await act(async () => {
    await hook.result.current.refetch();
  });
  expect(readGateSelection(fixture.user)?.stationId).toBe("gate-b");
  act(() => hook.result.current.myGate());
  expect(readGateSelection(fixture.user)?.stationId).toBe("gate-a");
  expect(hook.result.current.canOperate(2, "gate-a")).toBe(true);
  hook.unmount();
  client.clear();
});
it("does not give recording authority when operating context fails", async () => {
  fixture.request.mockRejectedValue(new Error("offline"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useGateOperatingContext(), { wrapper });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.canOperate(2, "gate-a")).toBe(false);
  client.clear();
});
