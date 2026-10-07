import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  id: 9,
  current: true,
  stored: new Map<string, string>(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: m.id, role: "vendor", vendorId: 4, activeMembershipId: 5 },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => m.api(...a) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "22222222-2222-4222-8222-222222222222",
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => m.stored.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    m.stored.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    m.stored.delete(k);
  },
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
import MeetingAssistantInvitation from "./MeetingAssistantInvitation";
const id = "11111111-1111-4111-8111-111111111111",
  receipt = {
    operationId: "22222222-2222-4222-8222-222222222222",
    expectedVersion: 0,
    invited: true,
    occurrenceId: id,
    actorUserId: 9,
    actorMembershipId: 5,
    actorSessionVersion: 1,
    ownerOrgType: "vendor",
    ownerOrgId: 4,
    fingerprint: "a".repeat(64),
    version: 1,
    status: "applied",
    changed: true,
    recordedAt: "2026-10-07T10:00:00Z",
    consentAccepted: false,
    deviceCaptureStarted: false,
  };
beforeEach(() => {
  cleanup();
  m.stored.clear();
  m.current = true;
  m.api.mockReset();
  m.id = 9;
});
it("requires explicit host-only canonical capability and review; saved refresh failure remains saved", async () => {
  const refresh = vi.fn().mockRejectedValue(Error("refresh"));
  const view = render(
    <MeetingAssistantInvitation
      occurrenceId={id}
      version={0}
      canManage={false}
      invited={false}
      onSaved={refresh}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(m.api).not.toHaveBeenCalled();
  view.rerender(
    <MeetingAssistantInvitation
      occurrenceId={id}
      version={0}
      canManage
      invited={false}
      onSaved={refresh}
    />,
  );
  await waitFor(() =>
    expect((screen.getByText("Invite V") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  await waitFor(() =>
    expect((screen.getByText("Invite V") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByText("Invite V"));
  expect(m.api).not.toHaveBeenCalled();
  m.api.mockResolvedValueOnce({ receipt: null }).mockResolvedValueOnce(receipt);
  await waitFor(() =>
    expect(
      (screen.getByText("Save reviewed invitation") as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await screen.findByText("Saved. Refresh the meeting to continue.");
  expect(screen.queryByRole("button")).toBeNull();
  expect(m.api).toHaveBeenCalledTimes(2);
});
it("retains exact unknown body across denied receipt lookup and restart", async () => {
  m.api
    .mockResolvedValueOnce({ receipt: null })
    .mockRejectedValueOnce(Error("dropped"));
  const props = {
    occurrenceId: id,
    version: 0,
    canManage: true,
    invited: false,
    onSaved: vi.fn(),
  };
  const view = render(<MeetingAssistantInvitation {...props} />);
  await waitFor(() =>
    expect((screen.getByText("Invite V") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByText("Invite V"));
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await screen.findByText("Check original invitation");
  m.api.mockRejectedValueOnce(Object.assign(Error("denied"), { status: 403 }));
  fireEvent.click(screen.getByText("Check original invitation"));
  await waitFor(() => expect(m.api).toHaveBeenCalledTimes(3));
  expect(m.stored.size).toBe(1);
  view.unmount();
  m.api.mockResolvedValueOnce({ receipt });
  render(<MeetingAssistantInvitation {...props} />);
  fireEvent.click(await screen.findByText("Check original invitation"));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(m.api.mock.calls.filter(([, i]) => i.method === "POST")).toHaveLength(
    1,
  );
});
it("late auth invalidation cannot send after receipt lookup", async () => {
  let finish!: (v: unknown) => void;
  m.api.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const saved = vi.fn();
  render(
    <MeetingAssistantInvitation
      occurrenceId={id}
      version={0}
      canManage
      invited={false}
      onSaved={saved}
    />,
  );
  await waitFor(() =>
    expect((screen.getByText("Invite V") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  await waitFor(() =>
    expect((screen.getByText("Invite V") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByText("Invite V"));
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await waitFor(() => expect(m.api).toHaveBeenCalledOnce());
  m.current = false;
  finish({ receipt: null });
  await new Promise((r) => setTimeout(r, 0));
  expect(m.api).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
});
it("preserves the reviewed desired invitation and revision across a newer snapshot", async () => {
  m.api.mockImplementation(async (_path, init) =>
    init.method === "GET" ? { receipt: null } : receipt,
  );
  const view = render(
    <MeetingAssistantInvitation
      occurrenceId={id}
      version={0}
      canManage
      invited={false}
      onSaved={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByText("Invite V"));
  view.rerender(
    <MeetingAssistantInvitation
      occurrenceId={id}
      version={1}
      canManage
      invited
      onSaved={() => undefined}
    />,
  );
  expect(screen.getByText(/Invite V.*Revision 0/)).toBeTruthy();
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await waitFor(() =>
    expect(m.api).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: receipt.operationId,
          expectedVersion: 0,
          invited: true,
        }),
      }),
      expect.any(Object),
    ),
  );
});
