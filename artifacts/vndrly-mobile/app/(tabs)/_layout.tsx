import { router, Slot, usePathname } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import AdaptiveNavigationShell from "@/components/AdaptiveNavigationShell";
import { useAuth } from "@/hooks/use-auth";
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

export default function TabLayout() {
  const { t } = useTranslation();
  const badges = useTabBadges();
  const { user } = useAuth();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [gateVoiceListening, setGateVoiceListening] = useState(false);

  useEffect(() => subscribeGateVoiceListening(setGateVoiceListening), []);

  const labels = useMemo<AppNavigationLabels>(
    () => ({
      askv: t("tabs.askv"),
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
    }),
    [t, user],
  );
  const items = useMemo(
    () => buildAppNavigation({ user, labels, badges }),
    [badges, labels, user],
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

  return (
    <AdaptiveNavigationShell
      activeKey={activeKey}
      bottomInset={insets.bottom}
      gateVoiceActive={gateVoiceListening}
      items={items}
      onActivate={activate}
      width={width}
    >
      <Slot />
    </AdaptiveNavigationShell>
  );
}

export function activeNavigationKey(pathname: string): string {
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
