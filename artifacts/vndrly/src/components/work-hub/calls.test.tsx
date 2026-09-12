import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkHubCalls } from "./calls";
const api = vi.hoisted(() => ({ request: vi.fn() }));
class FakeEventSource {
  static current: FakeEventSource | null = null;
  private listeners = new Map<string, Set<EventListener>>();
  constructor(_url: string, _options?: EventSourceInit) {
    FakeEventSource.current = this;
  }
  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }
  close() {}
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
vi.mock("@/lib/work-hub-client", () => ({
  workHubRequest: api.request,
  createWorkHubOperationId: () => "0198de93-3eb4-7881-901a-513bccccc001",
  isWorkHubAdmin: () => false,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 12 } }) }));
vi.mock("@/hooks/use-work-hub-device-presence", () => ({ workHubDeviceIdentity: () => ({ deviceId: "20000000-0000-4000-8000-000000000002", connectionId: "20000000-0000-4000-8000-000000000003" }) }));
vi.mock("@/components/brand-pill-button", () => ({
  default: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  brandImagePillSrc: () => "brand-pill.png",
  PngPillButton: ({ children, activeSrc: _activeSrc, idleSrc: _idleSrc, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#0f766e", name: "MidCon Solutions" }),
}));
vi.mock("@/components/meeting-audio-room", () => ({
  default: ({ occurrenceId }: any) => <div>Audio room {occurrenceId}</div>,
}));
vi.mock("./collaboration", () => ({
  PeoplePicker: ({ onChange }: any) => (
    <button onClick={() => onChange("5")}>Choose contact</button>
  ),
  HubError: ({ error }: any) =>
    error ? <div role="alert">{error.message}</div> : null,
}));
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <WorkHubCalls />
    </QueryClientProvider>,
  );
}
describe("internal Calls workspace", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    FakeEventSource.current = null;
  });
  beforeEach(() => {
    api.request.mockReset();
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  const defaults = (path: string) =>
    path === "/calls/settings"
      ? { available: true, speedDial: [] }
      : path === "/devices/preferences"
        ? { rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} }
      : path === "/people"
        ? [{ id: 5, displayName: "Jordan" }]
        : [];
  it("requires accepting an incoming ring before displaying audio", async () => {
    api.request.mockImplementation(async (path: string) =>
      path === "/calls"
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
    mount();
    const startCard = screen.getByRole("complementary", {
      name: "Start an internal call",
    });
    const historyCard = screen.getByRole("region", { name: "Call history" });
    expect(startCard.className).toContain("max-w-xs");
    expect(startCard.className).toContain("rounded-xl");
    expect(historyCard.className).toContain("rounded-xl");
    expect(startCard.parentElement?.className).toContain(
      "lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]",
    );
    expect(await screen.findByText("Jordan is calling")).toBeTruthy();
    expect(screen.queryByText("Audio room room1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      const request = api.request.mock.calls.find(
        ([path]) => path === "/calls/call1/respond",
      );
      expect(request?.[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        action: "accept",
        deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        connectionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });
  });
  it("stops a local ring as soon as another device answers", async () => {
    let callReads = 0;
    api.request.mockImplementation(async (path: string) => {
      if (path === "/calls") {
        callReads += 1;
        return [
          {
            id: "call1",
            occurrenceId: "room1",
            incoming: true,
            callerName: "Jordan",
            status: callReads === 1 ? "ringing" : "active",
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return defaults(path);
    });
    mount();
    expect(await screen.findByText("Jordan is calling")).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.current).not.toBeNull());
    FakeEventSource.current!.emit("work_hub.call.answered", {
      type: "work_hub.call.answered",
      subject: { type: "work_hub_call", id: "call1" },
    });
    await waitFor(() => {
      expect(callReads).toBeGreaterThan(1);
      expect(screen.queryByText("Jordan is calling")).toBeNull();
    });
  });
  it("shows saved voicemail only after selecting its history filter", async () => {
    api.request.mockImplementation(async (path: string) =>
      path === "/voicemail"
        ? [
            {
              id: "mail1",
              senderName: "Jordan",
              durationMs: 3500,
              createdAt: new Date().toISOString(),
              readAt: null,
              transcript: "Existing real transcript",
            },
          ]
        : defaults(path),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "voicemail" }));
    expect(await screen.findByText("Existing real transcript")).toBeTruthy();
    expect(
      screen.getByLabelText("Voicemail from Jordan").getAttribute("src"),
    ).toBe("/api/work-hub/voicemail/mail1/audio");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/voicemail/mail1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
  it("surfaces call failure without displaying a connected room", async () => {
    api.request.mockImplementation(async (path: string, options?: any) => {
      if (path === "/calls" && options?.method === "POST")
        throw new Error("Contact invitation must be accepted");
      return defaults(path);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Choose contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Contact invitation must be accepted",
    );
    expect(screen.queryByText(/Audio room/)).toBeNull();
  });
  it("uses branded pressed controls for presence and call history filters", async () => {
    api.request.mockImplementation(async (path: string, options?: any) => {
      if (path === "/calls/settings" && options?.method === "PUT") return options;
      return defaults(path);
    });
    mount();
    const presence = await screen.findByRole("button", {
      name: "Available for calls",
    });
    await waitFor(() =>
      expect((presence as HTMLButtonElement).disabled).toBe(false),
    );
    expect(presence.getAttribute("aria-pressed")).toBe("true");
    expect(presence.textContent).toContain("Show me as away for calls");
    fireEvent.click(presence);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/calls/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ available: false, speedDial: [] }),
        }),
      ),
    );
    expect(screen.getByRole("button", { name: "all" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "incoming" }));
    expect(screen.getByRole("button", { name: "incoming" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("keeps the presence control in the branded heading and both call areas inside one master card", async () => {
    api.request.mockImplementation(async (path: string) => defaults(path));
    mount();
    const master = await screen.findByRole("region", { name: "Calls workspace" });
    const heading = screen.getByRole("heading", { name: "Calls" });
    const presence = screen.getByRole("button", { name: "Available for calls" });
    expect(heading.closest("header")?.contains(presence)).toBe(true);
    expect(master.contains(screen.getByRole("complementary", { name: "Start an internal call" }))).toBe(true);
    expect(master.contains(screen.getByRole("region", { name: "Call history" }))).toBe(true);
    expect(master.className).toContain("border-[color:var(--brand-primary)]");
  });
  it("orders speed dial by latest call and removes one shortcut without deleting history", async () => {
    api.request.mockImplementation(async (path: string, options?: any) => {
      if (path === "/calls/settings" && options?.method === "PUT") return options;
      if (path === "/calls/settings") return { available: true, speedDial: [5, 6] };
      if (path === "/people") return [{ id: 5, displayName: "Jordan" }, { id: 6, displayName: "Casey" }];
      if (path === "/calls") return [
        { id: "older", incoming: false, recipientUserId: 5, callerUserId: 7, createdAt: "2026-09-09T10:00:00Z", status: "ended" },
        { id: "newer", incoming: true, recipientUserId: 7, callerUserId: 6, createdAt: "2026-09-10T10:00:00Z", status: "ended" },
      ];
      return [];
    });
    mount();
    await waitFor(() => {
      const removeButtons = screen.getAllByRole("button", {
        name: /Remove .* from speed dial/,
      });
      expect(removeButtons[0].getAttribute("aria-label")).toBe(
        "Remove Casey from speed dial",
      );
      expect(removeButtons[1].getAttribute("aria-label")).toBe(
        "Remove Jordan from speed dial",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Casey from speed dial" }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/calls/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ available: true, speedDial: [5] }),
        }),
      ),
    );
  });
});
