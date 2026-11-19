import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { implementationARequest } from "./client";
import { EmptyState, ImplementationSurface } from "./surface";
import DashboardTasks from "@/components/work-hub/dashboard-tasks";
import { WorkCrews } from "@/components/work-hub/work-crews";
import "./managed-crews.css";
type Sponsorship = { id: string; workerDisplayName?: string; managedOrganizationName?: string; roles?: string[]; siteLocationIds?: number[] };
export function ManagedCrews({ scope = "assigned", children }: { scope?: "assigned" | "managed-company"; children?: ReactNode }) {
  const query = useQuery<{ sponsorships: Sponsorship[] }>({ queryKey: ["implementation-a", "sponsorships", scope], queryFn: () => implementationARequest("/sponsorships") });
  return <div className="managed-crews-page"><ImplementationSurface module="managedCrews" title="Managed Crews" description="Manage crews, task assignments, and unassigned work." topCard={<><DashboardTasks/><WorkCrews/></>}>{query.data?.sponsorships?.length ? <ul className="grid gap-3">{query.data.sponsorships.map(row => <li key={row.id} className="rounded-lg border p-4"><strong>{row.workerDisplayName ?? "Sponsored worker"}</strong><p className="text-sm text-muted-foreground">{row.managedOrganizationName ?? "Managed subcontractor"}</p></li>)}</ul> : <EmptyState>No sponsored workers are visible in this scope.</EmptyState>}<div className="mt-4">{children}</div></ImplementationSurface></div>;
}
