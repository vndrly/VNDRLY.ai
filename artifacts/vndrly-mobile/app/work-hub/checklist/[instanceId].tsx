import React from "react";
import { useLocalSearchParams } from "expo-router";
import GateWebPage from "@/components/GateWebPage";

export default function Page() {
  const { instanceId } = useLocalSearchParams<{ instanceId: string }>();
  return <GateWebPage path={`/work-hub/checklist/${encodeURIComponent(instanceId ?? "")}`} />;
}
