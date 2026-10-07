import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import TicketRecovery from "./TicketRecovery";
const m = vi.hoisted(() => ({ api: vi.fn(), current: true }));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => m.api(...a) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => 1,
  isAuthScopeCurrent: () => m.current,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
beforeEach(() => {
  cleanup();
  m.current = true;
  m.api.mockReset();
});
const partner: any = {
  id: 7,
  role: "partner",
  partnerId: 11,
  activeMembershipId: 2,
};
const admin: any = { ...partner, role: "admin" };
function setup(user = partner, status = "denied") {
  m.api.mockImplementation(async (p: string) =>
    p.endsWith("/nearby-vendors")
      ? {
          approved: [
            { id: 9, name: "Actual vendor", isCurrentlyInvited: false },
          ],
          unapproved: [],
        }
      : p.endsWith("/transitions")
        ? []
        : { id: 12, status, vendorId: 8, lifecycleState: "pending_arrival" },
  );
  render(
    <TicketRecovery
      user={user}
      ticketId={12}
      status={status}
      onRefresh={vi.fn()}
    />,
  );
}
it("partner selects actual scoped vendor and explicitly reviews exact reinvite", async () => {
  setup();
  fireEvent.click(screen.getByText("Find another vendor"));
  fireEvent.click(await screen.findByText("Actual vendor"));
  fireEvent.click(screen.getByText("Review reinvite"));
  await screen.findByText("Confirm reinvite");
  fireEvent.click(screen.getByText("Confirm reinvite"));
  await waitFor(() =>
    expect(m.api).toHaveBeenCalledWith("/api/tickets/12/reinvite", {
      method: "POST",
      body: JSON.stringify({ vendorId: 9 }),
    }),
  );
});
it("platform admin reviews cancelled restoration only; no invented reason field", async () => {
  setup(admin, "cancelled");
  fireEvent.click(screen.getByText("Restore cancelled ticket"));
  fireEvent.click(await screen.findByText("Review restoration"));
  await screen.findByText("Confirm restoration");
  fireEvent.click(screen.getByText("Confirm restoration"));
  await waitFor(() =>
    expect(m.api).toHaveBeenCalledWith("/api/tickets/12/reactivate", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );
});
it("ordinary field/vendor or ineligible roles have no controls or reads", () => {
  setup({ ...partner, role: "vendor" });
  expect(screen.queryByText("Find another vendor")).toBeNull();
  expect(m.api).not.toHaveBeenCalled();
  cleanup();
  setup(partner, "cancelled");
  expect(screen.queryByText("Restore cancelled ticket")).toBeNull();
});
it("denied scoped vendor choices never permit preparation", async () => {
  setup();
  m.api.mockRejectedValue(Error("403"));
  fireEvent.click(screen.getByText("Find another vendor"));
  await screen.findByText("Current ticket unavailable. Refresh to review.");
  expect(screen.queryByText("Review reinvite")).toBeNull();
});
it("changed ticket after review refuses effect", async () => {
  setup();
  fireEvent.click(screen.getByText("Find another vendor"));
  fireEvent.click(await screen.findByText("Actual vendor"));
  fireEvent.click(screen.getByText("Review reinvite"));
  await screen.findByText("Confirm reinvite");
  m.api.mockImplementation(async (p: string) =>
    p.endsWith("/transitions")
      ? []
      : { id: 12, status: "in_progress", vendorId: 8 },
  );
  fireEvent.click(screen.getByText("Confirm reinvite"));
  await screen.findByText("Current ticket unavailable. Refresh to review.");
  expect(m.api.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    0,
  );
});
it("lost result checks history only, even if no matching audit exists", async () => {
  setup(admin, "cancelled");
  fireEvent.click(screen.getByText("Restore cancelled ticket"));
  fireEvent.click(await screen.findByText("Review restoration"));
  await screen.findByText("Confirm restoration");
  m.api.mockImplementation(async (p: string, o: any) => {
    if (o) throw Error("lost");
    return p.endsWith("/transitions")
      ? []
      : { id: 12, status: "cancelled", vendorId: 8 };
  });
  fireEvent.click(screen.getByText("Confirm restoration"));
  await screen.findByText("Check ticket history");
  fireEvent.click(screen.getByText("Check ticket history"));
  await screen.findByText(
    "Outcome uncertain. This command will not be resent.",
  );
  expect(m.api.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    1,
  );
});
it("context revocation immediately before effect refuses write", async () => {
  setup(admin, "cancelled");
  fireEvent.click(screen.getByText("Restore cancelled ticket"));
  fireEvent.click(await screen.findByText("Review restoration"));
  await screen.findByText("Confirm restoration");
  m.current = false;
  fireEvent.click(screen.getByText("Confirm restoration"));
  await waitFor(() =>
    expect(screen.queryByText("Confirm restoration")).toBeNull(),
  );
  expect(m.api.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    0,
  );
});
it("committed lost reinvite is observed from exact new transition, never resent", async () => {
  setup();
  fireEvent.click(screen.getByText("Find another vendor"));
  fireEvent.click(await screen.findByText("Actual vendor"));
  fireEvent.click(screen.getByText("Review reinvite"));
  await screen.findByText("Confirm reinvite");
  let applied = false;
  m.api.mockImplementation(async (p: string, o: any) => {
    if (o) {
      applied = true;
      throw Error("lost");
    }
    if (p.endsWith("/nearby-vendors"))
      return {
        approved: [{ id: 9, name: "Actual vendor", isCurrentlyInvited: false }],
        unapproved: [],
      };
    if (p.endsWith("/transitions"))
      return applied
        ? [
            {
              id: 3,
              ticketId: 12,
              actorUserId: 7,
              fromStatus: "denied",
              toStatus: "awaiting_acceptance",
              reason: "reassigned from vendor #8 to vendor #9",
              createdAt: "2026-10-07T15:00:00Z",
            },
          ]
        : [];
    return {
      id: 12,
      status: applied ? "awaiting_acceptance" : "denied",
      vendorId: applied ? 9 : 8,
      lifecycleState: "pending_arrival",
    };
  });
  fireEvent.click(screen.getByText("Confirm reinvite"));
  await screen.findByText("Check ticket history");
  fireEvent.click(screen.getByText("Check ticket history"));
  await screen.findByText("A matching transition is recorded (#3).");
  expect(m.api.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    1,
  );
});
it("reactivation matches only exact recorded restored status; no client lifecycle write", async () => {
  setup(admin, "cancelled");
  fireEvent.click(screen.getByText("Restore cancelled ticket"));
  fireEvent.click(await screen.findByText("Review restoration"));
  await screen.findByText("Confirm restoration");
  let applied = false;
  m.api.mockImplementation(async (p: string, o: any) => {
    if (o) {
      applied = true;
      return { id: 12, status: "submitted", lifecycleState: "off_site" };
    }
    if (p.endsWith("/transitions"))
      return applied
        ? [
            {
              id: 4,
              ticketId: 12,
              actorUserId: 7,
              fromStatus: "cancelled",
              toStatus: "submitted",
              reason: "ticket reactivated",
              createdAt: "2026-10-07T15:00:00Z",
            },
          ]
        : [];
    return {
      id: 12,
      status: applied ? "submitted" : "cancelled",
      vendorId: 8,
      lifecycleState: "off_site",
    };
  });
  fireEvent.click(screen.getByText("Confirm restoration"));
  await screen.findByText("A matching transition is recorded (#4).");
  expect(m.api.mock.calls.find((c) => c[1]?.method === "POST")?.[1].body).toBe(
    "{}",
  );
});
