import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ api: vi.fn(), id: 9 }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { userId: m.id, role: "vendor", vendorId: 4, activeMembershipId: 5 },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/lib/work-hub-client", () => ({
  workHubRequest: (...a: unknown[]) => m.api(...a),
  createWorkHubOperationId: () => "22222222-2222-4222-8222-222222222222",
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
import MeetingAssistantInvitation from "./meeting-assistant-invitation";
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
  sessionStorage.clear();
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
  fireEvent.click(screen.getByText("Invite V"));
  expect(m.api).not.toHaveBeenCalled();
  m.api.mockResolvedValueOnce({ receipt: null }).mockResolvedValueOnce(receipt);
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
  fireEvent.click(screen.getByText("Invite V"));
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await screen.findByText("Check original invitation");
  m.api.mockRejectedValueOnce(Object.assign(Error("denied"), { status: 403 }));
  fireEvent.click(screen.getByText("Check original invitation"));
  await waitFor(() => expect(m.api).toHaveBeenCalledTimes(3));
  expect(sessionStorage.length).toBe(1);
  view.unmount();
  m.api.mockResolvedValueOnce({ receipt });
  render(<MeetingAssistantInvitation {...props} />);
  fireEvent.click(screen.getByText("Check original invitation"));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(m.api.mock.calls.filter(([, i]) => i.method === "POST")).toHaveLength(
    1,
  );
});
it("fences late account response and storage failure before POST", async () => {
  let finish!: (v: unknown) => void;
  m.api.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const saved = vi.fn(),
    props = {
      occurrenceId: id,
      version: 0,
      canManage: true,
      invited: false,
      onSaved: saved,
    };
  const view = render(<MeetingAssistantInvitation {...props} />);
  fireEvent.click(screen.getByText("Invite V"));
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await waitFor(() => expect(m.api).toHaveBeenCalledOnce());
  m.id = 10;
  view.rerender(<MeetingAssistantInvitation {...props} />);
  finish({ receipt: null });
  await new Promise((r) => setTimeout(r, 0));
  expect(m.api).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw Error("storage");
    });
  fireEvent.click(screen.getByText("Invite V"));
  fireEvent.click(screen.getByText("Save reviewed invitation"));
  await screen.findByText(/Result unresolved/);
  expect(m.api).toHaveBeenCalledOnce();
  storage.mockRestore();
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
    ),
  );
});
