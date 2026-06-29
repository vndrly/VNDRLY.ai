import { Feather } from "@expo/vector-icons";
import { router, Slot, usePathname } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { crewMapTabVisible, homeTabTitleKey, isForemanEmployeeUser } from "@/lib/mobile-viewer";
import { useTabBadges } from "@/lib/tabBadges";

type TabItem = {
  badge?: number;
  href: string;
  icon: keyof typeof Feather.glyphMap;
  key: string;
  label: string;
  visible: boolean;
};

export default function TabLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  const badges = useTabBadges();
  const { user } = useAuth();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isForemanEmployee = isForemanEmployeeUser(user);
  const showsCrewMap = crewMapTabVisible(user);

  const tabs = ([
    { key: "askv", href: "/(tabs)/askv", label: t("tabs.askv"), icon: "zap", visible: true },
    {
      key: "index",
      href: "/(tabs)",
      label: t(homeTabTitleKey(user)),
      icon: "home",
      visible: true,
      badge: badges.home,
    },
    {
      key: "schedule",
      href: "/(tabs)/schedule",
      label: t("tabs.schedule"),
      icon: "calendar",
      visible: true,
      badge: badges.schedule,
    },
    {
      key: "flagged",
      href: "/(tabs)/flagged",
      label: t("tabs.flagged"),
      icon: "flag",
      visible: true,
      badge: badges.flagged,
    },
    {
      key: "crew-map",
      href: "/(tabs)/crew-map",
      label: t("tabs.crewMap"),
      icon: "map-pin",
      visible: showsCrewMap,
    },
    {
      key: "crews",
      href: "/(tabs)/crews",
      label: t("tabs.crews"),
      icon: "users",
      visible: isForemanEmployee,
    },
    {
      key: "comms",
      href: "/(tabs)/comms",
      label: t("tabs.comms"),
      icon: "radio",
      visible: isForemanEmployee,
      badge: badges.comms,
    },
    { key: "scan", href: "/(tabs)/scan", label: t("tabs.scan"), icon: "maximize", visible: true },
    { key: "profile", href: "/(tabs)/profile", label: t("tabs.profile"), icon: "user", visible: true },
  ] satisfies TabItem[]).filter((tab) => tab.visible);

  return (
    <View style={styles.root}>
      <View style={styles.page}>
        <Slot />
      </View>
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {tabs.map((tab) => {
          const active = isActiveTab(pathname, tab.key);
          const color = active ? colors.primary : colors.mutedForeground;
          const badgeLabel = tab.badge && tab.badge > 0 ? (tab.badge > 99 ? "99+" : String(tab.badge)) : null;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityState={active ? { selected: true } : undefined}
              onPress={() => router.push(tab.href as never)}
              style={styles.tabItem}
            >
              <View>
                <Feather name={tab.icon} size={26} color={color} />
                {badgeLabel ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.badgeText}>{badgeLabel}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[styles.tabLabel, { color }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function isActiveTab(pathname: string, key: string) {
  if (key === "index") {
    return pathname === "/" || pathname === "/index" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
  }
  return pathname.endsWith(`/${key}`) || pathname === `/(tabs)/${key}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  tabBar: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-around",
    minHeight: 82,
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  tabItem: {
    alignItems: "center",
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 56,
    minWidth: 0,
  },
  tabLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    maxWidth: 70,
  },
  badge: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    minWidth: 20,
    paddingHorizontal: 5,
    position: "absolute",
    right: -12,
    top: -8,
  },
  badgeText: {
    color: "#ffffff",
    fontFamily: "Inter_700Bold",
    fontSize: 10,
  },
});
