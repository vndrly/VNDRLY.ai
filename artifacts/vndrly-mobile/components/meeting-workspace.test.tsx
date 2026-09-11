import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@workspace/api-client-react/meeting-workspace";

const env = vi.hoisted(() => ({
  state: {} as any,
  push: vi.fn(),
  moduleData: { meetings: [] as any[] },
  scrollToEnd: vi.fn(),
  imageProps: [] as any[],
  getToken: vi.fn(),
  spanish: false,
  accessibilityFocus: vi.fn(),
  announce: vi.fn(),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const ReactModule = await import("react");
  const ScrollView = ReactModule.forwardRef<any, any>(
    (
      {
        accessibilityLabel,
        accessibilityLiveRegion,
        children,
        onContentSizeChange,
        onScroll,
        ...props
      },
      ref,
    ) => {
      ReactModule.useImperativeHandle(ref, () => ({
        scrollToEnd: env.scrollToEnd,
      }));
      return ReactModule.createElement(
        "div",
        {
          "aria-label": accessibilityLabel,
          "aria-live": accessibilityLiveRegion,
          onDoubleClick: () => onContentSizeChange?.(900, 900),
          onScroll: (event: any) =>
            onScroll?.({
              nativeEvent: {
                contentOffset: {
                  x: event.currentTarget.scrollLeft,
                  y: event.currentTarget.scrollTop,
                },
                contentSize: {
                  width: event.currentTarget.scrollWidth,
                  height: event.currentTarget.scrollHeight,
                },
                layoutMeasurement: {
                  width: event.currentTarget.clientWidth,
                  height: event.currentTarget.clientHeight,
                },
              },
            }),
          style: props.style,
        },
        children,
      );
    },
  );
  return {
    ...actual,
    ScrollView,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: env.accessibilityFocus,
      announceForAccessibility: env.announce,
    },
    findNodeHandle: (node: any) =>
      ({
        "meeting-roster-trigger": 101,
        "meeting-roster-person-2": 102,
        "meeting-composer-input": 103,
      })[node?.getAttribute?.("data-testid") as string] ?? null,
  };
});

vi.mock("@/lib/use-meeting-workspace", () => ({
  useMeetingWorkspace: () => env.state,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#111",
    card: "#222",
    text: "#fff",
    mutedForeground: "#aaa",
    border: "#555",
    primary: "#00adb5",
    primaryForeground: "#fff",
    destructive: "#ef4444",
  }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#00adb5", name: "MidCon" }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 1, activeMembershipId: 10 } }),
}));
vi.mock("@/lib/auth", () => ({ getToken: env.getToken }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => env.moduleData),
  getApiBase: () => "https://vndrly.example",
}));
vi.mock("@/lib/meeting-files", () => ({
  downloadAndShareMeetingReplayFile: vi.fn(),
}));
vi.mock("expo-av", () => ({ Audio: { Sound: { createAsync: vi.fn() } } }));
vi.mock("expo-image", () => ({
  Image: ({ source, testID, accessibilityLabel, ...props }: any) => {
    env.imageProps.push({ source, testID, accessibilityLabel, ...props });
    return (
      <img
        src={source?.uri}
        data-testid={testID}
        aria-label={accessibilityLabel}
        {...props}
      />
    );
  },
}));
vi.mock("@/components/WorkHubAudioRoom", () => ({
  default: ({ occurrenceId }: { occurrenceId: string }) => (
    <div data-testid={`audio-${occurrenceId}`}>audio</div>
  ),
}));
vi.mock("@/components/WorkHubCalls", () => ({ default: () => null }));
vi.mock("@/components/WorkHubConversation", () => ({ default: () => null }));
vi.mock("@/components/ScreenSafeArea", () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("expo-router", () => ({
  Stack: Object.assign(({ children }: any) => <>{children}</>, {
    Screen: () => null,
  }),
  useLocalSearchParams: () => ({ module: "meetings" }),
  router: { push: env.push },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) => {
      const labels: Record<string, string> = {
        "meetingWorkspace.opening": "Opening meeting…",
        "meetingWorkspace.transcriptionUnavailable":
          "Transcription unavailable on this device.",
        "meetingWorkspace.privateMessage": env.spanish
          ? "Mensaje privado"
          : "Private Message",
        "meetingWorkspace.noOneSpeaking": env.spanish
          ? "Nadie está hablando"
          : "No one speaking",
        "meetingWorkspace.presentCount": env.spanish
          ? "{{count}} presentes"
          : "{{count}} present",
        "meetingWorkspace.elapsed": env.spanish ? "Transcurrido" : "Elapsed",
        "meetingWorkspace.target": env.spanish ? "Objetivo" : "Target",
        "meetingWorkspace.meetingTools": env.spanish
          ? "Herramientas de reunión"
          : "Meeting Tools",
        "meetingWorkspace.send": env.spanish ? "Enviar" : "Send",
        "meetingWorkspace.messageMeeting": env.spanish
          ? "Mensaje para la reunión"
          : "Message the meeting",
        "meetingWorkspace.liveTranscript": "Live transcript",
        "meetingWorkspace.jumpLatest": "Jump to latest",
        "meetingWorkspace.tools.summary": "Summary",
        "meetingWorkspace.tools.actionItems": "Action Items",
        "meetingWorkspace.tools.decisions": "Decisions",
        "meetingWorkspace.tools.search": "Search",
        "meetingWorkspace.tools.agenda": "Agenda",
        "meetingWorkspace.tools.attendance": "Attendance",
        "meetingWorkspace.search": "Search meeting",
        "meetingWorkspace.manageAttendees": "Manage Attendees",
        "meetingWorkspace.endMeeting": "End meeting",
        "meetingWorkspace.cancel": "Cancel",
        "meetingWorkspace.confirmRemove": "Remove {{name}}",
        "meetingWorkspace.addFile": "Add File",
        "meetingWorkspace.camera": "Camera",
        "meetingWorkspace.photoLibrary": "Photo Library",
        "meetingWorkspace.files": "Files",
        "meetingWorkspace.openFile": "Open {{name}}",
        "meetingWorkspace.retryFile": "Retry file",
        "meetingWorkspace.confirmEnd": "End meeting for everyone",
        "meetingWorkspace.openMeeting": env.spanish
          ? "Abrir reunión"
          : "Open meeting",
        "meetingWorkspace.openMeetingLabel": env.spanish
          ? "Abrir {{name}}"
          : "Open {{name}}",
      };
      const raw = labels[key] ?? values?.defaultValue ?? values?.name ?? key;
      return raw.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
        String(values?.[name] ?? ""),
      );
    },
  }),
}));

