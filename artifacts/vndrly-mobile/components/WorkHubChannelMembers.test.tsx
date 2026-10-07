import React from "react";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  generation: 1,
  user: { id: 2, vendorId: 7, activeMembershipId: 12 },
  stored: new Map<string, string>(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: env.generation }),
  isAuthScopeCurrent: (scope: any) => scope.generation === env.generation,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => env.stored.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      env.stored.set(k, v);
    },
    removeItem: async (k: string) => {
      env.stored.delete(k);
    },
  },
}));
import WorkHubChannelMembers from "./WorkHubChannelMembers";
const id = "11111111-1111-4111-8111-111111111111",
  member = {
    id: "22222222-2222-4222-8222-222222222222",
    userId: 9,
    email: "synthetic@example.invalid",
    displayName: "Synthetic",
    mode: "member",
  };
beforeEach(() => {
  cleanup();
  env.stored.clear();
  env.api.mockReset();
  env.generation = 1;
  env.user = { id: 2, vendorId: 7, activeMembershipId: 12 };
});
async function review() {
  fireEvent.click(screen.getByText("Participants"));
  await screen.findByText("Review participant");
  fireEvent.change(screen.getByLabelText("Existing VNDRLY account email"), {
    target: { value: "synthetic@example.invalid" },
  });
  fireEvent.click(screen.getByText("Review participant"));
  fireEvent.click(screen.getByText("Add reviewed participant"));
}
it("closed control makes no request and unavailable manage permission hides mutation", async () => {
  env.api.mockResolvedValue({ canManage: false });
  render(<WorkHubChannelMembers channelId={id} />);
  expect(env.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Participants"));
  await screen.findByText(
    "Participant management is unavailable for this channel.",
  );
  expect(screen.queryByText("Review participant")).toBeNull();
});
it("retains exact email after lost POST and restart then reconciles without another POST", async () => {
  env.api.mockImplementation(async (path, init) => {
    if (path.endsWith("/member-access")) return { canManage: true };
    if (init?.method === "POST") throw Error("dropped");
    return [];
  });
  const view = render(<WorkHubChannelMembers channelId={id} />);
  await review();
  await screen.findByText(/Result unresolved/);
  expect(env.stored.size).toBe(1);
  view.unmount();
  env.api.mockImplementation(async (path) =>
    path.endsWith("/member-access") ? { canManage: true } : [member],
  );
  render(<WorkHubChannelMembers channelId={id} />);
  fireEvent.click(screen.getByText("Participants"));
  fireEvent.click(await screen.findByText("Check the same participant"));
  await screen.findByText(/membership is currently recorded/);
  expect(
    env.api.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(env.stored.size).toBe(0);
});
it("account changes during fresh lookup fence the original mutation", async () => {
  env.api.mockResolvedValueOnce({ canManage: true });
  render(<WorkHubChannelMembers channelId={id} />);
  fireEvent.click(screen.getByText("Participants"));
  await screen.findByText("Review participant");
  fireEvent.change(screen.getByLabelText("Existing VNDRLY account email"), {
    target: { value: "synthetic@example.invalid" },
  });
  fireEvent.click(screen.getByText("Review participant"));
  env.api.mockImplementation(async () => {
    env.generation++;
    return { canManage: true };
  });
  fireEvent.click(screen.getByText("Add reviewed participant"));
  await waitFor(() => expect(env.api).toHaveBeenCalledTimes(2));
  expect(env.api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});
