import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@/lib/meeting-types";

const mocks = vi.hoisted(() => ({ request: vi.fn(), primary: "#00adb5" }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: mocks.primary, name: "MidCon Solutions" }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, values?: Record<string, unknown>) => String(values?.defaultValue ?? _key) }) }));
import MeetingReplayWorkspace, { replayEventsAt, type ReplayManifest } from "./meeting-replay-workspace";

const meeting = {
  userId: 1, canManage: true, canViewAttendance: true, transcription: false, myConsent: "accepted",
  meeting: { title: "Morning Operations", agenda: "", policyVersion: 1 },
  occurrence: { id: "meeting", status: "ended", startsAt: "2026-09-09T14:00:00Z", endsAt: "2026-09-09T15:00:00Z", startedAt: "2026-09-09T14:00:00Z", endedAt: "2026-09-09T14:01:00Z", askvInvitedAt: null },
  participants: [{ userId: 1, displayName: "Chad", role: "host", muted: true, present: true, speaking: false, removedAt: null }, { userId: 2, displayName: "Susie", role: "participant", muted: true, present: false, speaking: false, removedAt: null }],
  chat: [], transcript: [], attendance: [], activity: [], recap: null,
} as MeetingSnapshot;
const manifest: ReplayManifest = {
  schemaVersion: 2, rendererVersion: 1, status: "complete", complete: true,
  occurrence: { startedAt: "2026-09-09T14:00:00.000Z", durationMs: 60_000 }, audio: [], gaps: [],
  events: [
    { key: "one", type: "message", offsetMs: 0, endOffsetMs: null, payload: { displayName: "Bob", body: "Safety first" } },
    { key: "two", type: "askv_answer", offsetMs: 30_000, endOffsetMs: null, payload: { displayName: "V", body: "The target is one hour" } },
  ],
};
let currentManifest = manifest;

beforeEach(() => {
  currentManifest = manifest;
  mocks.request.mockReset().mockImplementation((path: string) => {
    if (path.endsWith("/replay")) return Promise.resolve(currentManifest);
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

  it("pauses the active audio element when replay is paused", async () => {
    currentManifest = {
      ...manifest,
      audio: [{ sequence: 1, startsAtMs: 0, endsAtMs: 60_000, downloadPath: "/api/replay/audio/1" }],
    };
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { container } = render(<MeetingReplayWorkspace occurrenceId="meeting" meeting={meeting} />);
    await screen.findByRole("region", { name: "Timed meeting replay" });
    const audio = container.querySelector("audio")!;
    fireEvent.loadedMetadata(audio);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pause).toHaveBeenCalled());
    play.mockRestore();
    pause.mockRestore();
  });

  it("moves active audio when the timeline seeks within the same chunk", async () => {
    currentManifest = {
      ...manifest,
      audio: [{ sequence: 1, startsAtMs: 0, endsAtMs: 60_000, downloadPath: "/api/replay/audio/1" }],
    };
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { container } = render(<MeetingReplayWorkspace occurrenceId="meeting" meeting={meeting} />);
    await screen.findByRole("region", { name: "Timed meeting replay" });
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 0 });
    fireEvent.loadedMetadata(audio);
    fireEvent.change(screen.getByRole("slider", { name: "Replay timeline" }), { target: { value: "30000" } });
    await waitFor(() => expect(audio.currentTime).toBe(30));
    expect(pause).toHaveBeenCalled();
    pause.mockRestore();
  });

  it("ignores a stale play rejection after a newer playback attempt succeeds", async () => {
    currentManifest = {
      ...manifest,
      audio: [{ sequence: 1, startsAtMs: 0, endsAtMs: 60_000, downloadPath: "/api/replay/audio/1" }],
    };
    let rejectFirst!: (reason?: unknown) => void;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<MeetingReplayWorkspace occurrenceId="meeting" meeting={meeting} />);
    await screen.findByRole("region", { name: "Timed meeting replay" });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    rejectFirst(new DOMException("The play request was interrupted", "AbortError"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    play.mockRestore();
    pause.mockRestore();
  });
});
