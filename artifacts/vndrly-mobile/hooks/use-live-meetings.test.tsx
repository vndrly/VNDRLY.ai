import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  generation: 1,
  user: { id: 7, vendorId: 12, activeMembershipId: 15 },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "10000000-0000-4000-8000-000000000003",
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => {} }),
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: any[]) => m.api(...a) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: m.generation }),
  isAuthScopeCurrent: (s: any) => s.generation === m.generation,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
import { useLiveMeetings } from "@/lib/use-live-meetings";
afterEach(() => {
  cleanup();
  m.api.mockReset();
  m.generation = 1;
});
it("retains exact retry identity and refuses a different admission decision", async () => {
  m.api.mockImplementation(async (_path: any, options: any) => {
    if (options?.method) throw Error("lost response");
    return { meetings: [] };
  });
  const { result } = renderHook(() =>
    useLiveMeetings("/api/work-hub/live-meetings"),
  );
  await waitFor(() => expect(result.current.data).toBeTruthy());
  await act(async () => {
    await result.current
      .send("/admission/9", { decision: "admit" }, 2)
      .catch(() => {});
  });
  const original = m.api.mock.calls.find((c) => c[1]?.method)![1].body;
  await act(async () => {
    await result.current
      .send("/admission/9", { decision: "decline" }, 3)
      .catch(() => {});
  });
  expect(m.api.mock.calls.filter((c) => c[1]?.method)).toHaveLength(1);
  await act(async () => {
    await result.current.retryOriginal().catch(() => {});
  });
  expect(m.api.mock.calls.filter((c) => c[1]?.method)[1][1].body).toBe(
    original,
  );
});
it("discards a delayed private read after the company context changes", async () => {
  let finish: any;
  m.api.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(() =>
    useLiveMeetings("/api/work-hub/live-meetings"),
  );
  m.generation = 2;
  m.user = { ...m.user, activeMembershipId: 16 };
  rerender();
  await act(async () => finish({ private: "old company" }));
  expect(result.current.data).toBeNull();
});
