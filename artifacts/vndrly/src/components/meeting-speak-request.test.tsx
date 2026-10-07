import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  user: { userId: 9, role: "vendor", activeMembershipId: 3, vendorId: 4 },
  request: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/work-hub-client", () => ({
  workHubRequest: env.request,
  createWorkHubOperationId: () => "22222222-2222-4222-8222-222222222222",
}));
import MeetingSpeakRequest from "./meeting-speak-request";
const occurrenceId = "11111111-1111-4111-8111-111111111111",
  receipt = {
    occurrenceId,
    operationId: "22222222-2222-4222-8222-222222222222",
    actorUserId: 9,
    actorMembershipId: 3,
    actorSessionVersion: 1,
    ownerOrgType: "vendor",
    ownerOrgId: 4,
    requestId: "33333333-3333-4333-8333-333333333333",
    requestedAt: "2026-10-07T10:00:00Z",
    status: "saved",
    microphoneOpened: false,
    consentAccepted: false,
  };
beforeEach(() => {
  env.user = { userId: 9, role: "vendor", activeMembershipId: 3, vendorId: 4 };
  env.request.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("retains the original operation after loss and denied lookup; recovers without another POST", async () => {
  const onSaved = vi.fn();
  env.request
    .mockResolvedValueOnce({ receipt: null })
    .mockRejectedValueOnce(Error("lost"));
  const view = render(
    <MeetingSpeakRequest
      occurrenceId={occurrenceId}
      pending={false} canRequest={true}
      onSaved={onSaved}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(sessionStorage.length).toBe(1);
  view.rerender(
    <MeetingSpeakRequest
      occurrenceId={occurrenceId}
      pending={true} canRequest={false}
      onSaved={onSaved}
    />,
  );
  env.request.mockRejectedValueOnce(Error("403"));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("403"),
  );
  expect(sessionStorage.length).toBe(1);
  env.request.mockResolvedValueOnce({ receipt });
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(env.request.mock.calls.map((c) => c[1].method)).toEqual([
    "GET",
    "POST",
    "GET",
    "GET",
  ]);
  expect(sessionStorage.length).toBe(0);
});
it("fences a late old-account lookup before it can POST or mark the new account saved", async () => {
  let resolve!: (value: unknown) => void;
  env.request.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const onSaved = vi.fn(),
    view = render(
      <MeetingSpeakRequest
        occurrenceId={occurrenceId}
        pending={false} canRequest={true}
        onSaved={onSaved}
      />,
    );
  fireEvent.click(screen.getByRole("button"));
  env.user = { ...env.user, userId: 10, activeMembershipId: 5 };
  view.rerender(
    <MeetingSpeakRequest
      occurrenceId={occurrenceId}
      pending={false} canRequest={true}
      onSaved={onSaved}
    />,
  );
  await act(async () => {
    resolve({ receipt: null });
  });
  expect(env.request).toHaveBeenCalledTimes(1);
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("button").textContent).toBe(
    "meetingWorkspace.requestToSpeak",
  );
});
it("storage failure prevents sending; saved receipt survives refresh failure", async () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("storage unavailable");
  });
  const view = render(
    <MeetingSpeakRequest
      occurrenceId={occurrenceId}
      pending={false} canRequest={true}
      onSaved={() => {
        throw Error("refresh");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(env.request).not.toHaveBeenCalled();
  spy.mockRestore();
  env.request.mockResolvedValueOnce({ receipt });
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  expect(env.request).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
  view.unmount();
});
it("mute release during lookup keeps original recovery visible and prevents a new effect", async () => {
  let resolve!: (value: unknown) => void;
  env.request.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const onSaved = vi.fn(), view = render(<MeetingSpeakRequest occurrenceId={occurrenceId} pending={false} canRequest={true} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button"));
  view.rerender(<MeetingSpeakRequest occurrenceId={occurrenceId} pending={false} canRequest={false} onSaved={onSaved} />);
  await act(async () => { resolve({ receipt: null }); });
  expect(env.request).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(1);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  env.request.mockResolvedValueOnce({ receipt });
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(env.request.mock.calls.every(c => c[1].method === "GET")).toBe(true);
});
