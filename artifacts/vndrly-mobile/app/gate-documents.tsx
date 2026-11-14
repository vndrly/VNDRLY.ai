import React from "react";
import { NativeRepository } from "@/components/work-hub/NativeRepository";
import { GatePage, useGateCopy } from "@/components/gate/GateChrome";
import { useAuth } from "@/hooks/use-auth";
export default function GateDocuments() {
  const c = useGateCopy(),
    { user, activeMembershipId } = useAuth();
  return (
    <GatePage title={c("Company documents", "Documentos de empresa")} back>
      <NativeRepository
        key={[user?.id, activeMembershipId].join(":")}
        filesOnly
      />
    </GatePage>
  );
}
