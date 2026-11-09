import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccessibilityInfo, Animated, AppState, type AppStateStatus } from "react-native";
import type { GateStaffingAlert } from "@workspace/gate-booth";
import { setUser, setToken } from "@/lib/auth";

const state = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn(), reducedMotion: false }));
vi.mock("@/lib/api", () => ({ apiFetch: state.api }));
vi.mock("expo-router", () => ({ router: { push: state.push } }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "#111", mutedForeground: "#555", border: "#ccc", card: "white", primary: "blue" }) }));
vi.mock("./TogglePillButton", () => ({ default: ({ children, onPress, disabled, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
import GateStaffingAlerts from "./GateStaffingAlerts";

const id = "11111111-1111-4111-8111-111111111111", stationId = "22222222-2222-4222-8222-222222222222", shiftId = "33333333-3333-4333-8333-333333333333";
const href = `/work-hub/calendar?siteId=399&stationId=${stationId}&shiftId=${shiftId}&date=2026-11-09`;
const alert: GateStaffingAlert = { id, code: "GATE-ABCDE", status: "open", severity: "critical", kind: "uncovered", siteId: 399, stationId, shiftId, siteName: "Synthetic site", gateName: "East gate", title: "Gate watch uncovered", startsAt: "2026-11-09T12:00:00Z", endsAt: "2026-11-10T00:00:00Z", timezone: "America/Chicago", requiredCount: 2, actualCount: 0, acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, createdAt: "2026-11-09T12:00:00Z", escalatedAt: "2026-11-09T12:10:00Z", href, canAcknowledge: true, notificationsPaused: false };
const winner = { ...alert, status: "acknowledged" as const, acknowledgedAt: "2026-11-09T12:15:00Z", acknowledgedBy: { userId: 22, name: "Other admin" }, canAcknowledge: false };
let stop: ReturnType<typeof vi.fn>;
let foreground: (state: AppStateStatus) => void;
beforeEach(async () => {
  state.api.mockReset(); state.push.mockReset(); state.reducedMotion = false;
  await setToken("synthetic-token");
  await setUser({ id: 9, username: "synthetic-admin", displayName: "Current admin", role: "vendor", vendorId: 7, activeMembershipId: 1 });
  state.api.mockImplementation(async (path: string) => {
    if (path === "/api/gate-staffing-alerts") return { alerts: [alert], notificationsPaused: false };
    if (path === `/api/gate-staffing-alerts/${id}/acknowledge`) return { alert: winner };
    throw new Error(`Unexpected request ${path}`);
  });
  stop = vi.fn();
  vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => state.reducedMotion);
  vi.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: vi.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  vi.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => { foreground = listener; return { remove: vi.fn() } as ReturnType<typeof AppState.addEventListener>; });
  vi.spyOn(Animated, "loop").mockReturnValue({ start: vi.fn(), stop, reset: vi.fn() } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("requires explicit confirmation and displays the saved first admin winner while stopping the critical pulse", async () => {
  render(<GateStaffingAlerts />);
  await screen.findByText("Gate watch uncovered");
  expect(getComputedStyle(screen.getByTestId(`staffing-alert-${id}`)).borderTopColor).toBe("rgb(220, 38, 38)");
  await waitFor(() => expect(Animated.loop).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Critical · Awaiting acknowledgment")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge staffing alert" }));
  expect(state.api.mock.calls.filter(call => call[0].endsWith("/acknowledge"))).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm acknowledgment" }));
  await screen.findByText(/Acknowledged by Other admin/);
  expect(screen.getByText(/12:15|6:15/)).toBeTruthy();
  expect(state.api.mock.calls.find(call => call[0].endsWith("/acknowledge"))?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ channel: "ios" }) });
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Acknowledge staffing alert" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open staffing calendar" }));
  expect(state.push).toHaveBeenCalledExactlyOnceWith(href);
});

