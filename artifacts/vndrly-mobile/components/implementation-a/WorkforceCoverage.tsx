import React from "react";
import { View } from "react-native";
import { EmptyState, ImplementationASurface, RecordCard } from "./Surface";

type Gap = { id: string; label: string; startsAt: string; status: string };
export function WorkforceCoverage({ gaps = [] }: { gaps?: Gap[] }) {
  return <ImplementationASurface description="Uncovered shifts, acknowledgements, and escalation status.">
    {gaps.length ? <View style={{ gap: 10 }}>{gaps.map((gap) => <RecordCard key={gap.id} title={gap.label} detail={`${new Date(gap.startsAt).toLocaleString()} · ${gap.status}`} />)}</View> : <EmptyState>All required shifts are covered.</EmptyState>}
  </ImplementationASurface>;
}
