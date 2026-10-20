import React, { Suspense, type ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";

import ScreenSafeArea from "@/components/ScreenSafeArea";
import TogglePillButton from "@/components/TogglePillButton";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import { useFleetHome } from "@/hooks/use-fleet-home";
import { useAuth } from "@/hooks/use-auth";
import FleetHome from "./FleetHome";
import FleetSetup from "@/components/FleetSetup";
import FleetModuleBoundary, { type FleetModuleBoundaryProps } from "./FleetModuleBoundary";

const FleetLegacyWorkspace = React.lazy(() => import("@/components/FleetLegacyWorkspace"));

export const FLEET_MODULES = ["home", "dispatch", "yard", "driver", "office", "assets", "runs", "map", "history", "locations", "compliance", "setup"] as const;
export type FleetModuleId = typeof FLEET_MODULES[number];

/** A module owns its result and recovery; siblings are never reset for its failure. */
export type FleetModuleContent = Pick<FleetModuleBoundaryProps, "children" | "state" | "error" | "onRetry" | "onReview">;
export type FleetModuleRegistry = Partial<Record<FleetModuleId, FleetModuleContent>>;

export function fleetModuleFromParam(value: string | string[] | undefined): FleetModuleId {
  const candidate = Array.isArray(value) ? value[0] : value;
  return FLEET_MODULES.find((module) => module === candidate) ?? "home";
}

const moduleLabels: Record<FleetModuleId, string> = {
  home: "Fleet Ops", dispatch: "Dispatch", yard: "Yard", driver: "My Fleet Day", office: "Office",
  assets: "Assets and Details", runs: "Runs", map: "Map", history: "Fleet Log",
  locations: "Origins and Destinations", compliance: "Compliance",
  setup: "Fleet Setup",
};

const legacyModes = {
  dispatch: "desk", yard: "inventory", driver: "my-day", office: "desk", assets: "inventory",
  runs: "orders", map: "map", history: "log", locations: "locations", compliance: "compliance",
} as const;

export default function FleetShell({ module = "home", modules = {}, visibleModules, initialAssetId, initialRunId, initialYardOrderId }: {
  module?: FleetModuleId;
  modules?: FleetModuleRegistry;
  visibleModules?: readonly FleetModuleId[];
  initialAssetId?: string;
  initialRunId?: string;
  initialYardOrderId?: string;
}) {
  const colors = useColors();
  const copy = useFleetCopy();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const { user, activeMembershipId, activeMembership } = useAuth();
  const setupIdentity = JSON.stringify([user?.id ?? null, activeMembershipId ?? user?.activeMembershipId ?? null, activeMembership?.orgType ?? null, activeMembership?.orgId ?? user?.vendorId ?? user?.partnerId ?? null]);
  const home = useFleetHome(module === "home");
  const selected = visibleModules ?? (module === "home" ? [] : [module]);
  const open = (next: FleetModuleId, runId?: string, yardOrderId?: string) => router.push(`/(tabs)/fleet?module=${next}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}${yardOrderId ? `&yardOrderId=${encodeURIComponent(yardOrderId)}` : ""}` as never);
  const renderModule = (id: FleetModuleId) => {
    const entry = modules[id];
    const fallback: ReactNode = id === "home" ? null : id === "setup" ? <FleetSetup key={setupIdentity} onSaved={home.retry} /> : <Suspense fallback={<Text>{copy(`Loading ${moduleLabels[id]}`)}</Text>}>
      <FleetLegacyWorkspace embedded initialMode={legacyModes[id as keyof typeof legacyModes]} initialAssetId={id === "assets" ? initialAssetId : undefined} initialRunId={initialRunId} initialYardOrderId={initialYardOrderId} />
    </Suspense>;
    return <View key={id} style={{ width: wide && module === "home" ? "48%" : "100%", minWidth: 0 }}>
      <FleetModuleBoundary module={id} title={copy(moduleLabels[id])} state={entry?.state} error={entry?.error} onRetry={entry?.onRetry} onReview={entry?.onReview}>
        {entry?.children ?? fallback}
      </FleetModuleBoundary>
    </View>;
  };

  return <ScreenSafeArea><ScrollView testID="fleet-shell-scroll" contentContainerStyle={{ padding: 16, gap: 16 }}>
    <WorkHubPageTitle title={copy(moduleLabels[module])} onBack={module === "home" ? undefined : () => open("home")} />
    {module !== "home" && <TogglePillButton color="blue" compactOnTablet onPress={() => open("home")}>{copy("All Fleet modules")}</TogglePillButton>}
    {module === "home" && !selected.length && home.projection && <FleetHome projection={home.projection} visibility={home.visibility} onOpen={open} onRetry={home.retry} />}
    {module === "home" && !selected.length && !home.projection && <View style={{ gap: 12 }}>
      <Text accessibilityRole={home.state === "unavailable" ? "alert" : undefined} style={{ color: colors.text }}>{copy(home.error ?? "Loading Fleet Home")}</Text>
      {home.state === "unavailable" && <TogglePillButton color="blue" onPress={home.retry}>{copy("Retry Fleet Home")}</TogglePillButton>}
    </View>}
    {selected.length > 0 && <View testID="fleet-module-grid" style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
      {selected.map(renderModule)}
    </View>}
  </ScrollView></ScreenSafeArea>;
}
