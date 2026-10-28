import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { GateCoverageMap } from "@/components/gate-coverage-map";
import GateCreateCard from "@/components/gate-create-card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

export default function GateMapPage() {
  const { t } = useTranslation();
  return (
    <div className={`${FIELD_OPS_PAGE_CLASS} space-y-5`}>
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href="/gate/change-over" ariaLabel={t("nav.dashboard")} testId="button-back" />
        <MapPin aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("gateNav.map")}</h1>
      </div>
      <GateCoverageMap showGateSelector />
      <GateCreateCard />
    </div>
  );
}
