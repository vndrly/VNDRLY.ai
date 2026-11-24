import React from "react";
import { useLocalSearchParams } from "expo-router";
import GateWebPage from "@/components/GateWebPage";

export default function Page() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  return <GateWebPage path={`/work-hub/course/${encodeURIComponent(itemId ?? "")}`} />;
}
