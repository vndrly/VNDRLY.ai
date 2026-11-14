import React from "react";
import GateLocationsCard from "@/components/profile/GateLocationsCard";
import { GatePage, useGateCopy } from "@/components/gate/GateChrome";
export default function Locations() {
  const c = useGateCopy();
  return (
    <GatePage title={c("Gate locations", "Ubicaciones de acceso")} back>
      <GateLocationsCard />
    </GatePage>
  );
}
