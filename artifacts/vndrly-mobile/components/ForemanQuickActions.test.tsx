import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  daily: {
    calendarCount: 2,
    myWorkCount: 3,
    attentionCount: 4,
    safetyCount: 5,
    nextCalendarLabel: "Tomorrow morning",
    topAttentionLabel: "Review pending work",
  } as any,
}));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-router", () => ({ router: { push: mocks.push } }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ foreground: "#fff", card: "#222", border: "#333" }),
}));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#f90" }) }));
vi.mock("@/lib/daily-workspace", () => ({
  useDailySummary: () => ({
    data: mocks.daily,
    isError: false,
    isLoading: false,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (v: string) => v }),
}));
import ForemanQuickActions from "./ForemanQuickActions";
afterEach(() => {
  cleanup();
  mocks.push.mockReset();
  mocks.daily = {
    calendarCount: 2,
    myWorkCount: 3,
    attentionCount: 4,
    safetyCount: 5,
    nextCalendarLabel: "Tomorrow morning",
    topAttentionLabel: "Review pending work",
  };
});
it("uses shared daily counts and canonical destinations, ignoring the legacy schedule popup", () => {
  const old = vi.fn();
  render(<ForemanQuickActions onSchedulePress={old} />);
  expect(screen.getByText("Tomorrow morning")).toBeTruthy();
  expect(screen.getByText("Review pending work")).toBeTruthy();
  expect(screen.getByText("5 safety items")).toBeTruthy();
  for (const [id, path] of [
    ["foreman-action-alerts", "/work-hub/attention"],
    ["foreman-action-schedule", "/work-hub/calendar"],
    ["foreman-action-safety-reports", "/work-hub/safety"],
  ]) {
    fireEvent.click(screen.getByTestId(id));
    expect(mocks.push).toHaveBeenLastCalledWith(path);
  }
  expect(old).not.toHaveBeenCalled();
});
it("shows unavailable sources while retaining healthy source summaries", () => {
  mocks.daily = {
    calendarCount: null,
    myWorkCount: 2,
    attentionCount: null,
    safetyCount: 5,
  };
  render(<ForemanQuickActions unreadAlerts={99} pendingSchedule={99} />);
  expect(screen.getAllByText("Summary unavailable")).toHaveLength(2);
  expect(screen.getByText("5 safety items")).toBeTruthy();
  expect(screen.queryByText("0 upcoming")).toBeNull();
  expect(screen.queryByText("99+")).toBeNull();
});
it("clears previous counts when the shared scoped hook returns a pending state", () => {
  const view = render(<ForemanQuickActions />);
  expect(screen.getByText("Tomorrow morning")).toBeTruthy();
  mocks.daily = undefined;
  view.rerender(<ForemanQuickActions />);
  expect(screen.queryByText("Tomorrow morning")).toBeNull();
  expect(screen.getAllByText("Summary unavailable")).toHaveLength(3);
});
