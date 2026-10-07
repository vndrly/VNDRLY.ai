import React from "react";
import { useLocalSearchParams } from "expo-router";
import FleetWorkspace from "@/components/FleetWorkspace";
export default function FleetRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FleetWorkspace initialRunId={id} />;
}
