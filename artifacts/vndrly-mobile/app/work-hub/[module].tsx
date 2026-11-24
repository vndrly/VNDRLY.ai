import React from "react";
import { useLocalSearchParams } from "expo-router";
import GateWebPage from "@/components/GateWebPage";

export default function WorkHubModuleScreen() {
  const { module } = useLocalSearchParams<{ module?: string | string[] }>();
  const name = Array.isArray(module) ? module[0] : module;
  return <WorkHubModuleWorkspace module={name} />;
}

export function WorkHubModuleWorkspace({ module }: { module?: string }) {
  return <GateWebPage path={module ? `/work-hub/${encodeURIComponent(module)}` : "/work-hub"} />;
}
