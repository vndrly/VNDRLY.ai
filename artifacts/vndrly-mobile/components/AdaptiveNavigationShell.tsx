import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import AskVNavLogo from "@/components/AskVNavLogo";
import BrandTitleRow from "@/components/BrandTitleRow";
import GateVoiceNavButton from "@/components/GateVoiceNavButton";
import LanguageToggle from "@/components/LanguageToggle";
import NotificationBell from "@/components/NotificationBell";
import { SidebarNotificationsContext } from "@/components/SidebarNotificationsContext";
import Pill9Slice from "@/components/Pill9Slice";
import SidebarHalftoneBackground from "@/components/SidebarHalftoneBackground";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import type { AppNavigationItem } from "@/lib/app-navigation";
import { TEXT_SHADOW } from "@/lib/pill-doctrine";
import {
  IDLE_SQUARE_NAV_SOURCE,
  pickSquareNavSource,
} from "@/lib/square-nav-palette";

export const REGULAR_NAVIGATION_BREAKPOINT = 768;
export const REGULAR_SIDEBAR_WIDTH = 228;

type Props = {
  activeKey: string;
  bottomInset: number;
  children: React.ReactNode;
  gateVoiceActive: boolean;
  items: AppNavigationItem[];
  notificationCount?: number;
  onActivate: (item: AppNavigationItem) => void;
  onOpenNotifications?: () => void;
  onSignOut: () => void;
  profileSettingsLabel?: string;
  signOutLabel?: string;
  userName?: string;
  width: number;
};

export default function AdaptiveNavigationShell({
  activeKey,
  bottomInset,
  children,
  gateVoiceActive,
  items,
  notificationCount = 0,
  onActivate,
  onOpenNotifications,
  onSignOut,
  profileSettingsLabel,
  signOutLabel = "Sign Out",
  userName,
  width,
}: Props) {
  const regular = width >= REGULAR_NAVIGATION_BREAKPOINT;
  return (
    <SidebarNotificationsContext.Provider value={regular}>
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
            onActivate={onActivate}
            onOpenNotifications={onOpenNotifications}
            onSignOut={onSignOut}
            profileSettingsLabel={profileSettingsLabel}
            signOutLabel={signOutLabel}
            userName={userName}
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
    </SidebarNotificationsContext.Provider>
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
  onActivate,
  onOpenNotifications,
  onSignOut,
  profileSettingsLabel,
  signOutLabel,
  userName,
}: NavigationProps &
  Pick<
    Props,
    | "notificationCount"
    | "onOpenNotifications"
    | "onSignOut"
    | "profileSettingsLabel"
    | "signOutLabel"
    | "userName"
  >) {
  const brand = useBrand();
  const profile = items.find((item) => item.key === "profile");
  const sidebarProfile =
    profile && profileSettingsLabel
      ? { ...profile, label: profileSettingsLabel }
      : profile;
  const primary = items.filter((item) => item.key !== "profile");
  return (
    <View style={styles.sidebar} testID="adaptive-sidebar">
      <SidebarHalftoneBackground />
      <View style={styles.sidebarHeader}>
        <BrandTitleRow
          logoTestId="adaptive-sidebar-brand-logo"
          stacked
          subtitle={userName}
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
          <React.Fragment key={item.key}>
            <NavigationItem
              active={
                item.key === activeKey ||
                (item.kind === "gate-voice" && gateVoiceActive)
              }
              item={item}
              mode="sidebar"
              onPress={() => onActivate(item)}
            />
            {item.key === "shift-notes" ? (
              <View style={styles.sidebarToggles}>
                <LanguageToggle />
              </View>
            ) : null}
          </React.Fragment>
        ))}
      </View>
      <View style={styles.sidebarFooter} testID="sidebar-footer">
        {sidebarProfile ? (
          <NavigationItem
            active={sidebarProfile.key === activeKey}
            item={sidebarProfile}
            mode="sidebar"
            onPress={() => onActivate(sidebarProfile)}
          />
        ) : null}
        <SidebarSignOut
          label={signOutLabel ?? "Sign Out"}
          onPress={onSignOut}
        />
      </View>
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
  const brand = useBrand();
  const color =
    mode === "sidebar"
      ? active
        ? "#ffffff"
        : "rgba(255,255,255,0.66)"
      : active
        ? colors.primary
        : colors.mutedForeground;
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
        size={mode === "sidebar" ? 20 : 36}
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
        size={mode === "sidebar" ? 16 : 26}
        color={color}
        style={mode === "sidebar" ? styles.sidebarIconShadow : undefined}
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
        pressed && styles.pressed,
      ]}
      testID={`nav-${item.key}`}
    >
      {mode === "sidebar" ? (
        <>
          <View
            pointerEvents="none"
            testID={`sidebar-chrome-${item.key}`}
            style={StyleSheet.absoluteFill}
          >
            <Pill9Slice
              source={pickSquareNavSource(brand.primary, brand.name)}
              height={32}
              borderRadius={3}
              style={{ opacity: active ? 1 : 0 }}
              testID={`sidebar-active-chrome-${item.key}`}
            />
            <Pill9Slice
              source={IDLE_SQUARE_NAV_SOURCE}
              height={32}
              borderRadius={3}
              style={{ opacity: active ? 0 : 0.52 }}
              testID={`sidebar-idle-chrome-${item.key}`}
            />
          </View>
        </>
      ) : null}
      <View style={[styles.iconWrap, mode === "sidebar" && styles.sidebarIconWrap]}>
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
          mode === "sidebar" ? styles.sidebarLabelShadow : null,
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

function SidebarSignOut({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sidebarItem, pressed && styles.pressed]}
      testID="nav-sign-out"
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Pill9Slice
          source={IDLE_SQUARE_NAV_SOURCE}
          height={32}
          borderRadius={3}
          style={{ opacity: 0.52 }}
        />
      </View>
      <View style={[styles.iconWrap, styles.sidebarIconWrap]}>
        <Feather
          color="#d1d5db"
          name="log-out"
          size={16}
          style={styles.sidebarIconShadow}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.sidebarLabel,
          styles.sidebarLabelShadow,
          { color: "#d1d5db" },
        ]}
      >
        {label}
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
    gap: 0,
    paddingBottom: 18,
    paddingHorizontal: 14,
    paddingTop: 20,
    position: "relative",
    width: REGULAR_SIDEBAR_WIDTH,
  },
  sidebarHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 12,
    position: "relative",
    zIndex: 1,
  },
  sidebarItems: { flex: 1, gap: 3 },
  sidebarFooter: { gap: 3 },
  sidebarToggles: {
    alignItems: "flex-start",
    paddingHorizontal: 4,
    paddingTop: 7,
  },
  sidebarItem: {
    alignItems: "center",
    borderRadius: 3,
    flexDirection: "row",
    gap: 12,
    minHeight: 32,
    overflow: "hidden",
    paddingHorizontal: 12,
    position: "relative",
  },
  sidebarVoice: { alignItems: "center", paddingVertical: 4 },
  sidebarLabel: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  sidebarLabelShadow: TEXT_SHADOW.deep,
  sidebarIconShadow: TEXT_SHADOW.deep,
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
  sidebarIconWrap: { minHeight: 24, minWidth: 24 },
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
