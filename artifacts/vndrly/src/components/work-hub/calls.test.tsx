import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#0f766e", name: "MidCon Solutions" }),
}));
vi.mock("@/components/meeting-audio-room", () => ({
  default: ({ occurrenceId }: any) => <div>Audio room {occurrenceId}</div>,
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
function openCallPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Start a call" }));
  const input = screen.getByRole("combobox", { name: "Find a call contact" });
  fireEvent.focus(input);
  return input;
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
      : path === "/people?directory=calls"
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
    expect((await screen.findByText("Jordan is calling")).closest("[data-call-ringing]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jordan" }).closest("tr")?.hasAttribute("data-call-ringing")).toBe(true);
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
      expect(screen.getByRole("button", { name: "Jordan" }).closest("tr")?.hasAttribute("data-call-ringing")).toBe(false);
    });
  });
  it("pulses the outgoing call panel and log row until the recipient stops ringing", async () => {
    const call = {
      id: "outgoing", occurrenceId: "room-outgoing", incoming: false,
      recipientUserId: 5, recipientName: "Jordan", createdAt: "2026-11-20T14:01:00Z",
    };
    let status: string | undefined;
    api.request.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/calls" && options?.method === "POST") {
        status = "ringing";
        return { ...call, status };
      }
      if (path === "/calls") return status ? [{ ...call, status }] : [];
      return defaults(path);
    });
    mount();
    openCallPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Jordan" }));
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect((await screen.findByText("Calling…")).closest("[data-call-ringing]")).toBeTruthy();
    const log = screen.getByRole("table", { name: "Call log" });
    const row = within(log).getByRole("button", { name: "Jordan" }).closest("tr");
    expect(row?.hasAttribute("data-call-ringing")).toBe(true);
    status = "missed";
    FakeEventSource.current!.emit("work_hub.call.missed", { subject: { type: "work_hub_call", id: call.id } });
    await waitFor(() => {
      expect(screen.queryByText("Calling…")).toBeNull();
      expect(row?.hasAttribute("data-call-ringing")).toBe(false);
    });
    const voicemail = screen.getByRole("button", { name: "Leave voicemail" });
    expect(screen.queryByText("Jordan · missed")).toBeNull();
    expect(voicemail.parentElement?.classList.contains("justify-end")).toBe(true);
  });
  it("lists all call types newest first with icon-only listen and callback actions", async () => {
    api.request.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/calls/settings") return { available: true, speedDial: [5, 9] };
      if (path === "/calls" && options?.method === "POST") return { id: "return-call", status: "ringing" };
      if (path === "/calls") return [
        { id: "incoming", incoming: true, callerUserId: 8, callerName: "Morgan", status: "ended", createdAt: "2026-11-20T14:01:00Z" },
        { id: "outgoing", incoming: false, recipientUserId: 9, recipientName: "Riley", status: "ended", createdAt: "2026-11-20T14:02:00Z" },
        { id: "missed", incoming: true, callerUserId: 10, callerName: "Casey", status: "missed", createdAt: "2026-11-20T14:04:00Z" },
      ];
      if (path === "/voicemail") return [{
        id: "mail1",
        senderUserId: 5,
        senderName: "Jordan",
        durationMs: 3500,
        createdAt: "2026-11-20T14:03:00Z",
        readAt: null,
        transcript: "Existing real transcript",
      }];
      return defaults(path);
    });
    mount();
    const log = await screen.findByRole("table", { name: "Call log" });
    await waitFor(() => expect(within(log).getAllByRole("row")).toHaveLength(5));
    const rows = within(log).getAllByRole("row").slice(1);
    expect(rows.map(row => within(row).getAllByRole("cell")[0].textContent)).toEqual(["Missed", "Voicemail", "Outgoing", "Incoming"]);
    const contactButtons = rows.map(row => within(within(row).getAllByRole("cell")[1]).getByRole("button"));
    expect(contactButtons.map(button => button.getAttribute("aria-description"))).toEqual([null, "On speed dial", "On speed dial", null]);
    expect(contactButtons.map(button => button.firstElementChild?.classList.contains("fill-current"))).toEqual([false, true, true, false]);
    expect(contactButtons.every(button => button.firstElementChild?.tagName === "svg")).toBe(true);
    const mailCells = within(rows[1]).getAllByRole("cell");
    expect(mailCells[1].textContent).toContain("Jordan");
    expect(mailCells[2].querySelector("time")?.dateTime).toBe("2026-11-20T14:03:00Z");
    const callback = within(mailCells[3]).getByRole("button", { name: "Return call to Jordan" });
    expect(callback.textContent).toBe("");
    fireEvent.click(callback);
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("/calls", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ recipientUserId: 5, operationId: "0198de93-3eb4-7881-901a-513bccccc001" }),
    })));
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const listen = within(mailCells[3]).getByRole("button", { name: "Listen to voicemail from Jordan" });
    expect(screen.getAllByRole("button", { name: /listen to voicemail/i })).toHaveLength(1);
    expect(listen.textContent).toBe("");
    fireEvent.click(listen);
    expect(play).toHaveBeenCalledOnce();
    play.mockRestore();
    const panel = await screen.findByRole("region", { name: "Selected voicemail" });
    const panelUi = within(panel);
    const player = panelUi.getByRole("group", { name: "Voicemail playback" });
    const transcript = panelUi.getByText("Existing real transcript");
    expect(panelUi.getByText("4 seconds").nextElementSibling).toBe(transcript);
    expect(panelUi.queryByText("Jordan · voicemail")).toBeNull();
    const contactHistory = panelUi.getByRole("list", { name: "Call history with Jordan" });
    expect(panel.hasAttribute("data-work-hub-card")).toBe(false);
    expect(panel.classList.contains("border-transparent")).toBe(true);
    expect(panel.firstElementChild?.contains(player)).toBe(true);
    expect(transcript.parentElement).toBe(panel.firstElementChild?.nextElementSibling);
    expect(transcript.parentElement?.nextElementSibling).toBe(contactHistory);
    expect(panel.closest("tr")).toBe(rows[1].nextElementSibling);
    expect(log.contains(panel)).toBe(true);
    const audio = panelUi.getByLabelText("Voicemail from Jordan") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toBe("/api/work-hub/voicemail/mail1/audio");
    expect(audio.controls).toBe(false);
    fireEvent.play(audio);
    expect(within(player).getByRole("button", { name: "Pause voicemail" })).toBeTruthy();
    fireEvent.change(within(player).getByRole("slider", { name: "Voicemail position" }), { target: { value: "1.5" } });
    expect(audio.currentTime).toBe(1.5);
    fireEvent.pause(audio);
    expect(within(player).getByRole("button", { name: "Play voicemail" })).toBeTruthy();
    const deleteAction = panelUi.getByRole("button", { name: "Delete" });
    expect(deleteAction.parentElement).toBe(panel.firstElementChild);
    expect(deleteAction.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(deleteAction.classList.contains("vendor-mini-card-button")).toBe(false);
    fireEvent.click(deleteAction);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/voicemail/mail1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
  it("toggles the untitled contact history from a call or voicemail name", async () => {
    api.request.mockImplementation(async (path: string) => {
      if (path === "/calls") return [
        { id: "out", incoming: false, recipientUserId: 5, recipientName: "Jordan", status: "missed", createdAt: "2026-11-20T14:04:00Z" },
        { id: "other", incoming: true, callerUserId: 6, callerName: "Casey", status: "missed", createdAt: "2026-11-20T14:02:00Z" },
        { id: "in", incoming: true, callerUserId: 5, callerName: "Jordan", status: "ended", createdAt: "2026-11-20T14:01:00Z" },
      ];
      if (path === "/voicemail") return [
        { id: "message", senderUserId: 5, senderName: "Jordan", createdAt: "2026-11-20T14:03:00Z", readAt: null },
        { id: "mail-only", senderUserId: 7, senderName: "Sam", createdAt: "2026-11-20T14:00:00Z", readAt: null },
      ];
      return defaults(path);
    });
    mount();
    const log = await screen.findByRole("table", { name: "Call log" });
    const outgoing = within(log).getByRole("cell", { name: "Outgoing" }).closest("tr")!;
    const contact = within(outgoing).getByRole("button", { name: "Jordan" });
    fireEvent.click(contact);
    const history = screen.getByRole("list", { name: "Call history with Jordan" });
    expect(screen.queryByText("Jordan · missed")).toBeNull();
    const detail = history.closest("section")!;
    expect(detail.closest("tr")).toBe(outgoing.nextElementSibling);
    expect(detail.classList.contains("border-transparent")).toBe(true);
    expect(contact.getAttribute("aria-controls")).toBe(detail.id);
    expect(contact.getAttribute("aria-expanded")).toBe("true");
    expect(within(history).getAllByRole("listitem").map(entry => entry.querySelector("span")?.textContent)).toEqual([
      "Outgoing", "Voicemail", "Incoming",
    ]);
    expect([...history.querySelectorAll("time")].map(time => time.dateTime)).toEqual([
      "2026-11-20T14:04:00Z", "2026-11-20T14:03:00Z", "2026-11-20T14:01:00Z",
    ]);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    fireEvent.click(within(history).getByRole("button", { name: /^Listen to voicemail from Jordan/ }));
    expect(play).toHaveBeenCalledOnce();
    play.mockRestore();
    const inlinePlayer = within(detail).getByRole("group", { name: "Voicemail playback" });
    expect(detail.firstElementChild?.contains(inlinePlayer)).toBe(true);
    expect(detail.lastElementChild).toBe(history);
    fireEvent.click(contact);
    expect(contact.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Call history with Jordan" })).toBeNull();

    const voicemailContact = within(log).getByRole("button", { name: "Jordan, new voicemail" });
    fireEvent.click(voicemailContact);
    const playerPanel = screen.getByRole("region", { name: "Selected voicemail" });
    expect(within(playerPanel).getByRole("group", { name: "Voicemail playback" })).toBeTruthy();
    expect(playerPanel.closest("tr")).toBe(voicemailContact.closest("tr")?.nextElementSibling);
    expect(playerPanel.lastElementChild).toBe(within(playerPanel).getByRole("list", { name: "Call history with Jordan" }));
    const mailOnlyContact = within(log).getByRole("button", { name: "Sam, new voicemail" });
    fireEvent.click(mailOnlyContact);
    expect(screen.queryByRole("list", { name: "Call history with Jordan" })).toBeNull();
    expect(screen.getByRole("list", { name: "Call history with Sam" })).toBeTruthy();
    fireEvent.click(mailOnlyContact);
    expect(screen.queryByRole("list", { name: "Call history with Sam" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Selected voicemail" })).toBeNull();
  });
  it("surfaces call failure without displaying a connected room", async () => {
    api.request.mockImplementation(async (path: string, options?: any) => {
      if (path === "/calls" && options?.method === "POST")
        throw new Error("Contact invitation must be accepted");
      return defaults(path);
    });
    mount();
    openCallPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Jordan" }));
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect((await screen.findAllByRole("alert")).some(alert => alert.textContent?.includes("Contact invitation must be accepted"))).toBe(true);
    expect(screen.queryByText(/Audio room/)).toBeNull();
  });
  it("toggles availability beside the Call log title and uses mini-card buttons for dialing", async () => {
    let available = true;
    api.request.mockImplementation(async (path: string, options?: any) => {
      if (path === "/calls/settings") {
        if (options?.method === "PUT") available = JSON.parse(options.body).available;
        return { available, speedDial: [] };
      }
      return defaults(path);
    });
    mount();
    const presence = await screen.findByRole("button", {
      name: "Available for calls",
    });
    await waitFor(() =>
      expect((presence as HTMLButtonElement).disabled).toBe(false),
    );
    expect(presence.classList.contains("vendor-mini-card-button")).toBe(false);
    expect(presence.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(presence.firstChild).toBe(presence.querySelector("svg"));
    expect(presence.classList.contains("no-underline")).toBe(true);
    expect(presence.getAttribute("aria-pressed")).toBe("true");
    expect(presence.textContent).toBe("Available");
    fireEvent.click(presence);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/calls/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ available: false }),
        }),
      ),
    );
    await waitFor(() => expect(presence.textContent).toBe("Away"));
    expect(presence.getAttribute("aria-pressed")).toBe("false");
    expect(presence.classList.contains("text-gray-400")).toBe(true);
    fireEvent.click(presence);
    await waitFor(() => expect(presence.textContent).toBe("Available"));
  });
  it("switches the active panel using the Calls toolbar", async () => {
    api.request.mockImplementation(async (path: string) => defaults(path));
    mount();
    const master = await screen.findByRole("region", { name: "Calls workspace" });
    const heading = screen.getByRole("heading", { name: "Call log" });
    const presence = screen.getByRole("button", { name: "Available for calls" });
    expect(heading.nextElementSibling).toBe(presence);
    expect(heading.parentElement?.className).toContain("items-center");
    const history = screen.getByRole("region", { name: "Call history" });
    const toolbar = within(master).getByRole("group", { name: "Calls controls" });
    const log = within(toolbar).getByRole("button", {name:"Call log"});
    const start = within(history).getByRole("button", {name:"Start a call"});
    const devices = within(history).getByRole("button", {name:"Devices and audio backup"});
    expect(start.getAttribute("aria-label")).toBe("Start a call");
    expect(devices.getAttribute("aria-label")).toBe("Devices and audio backup");
    expect(history.parentElement?.parentElement).toBe(master);
    expect(history.classList.contains("w-full")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("work-hub-device-settings")).toBeNull();
    expect(master.className).toContain("border-[color:var(--brand-primary)]");
    fireEvent.click(start);
    const dial = await screen.findByRole("region", { name: "Start a call" });
    const call = within(dial).getByRole("button", { name: "Call" });
    const picker = within(dial).getByRole("combobox", { name: "Find a call contact" });
    expect(call.classList.contains("vendor-mini-card-button")).toBe(true);
    expect(picker.closest("[data-call-contact-picker]")?.nextElementSibling).toBe(call);
    fireEvent.keyDown(dial, {key:"Escape"});
    fireEvent.click(devices);
    fireEvent.click(await screen.findByRole("button", {name:"Expand devices panel"}));
    const audio = await screen.findByRole("region", { name: "Devices and audio backup" });
    expect(within(audio).getByTestId("work-hub-device-settings")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Start a call" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Call history" })).toBeNull();
    fireEvent.click(log);
    expect(screen.queryByRole("region", { name: "Devices and audio backup" })).toBeNull();
    expect(screen.getByRole("region", { name: "Call history" })).toBeTruthy();
    expect(log.getAttribute("aria-pressed")).toBe("true");
  });
  it("removes a speed-dial star from the contact picker without deleting call history", async () => {
    let speedDial = [5, 6];
    api.request.mockImplementation(async (path: string, options?: any) => {
      if (path === "/calls/settings") {
        if (options?.method === "PUT") {
          const { id } = JSON.parse(options.body).speedDialContact;
          speedDial = speedDial.filter(saved => saved !== id);
        }
        return { available: true, speedDial };
      }
      if (path === "/people?directory=calls") return [{ id: 5, displayName: "Jordan" }, { id: 6, displayName: "Casey" }];
      if (path === "/calls") return [
        { id: "older", incoming: false, recipientUserId: 5, recipientName: "Jordan", callerUserId: 7, createdAt: "2026-09-09T10:00:00Z", status: "ended" },
        { id: "newer", incoming: true, recipientUserId: 7, callerUserId: 6, callerName: "Casey", createdAt: "2026-09-10T10:00:00Z", status: "ended" },
      ];
      return [];
    });
    mount();
    expect(screen.queryByRole("heading", { name: "Speed dial" })).toBeNull();
    openCallPicker();
    const picker = within(screen.getByRole("grid", { name: "Call contacts" }));
    const remove = await picker.findByRole("button", { name: "Remove Casey from speed dial" });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/calls/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ speedDialContact: { id: 6, saved: false } }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Call log" }));
    const log = await screen.findByRole("table", { name: "Call log" });
    await waitFor(() => expect(within(log).getByRole("button", { name: "Casey" }).querySelector("svg")?.classList.contains("fill-none")).toBe(true));
    expect(within(log).getByRole("button", { name: "Jordan" }).querySelector("svg")?.classList.contains("fill-current")).toBe(true);
  });
  it("filters call contacts and toggles stars without selecting or dialing a contact", async () => {
    const jordan = { id: 5, displayName: "Jordan", organizationName: "NewTech", operationalRole: "gatekeeper" };
    const casey = { id: 6, displayName: "Casey", organizationName: "MidCon Solutions", role: "admin" };
    let speedDial = [6];
    api.request.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/people?directory=calls") return [jordan, casey];
      if (path === "/people?directory=calls&search=j.smith%40example.invalid") return [jordan];
      if (path === "/calls/settings") {
        if (options?.method === "PUT") {
          const { id, saved } = JSON.parse(String(options.body)).speedDialContact;
          speedDial = saved ? [...speedDial, id] : speedDial.filter(contactId => contactId !== id);
        }
        return { available: true, speedDial };
      }
      return defaults(path);
    });
    mount();
    const input = openCallPicker();
    const grid = screen.getByRole("grid", { name: "Call contacts" });
    await within(grid).findByRole("button", { name: "Remove Casey from speed dial" });
    expect(within(grid).getAllByRole("row")[0].textContent).toContain("Casey");
    for (const query of ["Gatekeepers", "NewTech", "Jor", "j.smith@example.invalid"]) {
      fireEvent.change(input, { target: { value: query } });
      await within(grid).findByRole("button", { name: "Jordan, NewTech, Gatekeeper" });
      expect(within(grid).getAllByRole("row")).toHaveLength(1);
    }
    fireEvent.change(input, { target: { value: "midcon" } });
    expect(within(grid).getByRole("button", { name: "Casey, MidCon Solutions, Administrative Team Member" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    const hollow = within(grid).getByRole("button", { name: "Add Jordan to speed dial" });
    expect(hollow.querySelector("svg")?.classList.contains("fill-current")).toBe(false);
    fireEvent.click(hollow);
    const filled = await within(grid).findByRole("button", { name: "Remove Jordan from speed dial" });
    expect(filled.querySelector("svg")?.classList.contains("fill-current")).toBe(true);
    expect((input as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(filled.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(filled);
    await within(grid).findByRole("button", { name: "Add Jordan to speed dial" });
    fireEvent.change(input, { target: { value: "Jor" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("Jordan");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(api.request.mock.calls.some(([path, options]) => path === "/calls" && options?.method === "POST")).toBe(false);
  });
  it("opens the call flyout with the contact supplied by an existing call link", async () => {
    api.request.mockImplementation(async (path: string) => defaults(path));
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/work-hub/calls?person=5");
    try {
      mount();
      const panel = await screen.findByRole("region", { name: "Start a call" });
      expect(await within(panel).findByDisplayValue("Jordan")).toBeTruthy();
      expect((within(panel).getByRole("button", { name: "Call" }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });
});
