import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeCallCompanionProvider } from "./NativeCallCompanion";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), dispose: vi.fn(),
  user: { id: 7, vendorId: 4, activeMembershipId: 12 },
  device: { deviceId: "iphone", connectionId: "test-connection" },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", primaryForeground: "white", card: "black", text: "white", muted: "gray" }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock("@/hooks/use-work-hub-device-presence", () => ({ nativeWorkHubDeviceIdentity: async () => mocks.device }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.request }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}), isAuthScopeCurrent: () => true,
  subscribeUser: () => () => {}, subscribeToken: () => () => {},
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button>,
}));
vi.mock("@/components/WorkHubAudioRoom", () => ({
  default: ({ autoStartCall }: { autoStartCall: boolean }) => {
    useEffect(() => () => { mocks.dispose(); }, []);
    return <div>{autoStartCall ? "Audio attached" : "Waiting to join audio"}</div>;
  },
}));

it("answers on the current iOS screen, renders both caption colors, and keeps the room while the screen changes", async () => {
  const call = { id: "call1", occurrenceId: "room1", callerName: "Jordan", incoming: true };
  let status = "ringing";
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith("?filter=live")) return [{ ...call, status }];
    if (path.endsWith("/respond")) { status = "active"; return { selectedAudioOwner: true }; }
    if (path.endsWith("/catch-up")) return { participationMode: "active" };
    if (path.endsWith("/transcription-state")) return { enabled: true };
    if (path.endsWith("/transcript")) return { segments: [
      { id: "a", speakerUserId: 7, speakerName: "Me", text: "Calendar is open." },
      { id: "b", speakerUserId: 8, speakerName: "Jordan", text: "I can hear you." },
    ] };
    throw new Error("Unexpected request: " + path);
  });
  function Screen() {
    const [page, setPage] = useState("Calendar");
    return <main><h1>{page}</h1><button onClick={() => setPage("Files")}>Open Files</button></main>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><NativeCallCompanionProvider><Screen /></NativeCallCompanionProvider></QueryClientProvider>);
  expect(await screen.findByText("Jordan is calling")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText("Audio attached")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Calendar" })).toBeTruthy();
  const mine = await screen.findByText("Calendar is open.");
  const their = await screen.findByText("I can hear you.");
  expect(mine.parentElement?.style.backgroundColor).toBe("rgb(0, 0, 255)");
  expect(their.parentElement?.style.backgroundColor).toBe("rgb(128, 128, 128)");
  fireEvent.click(screen.getByRole("button", { name: "Open Files" }));
  expect(screen.getByRole("heading", { name: "Files" })).toBeTruthy();
  await waitFor(() => expect(screen.getByText("Audio attached")).toBeTruthy());
  expect(mocks.dispose).not.toHaveBeenCalled();
});
