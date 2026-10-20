import React from "react";

import FleetLegacyWorkspace from "@/components/FleetLegacyWorkspace";

type LegacyMode = "desk" | "my-day" | "log" | "map" | "inventory" | "locations" | "orders" | "compliance";

/** Compatibility entry for saved run links and callers awaiting a module migration. */
export default function FleetWorkspace(props: {
  initialRunId?: string;
  initialAssetId?: string;
  initialMode?: LegacyMode;
} = {}) {
  return <FleetLegacyWorkspace {...props} />;
}
