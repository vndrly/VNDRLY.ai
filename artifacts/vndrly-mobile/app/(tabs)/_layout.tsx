import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useTabBadges } from "@/lib/tabBadges";

export default function TabLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  const badges = useTabBadges();
  const { user } = useAuth();
  const isFieldOnlyEmployee =
    user?.role === "field_employee" &&
    user.vendorRole !== "foreman" &&
    user.vendorRole !== "both";
  const isForemanEmployee =
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both");
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: {
          fontFamily: "Inter_600SemiBold",
          color: colors.foreground,
        },
        // Task #186: persistent active-organization indicator in every
        // authenticated tab's header. The component self-hides for
        // single-membership users so it only appears for the dual-role
        // operators who actually need the visual reminder. We thread
        // it through `headerRight` rather than wrapping the navigator
        // so the existing per-screen layouts (brand row on Home, etc.)
        // stay untouched, and so the safe-area / status-bar handling
        // the default header already does keeps working.
        headerRight: () => <ActiveOrgIndicator />,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: isForemanEmployee ? t("foremanHome.portal") : t("tabs.home"),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
          tabBarBadge: badges.home > 0 ? (badges.home > 99 ? "99+" : badges.home) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: "#ffffff" },
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t("tabs.schedule"),
          headerShown: false,
          href: isFieldOnlyEmployee ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Feather name="calendar" size={size} color={color} />
          ),
          tabBarBadge: badges.schedule > 0 ? (badges.schedule > 99 ? "99+" : badges.schedule) : undefined,
          tabBarBadgeStyle: { backgroundColor: "#7c3aed", color: "#ffffff" },
        }}
      />
      <Tabs.Screen
        name="crews"
        options={{
          title: t("tabs.crews"),
          headerShown: false,
          href: isForemanEmployee ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Feather name="users" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="comms"
        options={{
          title: t("tabs.comms"),
          headerShown: false,
          href: isForemanEmployee ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Feather name="radio" size={size} color={color} />
          ),
          tabBarBadge: badges.comms > 0 ? (badges.comms > 99 ? "99+" : badges.comms) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: "#ffffff" },
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t("tabs.scan"),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Feather name="maximize" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