import MeetingWorkspace from "./meeting-workspace";
import WorkHubModuleScreen from "../app/work-hub/[module]";

function snapshot(overrides: Partial<MeetingSnapshot> = {}): MeetingSnapshot {
  return {
    userId: 1,
    canManage: false,
    canViewAttendance: true,
    transcription: true,
    myConsent: "accepted",
    meeting: {
      title: "Daily operations",
      agenda: "Safety first",
      policyVersion: 1,
    },
    occurrence: {
      id: "meeting-a",
      status: "live",
      startsAt: "2026-09-09T14:00:00.000Z",
      endsAt: "2026-09-09T15:00:00.000Z",
      startedAt: "2026-09-09T14:00:00.000Z",
      endedAt: null,
      askvInvitedAt: "2026-09-09T14:01:00.000Z",
    },
    participants: [
      {
        userId: 1,
        displayName: "Alex Owner",
        photoUrl: null,
        role: "host",
        muted: false,
        present: true,
        speaking: false,
        removedAt: null,
      },
      {
        userId: 2,
        displayName: "Bob Brand",
        photoUrl: null,
        role: "attendee",
        muted: false,
        present: true,
        speaking: true,
        removedAt: null,
      },
      {
        userId: 3,
        displayName: "Casey",
        photoUrl: "https://example.test/casey.jpg",
        role: "attendee",
        muted: true,
        present: false,
        speaking: false,
        removedAt: null,
      },
    ],
    chat: [
      {
        id: "own",
        userId: 1,
        displayName: "Alex Owner",
        recipientUserId: null,
        body: "Owner update",
        messageType: "typed",
        createdAt: "2026-09-09T14:02:00.000Z",
      },
      {
        id: "other",
        userId: 2,
        displayName: "Bob Brand",
        recipientUserId: null,
        body: "Shared update",
        messageType: "typed",
        createdAt: "2026-09-09T14:03:00.000Z",
      },
      {
        id: "private-mine",
        userId: 2,
        displayName: "Bob Brand",
        recipientUserId: 1,
        body: "Authorized private",
        messageType: "typed",
        createdAt: "2026-09-09T14:04:00.000Z",
      },
      {
        id: "private-other",
        userId: 2,
        displayName: "Bob Brand",
        recipientUserId: 3,
        body: "Secret for Casey",
        messageType: "typed",
        createdAt: "2026-09-09T14:05:00.000Z",
      },
      {
        id: "answer",
        userId: 0,
        displayName: "V",
        recipientUserId: null,
        body: "Saved V answer",
        messageType: "askv",
        createdAt: "2026-09-09T14:06:00.000Z",
      },
      {
        id: "file",
        userId: 2,
        displayName: "Bob Brand",
        recipientUserId: null,
        body: "",
        messageType: "attachment",
        createdAt: "2026-09-09T14:07:00.000Z",
        attachment: {
          fileName: "field-plan.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
      },
    ],
    activity: [
      {
        userId: 2,
        kind: "typing",
        recipientUserId: null,
        expiresAt: Date.parse("2026-09-09T14:10:00.000Z"),
      },
    ],
    transcript: [
      {
        id: "spoken",
        speakerUserId: 2,
        displayName: "Bob Brand",
        text: "Spoken words",
        startsAtMs: 30_000,
        endsAtMs: 31_000,
      },
    ],
    attendance: [
      {
        id: "visit",
        userId: 2,
        joinedAt: "2026-09-09T14:00:00.000Z",
        leftAt: null,
      },
    ],
    recap: {
      summary: "Saved summary",
      actionItems: ["Inspect pump"],
      decisions: ["Delay move"],
    },
    ...overrides,
  };
}

function hookState(data = snapshot()) {
  return {
    snapshot: data,
    loading: false,
    error: "",
    accessLost: false,
    recipientUserId: null,
    draft: "",
    sending: false,
    now: Date.parse("2026-09-09T14:06:05.000Z"),
    selectRecipient: vi.fn(),
    updateDraft: vi.fn(),
    send: vi.fn(),
    refresh: vi.fn(),
    managementConfirmation: null,
    managementPending: false,
    managementNotice: "",
    managementRefreshFailed: false,
    meetingEndedAcknowledged: false,
    requestRemoveConfirmation: vi.fn(),
    requestEndConfirmation: vi.fn(),
    cancelManagement: vi.fn(),
    confirmManagement: vi.fn(),
    fileBusy: false,
    fileError: "",
    fileNotice: "",
    fileRefreshFailed: false,
    fileRetryAvailable: false,
    chooseFile: vi.fn(),
    retryFile: vi.fn(),
    openFile: vi.fn(),
  };
}

beforeEach(() => {
  env.state = hookState();
  env.push.mockReset();
  env.scrollToEnd.mockReset();
  env.imageProps = [];
  env.getToken.mockReset();
  env.getToken.mockResolvedValue("private-photo-token");
  env.moduleData = { meetings: [] };
  env.spanish = false;
  env.accessibilityFocus.mockReset();
  env.announce.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("native meeting workspace", () => {
  it("renders actual Spanish meeting controls and status text", () => {
    env.spanish = true;
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByText("2 presentes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Herramientas de reunión" }),
    ).toBeTruthy();
    expect(screen.getByTestId("meeting-timer").textContent).toContain(
      "Transcurrido",
    );
  });
  it("moves native accessibility focus into and out of the roster and into the selected private composer", () => {
    vi.useFakeTimers();
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByTestId("meeting-roster-trigger"));
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(env.accessibilityFocus).toHaveBeenLastCalledWith(102);
    fireEvent.click(screen.getByRole("button", { name: "Close attendees" }));
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(env.accessibilityFocus).toHaveBeenLastCalledWith(101);
    fireEvent.click(screen.getByTestId("meeting-roster-trigger"));
    act(() => {
      vi.runOnlyPendingTimers();
    });
    fireEvent.click(screen.getByTestId("meeting-roster-person-2"));
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(env.accessibilityFocus).toHaveBeenLastCalledWith(103);
  });

  it("includes presence and speaking state in every roster person's accessible name", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByTestId("meeting-roster-trigger"));
    expect(
      screen.getByRole("button", { name: "Bob Brand, Speaking, Present" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Casey, Not connected" }),
    ).toBeTruthy();
  });

  it("announces only newly appended eligible timeline entries once and never replays catch-up or another thread", () => {
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(env.announce).not.toHaveBeenCalled();
    env.state = hookState(
      snapshot({
        chat: [
          ...snapshot().chat,
          {
            id: "fresh",
            userId: 2,
            displayName: "Bob Brand",
            recipientUserId: null,
            body: "Fresh update",
            messageType: "typed",
            createdAt: "2026-09-09T14:08:00.000Z",
          },
        ],
      }),
    );
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(env.announce).toHaveBeenCalledTimes(1);
    expect(env.announce).toHaveBeenLastCalledWith("Bob Brand: Fresh update");
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(env.announce).toHaveBeenCalledTimes(1);
    env.state = hookState(
      snapshot({
        chat: [
          ...snapshot().chat,
          {
            id: "catch-up",
            userId: 2,
            displayName: "Bob Brand",
            recipientUserId: null,
            body: "Older catch-up",
            messageType: "typed",
            createdAt: "2026-09-09T14:01:30.000Z",
          },
          {
            id: "fresh",
            userId: 2,
            displayName: "Bob Brand",
            recipientUserId: null,
            body: "Fresh update",
            messageType: "typed",
            createdAt: "2026-09-09T14:08:00.000Z",
          },
        ],
      }),
    );
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(env.announce).toHaveBeenCalledTimes(1);
    env.state = { ...env.state, recipientUserId: 2 };
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(env.announce).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByLabelText("Private meeting messages")
        .getAttribute("aria-live"),
    ).toBeNull();
  });
  it("places Add File in the composer header and exposes camera, photo library, files, and cancel choices", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    const add = screen.getByRole("button", { name: "Add File" });
    const send = screen.getByRole("button", { name: "Send" });
    expect(
      add.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(env.state.chooseFile).toHaveBeenCalledWith("camera");
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Photo Library" }));
    expect(env.state.chooseFile).toHaveBeenCalledWith("photos");
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(env.state.chooseFile).toHaveBeenCalledWith("files");
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Camera" })).toBeNull();
  });

  it("shows accessible busy, error, retry, and refresh controls without clearing the text draft", () => {
    env.state = {
      ...hookState(),
      draft: "keep this text",
      fileBusy: true,
      fileError: "Upload uncertain",
      fileRetryAvailable: true,
    };
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen
        .getByRole("button", { name: "Add File" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.getByDisplayValue("keep this text")).toBeTruthy();
    env.state = { ...env.state, fileBusy: false };
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry file" }));
    expect(env.state.retryFile).toHaveBeenCalledOnce();
    env.state = {
      ...env.state,
      fileBusy: false,
      fileError: "",
      fileNotice: "File added. Refresh to load it in the timeline.",
      fileRefreshFailed: true,
      fileRetryAvailable: false,
    };
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(env.state.refresh).toHaveBeenCalled();
  });

  it("opens only current nonremoved attachment entries with a localized filename label", () => {
    env.state = hookState(
      snapshot({
        chat: [
          {
            id: "open-file",
            userId: 2,
            displayName: "Bob",
            recipientUserId: null,
            body: "",
            messageType: "attachment",
            createdAt: "2026-09-09T14:07:00.000Z",
            attachment: {
              fileName: "permit.pdf",
              contentType: "application/pdf",
              byteSize: 3,
            },
          },
          {
            id: "removed-file",
            userId: 2,
            displayName: "Bob",
            recipientUserId: null,
            body: "",
            messageType: "attachment",
            createdAt: "2026-09-09T14:08:00.000Z",
            attachment: {
              fileName: "old.pdf",
              contentType: "application/pdf",
              byteSize: 3,
              removedAt: "2026-09-09T14:09:00.000Z",
            },
          },
          {
            id: "askv",
            userId: 0,
            displayName: "V",
            recipientUserId: null,
            body: "answer",
            messageType: "askv",
            createdAt: "2026-09-09T14:09:00.000Z",
            attachment: {
              fileName: "fake.pdf",
              contentType: "application/pdf",
              byteSize: 3,
            },
          },
          {
            id: "private-file",
            userId: 2,
            displayName: "Bob",
            recipientUserId: 1,
            body: "",
            messageType: "attachment",
            createdAt: "2026-09-09T14:10:00.000Z",
            attachment: {
              fileName: "private.pdf",
              contentType: "application/pdf",
              byteSize: 3,
            },
          },
        ],
      }),
    );
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Open permit.pdf" }));
    expect(env.state.openFile).toHaveBeenCalledWith({
      id: "open-file",
      recipientUserId: null,
      fileName: "permit.pdf",
      contentType: "application/pdf",
      byteSize: 3,
    });
    expect(screen.queryByRole("button", { name: "Open old.pdf" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open fake.pdf" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open private.pdf" }),
    ).toBeNull();
    env.state = { ...env.state, recipientUserId: 2 };
    cleanup();
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen.getByRole("button", { name: "Open private.pdf" }),
    ).toBeTruthy();
  });
  it("mounts one inert audio room for authorized scheduled/live meetings only", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getAllByTestId("audio-meeting-a")).toHaveLength(1);
    expect(
      screen.getByText("Transcription unavailable on this device."),
    ).toBeTruthy();
    env.state = hookState(
      snapshot({
        occurrence: {
          ...snapshot().occurrence,
          status: "ended",
          endedAt: "2026-09-09T14:30:00.000Z",
        },
      }),
    );
    cleanup();
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryByTestId("audio-meeting-a")).toBeNull();
    env.state = hookState(
      snapshot({
        occurrence: {
          ...snapshot().occurrence,
          status: "scheduled",
          startedAt: null,
        },
      }),
    );
    cleanup();
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getAllByTestId("audio-meeting-a")).toHaveLength(1);
  });

  it("keeps attachment metadata visible after removal and ignores attachment-shaped Ask V payloads", () => {
    env.state = hookState(
      snapshot({
        chat: [
          {
            id: "removed",
            userId: 2,
            displayName: "Bob Brand",
            recipientUserId: null,
            body: "",
            messageType: "attachment",
            createdAt: "2026-09-09T14:07:00.000Z",
            attachment: {
              fileName: "permit.pdf",
              contentType: "application/pdf",
              byteSize: 2048,
              removedAt: "2026-09-09T14:08:00.000Z",
            },
          },
          {
            id: "not-file",
            userId: 0,
            displayName: "V",
            recipientUserId: null,
            body: "Answer",
            messageType: "askv",
            createdAt: "2026-09-09T14:09:00.000Z",
            attachment: {
              fileName: "wrong.pdf",
              contentType: "application/pdf",
              byteSize: 12,
            },
          },
        ],
      }),
    );
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen.getByText(
        /permit\.pdf · application\/pdf · 2 KB · File removed by host/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/wrong\.pdf/)).toBeNull();
  });

  it("hides a participant photo after its native load error", () => {
    const data = snapshot();
    data.participants[1] = {
      ...data.participants[1],
      photoUrl: "https://example.test/bob.jpg",
    };
    env.state = hookState(data);
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    const photo = screen.getByTestId("photo-file");
    fireEvent.error(photo);
    expect(screen.queryByTestId("photo-file")).toBeNull();
  });

  it("resolves protected participant photos through the API base with bearer authorization kept out of the URI", async () => {
    const data = snapshot();
    data.participants[1] = {
      ...data.participants[1],
      photoUrl: "/api/storage/objects/uploads/private-bob-photo",
    };
    env.state = hookState(data);
    render(<MeetingWorkspace occurrenceId="meeting-a" />);

    expect(screen.queryByTestId("photo-file")).toBeNull();
    await waitFor(() =>
      expect(
        [...env.imageProps]
          .reverse()
          .find((props) => props.testID === "photo-file")?.source,
      ).toEqual({
        uri: "https://vndrly.example/api/storage/objects/uploads/private-bob-photo",
        headers: { Authorization: "Bearer private-photo-token" },
      }),
    );
    const protectedSources = env.imageProps
      .filter((props) => props.testID === "photo-file")
      .map((props) => props.source);
    expect(protectedSources.length).toBeGreaterThan(0);
    expect(
      protectedSources.every(
        (source) =>
          source.uri ===
            "https://vndrly.example/api/storage/objects/uploads/private-bob-photo" &&
          source.headers?.Authorization === "Bearer private-photo-token" &&
          !source.uri.includes("private-photo-token"),
      ),
    ).toBe(true);
  });

  it("switches from a protected participant photo to a public URL synchronously without leaking prior auth headers", async () => {
    const protectedData = snapshot();
    protectedData.participants[1] = {
      ...protectedData.participants[1],
      photoUrl: "/api/storage/objects/uploads/private-bob-photo",
    };
    env.state = hookState(protectedData);
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    await waitFor(() => expect(screen.getByTestId("photo-file")).toBeTruthy());

    env.imageProps = [];
    const publicData = snapshot();
    publicData.participants[1] = {
      ...publicData.participants[1],
      photoUrl: "https://legacy.example/fresh-bob.jpg",
    };
    env.state = hookState(publicData);
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);

    expect(screen.getByTestId("photo-file").getAttribute("src")).toBe(
      "https://legacy.example/fresh-bob.jpg",
    );
    await act(async () => {
      await Promise.resolve();
    });
    const publicSources = env.imageProps
      .filter((props) => props.testID === "photo-file")
      .map((props) => props.source);
    expect(publicSources.length).toBeGreaterThan(0);
    expect(
      publicSources.every(
        (source) =>
          source.uri === "https://legacy.example/fresh-bob.jpg" &&
          source.headers === undefined,
      ),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["empty", ""],
  ])(
    "emits no protected participant image when the %s token lookup has no bearer credential",
    async (_label, token) => {
      env.getToken.mockResolvedValue(token);
      const data = snapshot();
      data.participants[1] = {
        ...data.participants[1],
        photoUrl: "/api/storage/objects/uploads/protected-bob",
      };
      env.state = hookState(data);
      render(<MeetingWorkspace occurrenceId="meeting-a" />);

      await waitFor(() => expect(env.getToken).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByTestId("photo-file")).toBeNull();
      expect(
        env.imageProps.filter((props) => props.testID === "photo-file"),
      ).toEqual([]);
    },
  );

  it("emits no protected participant image when token lookup rejects", async () => {
    env.getToken.mockRejectedValue(new Error("secure storage unavailable"));
    const data = snapshot();
    data.participants[1] = {
      ...data.participants[1],
      photoUrl: "/api/storage/objects/uploads/protected-bob",
    };
    env.state = hookState(data);
    render(<MeetingWorkspace occurrenceId="meeting-a" />);

    await waitFor(() => expect(env.getToken).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("photo-file")).toBeNull();
    expect(
      env.imageProps.filter((props) => props.testID === "photo-file"),
    ).toEqual([]);
  });

  it("recovers after a missing token when catch-up supplies a refreshed protected URL and a later token", async () => {
    env.getToken.mockResolvedValue(null);
    const stale = snapshot();
    stale.participants[1] = {
      ...stale.participants[1],
      photoUrl: "/api/storage/objects/uploads/stale-bob",
    };
    env.state = hookState(stale);
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    await waitFor(() => expect(env.getToken).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      env.imageProps.filter((props) => props.testID === "photo-file"),
    ).toEqual([]);

    env.getToken.mockResolvedValue("later-private-token");
    const staleLookupCount = env.getToken.mock.calls.length;
    const fresh = snapshot();
    fresh.participants[1] = {
      ...fresh.participants[1],
      photoUrl: "/api/storage/objects/uploads/fresh-bob",
    };
    env.state = hookState(fresh);
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);

    await waitFor(() =>
      expect(env.getToken.mock.calls.length).toBeGreaterThan(staleLookupCount),
    );
    await waitFor(() => expect(screen.getByTestId("photo-file")).toBeTruthy());
    const sources = env.imageProps
      .filter((props) => props.testID === "photo-file")
      .map((props) => props.source);
    expect(sources.length).toBeGreaterThan(0);
    expect(
      sources.every(
        (source) =>
          source.uri ===
            "https://vndrly.example/api/storage/objects/uploads/fresh-bob" &&
          source.headers?.Authorization === "Bearer later-private-token" &&
          !source.uri.includes("later-private-token"),
      ),
    ).toBe(true);
  });

  it("preserves public absolute legacy participant photo URLs without authorization headers", async () => {
    const data = snapshot();
    data.participants[1] = {
      ...data.participants[1],
      photoUrl: "https://legacy.example/bob.jpg",
    };
    env.state = hookState(data);
    render(<MeetingWorkspace occurrenceId="meeting-a" />);

    await waitFor(() =>
      expect(
        [...env.imageProps]
          .reverse()
          .find((props) => props.testID === "photo-file")?.source,
      ).toEqual({
        uri: "https://legacy.example/bob.jpg",
      }),
    );
  });

  it("retries a refreshed participant photo after an earlier catch-up URL failed", () => {
    const stale = snapshot();
    stale.participants[1] = {
      ...stale.participants[1],
      photoUrl: "https://example.test/stale.jpg",
    };
    env.state = hookState(stale);
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.error(screen.getByTestId("photo-file"));
    expect(screen.queryByTestId("photo-file")).toBeNull();

    const fresh = snapshot();
    fresh.participants[1] = {
      ...fresh.participants[1],
      photoUrl: "https://example.test/fresh.jpg",
    };
    env.state = hookState(fresh);
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);

    expect(screen.getByTestId("photo-file").getAttribute("src")).toBe(
      "https://example.test/fresh.jpg",
    );
  });

  it("keeps reading position detached when older entries are being read", () => {
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    const timeline = screen.getByLabelText("Meeting transcript");
    fireEvent.doubleClick(timeline);
    expect(env.scrollToEnd).toHaveBeenCalledWith({ animated: false });
    env.scrollToEnd.mockClear();
    Object.defineProperties(timeline, {
      scrollTop: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(timeline);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy();
    env.state = hookState(
      snapshot({
        chat: [
          ...snapshot().chat,
          {
            id: "newer",
            userId: 2,
            displayName: "Bob Brand",
            recipientUserId: null,
            body: "A newer update",
            messageType: "typed",
            createdAt: "2026-09-09T14:08:00.000Z",
          },
        ],
      }),
    );
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.doubleClick(timeline);
    expect(env.scrollToEnd).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy();
  });

  it("excludes self from private recipients and selects another attendee", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByRole("button", { name: /Private Message/ }));
    expect(screen.queryByRole("button", { name: /Alex Owner/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bob Brand/ }));
    expect(env.state.selectRecipient).toHaveBeenCalledWith(2);
  });

  it("expires live typing text and its matching timeline outline as time advances", () => {
    const data = snapshot({
      participants: snapshot().participants.map((participant) => ({
        ...participant,
        speaking: false,
      })),
      activity: [
        {
          userId: 2,
          kind: "typing",
          recipientUserId: null,
          expiresAt: Date.parse("2026-09-09T14:10:00.000Z"),
        },
      ],
    });
    env.state = hookState(data);
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByText(/Bob Brand is typing/)).toBeTruthy();
    expect(screen.getByTestId("entry-file").style.borderTopWidth).toBe("2px");

    env.state = { ...env.state, now: Date.parse("2026-09-09T14:10:01.000Z") };
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);

    expect(screen.queryByText(/Bob Brand is typing/)).toBeNull();
    expect(screen.getByTestId("entry-file").style.borderTopWidth).toBe("1px");
  });

  it("does not show expired activity and freezes an ended timer at endedAt", () => {
    env.state = hookState(
      snapshot({
        occurrence: {
          ...snapshot().occurrence,
          status: "ended",
          endedAt: "2026-09-09T14:30:00.000Z",
        },
        activity: [
          {
            userId: 2,
            kind: "typing",
            recipientUserId: null,
            expiresAt: Date.parse("2026-09-09T14:05:00.000Z"),
          },
        ],
      }),
    );
    env.state.now = Date.parse("2026-09-09T16:00:00.000Z");
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryByText(/is typing/)).toBeNull();
    expect(screen.getByTestId("meeting-timer").textContent).toContain(
      "00:30:00",
    );
  });

  it("shows only authorized shared/private history with own/V white and other people branded", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByText("Owner update")).toBeTruthy();
    expect(screen.getByText("Authorized private")).toBeTruthy();
    expect(screen.queryByText("Secret for Casey")).toBeNull();
    expect(
      screen.getByText("field-plan.pdf · application/pdf · 2 KB"),
    ).toBeTruthy();
    expect(screen.getByTestId("entry-own").style.alignSelf).toBe("flex-end");
    expect(screen.getByTestId("name-own").style.color).toBe(
      "rgb(255, 255, 255)",
    );
    expect(screen.getByTestId("name-other").style.color).toBe(
      "rgb(0, 173, 181)",
    );
    expect(screen.getByTestId("name-answer").style.color).toBe(
      "rgb(255, 255, 255)",
    );
    expect(screen.queryByTestId("photo-own")).toBeNull();
  });

  it("shows a temporary authorized V card before search filtering and retains the saved answer after expiry", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Meeting Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search meeting" }), {
      target: { value: "no-match" },
    });
    expect(screen.getByLabelText("V's latest answer").textContent).toContain(
      "Saved V answer",
    );
    cleanup();
    env.state = {
      ...hookState(),
      now: Date.parse("2026-09-09T14:06:11.000Z"),
      search: "",
    };
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryByLabelText("V's latest answer")).toBeNull();
    expect(screen.getByText("Saved V answer")).toBeTruthy();
  });

  it("shows five speaker bars only for the server-confirmed present unmuted speaker and outlines only their newest matching entry", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen
        .getByLabelText("Bob Brand speaking")
        .querySelectorAll("[data-testid^='speaker-bar-']"),
    ).toHaveLength(5);
    expect(screen.getByTestId("entry-other").style.borderTopWidth).toBe("1px");
    expect(screen.getByTestId("entry-file").style.borderTopWidth).toBe("2px");
    expect(screen.getByTestId("entry-spoken").style.borderTopWidth).toBe("1px");
    expect(
      Array.from(
        screen
          .getByLabelText("Bob Brand speaking")
          .querySelectorAll("[data-testid^='speaker-bar-']"),
      ).map((bar) => bar.getAttribute("data-rest-height")),
    ).toEqual(["7", "12", "9", "13", "6"]);
  });

  it("suppresses speaking bars after the meeting ends", () => {
    env.state = hookState(
      snapshot({
        occurrence: {
          ...snapshot().occurrence,
          status: "ended",
          endedAt: "2026-09-09T14:30:00.000Z",
        },
      }),
    );
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryAllByTestId(/speaker-bar-/)).toHaveLength(0);
  });

  it("counts present non-host attendees independently from private-recipient self exclusion", () => {
    env.state = hookState(
      snapshot({
        userId: 9,
        participants: [
          {
            userId: 1,
            displayName: "Alex Host",
            photoUrl: null,
            role: "host",
            muted: false,
            present: true,
            speaking: false,
            removedAt: null,
          },
          {
            userId: 2,
            displayName: "Bob Brand",
            photoUrl: null,
            role: "attendee",
            muted: false,
            present: true,
            speaking: false,
            removedAt: null,
          },
          {
            userId: 9,
            displayName: "Current User",
            photoUrl: null,
            role: "attendee",
            muted: false,
            present: false,
            speaking: false,
            removedAt: null,
          },
        ],
      }),
    );
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen.getByRole("button", { name: "Private Message +1" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Private Message +1" }));
    expect(
      screen.getByRole("button", { name: "Alex Host, Host, Present" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Current User" })).toBeNull();
  });

  it("shows host tools only to canManage and binds selection, cancellation, and confirmation to the named eligible attendee", () => {
    const host = snapshot({
      canManage: true,
      participants: [
        ...snapshot().participants,
        {
          userId: 4,
          displayName: "Other Host",
          photoUrl: null,
          role: "host",
          muted: false,
          present: true,
          speaking: false,
          removedAt: null,
        },
        {
          userId: 5,
          displayName: "Removed Person",
          photoUrl: null,
          role: "attendee",
          muted: true,
          present: false,
          speaking: false,
          removedAt: "2026-09-09T14:05:00.000Z",
        },
      ],
    });
    env.state = hookState(host);
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen.queryByRole("button", { name: "Manage Attendees" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Meeting Tools" }));
    expect(
      screen
        .getByRole("button", { name: "Summary" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Action Items" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Manage Attendees" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "End meeting" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage Attendees" }));
    expect(
      screen
        .getByRole("button", { name: "Manage Attendees" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: /Alex Owner/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Other Host/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Removed Person/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bob Brand/ }));
    expect(env.state.requestRemoveConfirmation).toHaveBeenCalledWith(2);

    cleanup();
    env.state = {
      ...hookState(host),
      managementConfirmation: {
        kind: "remove",
        userId: 2,
        displayName: "Bob Brand",
      },
    };
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByText("Remove Bob Brand?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(env.state.cancelManagement).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Remove Bob Brand" }));
    expect(env.state.confirmManagement).toHaveBeenCalledOnce();
  });

  it("retains named destructive button semantics while a host action is pending", () => {
    env.state = {
      ...hookState(snapshot({ canManage: true })),
      managementConfirmation: {
        kind: "remove",
        userId: 2,
        displayName: "Bob Brand",
      },
      managementPending: true,
    };
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    const remove = screen.getByRole("button", { name: "Remove Bob Brand" });
    expect(remove.getAttribute("aria-busy")).toBe("true");
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Cancel" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("unmounts audio immediately after authoritative end acknowledgement and does not stale-remount it", () => {
    const view = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByTestId("audio-meeting-a")).toBeTruthy();
    env.state = { ...hookState(), meetingEndedAcknowledged: true };
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryByTestId("audio-meeting-a")).toBeNull();
    env.state = {
      ...hookState(),
      meetingEndedAcknowledged: true,
      snapshot: snapshot(),
    };
    view.rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryByTestId("audio-meeting-a")).toBeNull();
  });

  it("does not expose a private typing outline in the shared timeline", () => {
    env.state = hookState(
      snapshot({
        activity: [
          {
            userId: 2,
            kind: "typing",
            recipientUserId: 1,
            expiresAt: Date.parse("2026-09-09T14:10:00.000Z"),
          },
        ],
      }),
    );
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByTestId("entry-private-mine").style.borderTopWidth).toBe(
      "1px",
    );
  });

  it("places timer below the divider, turns amber for the final ten minutes and reports overtime", () => {
    env.state = hookState();
    env.state.now = Date.parse("2026-09-09T14:50:00.000Z");
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting-a" />);
    const divider = screen.getByTestId("meeting-divider");
    const timer = screen.getByTestId("meeting-timer");
    expect(
      divider.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("meeting-progress")
        .firstElementChild?.getAttribute("style"),
    ).toContain("rgb(245, 158, 11)");
    env.state = { ...env.state, now: Date.parse("2026-09-09T15:05:00.000Z") };
    rerender(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.getByText(/Overtime \+00:05:00/)).toBeTruthy();
  });

  it("keeps tools collapsed and exposes attendance only when authorized", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(screen.queryByText("Saved summary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Meeting Tools" }));
    expect(screen.getByText("Saved summary")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attendance" })).toBeTruthy();
    cleanup();
    env.state = hookState(snapshot({ canViewAttendance: false }));
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Meeting Tools" }));
    expect(screen.queryByRole("button", { name: "Attendance" })).toBeNull();
  });

  it("keeps the multiline composer uncapped and routes text through the hook", () => {
    env.state = { ...hookState(), draft: "ready" };
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    const composer = screen.getByRole("textbox", {
      name: "Message the meeting",
    });
    expect(composer.getAttribute("maxlength")).toBeNull();
    fireEvent.change(composer, { target: { value: "x".repeat(5000) } });
    expect(env.state.updateDraft).toHaveBeenCalledWith("x".repeat(5000));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(env.state.send).toHaveBeenCalledOnce();
  });

  it("keeps transient speaker state live, transcript history quiet, and overtime text complete", () => {
    env.state = hookState();
    env.state.now = Date.parse("2026-09-09T15:05:00.000Z");
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen.getByLabelText("Meeting transcript").getAttribute("aria-live"),
    ).toBeNull();
    expect(
      screen.getByLabelText("Bob Brand speaking").getAttribute("aria-live"),
    ).toBe("polite");
    expect(
      screen.getByTestId("meeting-progress").getAttribute("aria-valuetext"),
    ).toContain("Overtime +00:05:00");
  });

  it("allows large text to wrap the header and composer action rows", () => {
    render(<MeetingWorkspace occurrenceId="meeting-a" />);
    expect(
      screen.getByTestId("meeting-header-row").getAttribute("style"),
    ).toContain("flex-wrap: wrap");
    expect(
      screen.getByTestId("meeting-composer-actions").getAttribute("style"),
    ).toContain("flex-wrap: wrap");
  });
});

describe("meeting list routing", () => {
  it("opens the dedicated meeting route without mounting an audio room in each list row", async () => {
    env.moduleData = {
      meetings: [
        {
          occurrence: { id: "meeting-a", startsAt: "2026-09-09T14:00:00.000Z" },
          meeting: { title: "Daily operations", agenda: "Safety" },
        },
      ],
    };
    render(<WorkHubModuleScreen />);
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(screen.queryByTestId("audio-meeting-a")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Daily operations" }),
    );
    expect(env.push).toHaveBeenCalledWith("/work-hub/meeting/meeting-a");
  });
  it("localizes the existing Open meeting action", async () => {
    env.spanish = true;
    env.moduleData = {
      meetings: [
        {
          occurrence: { id: "meeting-a", startsAt: "2026-09-09T14:00:00.000Z" },
          meeting: { title: "Daily operations", agenda: "Safety" },
        },
      ],
    };
    render(<WorkHubModuleScreen />);
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "Abrir Daily operations" })
        .textContent,
    ).toContain("Abrir reunión");
  });
});
