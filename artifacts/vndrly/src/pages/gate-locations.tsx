import SiteLocations from "./site-locations";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { GateCoverageMap } from "@/components/gate-coverage-map";
import GateCreateCard from "@/components/gate-create-card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

export default function GateLocationsPage() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith("es");
  const scope = [user?.userId, user?.activeMembershipId, user?.vendorId].join(":");
  return <div className={`${FIELD_OPS_PAGE_CLASS} gate-map-page space-y-5`} data-testid="gate-locations-page">
    <div className="flex items-center gap-3"><ContentPaneBackLink href="/" ariaLabel="Dashboard" testId="button-back" /><div><h1 className="text-2xl font-bold tracking-tight">{es ? "Mapeo" : "Mapping"}</h1><p className="text-sm text-muted-foreground">{es ? "Sitios, accesos, personal y equipo." : "Sites, gates, staff, and equipment."}</p></div></div>
    <GateCoverageMap key={scope} showGateSelector siteList={<SiteLocations embedded />} />
    <GateCreateCard key={`admin:${scope}`} />
  </div>;
}
