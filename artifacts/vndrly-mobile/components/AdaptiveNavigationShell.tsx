import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import AskVNavLogo from "@/components/AskVNavLogo";
import BrandTitleRow from "@/components/BrandTitleRow";
import NotificationBell from "@/components/NotificationBell";
import GateVoiceNavButton from "@/components/GateVoiceNavButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import type { AppNavigationItem } from "@/lib/app-navigation";

export const REGULAR_NAVIGATION_BREAKPOINT = 768;
export const REGULAR_SIDEBAR_WIDTH = 228;

type Props = {
  activeKey: string;
  bottomInset: number;
  children: React.ReactNode;
  gateVoiceActive: boolean;
  items: AppNavigationItem[];
  notificationCount?: number;
  onOpenNotifications?: () => void;
  onActivate: (item: AppNavigationItem) => void;
  width: number;
};

export default function AdaptiveNavigationShell({
  activeKey,
  bottomInset,
  children,
  gateVoiceActive,
  items,
  notificationCount = 0,
  onOpenNotifications,
  onActivate,
  width,
}: Props) {
  const regular = width >= REGULAR_NAVIGATION_BREAKPOINT;
  return (
    <View
      style={[styles.root, regular && styles.regularRoot]}
      testID="adaptive-navigation-shell"
    >
      {regular ? (
        <Sidebar
          activeKey={activeKey}
          gateVoiceActive={gateVoiceActive}
          items={items}
          notificationCount={notificationCount}
          onOpenNotifications={onOpenNotifications}
          onActivate={onActivate}
        />
      ) : null}
      <View style={styles.page} testID="adaptive-navigation-content">
        {children}
      </View>
      {!regular ? (
        <BottomTray
          activeKey={activeKey}
          bottomInset={bottomInset}
          gateVoiceActive={gateVoiceActive}
          items={items}
          onActivate={onActivate}
        />
      ) : null}
    </View>
  );
}

type NavigationProps = Pick<
  Props,
  "activeKey" | "gateVoiceActive" | "items" | "onActivate"
>;

function Sidebar({
  activeKey,
  gateVoiceActive,
  items,
  notificationCount,
  onOpenNotifications,
  onActivate,
}: NavigationProps & Pick<Props, "notificationCount" | "onOpenNotifications">) {
  const brand = useBrand();
  const profile = items.find((item) => item.key === "profile");
  const primary = items.filter((item) => item.key !== "profile");
  return (
    <View style={styles.sidebar} testID="adaptive-sidebar">
      <View style={{ alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" }}>
        <BrandTitleRow
          logoTestId="adaptive-sidebar-brand-logo"
          title={brand.name ?? "VNDRLY"}
        />
        <NotificationBell
          count={notificationCount ?? 0}
          onPress={onOpenNotifications}
          style={{ marginRight: 12 }}
          testID="sidebar-notifications"
        />
      </View>
      <View style={styles.sidebarItems}>
        {primary.map((item) => (
          <NavigationItem
            active={
              item.key === activeKey ||
              (item.kind === "gate-voice" && gateVoiceActive)
            }
            item={item}
            key={item.key}
            mode="sidebar"
            onPress={() => onActivate(item)}
          />
        ))}
      </View>
      {profile ? (
        <NavigationItem
          active={profile.key === activeKey}
          item={profile}
          mode="sidebar"
          onPress={() => onActivate(profile)}
        />
      ) : null}
    </View>
  );
}

function BottomTray({
  activeKey,
  bottomInset,
  gateVoiceActive,
  items,
  onActivate,
}: NavigationProps & { bottomInset: number }) {
  return (
    <View
      style={[styles.bottomTray, { paddingBottom: Math.max(bottomInset, 10) }]}
      testID="adaptive-bottom-tray"
    >
      {items.map((item) => {
        const active =
          item.key === activeKey ||
          (item.kind === "gate-voice" && gateVoiceActive);
        if (item.kind === "gate-voice") {
          return (
            <View
              key={item.key}
              style={styles.compactItem}
              testID="nav-gate-voice-container"
            >
              <GateVoiceNavButton
                active={active}
                label={item.label}
                onPress={() => onActivate(item)}
                testID="gate-voice-nav"
              />
            </View>
          );
        }
        return (
          <NavigationItem
            active={active}
            item={item}
            key={item.key}
            mode="compact"
            onPress={() => onActivate(item)}
          />
        );
      })}
    </View>
  );
}

function NavigationItem({
  active,
  item,
  mode,
  onPress,
}: {
  active: boolean;
  item: AppNavigationItem;
  mode: "compact" | "sidebar";
  onPress: () => void;
}) {
  const colors = useColors();
  const color = active ? colors.primary : colors.mutedForeground;
  const badge =
    item.badge && item.badge > 0
      ? item.badge > 99
        ? "99+"
        : String(item.badge)
      : null;
  const icon =
    item.kind === "askv" ? (
      <AskVNavLogo
        active={active}
        size={mode === "sidebar" ? 42 : 36}
        testID={`${item.key}-nav-logo`}
      />
    ) : item.kind === "gate-voice" ? (
      <GateVoiceNavButton
        active={active}
        label={item.label}
        onPress={onPress}
        testID="gate-voice-nav"
      />
    ) : (
      <Feather
        name={item.icon as keyof typeof Feather.glyphMap}
        size={26}
        color={color}
      />
    );

  if (item.kind === "gate-voice") {
    return <View style={styles.sidebarVoice}>{icon}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        mode === "compact" ? styles.compactItem : styles.sidebarItem,
        mode === "sidebar" && active
          ? { backgroundColor: `${colors.primary}22` }
          : null,
        pressed && styles.pressed,
      ]}
      testID={`nav-${item.key}`}
    >
      <View style={styles.iconWrap}>
        {icon}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[
          mode === "compact" ? styles.compactLabel : styles.sidebarLabel,
          { color },
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  regularRoot: { flexDirection: "row" },
  page: { flex: 1, minWidth: 0 },
  sidebar: {
    backgroundColor: "#1c1c1e",
    borderRightColor: "#3a3a3a",
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 16,
    paddingBottom: 18,
    paddingHorizontal: 14,
    paddingTop: 20,
    width: REGULAR_SIDEBAR_WIDTH,
  },
  sidebarItems: { flex: 1, gap: 4, marginTop: 4 },
  sidebarItem: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 13,
    minHeight: 50,
    paddingHorizontal: 12,
  },
  sidebarVoice: { alignItems: "center", paddingVertical: 4 },
  sidebarLabel: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  bottomTray: {
    alignItems: "center",
    borderTopColor: "#3a3a3a",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-around",
    minHeight: 82,
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  compactItem: {
    alignItems: "center",
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 56,
    minWidth: 0,
  },
  compactLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    maxWidth: 70,
    textAlign: "center",
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
    minWidth: 34,
  },
  badge: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    minWidth: 20,
    paddingHorizontal: 5,
    position: "absolute",
    right: -10,
    top: -7,
  },
  badgeText: { color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 10 },
  pressed: { opacity: 0.78 },
});
