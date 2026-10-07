import React from "react";
import { useLocalSearchParams } from "expo-router";
import FleetWorkspace from "@/components/FleetWorkspace";
export default function FleetScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  return <FleetWorkspace initialMode={view === "my-day" ? "my-day" : "desk"} />;
}
