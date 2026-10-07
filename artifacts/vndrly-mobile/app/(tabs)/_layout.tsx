import { router, Slot, usePathname } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import AdaptiveNavigationShell from "@/components/AdaptiveNavigationShell";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, logout } from "@/lib/api";
import { fleetHomeRoute } from "@/lib/fleet-mobile";
import { useFleetCopy } from "@/lib/fleet-copy";
import type { FleetOverview, FleetSiteChoices, FleetSupportChoices } from "@workspace/api-zod";
import {
  buildAppNavigation,
  type AppNavigationItem,
  type AppNavigationLabels,
} from "@/lib/app-navigation";
import {
  requestGateVoiceEntry,
  subscribeGateVoiceListening,
} from "@/lib/gate-voice-launch";
import { homeTabTitleKey } from "@/lib/mobile-viewer";
import { useTabBadges } from "@/lib/tabBadges";
import { useUnreadNotificationCount } from "@/lib/notificationBadge";

export default function TabLayout() {
  const { t } = useTranslation();
  const fleetCopy = useFleetCopy();
  const badges = useTabBadges();
  const notificationCount = useUnreadNotificationCount(true);
  const { user, activeMembershipId, activeMembership } = useAuth();
  const pathname = usePathname();
  const fleetIdentity = `${user?.id}:${activeMembershipId}`;
  const [fleetSupportAccess,setFleetSupportAccess]=useState<string|null>(null);
  const [fleetSiteAccess,setFleetSiteAccess] = useState<string|null>(null);
  const [fleetAccess, setFleetAccess] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFleetAccess(null);
    setFleetSupportAccess(null);
    if(user?.id && user.role === "admin") void apiFetch<FleetSupportChoices>("/api/fleet/support").then(result=>{if(alive && result.readOnly===true && result.companies.length>0)setFleetSupportAccess(fleetIdentity);}).catch(()=>undefined);
    setFleetSiteAccess(null);
    if (user?.id && (activeMembership ? activeMembership.orgType === "partner" : user.role === "partner")) {
      void apiFetch<FleetSiteChoices>("/api/fleet/site-activity").then(result=>{if(alive && result.capabilities.canReadSiteActivity)setFleetSiteAccess(fleetIdentity);}).catch(()=>undefined);
      return () => {alive=false;};
    }
    if (user?.id) void apiFetch<FleetOverview>("/api/fleet/overview")
      .then(result => {
        if (!alive) return;
        if (result.enabled || result.capabilities?.canSetup) setFleetAccess(fleetIdentity);
        const home = fleetHomeRoute(result);
        if (home && activeNavigationKey(pathname) === "index") router.replace(home as never);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [fleetIdentity, user?.id, user?.role, activeMembership?.orgType, pathname]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [gateVoiceListening, setGateVoiceListening] = useState(false);

  useEffect(() => subscribeGateVoiceListening(setGateVoiceListening), []);

  const labels = useMemo<AppNavigationLabels>(
    () => ({
      askv: t("tabs.askv"),
      fleet: fleetCopy("Fleet Ops"),
      fleetSiteActivity: fleetCopy("Fleet site activity"),
      fleetSupport: fleetCopy("Fleet support"),
      comms: t("tabs.comms"),
      crews: t("tabs.crews"),
      flagged: t("tabs.flagged"),
      gate: t("gatekeeper.tab"),
      history: t("tabs.history"),
      home: t(homeTabTitleKey(user)),
      map: t("tabs.crewMap"),
      profile: t("tabs.profile"),
      scan: t("tabs.scan"),
      schedule: t("tabs.schedule"),
      voice: t("gatekeeper.voiceEntry"),
      workHub: "Work Hub",
      changeOver: t("changeOver.title"),
      shiftNotes: t("changeOver.shiftNotes"),
    }),
    [t, user, fleetCopy],
  );
  const items = useMemo(
    () => buildAppNavigation({ user, labels, badges, fleetEnabled: fleetAccess === fleetIdentity, fleetSupportEnabled: fleetSupportAccess === fleetIdentity, fleetSiteActivityEnabled: fleetSiteAccess === fleetIdentity }),
    [badges, labels, user, fleetAccess, fleetSiteAccess, fleetSupportAccess, fleetIdentity],
  );
  const activeKey = activeNavigationKey(pathname);

  const activate = (item: AppNavigationItem) => {
    if (item.kind === "gate-voice") {
      if (!isGateScreen(pathname)) router.push(item.href as never);
      requestGateVoiceEntry();
      return;
    }
    router.push(item.href as never);
  };

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <AdaptiveNavigationShell
      activeKey={activeKey}
      bottomInset={insets.bottom}
      gateVoiceActive={gateVoiceListening}
      items={items}
      notificationCount={notificationCount}
      onActivate={activate}
      onOpenNotifications={() => router.push("/(tabs)/gate-notifications")}
      onSignOut={signOut}
      profileSettingsLabel={t("profile.navLabel")}
      signOutLabel={t("nav.signOut")}
      userName={user?.displayName ?? undefined}
      width={width}
    >
      <Slot />
    </AdaptiveNavigationShell>
  );
}

export function activeNavigationKey(pathname: string): string {
  if (pathname.split("/").includes("fleet-run")) return "fleet";
  if (
    pathname === "/" ||
    pathname === "/index" ||
    pathname === "/(tabs)" ||
    pathname === "/(tabs)/index"
  ) {
    return "index";
  }
  const segment = pathname.split("/").filter(Boolean).at(-1);
  return segment ?? "index";
}

function isGateScreen(pathname: string): boolean {
  return (
    pathname === "/gate" ||
    pathname === "/(tabs)/gate" ||
    pathname.endsWith("/gate")
  );
}
