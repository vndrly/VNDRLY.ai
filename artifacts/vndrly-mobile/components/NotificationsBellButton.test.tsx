import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

import NotificationsBellButton from "./NotificationsBellButton";

afterEach(() => {
  cleanup();
});

describe("NotificationsBellButton", () => {
  it("matches web: flat red pill with white count on the bell", () => {
    render(
      <NotificationsBellButton
        count={44}
        onPress={() => undefined}
        accessibilityLabel="Notifications"
      />,
    );

    expect(screen.getByTestId("button-notifications-bell")).toBeTruthy();
    expect(screen.getByTestId("badge-notification-count")).toBeTruthy();
    expect(screen.getByText("44")).toBeTruthy();
  });

  it("matches web: hides pill at zero unread", () => {
    render(
      <NotificationsBellButton
        count={0}
        onPress={() => undefined}
        accessibilityLabel="Notifications"
      />,
    );

    expect(screen.queryByTestId("badge-notification-count")).toBeNull();
  });

  it("matches web: caps at 99+", () => {
    render(
      <NotificationsBellButton
        count={120}
        onPress={() => undefined}
        accessibilityLabel="Notifications"
      />,
    );

    expect(screen.getByText("99+")).toBeTruthy();
  });
});
