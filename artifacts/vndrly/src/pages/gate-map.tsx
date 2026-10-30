import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { GateCoverageMap } from "@/components/gate-coverage-map";
import GateCreateCard from "@/components/gate-create-card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

export default function GateMapPage() {
  const { t } = useTranslation();
  const pageHeader = (close?: () => void) => <header className="gate-map-page-header flex items-center gap-3">
    <ContentPaneBackLink href="/gate/change-over" onClick={close} ariaLabel={close ? t("common.close", { defaultValue: "Close expanded map" }) : t("common.back", { defaultValue: "Back" })} testId={close ? "button-close-expanded-map" : "button-back"} />
    <MapPin aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
    <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("gateNav.map")}</h1>
  </header>;
  return (
    <div className={`${FIELD_OPS_PAGE_CLASS} gate-map-page space-y-5`}>
      {pageHeader()}
      <GateCoverageMap showGateSelector expandedHeader={pageHeader} />
      <GateCreateCard />
    </div>
  );
}
