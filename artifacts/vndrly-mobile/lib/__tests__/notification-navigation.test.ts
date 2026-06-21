import { beforeEach, describe, expect, it, vi } from "vitest";

const dismissMock = vi.fn();
const pushMock = vi.fn();
const canDismissMock = vi.fn(() => true);

vi.mock("expo-router", () => ({
  router: {
    dismiss: (...a: unknown[]) => dismissMock(...a),
    push: (...a: unknown[]) => pushMock(...a),
    canDismiss: () => canDismissMock(),
  },
}));

import {
  navigateFromNotificationLink,
  navigateToSafetyEventFromNotification,
  navigateToTicketFromNotification,
} from "../notification-navigation";

describe("notification-navigation", () => {
  beforeEach(() => {
    dismissMock.mockClear();
    pushMock.mockClear();
    canDismissMock.mockReturnValue(true);
  });

  it("dismisses modal stack before opening ticket detail", async () => {
    navigateToTicketFromNotification(10950);
    expect(dismissMock).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(pushMock).toHaveBeenCalledWith("/ticket/10950");
  });

  it("routes crew_removed list link to tabs", async () => {
    navigateFromNotificationLink("/tickets");
    expect(dismissMock).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(pushMock).toHaveBeenCalledWith("/(tabs)");
  });

  it("routes safety event links to safety-event detail", async () => {
    navigateFromNotificationLink("/safety/42?siteLocationId=7&ticketId=10950");
    expect(dismissMock).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(pushMock).toHaveBeenCalledWith({
      pathname: "/safety-event/[id]",
      params: { id: "42" },
    });
  });
});
