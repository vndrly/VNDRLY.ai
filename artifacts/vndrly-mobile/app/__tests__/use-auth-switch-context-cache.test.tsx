import path from "node:path";
import Module from "node:module";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #188 — switching organizations rotates the bearer token, so any
// React Query cache populated under the previous active membership now
// points at the wrong org. Until each query refetches on its own
// schedule, the user can briefly see the previous org's tickets, jobs,
// hotlist, etc. under the new org's header. The fix is for `useAuth`'s
// `switchContext` to drop the React Query cache as part of the same
// click so visible screens immediately refetch with the rotated token.
//
// This test renders a tiny consumer that records the cached query data
// across a `switchContext` call and asserts the cache is empty after
// the switch (the screens then refetch via their own observers).

const ASSETS_ROOT = path.resolve(__dirname, "..", "..");
const _Module = Module as unknown as {
  _resolveFilename: (
    request: string,
    parent: NodeModule,
    ...rest: unknown[]
  ) => string;
};
const origResolve = _Module._resolveFilename.bind(_Module);
_Module._resolveFilename = (request, parent, ...rest) => {
  if (request.startsWith("@/")) {
    return path.join(ASSETS_ROOT, request.slice(2));
  }
  return origResolve(request, parent, ...rest);
};

const { apiSwitchContextMock, refreshAuthMeMock, getUserMock } = vi.hoisted(
  () => ({
    apiSwitchContextMock: vi.fn(),
    refreshAuthMeMock: vi.fn(),
    getUserMock: vi.fn(),
  }),
);

vi.mock("@/lib/api", () => ({
  switchContext: apiSwitchContextMock,
  refreshAuthMe: refreshAuthMeMock,
}));

vi.mock("@/lib/auth", () => ({
  getUser: getUserMock,
  isTokenCacheReady: () => true,
  subscribeToken: () => () => undefined,
  subscribeUser: () => () => undefined,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

const VENDOR_USER = {
  id: 1,
  username: "vendor@example.com",
  role: "vendor_admin",
  activeMembershipId: 1,
  availableMemberships: [
    { id: 1, orgType: "vendor", orgName: "Acme Vendor" },
    { id: 2, orgType: "partner", orgName: "Globex Partner" },
  ],
};
const PARTNER_USER = {
  ...VENDOR_USER,
  role: "partner_admin",
  activeMembershipId: 2,
};

beforeEach(() => {
  apiSwitchContextMock.mockReset();
  refreshAuthMeMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue(VENDOR_USER);
  refreshAuthMeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Pre-seed cache entries that imitate what the open-tickets, hotlist,
  // dashboard summary, and ticket detail screens would have populated
  // for the previous active membership.
  queryClient.setQueryData(["tickets", "open"], [{ id: 11, status: "open" }]);
  queryClient.setQueryData(["hotlist"], [{ id: 22 }]);
  queryClient.setQueryData(["dashboard", "summary"], { count: 7 });
  queryClient.setQueryData(["ticket", 99], { id: 99, title: "stale" });

  let captured: ReturnType<typeof useAuth> | null = null;
  function Capture() {
    captured = useAuth();
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Capture />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    queryClient,
    getCaptured: () => {
      if (!captured) throw new Error("auth context not captured");
      return captured;
    },
  };
}

describe("useAuth().switchContext (Task #188)", () => {
  it("clears the React Query cache after a successful organization switch", async () => {
    apiSwitchContextMock.mockResolvedValue(PARTNER_USER);
    const { queryClient, getCaptured } = setup();

    // Wait a microtask so the AuthProvider's hydration effect runs and
    // captures the user, exposing `switchContext` to the consumer.
    await act(async () => {
      await Promise.resolve();
    });

    // Sanity: the previous-org data is in the cache before the switch.
    expect(queryClient.getQueryData(["tickets", "open"])).toEqual([
      { id: 11, status: "open" },
    ]);
    expect(queryClient.getQueryData(["hotlist"])).toEqual([{ id: 22 }]);
    expect(queryClient.getQueryData(["dashboard", "summary"])).toEqual({
      count: 7,
    });
    expect(queryClient.getQueryData(["ticket", 99])).toEqual({
      id: 99,
      title: "stale",
    });

    await act(async () => {
      await getCaptured().switchContext(2);
    });

    expect(apiSwitchContextMock).toHaveBeenCalledWith(2);

    // After the switch, the cache should be empty so that mounted
    // observers refetch with the rotated bearer token instead of
    // displaying the previous org's data under the new org's header.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getQueryData(["tickets", "open"])).toBeUndefined();
    expect(queryClient.getQueryData(["hotlist"])).toBeUndefined();
    expect(queryClient.getQueryData(["dashboard", "summary"])).toBeUndefined();
    expect(queryClient.getQueryData(["ticket", 99])).toBeUndefined();
  });

  it("does not clear the cache when the API switch call fails", async () => {
    apiSwitchContextMock.mockRejectedValue(new Error("network down"));
    const { queryClient, getCaptured } = setup();

    await act(async () => {
      await Promise.resolve();
    });

    await expect(
      act(async () => {
        await getCaptured().switchContext(2);
      }),
    ).rejects.toThrow("network down");

    // The bearer token never rotated, so the previously-cached data is
    // still correct — keep it instead of forcing every screen to show
    // a loading state for nothing.
    expect(queryClient.getQueryData(["tickets", "open"])).toEqual([
      { id: 11, status: "open" },
    ]);
    expect(queryClient.getQueryData(["dashboard", "summary"])).toEqual({
      count: 7,
    });
  });
});
