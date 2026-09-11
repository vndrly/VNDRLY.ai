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
vi.mock("@/lib/work-hub-client", () => ({
  workHubRequest: api.request,
  createWorkHubOperationId: () => "0198de93-3eb4-7881-901a-513bccccc001",
}));
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
  afterEach(cleanup);
  beforeEach(() => api.request.mockReset());
  const defaults = (path: string) =>
    path === "/calls/settings"
      ? { available: true, speedDial: [] }
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
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/calls/call1/respond",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "accept" }),
        }),
      ),
    );
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
      name: "Show me as available for calls",
    });
    await waitFor(() =>
      expect((presence as HTMLButtonElement).disabled).toBe(false),
    );
    expect(presence.getAttribute("aria-pressed")).toBe("true");
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
