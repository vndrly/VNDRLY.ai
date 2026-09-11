import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@/lib/meeting-types";
const mocks = vi.hoisted(() => ({ snapshot: {} as MeetingSnapshot, request: vi.fn(), invalidate: vi.fn(), primary: "#00adb5", spanish: false, audio: { joined: true, muted: true, transcriptionActive: false, transcriptionError: null as string | null, stopTranscription: vi.fn(), retryTranscription: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.snapshot }), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: mocks.primary, name: "MidCon Solutions" }) }));
vi.mock("@/hooks/use-meeting-audio", () => ({ useMeetingAudio: () => ({ ...mocks.audio, join: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), error: null, needsPlayback: false }) }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request, createWorkHubOperationId: () => "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => {
  const translations: Record<string, [string, string]> = {
    "meetingWorkspace.workspaceLabel": ["Meeting workspace", "Espacio de reunión"],
    "meetingWorkspace.privateMessageCount": ["Private Message, {{count}} attendees", "Mensaje privado, {{count}} asistentes"],
    "meetingWorkspace.attendees": ["Attendees", "Asistentes"],
    "meetingWorkspace.closeAttendees": ["Close attendees", "Cerrar asistentes"],
    "meetingWorkspace.speaking": ["{{name}} speaking", "{{name}} está hablando"],
    "meetingWorkspace.noOneSpeaking": ["No one speaking", "Nadie está hablando"],
    "meetingWorkspace.duration": ["Meeting duration", "Duración de la reunión"],
    "meetingWorkspace.transcriptLabel": ["Meeting transcript", "Transcripción de la reunión"],
    "meetingWorkspace.privateMessagesLabel": ["Private meeting messages", "Mensajes privados de la reunión"],
    "meetingWorkspace.addFile": ["Add File", "Agregar archivo"],
    "meetingWorkspace.takePhoto": ["Take photo", "Tomar foto"],
    "meetingWorkspace.send": ["Send", "Enviar"],
    "meetingWorkspace.meetingTools": ["Meeting Tools", "Herramientas de reunión"],
    "meetingWorkspace.privateMessage": ["Private Message", "Mensaje privado"],
    "meetingWorkspace.presentCount": ["{{count}} present", "{{count}} presentes"],
    "meetingWorkspace.elapsed": ["Elapsed", "Transcurrido"],
    "meetingWorkspace.target": ["Target", "Objetivo"],
    "meetingWorkspace.liveTranscript": ["Live transcript", "Transcripción en vivo"],
    "meetingWorkspace.tools.summary": ["Summary", "Resumen"],
  };
  const raw = translations[key]?.[mocks.spanish ? 1 : 0] ?? String(values?.defaultValue ?? key);
  return raw.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(values?.[name] ?? ""));
} }) }));
import MeetingWorkspace from "./meeting-workspace";

afterEach(() => { vi.useRealTimers(); });

