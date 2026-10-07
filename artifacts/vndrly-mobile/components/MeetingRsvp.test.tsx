import React from "react";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MeetingRsvp from "./MeetingRsvp";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  user: { id: 7, vendorId: 11, activeMembershipId: 2 },
  current: true,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => m.api(...args),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => 1,
  isAuthScopeCurrent: () => m.current,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ foreground: "#fff", destructive: "red" }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "10000000-0000-4000-8000-000000000001",
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async () => "b".repeat(64),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
const id = "10000000-0000-4000-8000-000000000002";
const observation = {
  snapshot: {
    occurrenceId: id,
    meetingId: "10000000-0000-4000-8000-000000000003",
    ownerType: "vendor",
    ownerId: 11,
    title: "Saved meeting",
    agenda: null,
    timezone: "America/Chicago",
    createdById: 7,
    startsAt: "2026-10-08T15:00:00Z",
    endsAt: null,
    status: "scheduled",
    participantUserIds: [7, 8],
  },
  fingerprint: "a".repeat(64),
  actorUserId: 7,
  canManage: false,
  responses: [
    {
      userId: 7,
      response: "unknown",
      recordedResponse: "accepted",
      scheduleResponseVerified: false,
      recordedAt: null,
    },
  ],
  source: "saved_work_hub_participant_response",
  physicalAttendanceVerified: false,
  externalAttendeeAcceptanceVerified: false,
};
beforeEach(() => {
  cleanup();
  m.api.mockReset();
  m.current = true;
});
describe("native RSVP detail", () => {
  it("shows own unknown legacy response without attendance claim or host list", async () => {
    m.api.mockResolvedValue(observation);
    render(<MeetingRsvp occurrenceId={id} />);
    await screen.findByText("Not verified for the current schedule");
    expect(screen.getByText(/Saved meeting.*America\/Chicago/)).toBeTruthy();
    expect(screen.queryByText("Participant responses")).toBeNull();
    expect(screen.getByText(/RSVP does not verify attendance/)).toBeTruthy();
  });
  it("keeps uncertain intent locked and recovers before resend", async () => {
    m.api
      .mockResolvedValueOnce(observation)
      .mockRejectedValueOnce(Error("network"))
      .mockRejectedValueOnce({ status: 403 });
    render(<MeetingRsvp occurrenceId={id} />);
    fireEvent.click(await screen.findByText("Accept invitation"));
    await screen.findByText("Check original response");
    fireEvent.click(screen.getByText("Check original response"));
    await waitFor(() => expect(m.api).toHaveBeenCalledTimes(3));
    expect(m.api.mock.calls[2][0]).toContain("/readback");
    expect(
      screen.getByText("Decline invitation").getAttribute("disabled"),
    ).not.toBeNull();
  });
  it("rejects cross-company snapshot before controls", async () => {
    m.api.mockResolvedValue({
      ...observation,
      snapshot: { ...observation.snapshot, ownerId: 12 },
    });
    render(<MeetingRsvp occurrenceId={id} />);
    await screen.findByText("Response unavailable. Refresh to review.");
    expect(screen.queryByText("Accept invitation")).toBeNull();
  });
  it("shows verified responses only for canonical host authority", async () => {
    m.api.mockResolvedValue({
      ...observation,
      canManage: true,
      responses: [
        {
          userId: 8,
          response: "accepted",
          recordedResponse: "accepted",
          scheduleResponseVerified: true,
          recordedAt: "2026-10-07T15:00:00Z",
        },
      ],
    });
    render(<MeetingRsvp occurrenceId={id} />);
    await screen.findByText("Participant responses");
    expect(
      screen.getByText("8: Accepted for the current schedule"),
    ).toBeTruthy();
  });
  it("discards a late snapshot after account invalidation", async () => {
    let resolve!: (v: unknown) => void;
    m.api.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<MeetingRsvp occurrenceId={id} />);
    m.current = false;
    resolve(observation);
    await waitFor(() => expect(m.api).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Accept invitation")).toBeNull();
  });
});
