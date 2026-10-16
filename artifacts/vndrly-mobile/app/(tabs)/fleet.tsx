import React from "react";
import { useLocalSearchParams } from "expo-router";
import FleetWorkspace from "@/components/FleetWorkspace";
export default function FleetScreen() {
  const { view, assetId } = useLocalSearchParams<{ view?: string; assetId?: string }>();
  return <FleetWorkspace initialMode={view === "inventory" ? "inventory" : view === "my-day" ? "my-day" : "desk"} initialAssetId={view === "inventory" ? assetId : undefined} />;
}
