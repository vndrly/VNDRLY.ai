vi.mock("./gate/GateShiftEditor", () => ({ default: () => null }));
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUser } from "@/lib/auth";
const state = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: state.api }));
vi.mock("expo-router", () => ({ router: { push: state.push } }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "black",
    mutedForeground: "grey",
    border: "grey",
  }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: 9,
      vendorId: 7,
      role: "vendor",
      vendorRole: "admin",
      activeMembershipId: 1,
      availableMemberships: [{ id: 1, role: "admin" }],
    },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("./GateShiftAssignments", () => ({
  default: ({ shiftId }: { shiftId: string }) => (
    <div>Assignments for {shiftId}</div>
  ),
}));
import GateStaffingCalendarShift from "./GateStaffingCalendarShift";
const context = {
  siteId: "399",
  stationId: "22222222-2222-4222-8222-222222222222",
  shiftId: "33333333-3333-4333-8333-333333333333",
  date: "2026-11-09",
};
const shift = {
  id: context.shiftId,
  title: "Exact East watch",
  siteLocationId: 399,
  gateStationId: context.stationId,
  startsAt: "2026-11-09T12:00:00Z",
  endsAt: "2026-11-10T00:00:00Z",
  timezone: "America/Chicago",
};
beforeEach(async () => {
  state.api.mockReset();
  state.push.mockReset();
  await setUser({
    id: 9,
    username: "synthetic",
    displayName: "Admin",
    role: "vendor",
    vendorId: 7,
  });
  state.api.mockResolvedValue({ item: shift });
});
afterEach(cleanup);
it("opens the exact Gate review without assuming a watch or changing permanent rights", async () => {
  render(<GateStaffingCalendarShift context={context} />);
  await screen.findByText("Exact East watch");
  fireEvent.click(
    screen.getByRole("button", { name: "Review Gate / Assume Watch" }),
  );
  expect(state.push).toHaveBeenCalledExactlyOnceWith(
    `/(tabs)/change-over?siteId=399&stationId=${context.stationId}&workHubShiftId=${context.shiftId}&gateMode=1&purpose=assume`,
  );
  expect(state.api.mock.calls.map((call) => call[0])).toEqual([
    `/api/work-hub/calendar/items/shift/${context.shiftId}`,
  ]);
  expect(
    state.api.mock.calls.every(
      (call) => !call[1]?.method || call[1].method === "GET",
    ),
  ).toBe(true);
});
it("does not offer an action after the current company read points to a different gate", async () => {
  state.api.mockResolvedValue({ item: { ...shift, gateStationId: "other" } });
  render(<GateStaffingCalendarShift context={context} />);
  await screen.findByText(/no longer available/);
  expect(screen.queryByText("Exact East watch")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Review Gate / Assume Watch" }),
  ).toBeNull();
});
it("hides loaded content and ignores a late old-company read on membership change", async () => {
  let resolve!: (value: unknown) => void;
  state.api.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<GateStaffingCalendarShift context={context} />);
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(1));
  state.api.mockRejectedValue(new Error("Denied"));
  await act(async () => {
    await setUser({
      id: 10,
      username: "other",
      displayName: "Other",
      role: "vendor",
      vendorId: 8,
    });
  });
  await act(async () => resolve({ item: shift }));
  expect(screen.queryByText("Exact East watch")).toBeNull();
  expect(state.push).not.toHaveBeenCalled();
});
