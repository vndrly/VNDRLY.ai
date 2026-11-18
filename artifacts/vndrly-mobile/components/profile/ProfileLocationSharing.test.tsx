import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ consent: "not_accepted", declined: false, native: false, current: true,
  foreground: vi.fn(), background: vi.fn(), requestForeground: vi.fn(), requestBackground: vi.fn(),
  accept: vi.fn(), revoke: vi.fn(), setDeclined: vi.fn(), updateNative: vi.fn(), start: vi.fn(), stop: vi.fn(), api: vi.fn(), saved: vi.fn() }));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: m.foreground, getBackgroundPermissionsAsync: m.background,
  requestForegroundPermissionsAsync: m.requestForeground, requestBackgroundPermissionsAsync: m.requestBackground }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => m.current }));
vi.mock("@/lib/api", () => ({ apiFetch: m.api }));
vi.mock("@/lib/locationConsent", () => ({ getDeviceConsentStatus: async () => m.consent, isConsentDeclined: async () => m.declined,
  acceptConsent: m.accept, revokeConsent: m.revoke, setConsentDeclined: m.setDeclined }));
vi.mock("@/lib/native-operations", () => ({ readNativeOperations: async () => ({ consent: { locationSharing: m.native } }), updateNativeConsent: m.updateNative }));
vi.mock("@/lib/liveLocationReporter", () => ({ startLiveLocationReporter: m.start, stopLiveLocationReporter: m.stop }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue" }) }));
vi.mock("@/components/gate/GateChrome", () => ({ gateStyle: { text: {} }, useGateCopy: () => (en: string) => en,
  GateRow: ({ label, expanded, trailing, onPress }: any) => <div><button aria-expanded={expanded} onClick={onPress}>{label}</button>{trailing}</div> }));
vi.mock("@/components/ProfileMiniCardButton", () => ({ default: ({ children, disabled, onPress }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import ProfileLocationSharing from "./ProfileLocationSharing";

function Profile({ vendorContext = true }: { vendorContext?: boolean }) {
  const [open, setOpen] = useState<"location" | "stop" | null>(null);
  return <ProfileLocationSharing open={open} onOpenChange={setOpen} header={title => <h2>{title}</h2>}
    vendorContext={vendorContext} agreementVersion="2026-11-14" onSaved={m.saved} />;
}
const sharingSwitch = () => screen.getByRole("switch", { name: "Location sharing and consent" });
beforeEach(() => {
  vi.clearAllMocks(); m.consent = "not_accepted"; m.declined = false; m.native = false; m.current = true;
  m.foreground.mockResolvedValue({ status: "granted" }); m.background.mockResolvedValue({ status: "granted" });
  m.requestForeground.mockResolvedValue({ status: "granted" }); m.requestBackground.mockResolvedValue({ status: "granted" });
  m.accept.mockImplementation(async () => { m.consent = "accepted"; });
  m.revoke.mockImplementation(async () => { m.consent = "not_accepted"; });
  m.setDeclined.mockImplementation(async value => { m.declined = value; });
  m.updateNative.mockImplementation(async value => { m.native = value; });
  m.start.mockResolvedValue(undefined); m.stop.mockResolvedValue(undefined); m.api.mockResolvedValue({}); m.saved.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Profile inline location controls", () => {
  it("expands and closes on Profile without asking permission or writing consent", async () => {
    render(<Profile />);
    const row = screen.getByRole("button", { name: "Location sharing and consent" });
    fireEvent.click(row); expect(screen.getByTestId("profile-location-details")).toBeTruthy();
    await screen.findByText("Location sharing is stopped on this phone.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("profile-location-details")).toBeNull();
    expect(m.requestForeground).not.toHaveBeenCalled(); expect(m.requestBackground).not.toHaveBeenCalled(); expect(m.accept).not.toHaveBeenCalled(); expect(m.api).not.toHaveBeenCalled();
  });
  it("turns on actual device and company consent from the slider", async () => {
    render(<Profile />); fireEvent.click(sharingSwitch());
    await waitFor(() => expect(m.saved).toHaveBeenCalledOnce());
    expect(m.accept).toHaveBeenCalledOnce(); expect(m.updateNative).toHaveBeenCalledWith(true); expect(m.setDeclined).toHaveBeenCalledWith(false); expect(m.start).toHaveBeenCalledOnce();
    expect(m.api).toHaveBeenCalledWith("/api/personal-agreements", expect.objectContaining({ body: JSON.stringify({ document: "location_sharing", version: "2026-11-14", accepted: true }) }), expect.anything());
    expect((sharingSwitch() as HTMLInputElement).checked).toBe(true);
  });
  it("does not save or start sharing when iOS denies location access", async () => {
    m.foreground.mockResolvedValue({ status: "denied" }); m.requestForeground.mockResolvedValue({ status: "denied" });
    render(<Profile />); fireEvent.click(sharingSwitch());
    expect((await screen.findByRole("alert")).textContent).toContain("Allow location access");
    expect(m.accept).not.toHaveBeenCalled(); expect(m.updateNative).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
  it("supports foreground sharing when background permission is declined", async () => {
    m.background.mockResolvedValue({ status: "denied" }); m.requestBackground.mockResolvedValue({ status: "denied" });
    render(<Profile />); fireEvent.click(sharingSwitch());
    await screen.findByText("Sharing allowed while the app is open during active work.");
    expect(m.start).toHaveBeenCalledOnce();
  });
  it("keeps Stop sharing inline and stops both systems when its action is selected", async () => {
    m.consent = "accepted"; m.native = true;
    render(<Profile />); fireEvent.click(screen.getByRole("button", { name: "Stop sharing live location" }));
    await screen.findByText("Sharing allowed during active work, including in the background.");
    expect(m.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing on this device" }));
    await waitFor(() => expect(m.updateNative).toHaveBeenCalledWith(false));
    expect(m.stop).toHaveBeenCalledOnce(); expect(m.revoke).toHaveBeenCalledOnce(); expect(m.setDeclined).toHaveBeenCalledWith(true);
    expect((sharingSwitch() as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("profile-stop-details")).toBeTruthy();
  });
  it("keeps sharing stopped locally if the server cannot save the revocation", async () => {
    m.consent = "accepted"; m.native = true; m.revoke.mockRejectedValueOnce(new Error("Offline"));
    render(<Profile />); fireEvent.click(screen.getByRole("button", { name: "Stop sharing live location" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing on this device" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Offline");
    expect(m.stop).toHaveBeenCalledOnce(); expect((sharingSwitch() as HTMLInputElement).checked).toBe(false);
  });
  it("saves device consent outside vendor contexts without requiring company-only operations", async () => {
    render(<Profile vendorContext={false} />); fireEvent.click(sharingSwitch());
    await waitFor(() => expect(m.saved).toHaveBeenCalledOnce());
    expect(m.accept).toHaveBeenCalledOnce(); expect(m.updateNative).not.toHaveBeenCalled();
  });
  it("does not save consent into a different account after an OS permission prompt", async () => {
    m.foreground.mockResolvedValue({ status: "denied" });
    m.requestForeground.mockImplementation(async () => { m.current = false; return { status: "granted" }; });
    render(<Profile />); fireEvent.click(sharingSwitch());
    await screen.findByRole("alert"); expect(m.accept).not.toHaveBeenCalled(); expect(m.updateNative).not.toHaveBeenCalled();
  });
});
