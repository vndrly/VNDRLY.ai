import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@/lib/meeting-types";

const mocks = vi.hoisted(() => ({ request: vi.fn(), primary: "#00adb5" }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: mocks.primary, name: "MidCon Solutions" }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, values?: Record<string, unknown>) => String(values?.defaultValue ?? _key) }) }));
import MeetingReplayWorkspace, { replayEventsAt } from "./meeting-replay-workspace";

const meeting = {
  userId: 1, canManage: true, canViewAttendance: true, transcription: false, myConsent: "accepted",
  meeting: { title: "Morning Operations", agenda: "", policyVersion: 1 },
  occurrence: { id: "meeting", status: "ended", startsAt: "2026-09-09T14:00:00Z", endsAt: "2026-09-09T15:00:00Z", startedAt: "2026-09-09T14:00:00Z", endedAt: "2026-09-09T14:01:00Z", askvInvitedAt: null },
  participants: [{ userId: 1, displayName: "Chad", role: "host", muted: true, present: true, speaking: false, removedAt: null }, { userId: 2, displayName: "Susie", role: "participant", muted: true, present: false, speaking: false, removedAt: null }],
  chat: [], transcript: [], attendance: [], activity: [], recap: null,
} as MeetingSnapshot;
const manifest = {
  schemaVersion: 2, rendererVersion: 1, status: "complete", complete: true,
  occurrence: { startedAt: "2026-09-09T14:00:00.000Z", durationMs: 60_000 }, audio: [], gaps: [],
  events: [
    { key: "one", type: "message", offsetMs: 0, endOffsetMs: null, payload: { displayName: "Bob", body: "Safety first" } },
    { key: "two", type: "askv_answer", offsetMs: 30_000, endOffsetMs: null, payload: { displayName: "V", body: "The target is one hour" } },
  ],
};

beforeEach(() => {
  mocks.request.mockReset().mockImplementation((path: string) => {
    if (path.endsWith("/replay")) return Promise.resolve(manifest);
    if (path.endsWith("/replay/assignments")) return Promise.resolve({ assignments: [] });
    if (path.endsWith("/replay/watch/session")) return Promise.resolve({ assignment: null, viewerSessionId: null });
    return Promise.resolve({});
  });
});

describe("timed meeting replay", () => {
  it("reveals shared meeting events only when the playhead reaches their original time", async () => {
    render(<MeetingReplayWorkspace occurrenceId="meeting" meeting={meeting} />);
    await screen.findByRole("region", { name: "Timed meeting replay" });
    expect(screen.getByText("Safety first")).toBeTruthy();
    expect(screen.queryByText("The target is one hour")).toBeNull();
    fireEvent.change(screen.getByRole("slider", { name: "Replay timeline" }), { target: { value: "30000" } });
    expect(screen.getByText("The target is one hour")).toBeTruthy();
  });

  it("offers required or optional catch-up assignment to the host", async () => {
    render(<MeetingReplayWorkspace occurrenceId="meeting" meeting={meeting} />);
    await screen.findByRole("region", { name: "Timed meeting replay" });
    fireEvent.click(screen.getByText("Assign catch-up"));
    fireEvent.change(screen.getByRole("combobox", { name: "Attendee" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/replay/assignments", expect.objectContaining({ method: "POST", body: expect.stringContaining('"requirement":"required"') })));
  });

  it("filters transient activity even if malformed data reaches the renderer", () => {
    expect(replayEventsAt([{ key: "bad", type: "activity" as any, offsetMs: 0, endOffsetMs: null, payload: {} }, ...manifest.events] as any, 60_000).map((event) => event.key)).toEqual(["one", "two"]);
  });
});
