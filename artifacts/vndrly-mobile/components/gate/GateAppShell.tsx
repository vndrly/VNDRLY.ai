import { useGateConnection } from "@/hooks/use-gate-connection";
import React, { useState, useEffect } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AdaptiveNavigationShell from "@/components/AdaptiveNavigationShell";
import { GateInsetsContext } from "./GateInsetsContext";
import { SidebarNotificationsContext } from "@/components/SidebarNotificationsContext";
import NotificationBell from "@/components/NotificationBell";
import { useUnreadNotificationCount } from "@/lib/notificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { logout } from "@/lib/api";
import {
  activeNavigationKey,
  type AppNavigationItem,
} from "@/lib/app-navigation";
import { gateManager, isGateReleasePath, GATE_HOME } from "@/lib/gate-release";
import { GateCard, GateRow, gateStyle, useGateCopy } from "./GateChrome";
export default function GateAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  useGateConnection();
  const { user } = useAuth(),
    { width } = useWindowDimensions(),
    insets = useSafeAreaInsets(),
    path = usePathname(),
    c = useGateCopy();
  const [menu, setMenu] = useState(false);
  const count = useUnreadNotificationCount(Boolean(user));
  const allowed =
    isGateReleasePath(path) || ["/login", "/activate-account"].includes(path);
  useEffect(() => {
    if (user?.mustChangePassword && path !== "/gate-password")
      router.replace("/gate-password" as never);
    else if (user && user.role !== "guest" && !allowed)
      router.replace(GATE_HOME);
  }, [allowed, user?.id, user?.mustChangePassword, path]);
  const item = (
    key: string,
    href: string,
    label: string,
    icon: string,
  ): AppNavigationItem => ({ key, href, label, icon, kind: "standard" });
  const primary = [
    item("change-over", GATE_HOME, c("Dashboard", "Panel"), "grid"),
    item("gate", "/(tabs)/gate", c("Gate", "Acceso"), "log-in"),
    item("gate-map", "/(tabs)/gate-map", c("Map", "Mapa"), "map-pin"),
    item("gate-history", "/(tabs)/gate-history", c("Log", "Registro"), "list"),
    item("handoff", "/(tabs)/handoff", c("Handoff", "Relevo"), "repeat"),
  ];
  const secondary = [
    item("work-hub", "/work-hub", "Work Hub", "briefcase"),
    item("askv", "/(tabs)/askv", "AskV", "zap"),
    ...(gateManager(user)
      ? [
          item(
            "gate-admin",
            "/gate-admin",
            c("Administration", "Administración"),
            "settings",
          ),
        ]
      : []),
    item("profile", "/(tabs)/profile", c("My Profile", "Mi perfil"), "user"),
  ];
  const activate = (entry: AppNavigationItem) => {
    setMenu(false);
    router.push(entry.href as never);
  };
  const signOut = async () => {
    await logout();
    router.replace("/login");
  };
  if (user?.mustChangePassword)
    return path === "/gate-password" ? <>{children}</> : null;
  if (!allowed) return null;
  return (
    <AdaptiveNavigationShell
      activeKey={activeNavigationKey(path)}
      bottomInset={insets.bottom}
      gateVoiceActive={false}
      items={width >= 768 ? [...primary, ...secondary] : primary}
      width={width}
      userName={user?.displayName ?? undefined}
      notificationCount={count}
      onOpenNotifications={() => router.push("/(tabs)/gate-notifications")}
      onActivate={activate}
      onSignOut={signOut}
    >
      {width < 768 && (
        <View
          style={{
            paddingTop: insets.top,
            paddingHorizontal: 16,
            backgroundColor: "#242426",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={c("Open workspace menu", "Abrir menú")}
            onPress={() => setMenu(true)}
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
            }}
          >
            <Feather name="menu" size={22} color="#ececec" />
            <Text style={gateStyle.text}>VNDRLY Gate</Text>
          </Pressable>
          <NotificationBell
            count={count}
            onPress={() => router.push("/(tabs)/gate-notifications")}
          />
        </View>
      )}
      <GateInsetsContext.Provider value={width < 768}>
        <SidebarNotificationsContext.Provider value={true}>
          {children}
        </SidebarNotificationsContext.Provider>
      </GateInsetsContext.Provider>
      <Modal
        visible={menu}
        transparent
        animationType="slide"
        onRequestClose={() => setMenu(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "#0009",
          }}
        >
          <ScrollView
            style={{
              maxHeight: "85%",
              backgroundColor: "#3a3d42",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
            contentContainerStyle={{
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
              gap: 12,
            }}
          >
            <GateCard title={c("Your workspace", "Tu espacio")} icon="menu">
              {secondary.map((entry) => (
                <GateRow
                  key={entry.key}
                  label={entry.label}
                  icon={entry.icon as never}
                  onPress={() => activate(entry)}
                />
              ))}
              <GateRow
                label={c("Shift Notes", "Notas del turno")}
                icon="file-text"
                onPress={() =>
                  activate(item("shift-notes", "/(tabs)/shift-notes", "", ""))
                }
              />
              <GateRow
                label={c("Close menu", "Cerrar menú")}
                icon="x"
                onPress={() => setMenu(false)}
              />
            </GateCard>
          </ScrollView>
        </View>
      </Modal>
    </AdaptiveNavigationShell>
  );
}
