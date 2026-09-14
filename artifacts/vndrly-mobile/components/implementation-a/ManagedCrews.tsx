import React from "react";
import { View } from "react-native";
import { EmptyState, ImplementationASurface, RecordCard } from "./Surface";

type Sponsorship = { id: string; workerDisplayName?: string; managedOrganizationName?: string; roles?: string[] };
export function ManagedCrews({ sponsorships = [] }: { sponsorships?: Sponsorship[] }) {
  return <ImplementationASurface description="Sponsored workers and supervisors, limited to the crews and sites you are authorized to manage.">
    {sponsorships.length ? <View style={{ gap: 10 }}>{sponsorships.map((row) => <RecordCard key={row.id} title={row.workerDisplayName ?? "Sponsored worker"} detail={row.managedOrganizationName ?? "Managed subcontractor"} extra={row.roles?.join(", ")} />)}</View> : <EmptyState>No sponsored workers are visible in this scope.</EmptyState>}
  </ImplementationASurface>;
}
