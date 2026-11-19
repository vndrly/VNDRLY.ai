import { ModalPressable as Pressable } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import { useGateConnection } from "@/hooks/use-gate-connection";
import React, { useState, useEffect } from "react";
import {
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
import GateHeaderActions, { GateHeaderActionsProvider } from "./GateHeaderActions";
import GateAskVStatus from "./GateAskVStatus";
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
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const inWorkHub = path === "/work-hub" || path.startsWith("/work-hub/");
  useEffect(() => setMapFullscreen(false), [path]);
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
    item("work-hub", "/work-hub", "Work Hub", "briefcase"),
    item("change-over", GATE_HOME, c("Gate Dashboard", "Panel de acceso"), "grid"),
    item("gate", "/(tabs)/gate", c("Gate", "Acceso"), "log-in"),
    item("gate-map", "/(tabs)/gate-map", c("Gate Map", "Mapa de acceso"), "map-pin"),
    item("gate-history", "/(tabs)/gate-history", c("Gate Log", "Registro de acceso"), "list"),
    item("shift-notes", "/(tabs)/shift-notes", c("Shift Notes", "Notas del turno"), "file-text"),
  ];
  const secondary = [
    item("askv", "/(tabs)/askv", "AskV", "zap"),
    ...(inWorkHub ? [item("profile", "/work-hub/profile", c("Profile", "Perfil"), "user")] : []),
    ...(gateManager(user)
      ? [
          item(
            "gate-admin",
            "/gate-admin",
            c("Admin", "Administración"),
            "settings",
          ),
        ]
      : []),
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
    <GateHeaderActionsProvider onMapFullscreenChange={setMapFullscreen}><AdaptiveNavigationShell
      hideNavigation={mapFullscreen}
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
              flexShrink: 1,
            }}
          >
            <Feather name="menu" size={22} color="#ececec" />
            <Text numberOfLines={1} style={[gateStyle.text, { flexShrink: 1 }]}>VNDRLY Gate</Text>
          </Pressable>
          <GateHeaderActions
            count={count}
            onNotifications={() => router.push("/(tabs)/gate-notifications")}
          />
        </View>
      )}
      <GateInsetsContext.Provider value={width < 768}>
        {!path.endsWith("/askv") && <GateAskVStatus />}
        <SidebarNotificationsContext.Provider value={true}>
          <View style={{ flex: 1, paddingTop: 0, paddingBottom: mapFullscreen ? insets.bottom : 0, paddingLeft: mapFullscreen ? insets.left : 0, paddingRight: mapFullscreen ? insets.right : 0 }}>{children}</View>
        </SidebarNotificationsContext.Provider>
      </GateInsetsContext.Provider>
      <DismissibleModal dismissLabel="close"
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
      </DismissibleModal>
    </AdaptiveNavigationShell></GateHeaderActionsProvider>
  );
}
