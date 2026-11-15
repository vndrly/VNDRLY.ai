import React from "react";
import { useLocalSearchParams } from "expo-router";
import GateEmployeeEditor from "@/components/gate/GateEmployeeEditor";
import { GatePage, useGateCopy } from "@/components/gate/GateChrome";
import { useAuth } from "@/hooks/use-auth";

export default function GatePersonPage() {
  const c = useGateCopy();
  const { user, activeMembershipId } = useAuth();
  const { id, vendorId } = useLocalSearchParams<{ id: string; vendorId?: string }>();
  return (
    <GatePage title={c("Gate employee", "Empleado de acceso")} back>
      <GateEmployeeEditor
        key={[user?.id, activeMembershipId, id, vendorId].join(":")}
        id={id}
      />
    </GatePage>
  );
}
