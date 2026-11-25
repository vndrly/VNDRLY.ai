import { ModalPressable as Pressable } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import { useGateConnection } from "@/hooks/use-gate-connection";
import React, { useState, useEffect } from "react";
import {
  ScrollView,
  StatusBar,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, usePathname } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AdaptiveNavigationShell, { NavigationItem } from "@/components/AdaptiveNavigationShell";
import BrandTitleRow from "@/components/BrandTitleRow";
import SidebarHalftoneBackground from "@/components/SidebarHalftoneBackground";
import { GateInsetsContext } from "./GateInsetsContext";
import { SidebarNotificationsContext } from "@/components/SidebarNotificationsContext";
import GateHeaderActions, { GateHeaderActionsProvider } from "./GateHeaderActions";
import GateAskVStatus from "./GateAskVStatus";
import AskVSwipeHeader from "./AskVSwipeHeader";
import { useUnreadNotificationCount } from "@/lib/notificationBadge";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, logout } from "@/lib/api";
import {
  activeNavigationKey,
  type AppNavigationItem,
} from "@/lib/app-navigation";
import { gateManager, isGateReleasePath, GATE_HOME } from "@/lib/gate-release";
import { nativeAskVContextPath } from "@/lib/askv-context-path";
import { isGateVoicePage } from "@workspace/gate-booth";
import { GateCard, GateRow, gateStyle, useGateCopy } from "./GateChrome";
export default function GateAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  useGateConnection();
  const { user, activeMembershipId } = useAuth(),
    { width } = useWindowDimensions(),
    insets = useSafeAreaInsets(),
    path = usePathname(),
    c = useGateCopy();
  const [menu, setMenu] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const inWorkHub = path === "/work-hub" || path.startsWith("/work-hub/");
  const hubPreferences = useQuery({
    queryKey: ["work-hub", "preferences", user?.id, activeMembershipId],
    queryFn: () => apiFetch<{ pinned?: string[]; order?: string[] }>("/api/work-hub/preferences"),
    enabled: inWorkHub && !!user,
    staleTime: 60000,
    retry: false,
  });
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
  const workHubBaseItems = [
    item("work-hub", "/work-hub", "Work Hub", "briefcase"),
    item("calendar", "/work-hub/calendar", c("Calendar", "Calendario"), "calendar"),
    item("chat", "/work-hub/chat", c("Communications", "Comunicaciones"), "message-square"),
    item("managedCrews", "/work-hub/managed-crews", c("Tasks & Crews", "Tareas y cuadrillas"), "users"),
    item("assets", "/work-hub/assets", c("Inventory", "Inventario"), "package"),
    item("files", "/work-hub/files", c("File Library", "Biblioteca de archivos"), "folder"),
    item("askv", "/work-hub/askv", "AskV", "zap"),
    item("search", "/work-hub/search", c("Search", "Buscar"), "search"),
  ];
  const office = !!user && (user.role === "admin" || user.availableMemberships?.some(membership => membership.id === activeMembershipId && membership.role === "admin") || ["office", "both"].includes(user.vendorRole ?? ""));
  const pinned = new Set(hubPreferences.data?.pinned ?? ["activity", "calendar", "chat", "files", "askv"]);
  const order = hubPreferences.data?.order ?? [];
  const orderedHubItems = [...workHubBaseItems].sort((a, b) => (order.indexOf(a.key === "work-hub" ? "activity" : a.key) < 0 ? 1000 : order.indexOf(a.key === "work-hub" ? "activity" : a.key)) - (order.indexOf(b.key === "work-hub" ? "activity" : b.key) < 0 ? 1000 : order.indexOf(b.key === "work-hub" ? "activity" : b.key)));
  const visibleHubItems = orderedHubItems.filter(entry => office || pinned.has(entry.key === "work-hub" ? "activity" : entry.key));
  const regularHubItems = visibleHubItems.filter(entry => entry.key !== "askv");
  const askvItems = visibleHubItems.filter(entry => entry.key === "askv");
  const activityPosition = regularHubItems.findIndex(entry => entry.key === "work-hub");
  const profileItem = item("profile", "/work-hub/profile", c("Profile", "Perfil"), "user");
  const workHubItems = activityPosition >= 0
    ? [...regularHubItems.slice(0, activityPosition + 1), profileItem, ...regularHubItems.slice(activityPosition + 1), ...askvItems, item("library", "/work-hub/library", "VNDRLY/U", "book-open")]
    : [...regularHubItems, ...askvItems, item("library", "/work-hub/library", "VNDRLY/U", "book-open"), profileItem];
  const workHubBottomItems = [
    ...orderedHubItems.filter(entry => pinned.has(entry.key === "work-hub" ? "activity" : entry.key)),
    profileItem,
  ];
  const hubSection = path.startsWith("/work-hub/meeting") || path.startsWith("/work-hub/calls") || path.startsWith("/work-hub/attention") ? "chat"
    : path.startsWith("/work-hub/task") || path.startsWith("/work-hub/my-work") ? "managedCrews"
    : path.startsWith("/work-hub/file") || path.startsWith("/work-hub/record") ? "files"
    : path.startsWith("/work-hub/asset") ? "assets"
    : path.startsWith("/work-hub/search-item") ? "search"
    : path.startsWith("/work-hub/library") || path.startsWith("/work-hub/training") || path.startsWith("/work-hub/course") ? "library"
    : workHubItems.find(entry => entry.href === path || (entry.href !== "/work-hub" && path.startsWith(`${entry.href}/`)))?.key ?? "work-hub";
  const secondary = [
    item("askv", "/(tabs)/askv", "AskV", "zap"),
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
  const returnToGateItem = item("return-to-gate", GATE_HOME, "Return to Gate", "arrow-left");
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
      inlineProfile={inWorkHub}
      activeKey={inWorkHub ? hubSection : activeNavigationKey(path)}
      bottomInset={insets.bottom}
      gateVoiceActive={false}
      items={inWorkHub ? width >= 768 ? [returnToGateItem, ...workHubItems, ...secondary.filter(entry => entry.key !== "askv")] : workHubBottomItems : width >= 768 ? [...primary, ...secondary] : primary}
      width={width}
      userName={user?.displayName ?? undefined}
      notificationCount={count}
      onOpenNotifications={() => router.push("/(tabs)/gate-notifications")}
      onActivate={activate}
      onSignOut={signOut}
    >
      {width < 768 && !mapFullscreen && (
        <AskVSwipeHeader
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
            <Text numberOfLines={1} style={[gateStyle.text, { flexShrink: 1 }]}>{inWorkHub ? "Work Hub" : "VNDRLY Gate"}</Text>
          </Pressable>
          <GateHeaderActions
            count={count}
            onNotifications={() => router.push("/(tabs)/gate-notifications")}
          />
        </AskVSwipeHeader>
      )}
      <GateInsetsContext.Provider value={width < 768}>
        {mapFullscreen && <StatusBar hidden />}
        {!mapFullscreen && !path.endsWith("/askv") && <GateAskVStatus gatePage={isGateVoicePage(nativeAskVContextPath(path))} pagePath={path} topInset={0} />}
        <SidebarNotificationsContext.Provider value={true}>
          <View style={{ flex: 1, paddingTop: mapFullscreen ? insets.top : 0, paddingBottom: mapFullscreen ? insets.bottom : 0, paddingLeft: mapFullscreen ? insets.left : 0, paddingRight: mapFullscreen ? insets.right : 0 }}>{children}</View>
        </SidebarNotificationsContext.Provider>
      </GateInsetsContext.Provider>
      <DismissibleModal dismissLabel="close"
        visible={menu}
        transparent
        animationType={inWorkHub ? "fade" : "slide"}
        onRequestClose={() => setMenu(false)}
      >
        {inWorkHub ? <View style={{ flex: 1, flexDirection: "row", backgroundColor: "#0009" }}>
          <View style={{ width: Math.min(width * 0.8, 256), backgroundColor: "#3a3d42", paddingTop: insets.top, paddingBottom: insets.bottom }}>
            <SidebarHalftoneBackground />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 20, gap: 3 }}>
              <View style={{ minHeight: 116, paddingHorizontal: 4, paddingBottom: 12 }}>
                <BrandTitleRow logoTestId="work-hub-menu-brand" stacked subtitle={user?.displayName ?? undefined} portalLabel={user?.role === "admin" ? "Admin Portal" : user?.role === "partner" ? "Partner Portal" : "Vendor Portal"} />
              </View>
              <NavigationItem active={false} item={returnToGateItem} mode="sidebar" onPress={() => activate(returnToGateItem)} />
              {workHubItems.map(entry => <NavigationItem key={entry.key} active={entry.key === hubSection} item={entry} mode="sidebar" onPress={() => activate(entry)} />)}
              {secondary.filter(entry => entry.key !== "askv").map(entry => <NavigationItem key={entry.key} active={false} item={entry} mode="sidebar" onPress={() => activate(entry)} />)}
              <NavigationItem active={false} item={item("sign-out", "/login", "Sign Out", "log-out")} mode="sidebar" onPress={() => { setMenu(false); void signOut(); }} />
            </ScrollView>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Work Hub menu" onPress={() => setMenu(false)} style={{ flex: 1 }} />
        </View> :
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
              {(inWorkHub ? [...workHubItems, ...secondary.filter(entry => entry.key !== "askv")] : secondary).map((entry) => (
                <GateRow
                  key={entry.key}
                  label={entry.label}
                  icon={entry.icon as never}
                  onPress={() => activate(entry)}
                />
              ))}
              {!inWorkHub && <GateRow
                label={c("Shift Notes", "Notas del turno")}
                icon="file-text"
                onPress={() =>
                  activate(item("shift-notes", "/(tabs)/shift-notes", "", ""))
                }
              />}
              <GateRow
                label={c("Close menu", "Cerrar menú")}
                icon="x"
                onPress={() => setMenu(false)}
              />
            </GateCard>
          </ScrollView>
        </View>}
      </DismissibleModal>
    </AdaptiveNavigationShell></GateHeaderActionsProvider>
  );
}
