import { router, Slot, usePathname } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import AdaptiveNavigationShell from "@/components/AdaptiveNavigationShell";
import type { CompanyOperations } from "@/components/CompanyOperationsChoice";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, logout } from "@/lib/api";
import { fleetHomeRoute } from "@/lib/fleet-mobile";
import { useFleetCopy } from "@/lib/fleet-copy";
import type { FleetOverview, FleetSiteChoices, FleetSupportChoices } from "@workspace/api-zod";
import {
  buildAppNavigation,
  activeNavigationKey,
  type AppNavigationItem,
  type AppNavigationLabels,
} from "@/lib/app-navigation";
import {
  requestGateVoiceEntry,
  subscribeGateVoiceListening,
} from "@/lib/gate-voice-launch";
import { homeTabTitleKey, isGatekeeperUser } from "@/lib/mobile-viewer";
import { useTabBadges } from "@/lib/tabBadges";
import { useUnreadNotificationCount } from "@/lib/notificationBadge";

export default function TabLayout() {
  const { t } = useTranslation();
  const fleetCopy = useFleetCopy();
  const badges = useTabBadges();
  const notificationCount = useUnreadNotificationCount(true);
  const { user, activeMembershipId, activeMembership } = useAuth();
  const pathname = usePathname();
  const [companyOperations, setCompanyOperations] = useState<{ identity: string; value: CompanyOperations } | null>(null);
  const fleetIdentity = `${user?.id}:${activeMembershipId}:${user?.vendorId}`;
  useEffect(() => {
    let alive = true;
    if (user?.vendorId) void apiFetch<CompanyOperations>("/api/company-operations").then(value => {
      if (alive && value.vendorId === user.vendorId) setCompanyOperations({ identity: fleetIdentity, value });
    }).catch(() => { /* Retain this identity's last verified categories during a failed refresh. */ });
    return () => { alive = false; };
  }, [fleetIdentity, user?.vendorId, pathname]);
  const categories = user?.vendorId ? companyOperations?.identity === fleetIdentity ? companyOperations.value.categories : [] : null;
  const [fleetSupportAccess,setFleetSupportAccess]=useState<string|null>(null);
  const [fleetSiteAccess,setFleetSiteAccess] = useState<string|null>(null);
  const [fleetAccess, setFleetAccess] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFleetAccess(previous=>previous===fleetIdentity?previous:null);
    setFleetSupportAccess(previous=>previous===fleetIdentity?previous:null);
    if(user?.id && user.role === "admin") void apiFetch<FleetSupportChoices>("/api/fleet/support").then(result=>{if(alive && result.readOnly===true && result.companies.length>0)setFleetSupportAccess(fleetIdentity);}).catch(()=>undefined);
    setFleetSiteAccess(previous=>previous===fleetIdentity?previous:null);
    if (user?.id && (activeMembership ? activeMembership.orgType === "partner" : user.role === "partner")) {
      void apiFetch<FleetSiteChoices>("/api/fleet/site-activity").then(result=>{if(alive && result.capabilities.canReadSiteActivity)setFleetSiteAccess(fleetIdentity);}).catch(()=>undefined);
      return () => {alive=false;};
    }
    if (user?.id) void apiFetch<FleetOverview>("/api/fleet/overview")
      .then(result => {
        if (!alive) return;
        setFleetAccess(result.enabled || result.capabilities?.canSetup ? fleetIdentity : null);
        const home = fleetHomeRoute(result);
        if (home && categories?.includes("fleet") && !categories.includes("field") && activeNavigationKey(pathname) === "index") router.replace(home as never);
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
      fleetLog: fleetCopy("Fleet Log"),
      fleetMap: fleetCopy("Fleet Map"),
      fleetSiteActivity: fleetCopy("Fleet site activity"),
      fleetSupport: fleetCopy("Fleet support"),
      comms: t("tabs.comms"),
      crews: t("tabs.crews"),
      flagged: t("tabs.flagged"),
      gate: t("tabs.gateOps", {defaultValue:"Gate Ops"}),
      gateMap: t("tabs.gateMap", {defaultValue:"Gate Map"}),
      gateLog: t("tabs.gateLog", {defaultValue:"Gate Log"}),
      history: t("tabs.history"),
      home: t(homeTabTitleKey(user)),
      map: t("tabs.crewMap"),
      profile: t("tabs.profile"),
      scan: t("tabs.scan"),
      schedule: "Calendar",
      voice: t("gatekeeper.voiceEntry"),
      workHub: "Work Hub",
      changeOver: t("changeOver.title"),
      shiftNotes: t("changeOver.shiftNotes"),
    }),
    [t, user, fleetCopy],
  );
  const items = useMemo(
    () => buildAppNavigation({ user, labels, badges, companyOperationsCategories: categories, fleetEnabled: fleetAccess === fleetIdentity, fleetSupportEnabled: fleetSupportAccess === fleetIdentity, fleetSiteActivityEnabled: fleetSiteAccess === fleetIdentity }),
    [badges, labels, user, categories, fleetAccess, fleetSiteAccess, fleetSupportAccess, fleetIdentity],
  );
  const activeKey = activeNavigationKey(pathname);
  const shared = ["askv", "work-hub", "profile", "gate-notifications", "gate-notification-preferences"].includes(activeKey);
  const allowed = !categories || shared || (categories.includes("field") && !activeKey.startsWith("fleet") && !["gate", "gate-history", "gate-map", "change-over", "shift-notes"].includes(activeKey)) || (categories.includes("fleet") && (["fleet", "fleet-log", "fleet-map"].includes(activeKey) || pathname.includes("/fleet-run"))) || (categories.includes("gate") && ["gate", "gate-history", "gate-map", "change-over", "shift-notes"].includes(activeKey));
  useEffect(() => {
    if (!companyOperations || companyOperations.identity !== fleetIdentity || allowed) return;
    router.replace((isGatekeeperUser(user) && !categories?.includes("gate") ? "/(tabs)/profile" : categories?.includes("fleet") ? "/(tabs)/fleet" : categories?.includes("gate") ? "/(tabs)/change-over" : categories?.includes("field") ? "/(tabs)" : companyOperations.value.canManage ? "/company-operations" : "/(tabs)/profile") as never);
  }, [allowed, categories, companyOperations, fleetIdentity]);

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
      {allowed ? <Slot /> : null}
    </AdaptiveNavigationShell>
  );
}

export {activeNavigationKey} from "@/lib/app-navigation";

function isGateScreen(pathname: string): boolean {
  return (
    pathname === "/gate" ||
    pathname === "/(tabs)/gate" ||
    pathname.endsWith("/gate")
  );
}
