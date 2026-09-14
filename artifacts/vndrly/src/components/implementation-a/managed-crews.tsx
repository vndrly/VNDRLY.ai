import { useQuery } from "@tanstack/react-query";
import { implementationARequest } from "./client";
import { EmptyState, ImplementationSurface } from "./surface";
type Sponsorship = { id: string; workerDisplayName?: string; managedOrganizationName?: string; roles?: string[]; siteLocationIds?: number[] };
export function ManagedCrews({ scope = "assigned" }: { scope?: "assigned" | "managed-company" }) {
  const query = useQuery<{ sponsorships: Sponsorship[] }>({ queryKey: ["implementation-a", "sponsorships", scope], queryFn: () => implementationARequest("/sponsorships") });
  return <ImplementationSurface module="managedCrews" title="Managed Crews" description="Sponsored workers and supervisors, limited to the crews and sites you are authorized to manage.">{query.data?.sponsorships?.length ? <ul className="grid gap-3">{query.data.sponsorships.map(row => <li key={row.id} className="rounded-lg border p-4"><strong>{row.workerDisplayName ?? "Sponsored worker"}</strong><p className="text-sm text-muted-foreground">{row.managedOrganizationName ?? "Managed subcontractor"}</p></li>)}</ul> : <EmptyState>No sponsored workers are visible in this scope.</EmptyState>}</ImplementationSurface>;
}
