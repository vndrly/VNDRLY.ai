import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import WorkHubCalls from "./WorkHubCalls";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  createSound: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  apiFetch: mocks.api,
  getApiBase: () => "https://vndrly.example",
}));
vi.mock("@/lib/auth", () => ({ getToken: async () => "private-test-token" }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "blue",
    text: "black",
    mutedForeground: "gray",
    border: "gray",
    destructive: "red",
  }),
}));
vi.mock("@/components/WorkHubAudioRoom", () => ({
  default: ({ occurrenceId }: any) => <div>Audio room {occurrenceId}</div>,
}));
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: mocks.upload,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: async () => ({ exists: true, size: 128 }),
  deleteAsync: async () => undefined,
}));
vi.mock("expo-av", () => ({
  Audio: {
    requestPermissionsAsync: async () => ({ status: "granted" }),
    setAudioModeAsync: async () => undefined,
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
    Recording: class {
      async prepareToRecordAsync() {}
      async startAsync() {}
      async stopAndUnloadAsync() {}
      getURI() {
        return "file:///private/voicemail.m4a";
      }
    },
    Sound: { createAsync: mocks.createSound },
  },
}));
const defaults = (path: string) =>
  path === "/api/work-hub/calls/settings"
    ? { available: true, speedDial: [] }
    : [];
describe("mobile internal Calls", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.upload.mockReset();
    mocks.createSound.mockReset();
  });
  it("does not expose the audio room before recipient acceptance", async () => {
    mocks.api.mockImplementation(async (path: string) =>
      path === "/api/work-hub/calls"
        ? [
            {
              id: "call1",
              occurrenceId: "room1",
              incoming: true,
              callerName: "Jordan",
              status: "ringing",
              createdAt: new Date().toISOString(),
            },
          ]
        : defaults(path),
    );
    render(<WorkHubCalls />);
    expect(await screen.findByText("Jordan is calling")).toBeTruthy();
    expect(screen.queryByText("Audio room room1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/work-hub/calls/call1/respond",
        expect.objectContaining({ body: JSON.stringify({ action: "accept" }) }),
      ),
    );
  });
  it("keeps playback credentials in headers, never the audio URL", async () => {
    mocks.api.mockImplementation(async (path: string) =>
      path === "/api/work-hub/voicemail"
        ? [
            {
              id: "mail1",
              senderName: "Jordan",
              createdAt: new Date().toISOString(),
              readAt: null,
              durationMs: 2000,
            },
          ]
        : defaults(path),
    );
    mocks.createSound.mockResolvedValue({
      sound: {
        playAsync: async () => undefined,
        unloadAsync: async () => undefined,
        setOnPlaybackStatusUpdate: () => undefined,
      },
    });
    render(<WorkHubCalls />);
    fireEvent.click(screen.getByText("voicemail"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Play voicemail" }),
    );
    await waitFor(() =>
      expect(mocks.createSound).toHaveBeenCalledWith({
        uri: "https://vndrly.example/api/work-hub/voicemail/mail1/audio",
        headers: {
          Authorization: "Bearer private-test-token",
          "x-vndrly-client": "ios",
        },
      }),
    );
  });
  it("records and uploads private voicemail as authenticated binary with retry identity", async () => {
    mocks.api.mockImplementation(async (path: string) =>
      path === "/api/work-hub/calls"
        ? [
            {
              id: "call2",
              occurrenceId: "room2",
              incoming: false,
              recipientName: "Jordan",
              status: "unavailable",
              createdAt: new Date().toISOString(),
            },
          ]
        : defaults(path),
    );
    mocks.upload.mockResolvedValue({ status: 201, body: "{}" });
    render(<WorkHubCalls />);
    fireEvent.click(await screen.findByText("Jordan · unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Leave voicemail" }));
    fireEvent.click(screen.getByRole("button", { name: "Record message" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop recording" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Send voicemail" }),
    );
    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith(
        "https://vndrly.example/api/work-hub/calls/call2/voicemail",
        "file:///private/voicemail.m4a",
        expect.objectContaining({
          httpMethod: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer private-test-token",
            "Content-Type": "audio/mp4",
            "x-operation-id": expect.any(String),
          }),
        }),
      ),
    );
    expect(await screen.findByText("Private voicemail sent.")).toBeTruthy();
  });
});
