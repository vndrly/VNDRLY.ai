import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { WorkHubCalendarResponseInputSchema } from "@workspace/api-zod";
import Panel from "./meeting-invitation-response";
const state = vi.hoisted(() => ({
  user: {
    userId: 7,
    role: "vendor",
    vendorId: 9,
    partnerId: null,
    activeMembershipId: 11,
  },
  request: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: state.request }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (p: any) => <button {...p} />,
}));
const id = "10000000-0000-4000-8000-000000000001",
  fp = "a".repeat(64);
const observation = () => ({
  snapshot: {
    occurrenceId: id,
    meetingId: "10000000-0000-4000-8000-000000000002",
    ownerType: "vendor",
    ownerId: 9,
    title: "Synthetic invitation",
    agenda: null,
    timezone: "UTC",
    createdById: 8,
    startsAt: "2026-10-08T12:00:00Z",
    endsAt: "2026-10-08T12:30:00Z",
    status: "scheduled",
    participantUserIds: [7, 8],
  },
  fingerprint: fp,
  actorUserId: 7,
  canManage: false,
  responses: [
    {
      userId: 7,
      response: "pending",
      recordedResponse: "pending",
      scheduleResponseVerified: false,
      recordedAt: null,
    },
  ],
  source: "saved_work_hub_participant_response",
  physicalAttendanceVerified: false,
  externalAttendeeAcceptanceVerified: false,
});
async function result(raw: string) {
  const input = WorkHubCalendarResponseInputSchema.parse(JSON.parse(raw));
  const hash = Buffer.from(
    await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ input, actorUserId: 7 })),
    ),
  ).toString("hex");
  return {
    receipt: {
      operationId: input.operationId,
      occurrenceId: id,
      actorUserId: 7,
      commandFingerprint: hash,
      scheduleFingerprint: fp,
      response: input.response,
      recordedAt: "2026-10-07T14:00:00Z",
      status: "response_recorded",
      physicalAttendanceVerified: false,
      recordingConsentGranted: false,
      externalAttendeeAcceptanceVerified: false,
    },
    replayed: false,
  };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  state.user = {
    userId: 7,
    role: "vendor",
    vendorId: 9,
    partnerId: null,
    activeMembershipId: 11,
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function review() {
  await screen.findByText("Review acceptance");
  fireEvent.click(screen.getByText("Review acceptance"));
  fireEvent.click(screen.getByText("Save my reviewed response"));
}
it("records only explicit own reviewed response after absent readback; no microphone or attendance claim", async () => {
  state.request.mockImplementation(async (path: string, init: any) =>
    path.endsWith("snapshot")
      ? observation()
      : path.endsWith("readback")
        ? { receipt: null, replayed: false }
        : result(init.body),
  );
  render(<Panel occurrenceId={id} />);
  await screen.findByText("Review acceptance");
  expect(state.request.mock.calls.every(([p]) => p.endsWith("snapshot"))).toBe(
    true,
  );
  await review();
  await screen.findByText(/Your response was recorded/);
  expect(
    state.request.mock.calls.filter(([p]) => p.endsWith("execute")),
  ).toHaveLength(1);
  expect(sessionStorage.length).toBe(0);
});
it("recovers a dropped response with exact original readback and no resend", async () => {
  let saved: any;
  state.request.mockImplementation(async (path: string, init: any) => {
    if (path.endsWith("snapshot")) return observation();
    if (path.endsWith("readback"))
      return saved ?? { receipt: null, replayed: false };
    saved = await result(init.body);
    throw Error("dropped");
  });
  render(<Panel occurrenceId={id} />);
  await review();
  fireEvent.click(await screen.findByText("Check saved response and retry"));
  await screen.findByText(/Your response was recorded/);
  expect(
    state.request.mock.calls.filter(([p]) => p.endsWith("execute")),
  ).toHaveLength(1);
  const writes = state.request.mock.calls.filter(
    ([p]) => !p.endsWith("snapshot"),
  );
  expect(writes[0][1].body).toBe(writes.at(-1)![1].body);
});
it("never executes after denied readback and retains exact reviewed request", async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith("snapshot")) return observation();
    throw Error("403");
  });
  render(<Panel occurrenceId={id} />);
  await review();
  await screen.findByText("Check saved response and retry");
  expect(sessionStorage.length).toBe(1);
  expect(state.request.mock.calls.some(([p]) => p.endsWith("execute"))).toBe(
    false,
  );
});
it("rejects changed schedule before first effect without rebasing review", async () => {
  let reads = 0;
  state.request.mockImplementation(async (path: string) =>
    path.endsWith("snapshot")
      ? { ...observation(), fingerprint: ++reads === 1 ? fp : "b".repeat(64) }
      : { receipt: null, replayed: false },
  );
  render(<Panel occurrenceId={id} />);
  await review();
  await screen.findByText("Check saved response and retry");
  expect(state.request.mock.calls.some(([p]) => p.endsWith("execute"))).toBe(
    false,
  );
  expect(
    JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage)[0])!).input
      .expectedFingerprint,
  ).toBe(fp);
  const originalOperation = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage)[0])!).input.operationId;
  fireEvent.click(screen.getByText("Review changed invitation as a new request"));
  fireEvent.click(screen.getByText("Review acceptance"));
  const newlyReviewed = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage)[0])!).input;
  expect(newlyReviewed.expectedFingerprint).toBe("b".repeat(64));
  expect(newlyReviewed.operationId).not.toBe(originalOperation);
  expect(state.request.mock.calls.some(([p]) => p.endsWith("execute"))).toBe(false);
});
it("refuses foreign participant decisions unless server marks current host authority", async () => {
  state.request.mockResolvedValue({
    ...observation(),
    responses: [
      ...observation().responses,
      {
        userId: 8,
        response: "accepted",
        recordedResponse: "accepted",
        scheduleResponseVerified: true,
        recordedAt: "2026-10-07T14:00:00Z",
      },
    ],
  });
  render(<Panel occurrenceId={id} />);
  await screen.findByText(/unavailable in this current account/);
  expect(screen.queryByText("Review acceptance")).toBeNull();
});
it("clears old account result and prevents execute when readback arrives after membership switch", async () => {
  let finish!: (x: any) => void;
  state.request.mockImplementation(async (path: string) =>
    path.endsWith("snapshot")
      ? observation()
      : new Promise((r) => (finish = r)),
  );
  const view = render(<Panel occurrenceId={id} />);
  await review();
  await waitFor(() => expect(finish).toBeTruthy());
  state.user = { ...state.user, activeMembershipId: 12 };
  state.request.mockResolvedValue({ ...observation(), actorUserId: 99 });
  view.rerender(<Panel occurrenceId={id} />);
  finish({ receipt: null, replayed: false });
  await screen.findByText(/unavailable in this current account/);
  expect(state.request.mock.calls.some(([p]) => p.endsWith("execute"))).toBe(
    false,
  );
});
it("renders exact host current-schedule decisions while legacy acceptance remains unknown", async () => {
  state.request.mockResolvedValue({
    ...observation(),
    canManage: true,
    responses: [
      {
        userId: 7,
        response: "unknown",
        recordedResponse: "accepted",
        scheduleResponseVerified: false,
        recordedAt: null,
      },
      {
        userId: 8,
        response: "accepted",
        recordedResponse: "accepted",
        scheduleResponseVerified: true,
        recordedAt: "2026-10-07T14:00:00Z",
      },
    ],
  });
  render(<Panel occurrenceId={id} />);
  await screen.findByText("Current participants' recorded responses");
  expect(screen.getByText(/#8 · Accepted/)).toBeTruthy();
  expect(screen.getByText(/Your recorded response · Unknown/)).toBeTruthy();
});