it("leaves an unknown acknowledgment open and retries the same incident", async () => {
  state.api.mockImplementation(async (path: string) => {
    if (path.endsWith("/acknowledge")) throw new Error("network");
    return { alerts: [alert], notificationsPaused: false };
  });
  render(<GateStaffingAlerts />);
  fireEvent.click(await screen.findByRole("button", { name: "Acknowledge staffing alert" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm acknowledgment" }));
  await screen.findByText(/Acknowledgment could not be confirmed/);
  expect(screen.queryByText(/Acknowledged by/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Confirm acknowledgment" }));
  await waitFor(() => expect(state.api.mock.calls.filter(call => call[0].endsWith("/acknowledge"))).toHaveLength(2));
  expect(state.api.mock.calls.filter(call => call[0].endsWith("/acknowledge")).every(call => call[0] === `/api/gate-staffing-alerts/${id}/acknowledge`)).toBe(true);
});

it.each(["company", "incident", "midcon"])("keeps %s-held staffing facts neutral with no alarm or actions", async (hold) => {
  if (hold === "midcon") await setUser({ id: 9, username: "synthetic-admin", displayName: "Admin", role: "vendor", vendorId: 1054 });
  state.api.mockResolvedValue({ alerts: [{ ...alert, notificationsPaused: hold === "incident" }], notificationsPaused: hold === "company" });
  render(<GateStaffingAlerts />);
  await screen.findByText(/Staffing notifications paused/);
  expect(screen.getByText(/East gate/)).toBeTruthy();
  expect(screen.getByText(/0 on watch · 2 required/)).toBeTruthy();
  expect(screen.queryByText("Gate watch uncovered")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Acknowledge staffing alert" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open staffing calendar" })).toBeNull();
  expect(Animated.loop).not.toHaveBeenCalled();
});

it("respects reduced motion and omits restored incidents", async () => {
  state.reducedMotion = true;
  state.api.mockResolvedValue({ alerts: [alert, { ...alert, id: "restored", title: "Restored gap", status: "resolved", resolvedAt: "2026-11-09T13:00:00Z" }], notificationsPaused: false });
  render(<GateStaffingAlerts />);
  await screen.findByText("Critical · Awaiting acknowledgment");
  expect(Animated.loop).not.toHaveBeenCalled();
  expect(screen.queryByText("Restored gap")).toBeNull();
});
it("shows an upcoming assignment warning without claiming the current booth is empty", async () => {
  state.api.mockResolvedValue({ alerts: [{ ...alert, kind: "watch_radar", severity: "warning", startsAt: "2026-11-12T12:00:00Z", endsAt: "2026-11-13T00:00:00Z" }], notificationsPaused: false });
  render(<GateStaffingAlerts />);
  await screen.findByText("Upcoming watch needs assignment");
  expect(screen.getByText("2 required for upcoming watch")).toBeTruthy();
  expect(screen.queryByText(/0 on watch/)).toBeNull();
  expect(Animated.loop).not.toHaveBeenCalled();
});

it("clears a pending confirmation on account switch and ignores a late previous-account acknowledgment", async () => {
  let complete!: (value: unknown) => void;
  state.api.mockImplementation(async (path: string) => path.endsWith("/acknowledge") ? new Promise(resolve => { complete = resolve; }) : { alerts: [alert], notificationsPaused: false });
  render(<GateStaffingAlerts />);
  fireEvent.click(await screen.findByRole("button", { name: "Acknowledge staffing alert" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm acknowledgment" }));
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  state.api.mockResolvedValue({ alerts: [], notificationsPaused: false });
  await act(async () => { await setUser({ id: 10, username: "other", displayName: "Other company", role: "vendor", vendorId: 8 }); });
  expect(screen.queryByText("Gate watch uncovered")).toBeNull();
  await act(async () => complete({ alert: winner }));
  expect(screen.queryByText(/Acknowledged by Other admin/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm acknowledgment" })).toBeNull();
});

it("refreshes revoked authority after a denial without claiming acknowledgment", async () => {
  state.api.mockImplementation(async (path: string) => {
    if (path.endsWith("/acknowledge")) {
      state.api.mockResolvedValue({ alerts: [{ ...alert, canAcknowledge: false }], notificationsPaused: false });
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }
    return { alerts: [alert], notificationsPaused: false };
  });
  render(<GateStaffingAlerts />);
  fireEvent.click(await screen.findByRole("button", { name: "Acknowledge staffing alert" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm acknowledgment" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm acknowledgment" })).toBeNull());
  expect(screen.queryByText(/Acknowledged by/)).toBeNull();
});
it("removes alarm actions when current-company access is revoked during refresh", async () => {
  render(<GateStaffingAlerts />);
  await screen.findByText("Gate watch uncovered");
  state.api.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  // Foreground refresh uses the same saved scope and must discard denied facts.
  await act(async () => foreground("active"));
  await waitFor(() => expect(screen.queryByText("Gate watch uncovered")).toBeNull());
  expect(screen.queryByRole("button", { name: "Acknowledge staffing alert" })).toBeNull();
});
