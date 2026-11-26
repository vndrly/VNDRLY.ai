import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consentLabel = "I use this device for work and authorize VNDRLY to share its location with my company during active work.";
const m = vi.hoisted(() => ({ current: true, workDeviceIds: [] as string[],
  devices: [{ id: "phone", friendlyName: "iPhone 15", deviceClass: "phone" }, { id: "tablet", friendlyName: "iPad Air", deviceClass: "tablet" }, { id: "old", friendlyName: "Old iPhone", deviceClass: "phone" }],
  foreground: vi.fn(), requestForeground: vi.fn(), requestBackground: vi.fn(), register: vi.fn(),
  accept: vi.fn(), setDeclined: vi.fn(), updateNative: vi.fn(), setWorkDevice: vi.fn(), start: vi.fn(), api: vi.fn(), saved: vi.fn() }));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: m.foreground,
  requestForegroundPermissionsAsync: m.requestForeground, requestBackgroundPermissionsAsync: m.requestBackground }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => m.current }));
vi.mock("@/lib/api", () => ({ apiFetch: m.api }));
vi.mock("@/lib/deviceId", () => ({ getDeviceId: async () => "phone" }));
vi.mock("@/lib/account-device-registration", () => ({ registerAccountWorkDevice: m.register }));
vi.mock("@/lib/locationConsent", () => ({ acceptConsent: m.accept, setConsentDeclined: m.setDeclined }));
vi.mock("@/lib/native-operations", () => ({ readNativeOperations: async () => ({ workDeviceIds: [...m.workDeviceIds], devices: m.devices }),
  updateNativeConsent: m.updateNative, setNativeWorkDevice: m.setWorkDevice }));
vi.mock("@/lib/liveLocationReporter", () => ({ startLiveLocationReporter: m.start }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue" }) }));
vi.mock("../StatusShield", () => ({ default: ({ label }: any) => <span>{label}</span> }));
vi.mock("@/components/gate/GateChrome", () => ({ gateStyle: { text: {} }, useGateCopy: () => (en: string) => en,
  GateRow: ({ label, expanded, trailing, onPress }: any) => <div><button aria-expanded={expanded} onClick={onPress}>{label}</button>{trailing}</div> }));
vi.mock("@/components/ProfileMiniCardButton", () => ({ default: ({ children, disabled, onPress }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import ProfileWorkDevice from "./ProfileWorkDevice";

const open = async () => {
  render(<ProfileWorkDevice header={title => <h2>{title}</h2>} agreementVersion="2026-11-14" onSaved={m.saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Work Device Authorization" }));
  const box = screen.getByRole("checkbox", { name: consentLabel });
  await waitFor(() => expect(box.getAttribute("aria-disabled")).not.toBe("true"));
  return box;
};
beforeEach(() => {
  vi.clearAllMocks(); m.current = true; m.workDeviceIds = [];
  m.foreground.mockResolvedValue({ status: "granted" }); m.requestForeground.mockResolvedValue({ status: "granted" });
  m.requestBackground.mockResolvedValue({ status: "granted" }); m.register.mockResolvedValue("phone");
  m.setWorkDevice.mockImplementation(async (id: string, authorized: boolean) => {
    m.workDeviceIds = authorized ? [...m.workDeviceIds, id] : m.workDeviceIds.filter(saved => saved !== id);
  });
  m.api.mockResolvedValue({}); m.saved.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Profile work device card", () => {
  it("opens and closes without asking permission or authorizing anything", async () => {
    await open();
    expect(screen.getByText("This is not a work device")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("profile-work-device-details")).toBeNull();
    expect(m.requestForeground).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled(); expect(m.setWorkDevice).not.toHaveBeenCalled();
  });
  it("authorizes this device with location consent when the box is checked", async () => {
    fireEvent.click(await open());
    await waitFor(() => expect(m.saved).toHaveBeenCalledOnce());
    expect(m.accept).toHaveBeenCalledOnce(); expect(m.updateNative).toHaveBeenCalledWith(true); expect(m.setDeclined).toHaveBeenCalledWith(false);
    expect(m.api).toHaveBeenCalledWith("/api/personal-agreements", expect.objectContaining({ body: JSON.stringify({ document: "location_sharing", version: "2026-11-14", accepted: true }) }), expect.anything());
    expect(m.setWorkDevice).toHaveBeenCalledWith("phone", true);
    await screen.findByText("This is a work device");
    expect(screen.getByText("iPhone 15 · This device")).toBeTruthy();
    expect(screen.queryByText("Old iPhone")).toBeNull();
  });
  it("does not authorize the device when location access is denied", async () => {
    m.foreground.mockResolvedValue({ status: "denied" }); m.requestForeground.mockResolvedValue({ status: "denied" });
    fireEvent.click(await open());
    expect((await screen.findByRole("alert")).textContent).toContain("Allow location access");
    expect(m.accept).not.toHaveBeenCalled(); expect(m.setWorkDevice).not.toHaveBeenCalled();
  });
  it("lists a second work device and removes only the device selected", async () => {
    m.workDeviceIds = ["phone", "tablet"];
    await open();
    await screen.findByText("iPad Air");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(m.setWorkDevice).toHaveBeenCalledWith("tablet", false));
    await waitFor(() => expect(screen.queryByText("iPad Air")).toBeNull());
    expect(screen.getByText("iPhone 15 · This device")).toBeTruthy(); expect(m.accept).not.toHaveBeenCalled();
  });
  it("removes this device when its box is unchecked", async () => {
    m.workDeviceIds = ["phone"];
    const box = await open();
    await screen.findByText("This is a work device");
    fireEvent.click(box);
    await waitFor(() => expect(m.setWorkDevice).toHaveBeenCalledWith("phone", false));
    await screen.findByText("This is not a work device");
  });
  it("does not authorize a different account after an OS permission prompt", async () => {
    m.foreground.mockResolvedValue({ status: "denied" });
    m.requestForeground.mockImplementation(async () => { m.current = false; return { status: "granted" }; });
    fireEvent.click(await open());
    await screen.findByRole("alert"); expect(m.register).not.toHaveBeenCalled(); expect(m.setWorkDevice).not.toHaveBeenCalled();
  });
});
