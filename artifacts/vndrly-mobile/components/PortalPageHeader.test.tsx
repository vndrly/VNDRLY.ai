import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PortalPageHeader from "./PortalPageHeader";
import AdaptiveNavigationShell from "./AdaptiveNavigationShell";

const state = vi.hoisted(() => ({ width: 390, count: 7, push: vi.fn() }));
vi.mock("react-native", async (original) => ({ ...await original<typeof import("react-native")>(), useWindowDimensions: () => ({ width: state.width, height: 800, scale: 1, fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: state.push, dismissTo: vi.fn() } }));
vi.mock("@expo/vector-icons", () => ({ Feather: ({ size, testID }: any) => <span data-testid={testID} data-size={size} /> }));
vi.mock("@/lib/notificationBadge", () => ({ useUnreadNotificationCount: () => state.count }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ activeMembership: null }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a8b8", name: "Gate company" }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black" }) }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: () => null }));
vi.mock("@/components/LanguageToggle", () => ({ default: () => null }));
vi.mock("@/components/SidebarHalftoneBackground", () => ({ default: () => null }));
vi.mock("react-i18next", async (original) => ({ ...await original<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string, args?: any) => args?.count ? `${args.count} unread notifications` : key }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("responsive notification placement", () => {
  it("keeps one bell on a wide root page that has no sidebar", () => {
    state.width = 1024;
    const screen = render(<PortalPageHeader title="Edit profile" testIdPrefix="edit-profile" />);
    const bells = screen.getAllByRole("button", { name: "nav.notifications" });
    expect(bells).toHaveLength(1);
    expect(bells[0].nextElementSibling).toBe(screen.getByTestId("edit-profile-vndrly-logo"));
    fireEvent.click(bells[0]);
    expect(state.push).toHaveBeenCalledExactlyOnceWith("/(tabs)/gate-notifications");
  });
  it.each([390, 767, 768, 1024])("renders exactly one bell at %i points and opens the shared inbox once", (width) => {
    state.width = width;
    const screen = render(<AdaptiveNavigationShell activeKey="gate" bottomInset={0} gateVoiceActive={false} items={[]} notificationCount={7} onActivate={() => {}} onOpenNotifications={() => state.push("/(tabs)/gate-notifications")} {...{ onSignOut: () => {} }} width={width}>
      <PortalPageHeader title="Notifications" testIdPrefix="notifications" />
    </AdaptiveNavigationShell>);
    const bells = screen.getAllByRole("button", { name: "nav.notifications" });
    expect(bells).toHaveLength(1);
    expect(bells[0].getAttribute("aria-valuetext")).toBe("7 unread notifications");
    if (width < 768) {
      expect(bells[0].nextElementSibling).toBe(screen.getByTestId("notifications-vndrly-logo"));
      expect(screen.queryByTestId("sidebar-notifications")).toBeNull();
    } else {
      expect(screen.getByTestId("adaptive-sidebar").contains(bells[0])).toBe(true);
      expect(bells[0].style.marginRight).toBe("12px");
    }
    fireEvent.click(bells[0]);
    expect(state.push).toHaveBeenCalledExactlyOnceWith("/(tabs)/gate-notifications");
  });
});
