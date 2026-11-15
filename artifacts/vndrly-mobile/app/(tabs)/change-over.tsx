import React from "react";
import { useLocalSearchParams } from "expo-router";
import GateChangeOver from "@/components/GateChangeOver";
import GateWebPage from "@/components/GateWebPage";

export default function GateDashboard() {
  const { purpose, gateMode } = useLocalSearchParams<{ purpose?: string; gateMode?: string }>();
  if (purpose === "assume" || gateMode === "1") return <GateChangeOver />;
  return <GateWebPage path="/gate/change-over" />;
}
