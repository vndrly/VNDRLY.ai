import React from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppNavigationItem } from "@/lib/app-navigation";
import AdaptiveNavigationShell from "./AdaptiveNavigationShell";

vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name, size }: { name: string; size: number }) => (
    <Text testID={`icon-${name}`}>{name}:{size}</Text>
  ),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ name: "MidCon Solutions", primary: "#00A8B8" }),
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#FFB800", mutedForeground: "#a3a3a3" }),
}));
vi.mock("@/components/BrandTitleRow", () => ({
  default: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <Text>{`${title}${subtitle ? ` — ${subtitle}` : ""}`}</Text>
  ),
}));
vi.mock("@/components/LanguageToggle", () => ({
  default: () => <Text testID="language-toggle">EN ES</Text>,
}));
vi.mock("@/components/SidebarHalftoneBackground", () => ({
  default: () => <Text testID="adaptive-sidebar-halftone">Halftone</Text>,
}));
vi.mock("@/components/AskVNavLogo", () => ({
  default: ({ size }: { size: number }) => <Text testID="icon-askv">AskV art:{size}</Text>,
}));
vi.mock("@/components/GateVoiceNavButton", () => ({
  default: ({ onPress, testID }: { onPress: () => void; testID: string }) => (
    <Text onPress={onPress} testID={testID}>
      Voice art
    </Text>
  ),
}));

afterEach(cleanup);

const items: AppNavigationItem[] = [
  {
    key: "gate",
    href: "/gate",
    icon: "truck",
    kind: "standard",
    label: "Gate",
  },
  { key: "askv", href: "/askv", icon: "zap", kind: "askv", label: "AskV" },
  {
    key: "gate-voice",
    href: "/gate",
    icon: "mic",
    kind: "gate-voice",
    label: "Voice",
  },
  {
    key: "gate-history",
    href: "/history",
    icon: "clock",
    kind: "standard",
    label: "History",
  },
  {
    key: "shift-notes",
    href: "/shift-notes",
    icon: "file-text",
    kind: "standard",
    label: "Shift Notes",
  },
  {
    key: "profile",
    href: "/profile",
    icon: "user",
    kind: "standard",
    label: "Profile",
  },
];

describe("AdaptiveNavigationShell", () => {
  it("uses bottom navigation below 768 points and keeps Voice centered", () => {
    const onActivate = vi.fn();
    const screen = render(
      <AdaptiveNavigationShell
        activeKey="gate"
        bottomInset={0}
        gateVoiceActive={false}
        items={items}
        onActivate={onActivate}
        onSignOut={() => undefined}
        width={390}
      >
        <Text>Content</Text>
      </AdaptiveNavigationShell>,
    );
    expect(screen.getByTestId("adaptive-bottom-tray")).toBeTruthy();
    expect(screen.queryByTestId("adaptive-sidebar")).toBeNull();
    const tray = screen.getByTestId("adaptive-bottom-tray");
    expect(
      Array.from(tray.children).map((node) => node.getAttribute("data-testid")),
    ).toEqual([
      "nav-gate",
      "nav-askv",
      "nav-gate-voice-container",
      "nav-gate-history",
      "nav-shift-notes",
      "nav-profile",
    ]);
    fireEvent.click(screen.getByText("Voice art"));
    expect(onActivate).toHaveBeenCalledWith(items[2]);
  });

  it("uses a persistent sidebar at 768 points and above", () => {
    const screen = render(
      <AdaptiveNavigationShell
        activeKey="gate"
        bottomInset={0}
        gateVoiceActive={false}
        items={items}
        onActivate={() => undefined}
        onSignOut={() => undefined}
        width={1024}
      >
        <Text>Content</Text>
      </AdaptiveNavigationShell>,
    );
    expect(screen.getByTestId("adaptive-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("adaptive-bottom-tray")).toBeNull();
    expect(screen.getByTestId("adaptive-navigation-content")).toBeTruthy();
    expect(screen.getByTestId("sidebar-chrome-gate")).toBeTruthy();
    expect(screen.getByTestId("sidebar-active-chrome-gate")).toBeTruthy();
    expect(screen.getByTestId("sidebar-idle-chrome-gate")).toBeTruthy();
  });

  it("uses website-scale icons and adds iPad-only account controls", () => {
    const onOpenNotifications = vi.fn();
    const onSignOut = vi.fn();
    const screen = render(
      <AdaptiveNavigationShell
        activeKey="gate"
        bottomInset={0}
        gateVoiceActive={false}
        items={items}
        notificationCount={3}
        onActivate={() => undefined}
        onOpenNotifications={onOpenNotifications}
        onSignOut={onSignOut}
        profileSettingsLabel="Profile & Settings"
        signOutLabel="Sign Out"
        userName="Gate Keeper"
        width={1024}
      >
        <Text>Content</Text>
      </AdaptiveNavigationShell>,
    );

    expect(screen.getByTestId("icon-truck").textContent).toBe("truck:16");
    expect(getComputedStyle(screen.getByTestId("icon-truck").parentElement!).minWidth).toBe("24px");
    expect(screen.getByTestId("icon-askv").textContent).toBe("AskV art:20");
    expect(screen.getByText("MidCon Solutions — Gate Keeper")).toBeTruthy();
    expect(screen.getByTestId("language-toggle")).toBeTruthy();
    expect(screen.getByText("Profile & Settings")).toBeTruthy();
    const footer = screen.getByTestId("sidebar-footer");
    expect(Array.from(footer.children).map((node) => node.getAttribute("data-testid"))).toEqual([
      "nav-profile",
      "nav-sign-out",
    ]);
    fireEvent.click(screen.getByTestId("sidebar-notifications"));
    fireEvent.click(screen.getByTestId("nav-sign-out"));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("does not add the new sidebar controls to the iPhone tray", () => {
    const screen = render(
      <AdaptiveNavigationShell
        activeKey="gate"
        bottomInset={0}
        gateVoiceActive={false}
        items={items}
        onActivate={() => undefined}
        onSignOut={() => undefined}
        width={390}
      >
        <Text>Content</Text>
      </AdaptiveNavigationShell>,
    );

    expect(screen.queryByTestId("language-toggle")).toBeNull();
    expect(screen.queryByTestId("sidebar-notifications")).toBeNull();
    expect(screen.queryByTestId("nav-sign-out")).toBeNull();
    expect(screen.getByTestId("icon-truck").textContent).toBe("truck:26");
    const compactIcon = getComputedStyle(screen.getByTestId("icon-truck").parentElement!);
    expect(compactIcon.minWidth).toBe("34px");
    expect(compactIcon.minHeight).toBe("30px");
  });
});