beforeEach(() => {
  mocks.primary = "#00adb5";
  mocks.spanish = false;
  Object.assign(mocks.audio, { joined: true, muted: true, transcriptionActive: false, transcriptionError: null });
  mocks.audio.stopTranscription.mockReset(); mocks.audio.retryTranscription.mockReset();
  sessionStorage.clear(); mocks.request.mockReset().mockResolvedValue({}); mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.snapshot = {
    userId: 1, canManage: true, canViewAttendance: true, transcription: true, myConsent: "accepted", nativeCaptureAvailable: true,
    meeting: { title: "Morning Operations", agenda: "Safety and jobs", policyVersion: 1 },
    occurrence: { id: "meeting", status: "live", startsAt: "2026-09-09T14:00:00Z", endsAt: "2026-09-09T15:00:00Z", startedAt: "2026-09-09T14:00:00Z", endedAt: null, askvInvitedAt: "2026-09-09T14:00:00Z" },
    participants: [ { userId: 1, displayName: "Susie", role: "host", muted: true, present: true, speaking: false, removedAt: null }, { userId: 2, displayName: "Bob", role: "participant", muted: false, present: true, speaking: true, removedAt: null } ],
    chat: [{ id: "one", userId: 1, displayName: "Susie", body: "My message", createdAt: "2026-09-09T14:01:00Z", recipientUserId: null, messageType: "typed" }, { id: "two", userId: 2, displayName: "Bob", body: "Bob's message", createdAt: "2026-09-09T14:01:20Z", recipientUserId: null, messageType: "typed" }, { id: "three", userId: 1, displayName: "Ask V", body: "V's answer", createdAt: "2026-09-09T14:01:30Z", recipientUserId: null, messageType: "askv" }],
    activity: [], transcript: [], attendance: [], recap: null,
  };
});
describe("approved Work Hub meeting workspace", () => {
  it("keeps the existing consent controls without an in-house claim when streaming capture is selected", () => {
    mocks.snapshot.myConsent = "pending"; mocks.snapshot.nativeCaptureAvailable = false; mocks.snapshot.streamingCaptureAvailable = true;
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("button", { name: "Accept transcription" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/in-house|provider|training/i);
    expect(screen.queryByText(/microphone is not being transcribed/i)).toBeNull();
  });
  it("shows a fresh V answer for ten seconds and retains its exact text in the transcript", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T14:01:30Z"));
    mocks.snapshot.chat[2].body = "Delivery is at 11:30 tomorrow, at 123 Main Street.";
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(within(screen.getByRole("region", { name: "V's latest answer" })).getByText("Delivery is at 11:30 tomorrow, at 123 Main Street.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(9999); });
    expect(screen.getByRole("region", { name: "V's latest answer" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1001); });
    expect(screen.queryByRole("region", { name: "V's latest answer" })).toBeNull();
    expect(screen.getByText("Delivery is at 11:30 tomorrow, at 123 Main Street.").closest("article")).toBeTruthy();
  });
  it.each(["text search", "human speaker"])("spotlights a fresh answer while a nonmatching %s filter remains active", (filter) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T14:05:00Z"));
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByText("Meeting Tools"));
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    if (filter === "text search") fireEvent.change(screen.getByRole("textbox", { name: "Search meeting" }), { target: { value: "unrelated search term" } });
    else fireEvent.change(screen.getByRole("combobox", { name: "Filter by speaker" }), { target: { value: "2" } });
    expect(screen.queryByRole("region", { name: "V's latest answer" })).toBeNull();
    mocks.snapshot.chat.push({ ...mocks.snapshot.chat[2], id: "fresh-answer", body: "Start at the north gate.", createdAt: "2026-09-09T14:05:00Z" });
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(within(screen.getByRole("region", { name: "V's latest answer" })).getByText("Start at the north gate.")).toBeTruthy();
    expect(within(screen.getByLabelText("Meeting transcript")).queryByText("Start at the north gate.")).toBeNull();
  });
  it("ignores timeline search for a selected private thread while excluding other threads and audiences", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T14:05:02Z"));
    mocks.snapshot.participants.push({ userId: 3, displayName: "Carla", role: "participant", muted: true, present: true, speaking: false, removedAt: null });
    const answer = mocks.snapshot.chat[2];
    mocks.snapshot.chat.push(
      { ...answer, id: "bob-answer", userId: 2, recipientUserId: 1, body: "Bob's private answer.", createdAt: "2026-09-09T14:05:00Z" },
      { ...answer, id: "carla-answer", recipientUserId: 3, body: "Carla's private answer.", createdAt: "2026-09-09T14:05:01Z" },
      { ...answer, id: "shared-answer", body: "New shared answer.", createdAt: "2026-09-09T14:05:02Z" },
      { ...answer, id: "other-pair-answer", userId: 2, recipientUserId: 3, body: "Another pair's answer.", createdAt: "2026-09-09T14:05:02Z" },
    );
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: /Private Message/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bob Speaking" }));
    fireEvent.click(screen.getByText("Meeting Tools"));
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search meeting" }), { target: { value: "unrelated search term" } });
    const card = screen.getByRole("region", { name: "V's latest answer" });
    expect(within(card).getByText("Bob's private answer.")).toBeTruthy();
    expect(within(card).getByText("Private with Bob")).toBeTruthy();
    expect(within(screen.getByLabelText("Private meeting messages")).queryByText("Bob's private answer.")).toBeNull();
    mocks.snapshot.chat = mocks.snapshot.chat.filter((entry) => entry.id !== "bob-answer");
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.queryByRole("region", { name: "V's latest answer" })).toBeNull();
    expect(screen.queryByText("Another pair's answer.")).toBeNull();
  });
  it("does not reshow an old answer card on refresh or replay it when V is paused", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T14:05:00Z"));
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.queryByRole("region", { name: "V's latest answer" })).toBeNull();
    mocks.snapshot.chat[2].createdAt = new Date().toISOString();
    mocks.snapshot.occurrence.askvInvitedAt = null;
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.queryByRole("region", { name: "V's latest answer" })).toBeNull();
    expect(screen.getByText("V's answer")).toBeTruthy();
  });
  it("labels private V answers with the other attendee and never uses the requester's photo for V", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T14:01:30Z"));
    mocks.snapshot.participants[0].photoUrl = "/susie.jpg";
    mocks.snapshot.chat[2].recipientUserId = 2;
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const card = screen.getByRole("region", { name: "V's latest answer" });
    expect(within(card).getByText("Private with Bob")).toBeTruthy();
    const answer = screen.getAllByText("V's answer").find((element) => element.closest("article"))!.closest("article")!;
    expect(within(answer).getByText("Private · Bob")).toBeTruthy();
    expect(answer.querySelector("img")).toBeNull();
  });
  it("keeps the card brand current when the organization color changes", () => {
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("region", { name: "Meeting workspace" }).style.getPropertyValue("--meeting-brand")).toBe("#00adb5");
    mocks.primary = "#ab3478";
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("region", { name: "Meeting workspace" }).style.getPropertyValue("--meeting-brand")).toBe("#ab3478");
  });
  it("never turns V's saved answer metadata into a file download", () => {
    mocks.snapshot.chat[2].attachment = { kind: "askv_answer", sourceId: "one" } as unknown as NonNullable<MeetingSnapshot["chat"][number]["attachment"]>;
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const answer = screen.getByText("V's answer").closest("article")!;
    expect(within(answer).queryByRole("link")).toBeNull();
    expect(answer.textContent).not.toContain("NaN");
  });
  it("preserves real attachment previews and downloads in the same timeline", () => {
    mocks.snapshot.chat.push({ id: "photo", userId: 2, displayName: "Bob", body: "Completed work", createdAt: "2026-09-09T14:02:00Z", recipientUserId: null, messageType: "attachment", attachment: { fileName: "completion.jpg", contentType: "image/jpeg", byteSize: 2048 } });
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const item = screen.getByText("Completed work").closest("article")!;
    expect(within(item).getByRole("img", { name: "completion.jpg" }).getAttribute("src")).toBe("/api/work-hub/meetings/meeting/files/photo");
    expect(within(item).getByRole("link", { name: "completion.jpg · 2 KB" }).getAttribute("href")).toBe("/api/work-hub/meetings/meeting/files/photo");
  });
  it("does not display another pair's private answer even if it is accidentally included in a snapshot", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T14:01:30Z"));
    mocks.snapshot.chat[2].userId = 2; mocks.snapshot.chat[2].recipientUserId = 3;
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.queryAllByText("V's answer")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "V's latest answer" })).toBeNull();
  });
  it("outlines only a speaker's newest shared bubble and clears it when they stop", () => {
    mocks.snapshot.chat.push({ ...mocks.snapshot.chat[1], id: "new-bob", body: "Bob's next message", createdAt: "2026-09-09T14:02:00Z" });
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByText("Bob's message").closest("article")!.classList.contains("meeting-message-active")).toBe(false);
    expect(screen.getByText("Bob's next message").closest("article")!.classList.contains("meeting-message-active")).toBe(true);
    mocks.snapshot.participants[1].speaking = false;
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByText("Bob's next message").closest("article")!.classList.contains("meeting-message-active")).toBe(false);
  });
  it.each(["typing", "file"] as const)("outlines private %s activity only on the private bubble, until expiry", (kind) => {
    mocks.snapshot.participants[1].speaking = false;
    mocks.snapshot.chat.push({ ...mocks.snapshot.chat[1], id: "private-bob", body: "Bob's private message", recipientUserId: 1, createdAt: "2026-09-09T14:02:00Z" });
    mocks.snapshot.activity = [{ userId: 2, kind, recipientUserId: 1, expiresAt: Date.now() + 8000 }];
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByText("Bob's message").closest("article")!.classList.contains("meeting-message-active")).toBe(false);
    expect(screen.getByText("Bob's private message").closest("article")!.classList.contains("meeting-message-active")).toBe(true);
    mocks.snapshot.activity[0].expiresAt = Date.now() - 1;
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByText("Bob's private message").closest("article")!.classList.contains("meeting-message-active")).toBe(false);
    expect(screen.getByRole("status", { name: "Meeting activity" }).textContent).toBe("");
  });
  it("places my messages right, others left, and keeps my name and V white", () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const own = screen.getByText("My message").closest("article")!;
    const bob = screen.getByText("Bob's message").closest("article")!;
    const v = screen.getByText("V's answer").closest("article")!;
    expect(own.className).toContain("meeting-message-own");
    expect(bob.className).not.toContain("meeting-message-own");
    expect(v.className).not.toContain("meeting-message-own");
    expect(own.querySelector("strong")!.style.color).toBe("white");
    expect(v.querySelector("strong")!.style.color).toBe("white");
    expect(bob.querySelector("strong")!.style.color).toBe("rgb(0, 173, 181)");
    expect(bob.querySelector(".meeting-message-heading img")).toBeNull();
  });
  it("shows only a supplied participant photo immediately before the speaker name", () => {
    mocks.snapshot.participants[1].photoUrl = "/api/storage/objects/uploads/bob-photo";
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const bob = screen.getByText("Bob's message").closest("article")!;
    const heading = bob.querySelector(".meeting-message-heading")!;
    const photo = heading.querySelector("img")!;
    const name = heading.querySelector("strong")!;
    expect(photo.getAttribute("src")).toBe("/api/storage/objects/uploads/bob-photo");
    expect(photo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("My message").closest("article")!.querySelector("img")).toBeNull();
    expect(screen.getByText("V's answer").closest("article")!.querySelector("img")).toBeNull();
  });
  it("retries a refreshed participant photo after an earlier catch-up URL failed", () => {
    mocks.snapshot.participants[1].photoUrl = "/api/storage/objects/uploads/stale-photo";
    const view = render(<MeetingWorkspace occurrenceId="meeting" />);
    const photo = screen.getByText("Bob's message").closest("article")!.querySelector("img")!;
    fireEvent.error(photo);
    expect(photo.style.display).toBe("none");

    mocks.snapshot.participants[1].photoUrl = "/api/storage/objects/uploads/fresh-photo";
    view.rerender(<MeetingWorkspace occurrenceId="meeting" />);

    const refreshed = screen.getByText("Bob's message").closest("article")!.querySelector("img")!;
    expect(refreshed.getAttribute("src")).toBe("/api/storage/objects/uploads/fresh-photo");
    expect(refreshed.style.display).not.toBe("none");
  });
  it("uses the revised V control and posts the host's pause action", async () => {
    mocks.audio.muted = false; mocks.audio.transcriptionActive = true;
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "V is listening" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/askv", expect.objectContaining({ body: '{"invited":false}' })));
    expect(mocks.audio.stopTranscription).toHaveBeenCalled();
    mocks.audio.transcriptionActive = false;
    mocks.snapshot.transcription = false; mocks.snapshot.occurrence.askvInvitedAt = null;
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("button", { name: "Click to restart V" })).toBeTruthy();
  });
  it("never claims transcription is saving or V is listening from permission alone", () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.queryByText(/Transcript saving/)).toBeNull();
    expect(screen.queryByRole("button", { name: "V is listening" })).toBeNull();
    expect(screen.getByRole("button", { name: "Your mic is muted" })).toBeTruthy();
  });
  it("lets an attendee withdraw consent and stops local capture before the request resolves", () => {
    mocks.audio.muted = false; mocks.audio.transcriptionActive = true;
    mocks.request.mockImplementation(() => new Promise(() => undefined));
    render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw transcription consent" }));
    expect(mocks.audio.stopTranscription).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/consent", expect.objectContaining({ body: '{"policyVersion":1,"response":"declined"}' }));
  });
  it("shows transcription errors independently of working meeting audio and supports retry", () => {
    mocks.audio.muted = false; mocks.audio.transcriptionError = "Meeting transcription is unavailable.";
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("alert").textContent).toContain("Meeting transcription is unavailable.");
    expect(screen.getByRole("button", { name: "Transcription unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry transcription" }));
    expect(mocks.audio.retryTranscription).toHaveBeenCalledOnce();
  });
  it("keeps long pasted text intact and sends typed messages into the shared timeline", async () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const input = screen.getByRole("textbox", { name: "Message the meeting" });
    const long = "A full sentence and more. ".repeat(150);
    expect(input.getAttribute("maxlength")).toBeNull();
    fireEvent.change(input, { target: { value: long } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mocks.request.mock.calls.some(([path]) => String(path).endsWith("/chat"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/chat", expect.objectContaining({ body: JSON.stringify({ id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02", body: long.trim(), recipientUserId: null }) })));
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  });
  it("routes private drafts and typing indicators only to the chosen attendee", async () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: /Private Message/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bob Speaking" }));
    const input = screen.getByRole("textbox", { name: "Private message to Bob" });
    fireEvent.change(input, { target: { value: "Private question" } });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/activity", expect.objectContaining({ body: '{"kind":"typing","recipientUserId":2}' })));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/chat", expect.objectContaining({ body: expect.stringContaining('"recipientUserId":2') })));
  });
  it("keeps failed messages in the editor for retry", async () => {
    mocks.request.mockImplementation((path: string) => path.endsWith("/chat") ? Promise.reject(new Error("Connection interrupted")) : Promise.resolve({}));
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const input = screen.getByRole("textbox", { name: "Message the meeting" });
    fireEvent.change(input, { target: { value: "Keep my draft" } }); fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Connection interrupted");
    expect((input as HTMLTextAreaElement).value).toBe("Keep my draft");
  });
  it("shows expiring activity next to the person's name and keeps tools collapsed", () => {
    mocks.snapshot.activity = [{ userId: 2, kind: "file", recipientUserId: null, expiresAt: Date.now() + 8000 }];
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("status", { name: "Meeting activity" }).textContent).toContain("Bob is adding a file");
    expect(screen.getByText("Meeting Tools").closest("details")!.open).toBe(false);
  });

  it("exposes the transcript as an ordered polite log and announces the current speaker", () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const transcript = screen.getByRole("log", { name: "Meeting transcript" });
    expect(transcript.getAttribute("aria-live")).toBe("polite");
    expect(transcript.getAttribute("aria-relevant")).toBe("additions text");
    expect(screen.getByRole("status", { name: "Bob speaking" })).toBeTruthy();
  });

  it("connects the roster disclosure to its region and moves focus into and back out of it", () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    const trigger = screen.getByRole("button", { name: "Private Message, 1 attendees" });
    expect(trigger.getAttribute("aria-controls")).toBe("meeting-attendee-roster");
    fireEvent.click(trigger);
    const roster = screen.getByRole("region", { name: "Attendees" });
    expect(roster.id).toBe("meeting-attendee-roster");
    expect(screen.getByRole("button", { name: "Bob Speaking" })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: "Close attendees" }));
    expect(trigger).toBe(document.activeElement);
  });

  it("moves focus from a chosen attendee into the private message composer", async () => {
    render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "Private Message, 1 attendees" }));
    const bob = screen.getByRole("button", { name: "Bob Speaking" });
    await waitFor(() => expect(bob).toBe(document.activeElement));
    fireEvent.click(bob);
    const composer = screen.getByRole("textbox", { name: "Private message to Bob" });
    await waitFor(() => expect(composer).toBe(document.activeElement));
  });

  it("renders actual Spanish visible meeting text and accessible control names", () => {
    mocks.spanish = true;
    render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("region", { name: "Espacio de reunión" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mensaje privado, 1 asistentes" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("log", { name: "Transcripción de la reunión" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agregar archivo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText((_text, element) => element?.tagName === "P" && element.textContent?.includes("2 presentes") === true)).toBeTruthy();
    expect(screen.getByText(/Transcurrido/)).toBeTruthy();
    expect(screen.getByText("Transcripción en vivo")).toBeTruthy();
    expect(screen.getByText("Herramientas de reunión").getAttribute("aria-label")).toBe("Herramientas de reunión");
    fireEvent.click(screen.getByText("Herramientas de reunión"));
    expect(screen.getByRole("button", { name: "Resumen" })).toBeTruthy();
    expect(document.querySelector(".meeting-tool-body")?.getAttribute("aria-label")).toBe("Resumen");
  });
});
