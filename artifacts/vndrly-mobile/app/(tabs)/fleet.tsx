import React from "react";
import { useLocalSearchParams } from "expo-router";
import FleetShell, { fleetModuleFromParam } from "@/components/fleet/FleetShell";
export default function FleetScreen() {
  const { module, view, assetId, runId, yardOrderId, runOrderId, driverUserId } = useLocalSearchParams<{
    module?: string;
    view?: string;
    assetId?: string;
    runId?: string;
    yardOrderId?: string;
    runOrderId?: string;
    driverUserId?: string;
  }>();
  return <FleetShell module={module ? fleetModuleFromParam(module) : view === "locations" ? "locations" : view === "inventory" ? "assets" : view === "my-day" ? "driver" : "home"} initialAssetId={assetId} initialRunId={runId} initialYardOrderId={yardOrderId} initialRunOrderId={runOrderId} initialDriverUserId={driverUserId ? Number(driverUserId) : undefined} />;
}
