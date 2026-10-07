import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
import TicketUnlock from "./TicketUnlock";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  current: true,
  user: { id: 7, role: "admin", activeMembershipId: 2 },
}));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => m.api(...a) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => 1,
  isAuthScopeCurrent: () => m.current,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
beforeEach(() => {
  cleanup();
  m.api.mockReset();
  m.current = true;
  m.user.role = "admin";
});
function setup() {
  m.api.mockImplementation(async (p: string) =>
    p.endsWith("/unlocks")
      ? []
      : { id: 12, status: "approved", lifecycleState: "off_site" },
  );
  render(
    <TicketUnlock
      user={m.user as any}
      ticketId={12}
      status="approved"
      onRefresh={vi.fn()}
    />,
  );
}
async function review() {
  fireEvent.change(screen.getByPlaceholderText("Reason (required)"), {
    target: { value: "Correct saved labor" },
  });
  fireEvent.click(screen.getByText("Review unlock"));
  await screen.findByText("Confirm unlock");
}
it("requires reason and explicit review before exact canonical unlock", async () => {
  setup();
  expect(
    (screen.getByText("Review unlock") as HTMLButtonElement).disabled,
  ).toBe(true);
  await review();
  let applied = false;
  m.api.mockImplementation(async (p: string, o: any) => {
    if (o) {
      applied = true;
      return { id: 12, status: "in_progress", lifecycleState: "on_site" };
    }
    if (!applied)
      return p.endsWith("/unlocks")
        ? []
        : { id: 12, status: "approved", lifecycleState: "off_site" };
    return p.endsWith("/unlocks")
      ? [
          {
            id: 4,
            unlockedById: 7,
            reason: "Correct saved labor",
            previousStatus: "approved",
            unlockedAt: "2026-10-07T15:00:00Z",
          },
        ]
      : { id: 12, status: "in_progress", lifecycleState: "on_site" };
  });
  fireEvent.click(screen.getByText("Confirm unlock"));
  await screen.findByText("A matching unlock is recorded.");
  expect(m.api).toHaveBeenCalledWith("/api/tickets/12/unlock", {
    method: "POST",
    body: JSON.stringify({ reason: "Correct saved labor" }),
  });
});
it("hides preparation from nonadmins and ineligible status", () => {
  m.user.role = "vendor";
  render(
    <TicketUnlock
      user={m.user as any}
      ticketId={12}
      status="approved"
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.queryByText("Review unlock")).toBeNull();
  cleanup();
  m.user.role = "admin";
  render(
    <TicketUnlock
      user={m.user as any}
      ticketId={12}
      status="cancelled"
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.queryByText("Review unlock")).toBeNull();
});
it("lost response only checks fresh history and never resends", async () => {
  setup();
  await review();
  m.api.mockImplementation(async (p: string, o: any) => {
    if (o) throw Error("lost");
    return p.endsWith("/unlocks")
      ? []
      : { id: 12, status: "approved", lifecycleState: "off_site" };
  });
  fireEvent.click(screen.getByText("Confirm unlock"));
  await screen.findByText("Check unlock history");
  fireEvent.click(screen.getByText("Check unlock history"));
  await waitFor(() =>
    expect(
      m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1),
  );
  expect(screen.queryByText("Confirm unlock")).toBeNull();
});
it("context revocation during review prevents write", async () => {
  setup();
  await review();
  m.current = false;
  fireEvent.click(screen.getByText("Confirm unlock"));
  await waitFor(() => expect(screen.queryByText("Confirm unlock")).toBeNull());
  expect(m.api.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    0,
  );
});
it("reconciles a committed lost response from new exact audit without another write", async () => {
  setup();
  await review();
  let applied = false;
  m.api.mockImplementation(async (p: string, o: any) => {
    if (o) {
      applied = true;
      throw Error("response lost");
    }
    return p.endsWith("/unlocks")
      ? applied
        ? [
            {
              id: 9,
              unlockedById: 7,
              reason: "Correct saved labor",
              previousStatus: "approved",
              unlockedAt: "2026-10-07T15:00:00Z",
            },
          ]
        : []
      : {
          id: 12,
          status: applied ? "in_progress" : "approved",
          lifecycleState: applied ? "on_site" : "off_site",
        };
  });
  fireEvent.click(screen.getByText("Confirm unlock"));
  await screen.findByText("Check unlock history");
  fireEvent.click(screen.getByText("Check unlock history"));
  await screen.findByText("A matching unlock is recorded.");
  expect(m.api.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    1,
  );
});
