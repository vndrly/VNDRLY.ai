import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getToken: vi.fn(),
  createSound: vi.fn(),
  unload: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  position: vi.fn(),
  playbackUpdate: null as null | ((status: any) => void),
  shareReplay: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: env.apiFetch,
  getApiBase: () => "https://vndrly.example",
}));
vi.mock("@/lib/auth", () => ({
  getToken: env.getToken,
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/lib/meeting-files", () => ({ downloadAndShareMeetingReplayFile: env.shareReplay }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#0a7f52", name: "MidCon" }) }));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled, accessibilityLabel, testID }: any) => (
    <button aria-label={accessibilityLabel} data-testid={testID} disabled={disabled} onClick={onPress}>{children}</button>
  ),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, values?: any) => {
  const raw = values?.defaultValue ?? _key;
  return raw.replace?.(/\{\{(\w+)\}\}/g, (_match: string, name: string) => String(values?.[name] ?? "")) ?? raw;
} }) }));
vi.mock("expo-av", () => ({
  Audio: {
    Sound: {
      createAsync: env.createSound,
    },
  },
}));

import MeetingReplayWorkspace, { replayEventsAt } from "./meeting-replay-workspace";

const meeting = {
  canManage: true,
  participants: [
    { userId: 1, displayName: "Chad Host", role: "host", removedAt: null },
    { userId: 2, displayName: "Susie", role: "attendee", removedAt: null },
  ],
} as any;

const manifest = {
  schemaVersion: 2,
  rendererVersion: 1,
  status: "complete",
  complete: true,
  occurrence: { startedAt: "2026-09-10T10:00:00.000Z", durationMs: 30_000 },
  audio: [{ sequence: 0, startsAtMs: 0, endsAtMs: 30_000, downloadPath: "/api/work-hub/meetings/meeting-a/replay/audio/chunk-a" }],
  gaps: [],
  events: [
    { key: "first", type: "message", offsetMs: 0, endOffsetMs: null, payload: { displayName: "Susie", body: "Start update" } },
    { key: "file-event", type: "file", offsetMs: 0, endOffsetMs: null, payload: { displayName: "Susie", fileName: "receipt.pdf", contentType: "application/pdf", byteSize: 3, downloadPath: "/api/work-hub/meetings/meeting-a/replay/files/file-event" } },
    { key: "later", type: "transcript", offsetMs: 12_000, endOffsetMs: 13_000, payload: { displayName: "Bob", text: "Later update" } },
  ],
};

function installApi() {
  env.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/replay")) return manifest;
    if (path.endsWith("/replay/assignments") && !init?.method) return { assignments: [{ id: "assignment-a", assigneeUserId: 2, requirement: "required", dueAt: null, status: "in_progress", watchedMs: 5_000, lastPositionMs: 5_000, completedAt: null }] };
    if (path.endsWith("/replay/watch/session")) return { assignment: { id: "assignment-a", assigneeUserId: 2, requirement: "required", dueAt: null, status: "in_progress", watchedMs: 5_000, lastPositionMs: 5_000, completedAt: null }, viewerSessionId: "viewer-token" };
    if (path.endsWith("/replay/watch/progress")) return { assignment: { id: "assignment-a", assigneeUserId: 2, requirement: "required", dueAt: null, status: "in_progress", watchedMs: 10_000, lastPositionMs: 12_000, completedAt: null } };
    if (path.endsWith("/replay/assignments") && init?.method === "POST") return { assignment: { id: "assignment-a", assigneeUserId: 2, requirement: "required", dueAt: null, status: "not_started", watchedMs: 0, lastPositionMs: 0, completedAt: null } };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  env.apiFetch.mockReset();
  env.getToken.mockReset().mockResolvedValue("mobile-token");
  env.createSound.mockReset();
  env.unload.mockReset().mockResolvedValue(undefined);
  env.play.mockReset().mockResolvedValue(undefined);
  env.pause.mockReset().mockResolvedValue(undefined);
  env.position.mockReset().mockResolvedValue(undefined);
  env.shareReplay.mockReset().mockResolvedValue(undefined);
  env.playbackUpdate = null;
  env.createSound.mockImplementation(async (_source: unknown, _status: unknown, callback: (status: any) => void) => {
    env.playbackUpdate = callback;
    return { sound: { unloadAsync: env.unload, playAsync: env.play, pauseAsync: env.pause, setPositionAsync: env.position, setOnPlaybackStatusUpdate: (next: any) => { env.playbackUpdate = next; } } };
  });
  installApi();
});

afterEach(() => cleanup());

describe("mobile meeting replay", () => {
  it("reveals only shared events reached by the playhead", () => {
    expect(replayEventsAt(manifest.events as any, 0).map((event) => event.key)).toEqual(["first", "file-event"]);
    expect(replayEventsAt(manifest.events as any, 12_000).map((event) => event.key)).toEqual(["first", "file-event", "later"]);
  });

  it("resumes an assigned replay and streams protected audio with the current bearer token", async () => {
    render(<MeetingReplayWorkspace occurrenceId="meeting-a" meeting={meeting} />);
    await screen.findByText("Start update");
    expect(screen.queryByText("Later update")).toBeNull();
    expect(screen.getByText("Required · 17%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(env.createSound).toHaveBeenCalled());
    expect(env.createSound.mock.calls[0][0]).toEqual({
      uri: "https://vndrly.example/api/work-hub/meetings/meeting-a/replay/audio/chunk-a",
      headers: { authorization: "Bearer mobile-token", "x-replay-renderer-version": "1", "x-replay-schema-version": "2" },
    });
    expect(env.position).toHaveBeenCalledWith(5_000);

    act(() => env.playbackUpdate?.({ isLoaded: true, positionMillis: 12_000, didJustFinish: false }));
    expect(await screen.findByText("Later update")).toBeTruthy();
  });

  it("assigns required catch-up from the host controls", async () => {
    render(<MeetingReplayWorkspace occurrenceId="meeting-a" meeting={meeting} />);
    await screen.findByText("Assign catch-up");
    fireEvent.click(screen.getByRole("button", { name: "Select Susie" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(env.apiFetch).toHaveBeenCalledWith(
      "/api/work-hub/meetings/meeting-a/replay/assignments",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ assigneeUserId: 2, requirement: "required", dueAt: null }) }),
    ));
  });

  it("opens a shared replay file through the protected native sharing flow", async () => {
    render(<MeetingReplayWorkspace occurrenceId="meeting-a" meeting={meeting} />);
    await screen.findByText("receipt.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Open shared file" }));
    await waitFor(() => expect(env.shareReplay).toHaveBeenCalledWith(expect.objectContaining({
      occurrenceId: "meeting-a",
      replayEventId: "file-event",
      fileName: "receipt.pdf",
      contentType: "application/pdf",
      byteSize: 3,
    })));
  });
});
