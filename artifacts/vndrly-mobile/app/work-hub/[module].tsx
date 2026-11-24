import React from "react";
import { useLocalSearchParams } from "expo-router";
import GateWebPage from "@/components/GateWebPage";

export default function WorkHubModuleScreen() {
  const { module } = useLocalSearchParams<{ module?: string | string[] }>();
  const name = Array.isArray(module) ? module[0] : module;
  return <WorkHubModuleWorkspace module={name} />;
}

export function WorkHubModuleWorkspace({ module }: { module?: string }) {
  const companion = module === "tasks-forms" ? "managed-crews" : module === "files-notes" ? "files" : module;
  return <GateWebPage path={companion ? `/work-hub/${encodeURIComponent(companion)}` : "/work-hub"} />;
}
