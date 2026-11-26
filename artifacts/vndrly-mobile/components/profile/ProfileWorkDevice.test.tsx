import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consentLabel = "I use this device for work and authorize VNDRLY to share its location with my company during active work.";
const m = vi.hoisted(() => ({ current: true, workDeviceIds: [] as string[],
  devices: [{ id: "phone", friendlyName: "iPhone 15", deviceClass: "phone" }, { id: "tablet", friendlyName: "iPad Air", deviceClass: "tablet" }, { id: "old", friendlyName: "Old iPhone", deviceClass: "phone" }],
  foreground: vi.fn(), requestForeground: vi.fn(), requestBackground: vi.fn(), register: vi.fn(),
  accept: vi.fn(), setDeclined: vi.fn(), updateNative: vi.fn(), setWorkDevice: vi.fn(), start: vi.fn(), api: vi.fn(), saved: vi.fn(), read: vi.fn() }));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: m.foreground,
  requestForegroundPermissionsAsync: m.requestForeground, requestBackgroundPermissionsAsync: m.requestBackground }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => m.current }));
vi.mock("@/lib/api", () => ({ apiFetch: m.api }));
vi.mock("@/lib/deviceId", () => ({ getDeviceId: async () => "phone" }));
vi.mock("@/lib/account-device-registration", () => ({ registerAccountWorkDevice: m.register }));
vi.mock("@/lib/locationConsent", () => ({ acceptConsent: m.accept, setConsentDeclined: m.setDeclined }));
vi.mock("@/lib/native-operations", () => ({ readNativeOperations: m.read,
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
  m.read.mockReset(); m.read.mockImplementation(async () => ({ workDeviceIds: [...m.workDeviceIds], devices: m.devices }));
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
  it("shows the tick at once and ignores more taps until the saved result is on screen", async () => {
    const box = await open();
    const save = deferred();
    m.setWorkDevice.mockImplementation(async (id: string) => { await save.promise; m.workDeviceIds = [id]; });
    fireEvent.click(box);
    await waitFor(() => expect(box.textContent).toContain("☑"));
    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(box.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(box); fireEvent.click(box);
    await waitFor(() => expect(m.setWorkDevice).toHaveBeenCalledOnce());
    const read = deferred();
    m.read.mockImplementation(async () => { await read.promise; return { workDeviceIds: [...m.workDeviceIds], devices: m.devices }; });
    save.resolve();
    await waitFor(() => expect(m.saved).toHaveBeenCalledOnce());
    // The save is done but its result is not on screen yet: a tap here used to start a second save or undo the first.
    fireEvent.click(box);
    expect(box.getAttribute("aria-disabled")).toBe("true");
    read.resolve();
    await screen.findByText("This is a work device");
    await waitFor(() => expect(box.getAttribute("aria-disabled")).not.toBe("true"));
    expect(box.textContent).toContain("☑");
    expect(screen.queryByText("Saving…")).toBeNull();
    expect(m.setWorkDevice).toHaveBeenCalledOnce(); expect(m.setWorkDevice).toHaveBeenCalledWith("phone", true);
  });
  it("keeps the saved tick when an older status read finishes late", async () => {
    const box = await open();
    const stale = deferred();
    m.read.mockImplementationOnce(async () => { const before = { workDeviceIds: [...m.workDeviceIds], devices: m.devices }; await stale.promise; return before; });
    document.dispatchEvent(new Event("visibilitychange")); // the app returns to the foreground and starts a status read
    await waitFor(() => expect(m.read).toHaveBeenCalledTimes(2));
    fireEvent.click(box);
    await screen.findByText("This is a work device");
    await waitFor(() => expect(box.getAttribute("aria-disabled")).not.toBe("true"));
    stale.resolve();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByText("This is a work device")).toBeTruthy();
    expect(box.textContent).toContain("☑");
  });
  it("puts the box back and explains when saving fails", async () => {
    m.setWorkDevice.mockRejectedValue(new Error("Could not save"));
    const box = await open();
    fireEvent.click(box);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save");
    await waitFor(() => expect(box.getAttribute("aria-disabled")).not.toBe("true"));
    expect(box.textContent).toContain("☐");
    expect(screen.getByText("This is not a work device")).toBeTruthy();
  });
  it("does not authorize a different account after an OS permission prompt", async () => {
    m.foreground.mockResolvedValue({ status: "denied" });
    m.requestForeground.mockImplementation(async () => { m.current = false; return { status: "granted" }; });
    fireEvent.click(await open());
    await screen.findByRole("alert"); expect(m.register).not.toHaveBeenCalled(); expect(m.setWorkDevice).not.toHaveBeenCalled();
  });
});
