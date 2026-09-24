import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationBell from "./NotificationBell";

vi.mock("@expo/vector-icons", () => ({ Feather: ({ size, testID }: any) => <span data-testid={testID} data-size={size} /> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, args?: any) => key === "nav.notifications" ? "Notifications" : key === "home.unreadNotifications" ? `${args.count} unread notifications` : "No unread notifications" }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a8b8" }) }));
afterEach(cleanup);

describe("NotificationBell", () => {
  it("offers one accessible 44-point action around a 27-point icon", () => {
    const onPress = vi.fn();
    const screen = render(<NotificationBell count={127} onPress={onPress} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(screen.getByTestId("notification-bell-icon").getAttribute("data-size")).toBe("27");
    expect(bell.style.minHeight).toBe("44px");
    expect(bell.style.minWidth).toBe("44px");
    expect(bell.getAttribute("aria-valuetext")).toBe("127 unread notifications");
    expect(screen.getByText("99+").closest('[aria-hidden="true"]')).toBeTruthy();
    fireEvent.click(bell);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("announces zero without a badge and updates the full accessible count", () => {
    const screen = render(<NotificationBell count={0} onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Notifications" }).getAttribute("aria-valuetext")).toBe("No unread notifications");
    expect(screen.queryByTestId("notification-bell-badge")).toBeNull();
    screen.rerender(<NotificationBell count={8} onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Notifications" }).getAttribute("aria-valuetext")).toBe("8 unread notifications");
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
  });
});
