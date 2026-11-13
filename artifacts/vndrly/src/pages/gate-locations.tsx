import { useAuth } from "@/hooks/use-auth";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { GateCoverageMap } from "@/components/gate-coverage-map";
import GateCreateCard from "@/components/gate-create-card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

export default function GateLocationsPage() {
  const { user } = useAuth();
  const scope = [user?.userId, user?.activeMembershipId, user?.vendorId].join(":");
  return <div className={`${FIELD_OPS_PAGE_CLASS} gate-map-page space-y-5`} data-testid="gate-locations-page">
    <div className="flex items-center gap-3"><ContentPaneBackLink href="/" ariaLabel="Dashboard" testId="button-back" /><div><h1 className="text-2xl font-bold tracking-tight">Gate Locations</h1><p className="text-sm text-muted-foreground">Set gate entry points and monitor live gate coverage.</p></div></div>
    <GateCoverageMap key={scope} showGateSelector />
    <GateCreateCard key={`admin:${scope}`} />
  </div>;
}
