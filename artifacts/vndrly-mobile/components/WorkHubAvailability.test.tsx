import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: {
    id: 2,
    role: "field_employee",
    vendorId: 7,
    vendorPeopleId: 22,
    activeMembershipId: 12,
  },
  request: vi.fn(),
  current: true,
  invalidate: () => {},
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/api", () => ({ apiFetch: async () => snapshot }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => "scope",
  isAuthScopeCurrent: () => state.current,
  subscribeUser: (callback: () => void) => {
    state.invalidate = callback;
    return () => {};
  },
  subscribeToken: () => () => {},
  getUser: async () => state.user,
}));
const stored = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => stored.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      stored.set(k, v);
    },
    removeItem: async (k: string) => {
      stored.delete(k);
    },
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async () => "a".repeat(64),
}));
vi.mock("@workspace/api-zod", async () => {
  const actual = await vi.importActual<any>("@workspace/api-zod");
  return {
    ...actual,
    submitWorkHubAvailabilityAttempt: (...args: any[]) =>
      state.request(...args),
  };
});
import WorkHubAvailability from "./WorkHubAvailability";
const snapshot = {
  userId: 2,
  companyId: 7,
  actorMembershipId: 12,
  actorSessionVersion: 3,
  fingerprint: "a".repeat(64),
  records: [],
  canManage: true,
  physicalReadinessVerified: false,
};
const response = { ok: true, json: async () => snapshot };
beforeEach(() => {
  cleanup();
  stored.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  state.request.mockReset();
  state.current = true;
});
async function review() {
  await screen.findByText("New interval");
  fireEvent.change(
    screen.getByLabelText("Start local time: YYYY-MM-DDTHH:mm"),
    { target: { value: "2026-10-10T10:00" } },
  );
  fireEvent.change(screen.getByLabelText("End local time: YYYY-MM-DDTHH:mm"), {
    target: { value: "2026-10-10T11:00" },
  });
  fireEvent.click(screen.getByText("Review availability"));
  await screen.findByText("Save reviewed interval");
}
it("retains exact reviewed request on denial and retries it after restart", async () => {
  state.request
    .mockRejectedValueOnce(Error("dropped"))
    .mockRejectedValueOnce(Error("403"))
    .mockResolvedValueOnce({});
  let view = render(<WorkHubAvailability />);
  await review();
  fireEvent.click(screen.getByText("Save reviewed interval"));
  await screen.findByText(/Result unresolved/);
  const original = state.request.mock.calls[0][0];
  fireEvent.click(screen.getByText("Check the same request"));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  expect(state.request.mock.calls[1][0]).toEqual(original);
  view.unmount();
  view = render(<WorkHubAvailability />);
  fireEvent.click(await screen.findByText("Check the same request"));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
  expect(state.request.mock.calls[2][0]).toEqual(original);
  await screen.findByText("Availability saved.");
});
it("blocks a new intent when the retained journal is corrupt", async () => {
  stored.set(
    "vndrly-own-availability:" +
      JSON.stringify([2, 7, 12, "field_employee", 22]),
    "{bad",
  );
  render(<WorkHubAvailability />);
  await screen.findByText("Availability could not be loaded.");
  expect(screen.queryByText("Review availability")).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});

it("same-account session refresh restores the retained request without a new intent", async () => {
  state.request
    .mockRejectedValueOnce(Error("dropped"))
    .mockResolvedValueOnce({});
  render(<WorkHubAvailability />);
  await review();
  fireEvent.click(screen.getByText("Save reviewed interval"));
  await screen.findByText(/Result unresolved/);
  const original = state.request.mock.calls[0][0];
  state.current = false;
  state.invalidate();
  state.current = true;
  fireEvent.click(screen.getByText("Refresh"));
  await screen.findByText("New interval");
  fireEvent.click(screen.getByText("Check the same request"));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  expect(state.request.mock.calls[1][0]).toEqual(original);
});
