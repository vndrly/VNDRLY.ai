import React from "react";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: m.fetch }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 7, vendorId: 9, activeMembershipId: 3 } }),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => true,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => {} }),
  },
}));
import { useFormCampaigns } from "@/lib/use-form-campaigns";
afterEach(() => {
  cleanup();
  m.fetch.mockReset();
});
it("loads a new instance immediately and never installs an old read into its page", async () => {
  let resolveA: (v: any) => void = () => {};
  m.fetch.mockImplementation((path: string) =>
    path.endsWith("/a")
      ? new Promise((r) => (resolveA = r))
      : Promise.resolve({ instanceId: "b", title: "B" }),
  );
  const h = renderHook(
    ({ id }) =>
      useFormCampaigns(
        `/instances/${id}`,
        (x) => x as { instanceId: string; title: string },
      ),
    { initialProps: { id: "a" } },
  );
  await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce());
  h.rerender({ id: "b" });
  await waitFor(() => expect(h.result.current.data?.instanceId).toBe("b"));
  await act(async () => resolveA({ instanceId: "a", title: "A" }));
  expect(h.result.current.data).toEqual({ instanceId: "b", title: "B" });
});
it("refuses a mismatched canonical instance", async () => {
  m.fetch.mockResolvedValue({ instanceId: "other" });
  const h = renderHook(() =>
    useFormCampaigns("/instances/requested", (x) => x),
  );
  await waitFor(() =>
    expect(h.result.current.error).toContain("does not match"),
  );
  expect(h.result.current.data).toBeNull();
});
