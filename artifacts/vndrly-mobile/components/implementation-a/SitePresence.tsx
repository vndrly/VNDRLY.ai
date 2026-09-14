import React from "react";
import { View } from "react-native";
import { EmptyState, ImplementationASurface, RecordCard } from "./Surface";

type Person = { id: string; name: string; employer: string; site: string; exactLocation?: string };
export function SitePresence({ people = [], canSeeExactLocation = false }: { people?: Person[]; canSeeExactLocation?: boolean }) {
  return <ImplementationASurface description="Authorized on-duty and on-site visibility across connected work. Off-duty locations are never shown.">
    {people.length ? <View style={{ gap: 10 }}>{people.map((person) => <RecordCard key={person.id} title={person.name} detail={`${person.employer} · ${person.site}`} extra={canSeeExactLocation ? person.exactLocation : undefined} />)}</View> : <EmptyState>No authorized workers are currently visible.</EmptyState>}
  </ImplementationASurface>;
}
