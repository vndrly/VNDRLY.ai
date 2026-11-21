import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { WorkHubCallSession } from "./floating-call";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  join: vi.fn(),
  disposeAudio: vi.fn(),
  user: { userId: 104, vendorId: 15, partnerId: null, activeMembershipId: 1 },
  identity: { deviceId: "browser-device", connectionId: "tab-connection" },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({}),
  brandStyleVars: () => ({ "--brand-primary": "#00b0c7" }),
}));
vi.mock("@/hooks/use-work-hub-device-presence", () => ({
  registerWorkHubBrowserDevice: async () => undefined,
  reportWorkHubBrowserPresence: async () => undefined,
  useWorkHubDevicePresence: () => undefined,
  workHubDeviceIdentity: () => mocks.identity,
}));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));
vi.mock("@/hooks/use-meeting-audio", () => ({
  useMeetingAudio: (_occurrenceId: string) => {
    const [joined, setJoined] = useState(false);
    const [muted, setMuted] = useState(true);
    useEffect(() => () => mocks.disposeAudio(), []);
    return {
      joined, muted,
      join: async (_source?: string, unmute?: boolean) => {
        mocks.join(_source, unmute);
        setJoined(true);
        setMuted(!unmute);
      },
      toggleMute: async () => setMuted(value => !value),
    };
  },
}));

const call = { id: "call-1", occurrenceId: "room-1", incoming: true, callerName: "Morgan Lee" };
function Workspace() {
  const [path] = useLocation();
  return <main>
    <h1>{path === "/tickets/42" ? "Ticket 42" : "Schedule"}</h1>
    <label>Notes<input /></label>
    <Link href="/calendar">Schedule</Link>
  </main>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const location = memoryLocation({ path: "/tickets/42" });
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <WorkHubCallSession><Workspace /></WorkHubCallSession>
      </Router>
    </QueryClientProvider>,
  );
}

describe("floating Work Hub call", () => {
  let status: "ringing" | "active" | "ended";
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    status = "ringing";
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/calls?filter=live") return status === "ended" ? [] : [{ ...call, status }];
      if (path === "/calls/call-1/respond") {
        const action = JSON.parse(String(init?.body)).action;
        status = action === "accept" ? "active" : "ended";
        return { occurrenceId: call.occurrenceId, selectedAudioOwner: action === "accept" };
      }
      if (path === "/meetings/room-1/catch-up") return {
        occurrence: { status: "live" }, meeting: { policyVersion: 1 }, participants: [], participationMode: "active",
      };
      if (path === "/calls/call-1/transcription-state") return { enabled: true, policyVersion: 1 };
      if (path === "/calls/call-1/transcript") return {
        segments: [
          { id: "mine", speakerUserId: 104, text: "I have the ticket open." },
          { id: "remote", speakerUserId: 105, speakerName: "Morgan Lee", text: "Thanks for checking." },
        ],
      };
      throw new Error(`Unexpected request ${path}`);
    });
  });

  it("answers in place, shows speaker-specific captions, and keeps audio across routes", async () => {
    mount();
    const notes = screen.getByRole("textbox", { name: "Notes" }) as HTMLInputElement;
    fireEvent.change(notes, { target: { value: "Unsaved work" } });
    const incoming = await screen.findByRole("complementary", { name: "Incoming call" });
    expect(within(incoming).getByText("Morgan Lee is calling")).toBeTruthy();
    fireEvent.click(within(incoming).getByRole("button", { name: "Accept" }));

    const active = await screen.findByRole("complementary", { name: "Active call" });
    expect(screen.getByRole("heading", { name: "Ticket 42" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Notes" })).toBe(notes);
    expect(notes.value).toBe("Unsaved work");
    expect(mocks.request).toHaveBeenCalledWith("/calls/call-1/respond", expect.objectContaining({
      body: JSON.stringify({ action: "accept", ...mocks.identity }),
    }));
    await waitFor(() => expect(mocks.join).toHaveBeenCalledExactlyOnceWith(undefined, true));
    const captions = within(active).getByRole("log", { name: "Live captions" });
    expect((await within(captions).findByText("I have the ticket open.")).parentElement?.className).toContain("bg-[var(--brand-primary)]");
    expect((await within(captions).findByText("Thanks for checking.")).parentElement?.className).toContain("bg-[#3a3d42]");

    fireEvent.click(screen.getByRole("link", { name: "Schedule" }));
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Active call" })).toBe(active);
    expect(mocks.disposeAudio).not.toHaveBeenCalled();
    fireEvent.click(within(active).getByRole("button", { name: "End call" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Active call" })).toBeNull());
  });

  it("declines on the current page without starting audio", async () => {
    mount();
    const incoming = await screen.findByRole("complementary", { name: "Incoming call" });
    fireEvent.click(within(incoming).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Incoming call" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Ticket 42" })).toBeTruthy();
    expect(mocks.join).not.toHaveBeenCalled();
  });
});
