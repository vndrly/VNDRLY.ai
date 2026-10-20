import React from "react";
import { useLocalSearchParams } from "expo-router";
import FleetShell, { fleetModuleFromParam } from "@/components/fleet/FleetShell";
export default function FleetScreen() {
  const { module, view, assetId, runId } = useLocalSearchParams<{
    module?: string;
    view?: string;
    assetId?: string;
    runId?: string;
  }>();
  return <FleetShell module={module ? fleetModuleFromParam(module) : view === "locations" ? "locations" : view === "inventory" ? "assets" : view === "my-day" ? "driver" : "home"} initialAssetId={view === "inventory" ? assetId : undefined} initialRunId={runId} />;
}
