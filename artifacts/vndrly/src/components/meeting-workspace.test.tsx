import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@/lib/meeting-types";
const mocks = vi.hoisted(() => ({ snapshot: {} as MeetingSnapshot, request: vi.fn(), invalidate: vi.fn(), primary: "#00adb5" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.snapshot }), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: mocks.primary, name: "MidCon Solutions" }) }));
vi.mock("@/hooks/use-meeting-audio", () => ({ useMeetingAudio: () => ({ joined: true, muted: true, join: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), error: null, needsPlayback: false }) }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request, createWorkHubOperationId: () => "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea02" }));
import MeetingWorkspace from "./meeting-workspace";

beforeEach(() => {
  mocks.primary = "#00adb5";
  sessionStorage.clear(); mocks.request.mockReset().mockResolvedValue({}); mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.snapshot = {
    userId: 1, canManage: true, canViewAttendance: true, transcription: true, myConsent: "accepted",
    meeting: { title: "Morning Operations", agenda: "Safety and jobs", policyVersion: 1 },
    occurrence: { id: "meeting", status: "live", startsAt: "2026-09-09T14:00:00Z", endsAt: "2026-09-09T15:00:00Z", startedAt: "2026-09-09T14:00:00Z", endedAt: null, askvInvitedAt: "2026-09-09T14:00:00Z" },
    participants: [ { userId: 1, displayName: "Susie", role: "host", muted: true, present: true, speaking: false, removedAt: null }, { userId: 2, displayName: "Bob", role: "participant", muted: false, present: true, speaking: true, removedAt: null } ],
    chat: [{ id: "one", userId: 1, displayName: "Susie", body: "My message", createdAt: "2026-09-09T14:01:00Z", recipientUserId: null, messageType: "typed" }, { id: "two", userId: 2, displayName: "Bob", body: "Bob's message", createdAt: "2026-09-09T14:01:20Z", recipientUserId: null, messageType: "typed" }, { id: "three", userId: 1, displayName: "Ask V", body: "V's answer", createdAt: "2026-09-09T14:01:30Z", recipientUserId: null, messageType: "askv" }],
    activity: [], transcript: [], attendance: [], recap: null,
  };
});
describe("approved Work Hub meeting workspace", () => {
  it("keeps the card brand current when the organization color changes", () => {
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("region", { name: "Meeting workspace" }).style.getPropertyValue("--meeting-brand")).toBe("#00adb5");
    mocks.primary = "#ab3478";
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("region", { name: "Meeting workspace" }).style.getPropertyValue("--meeting-brand")).toBe("#ab3478");
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
    expect(screen.getByRole("status").textContent).toBe("");
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
  it("uses the revised V control and posts the host's pause action", async () => {
    const { rerender } = render(<MeetingWorkspace occurrenceId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "V is listening" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/meetings/meeting/askv", expect.objectContaining({ body: '{"invited":false}' })));
    mocks.snapshot.transcription = false; mocks.snapshot.occurrence.askvInvitedAt = null;
    rerender(<MeetingWorkspace occurrenceId="meeting" />);
    expect(screen.getByRole("button", { name: "Click to restart V" })).toBeTruthy();
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
    expect(screen.getByRole("status").textContent).toContain("Bob is adding a file");
    expect(screen.getByText("Meeting Tools").closest("details")!.open).toBe(false);
  });
});
