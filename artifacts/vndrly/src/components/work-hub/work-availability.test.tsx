import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: {
    userId: 2,
    role: "field_employee",
    vendorId: 7,
    vendorPeopleId: 22,
    activeMembershipId: 12,
  },
  request: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, ...p }: any) => (
    <button {...p}>{children}</button>
  ),
}));
vi.mock("@workspace/api-zod", async () => {
  const actual = await vi.importActual<any>("@workspace/api-zod");
  return {
    ...actual,
    submitWorkHubAvailabilityAttempt: (...args: any[]) =>
      state.request(...args),
  };
});
import WorkHubAvailability from "./work-availability";
const snapshot = {
  userId: 2,
  companyId: 7,
  actorMembershipId: 12,
  actorSessionVersion: 3,
  fingerprint: "a".repeat(64),
  records: [],
  canManage: true,
  physicalReadinessVerified: false,
};
const response = { ok: true, json: async () => snapshot };
beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  state.request.mockReset();
});
async function review() {
  await screen.findByText("No saved intervals.");
  fireEvent.change(screen.getByLabelText("Start (local time)"), {
    target: { value: "2026-10-10T10:00" },
  });
  fireEvent.change(screen.getByLabelText("End (local time)"), {
    target: { value: "2026-10-10T11:00" },
  });
  fireEvent.click(screen.getByText("Review availability"));
  await screen.findByText("Save reviewed interval");
}
it("retains exact reviewed request on denial and retries it after restart", async () => {
  state.request
    .mockRejectedValueOnce(Error("dropped"))
    .mockRejectedValueOnce(Error("403"))
    .mockResolvedValueOnce({});
  let view = render(<WorkHubAvailability />);
  await review();
  fireEvent.click(screen.getByText("Save reviewed interval"));
  await screen.findByText(/result is unresolved/);
  const original = state.request.mock.calls[0][0];
  fireEvent.click(screen.getByText("Check the same request"));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  expect(state.request.mock.calls[1][0]).toEqual(original);
  view.unmount();
  view = render(<WorkHubAvailability />);
  fireEvent.click(await screen.findByText("Check the same request"));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
  expect(state.request.mock.calls[2][0]).toEqual(original);
  await screen.findByText("Availability saved.");
});
it("blocks a new intent when the retained journal is corrupt", async () => {
  sessionStorage.setItem(
    "vndrly-own-availability:" +
      JSON.stringify([2, 7, 12, "field_employee", 22]),
    "{bad",
  );
  render(<WorkHubAvailability />);
  await screen.findByText("No saved intervals.");
  expect(
    (screen.getByText("Review availability") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(state.request).not.toHaveBeenCalled();
});
it("storage failure does not submit the reviewed command", async () => {
  render(<WorkHubAvailability />);
  await review();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("storage");
  });
  fireEvent.click(screen.getByText("Save reviewed interval"));
  await screen.findByText(/result is unresolved/);
  expect(state.request).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
