import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../lib/locales/en.json";

const { apiFetch, auth } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  auth: { generation: 0, listeners: new Set<() => void>() },
}));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: auth.generation }),
  isAuthScopeCurrent: (scope: { generation: number }) => scope.generation === auth.generation,
  subscribeUser: (cb: () => void) => { auth.listeners.add(cb); return () => auth.listeners.delete(cb); },
  subscribeToken: () => () => {},
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, usePathname: () => "/notification-preferences" }));
vi.mock("@/components/PortalPageHeader", () => ({ default: () => null }));
vi.mock("@/components/InPageHeader", () => ({ default: () => null }));
vi.mock("@/components/AmberButton", () => ({
  default: ({ children, disabled, onPress }: any) => <button disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
function translate(key: string) { return key.split(".").reduce<any>((value, part) => value?.[part], en) ?? key; }
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
import NotificationPreferencesScreen from "../notification-preferences";

const gate = {
  mode: "gate", scheduleEnabled: true, gateCrewEnabled: true, messagesEnabled: true,
  handoffsEnabled: true, tasksEnabled: true, complianceEnabled: true, alertsEnabled: true,
  pushEnabled: true, dndStartHour: null, dndEndHour: null,
};
const office = {
  ticketsEnabled: true, hotlistEnabled: true, complianceEnabled: true, crewEnabled: true,
  systemEnabled: true, commentsEnabled: true, commentMentionEmailEnabled: true,
  commentReplyEmailEnabled: true, pushEnabled: true, dndStartHour: null, dndEndHour: null,
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function switchAccount() { await act(async () => { auth.generation++; auth.listeners.forEach((cb) => cb()); }); }
beforeEach(() => { apiFetch.mockReset(); auth.generation = 0; });
afterEach(cleanup);

describe("role-specific notification preferences", () => {
  it("shows seven gate categories and sends only editable gate fields", async () => {
    apiFetch.mockResolvedValue({ ...gate, userId: 123, ticketsEnabled: true });
    render(<NotificationPreferencesScreen />);
    await screen.findByRole("switch", { name: "Schedule" });
    for (const label of ["Schedule", "Gate Crew", "Messages", "Handoffs", "Tasks", "Compliance", "Alerts"]) {
      expect(screen.getByRole("switch", { name: label })).toBeTruthy();
    }
    for (const label of ["Tickets", "Hotlist", "Crew", "Comments & mentions", "System", "All"]) expect(screen.queryByText(label)).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(8);
    fireEvent.click(screen.getByRole("switch", { name: "Messages" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const { mode: _mode, ...editable } = gate;
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ ...editable, messagesEnabled: false });
  });

  it("keeps existing office controls and does not write unshown email preferences", async () => {
    apiFetch.mockResolvedValue({ ...office, userId: 123, ticketsEmailEnabled: false });
    render(<NotificationPreferencesScreen />);
    await screen.findByRole("switch", { name: "Tickets" });
    for (const label of ["Tickets", "Hotlist", "Crew", "System", "Comments & mentions"]) expect(screen.getByRole("switch", { name: label })).toBeTruthy();
    expect(screen.queryByText("Handoffs")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual(office);
  });

  it("shows a retry after loading fails and never exposes editable defaults", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(gate);
    render(<NotificationPreferencesScreen />);
    await screen.findByText("Couldn't load notification settings.");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("switch", { name: "Schedule" });
  });

  it("retains the draft after server rejection and accepts the server's saved values on retry", async () => {
    apiFetch.mockResolvedValueOnce(gate).mockRejectedValueOnce(new Error("validation failed"))
      .mockResolvedValueOnce({ ...gate, messagesEnabled: true });
    render(<NotificationPreferencesScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "Messages" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByText("Couldn't save preferences.");
    expect((screen.getByRole("switch", { name: "Messages" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect((screen.getByRole("switch", { name: "Messages" }) as HTMLInputElement).checked).toBe(true));
  });

  it("disables editing while saving so a late response cannot overwrite a newer draft", async () => {
    const pending = deferred<typeof gate>();
    apiFetch.mockResolvedValueOnce(gate).mockReturnValueOnce(pending.promise);
    render(<NotificationPreferencesScreen />);
    await screen.findByRole("switch", { name: "Schedule" });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect((screen.getByRole("switch", { name: "Schedule" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save preferences" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve(gate));
  });

  it.each(["load", "save"])("ignores a previous account's pending %s response", async (kind) => {
    const pending = deferred<typeof gate>();
    if (kind === "load") apiFetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(office);
    else apiFetch.mockResolvedValueOnce(gate).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(office);
    render(<NotificationPreferencesScreen />);
    if (kind === "save") { await screen.findByRole("switch", { name: "Schedule" }); fireEvent.click(screen.getByRole("button", { name: "Save preferences" })); }
    await switchAccount();
    await screen.findByRole("switch", { name: "Tickets" });
    await act(async () => pending.resolve(gate));
    expect(screen.queryByText("Schedule")).toBeNull();
    expect(screen.getByRole("switch", { name: "Tickets" })).toBeTruthy();
  });

  it("does not submit an old draft if the account changes just before Save is handled", async () => {
    apiFetch.mockResolvedValueOnce(gate).mockResolvedValue(office);
    render(<NotificationPreferencesScreen />);
    await screen.findByRole("switch", { name: "Schedule" });
    const save = screen.getByRole("button", { name: "Save preferences" });
    await act(async () => {
      auth.generation++;
      auth.listeners.forEach((cb) => cb());
      fireEvent.click(save);
    });
    await screen.findByRole("switch", { name: "Tickets" });
    expect(apiFetch.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(0);
  });

  it.each([null, { ...gate, scheduleEnabled: "yes" }, { ...gate, dndStartHour: 30 }])("shows a load error for malformed server preferences %#", async (response) => {
    apiFetch.mockResolvedValue(response);
    render(<NotificationPreferencesScreen />);
    await screen.findByText("Couldn't load notification settings.");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("keeps the draft when the save response is malformed", async () => {
    apiFetch.mockResolvedValueOnce(gate).mockResolvedValueOnce(null);
    render(<NotificationPreferencesScreen />);
    fireEvent.click(await screen.findByRole("switch", { name: "Messages" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByText("Couldn't save preferences.");
    expect((screen.getByRole("switch", { name: "Messages" }) as HTMLInputElement).checked).toBe(false);
  });
});
