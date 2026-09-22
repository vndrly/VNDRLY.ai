import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import ContentPaneBackLink from "@/components/content-pane-back-link";
import { GateReportToolbar, queryGateReportRows, type GateReportRange, type GateReportRecordType } from "@/components/gate-report-toolbar";
import { BrandedInput, BrandedSelect } from "@/components/work-hub/chrome";
import { Card, CardContent, CARD_INNER_TILE_CLASS, CARD_SURFACE_CLASS } from "@/components/ui/card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { changeOverRequest } from "@/lib/change-over-api";
import { formatPlateForDisplay } from "@/lib/plate-display";

type GateHistoryRow = {
  id: string; name?: string; company?: string | null; vehiclePlate?: string | null;
  plateState?: string | null; checkInTime?: string; checkOutTime?: string | null;
  reconciliationState?: string | null; kind?: string;
};

const RANGE_OPTIONS: Array<[GateReportRange, string]> = [
  ["current_shift", "Current shift"], ["previous_shift", "Previous shift"], ["24h", "Last 24 hours"],
  ["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["90d", "90 days"], ["1y", "1 year"],
];
const TYPE_OPTIONS: Array<[GateReportRecordType, string]> = [
  ["all", "All records"], ["check_ins", "Check-ins"], ["check_outs", "Check-outs"],
  ["visitors_on_site", "Visitors on site"], ["employees_on_site", "Employees on site"],
  ["vehicles_on_site", "Vehicles on site"], ["pending", "Pending admission"], ["needs_review", "Needs review"],
];

export default function GateHistoryPage() {
  const { t } = useTranslation();
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [siteId, setSiteId] = useState(initial.get("siteId") ?? initial.get("siteLocationId") ?? "");
  const [stationId, setStationId] = useState(initial.get("stationId") ?? "");
  const [range, setRange] = useState<GateReportRange>((initial.get("range") as GateReportRange) || "current_shift");
  const [recordType, setRecordType] = useState<GateReportRecordType>((initial.get("recordType") as GateReportRecordType) || "all");
  const [search, setSearch] = useState(initial.get("search") ?? "");
  const sites = useQuery({ queryKey: ["change-over-sites"], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites"), retry: false });
  const resolvedSiteId = siteId || String(sites.data?.sites[0]?.id ?? "");
  const stations = useQuery({ queryKey: ["change-over-stations", resolvedSiteId], queryFn: () => changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${resolvedSiteId}`), enabled: Boolean(resolvedSiteId), retry: false });
  const resolvedStationId = stationId || stations.data?.stations[0]?.id || "";
  const filters = resolvedSiteId ? {
    siteId: Number(resolvedSiteId), ...(resolvedStationId ? { stationId: resolvedStationId } : {}), range, recordType,
    ...(search.trim() ? { search: search.trim() } : {}),
  } : null;
  const rows = useQuery({ queryKey: ["gate-history-report", filters], queryFn: () => queryGateReportRows<GateHistoryRow>("history", filters!), enabled: Boolean(filters), retry: false });

  useEffect(() => {
    const params = new URLSearchParams();
    if (resolvedSiteId) params.set("siteId", resolvedSiteId);
    if (resolvedStationId) params.set("stationId", resolvedStationId);
    params.set("range", range); params.set("recordType", recordType);
    if (search.trim()) params.set("search", search.trim());
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [range, recordType, resolvedSiteId, resolvedStationId, search]);

  const displayPlate = (state?: string | null, plate?: string | null) => formatPlateForDisplay(state, plate, t("gatekeeper.plateStateUnconfirmed"));
  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="gate-history-page">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href="/gate/change-over" ariaLabel={t("gatekeeper.backToGate")} testId="button-back" />
        <History aria-hidden="true" data-testid="gate-history-header-icon" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
        <div><h1 className="text-2xl font-bold tracking-tight text-foreground">{t("gatekeeper.historyTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">Review and export Gate activity for the selected shift or date range.</p></div>
      </div>
      <Card className={`min-h-[24rem] ${CARD_SURFACE_CLASS}`}>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap gap-3">
            <label className="min-w-44 space-y-1 text-sm font-medium">Site<BrandedSelect value={resolvedSiteId} onChange={(event) => { setSiteId(event.target.value); setStationId(""); }}>{sites.data?.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</BrandedSelect></label>
            <label className="min-w-44 space-y-1 text-sm font-medium">Gate<BrandedSelect value={resolvedStationId} onChange={(event) => setStationId(event.target.value)}>{stations.data?.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</BrandedSelect></label>
          </div>
          <GateReportToolbar reportKind="history" filters={filters} disabled={rows.isLoading} />
          <div className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem_13rem]">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><BrandedInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("gatekeeper.historySearch")} aria-label={t("gatekeeper.historySearch")} className="pl-9" data-testid="input-gate-history-search" /></div>
            <BrandedSelect aria-label="History range" value={range} onChange={(event) => setRange(event.target.value as GateReportRange)}>{RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</BrandedSelect>
            <BrandedSelect aria-label="Record type" value={recordType} onChange={(event) => setRecordType(event.target.value as GateReportRecordType)}>{TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</BrandedSelect>
          </div>
          {rows.isLoading ? <Loader2 className="animate-spin text-muted-foreground" /> : rows.isError ? <p className="text-sm text-destructive">{t("gatekeeper.historyLoadFailed")}</p> : !rows.data?.length ? <p className="text-sm text-muted-foreground">{t("gatekeeper.historyEmpty")}</p> : rows.data.map((visit) => (
            <div key={visit.id} className={`${CARD_INNER_TILE_CLASS} transition-colors hover:bg-gray-50`} data-testid="gate-history-row">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-foreground">{visit.name || "Gate record"}</p><p className="truncate text-xs text-muted-foreground">{[visit.company, displayPlate(visit.plateState, visit.vehiclePlate)].filter(Boolean).join(" · ")}</p><p className="text-xs text-muted-foreground">{visit.checkInTime ? new Date(visit.checkInTime).toLocaleString() : ""}{visit.checkOutTime ? ` → ${new Date(visit.checkOutTime).toLocaleString()}` : ""}</p></div><span className="shrink-0 text-xs font-semibold text-muted-foreground">{visit.reconciliationState === "needs_review" ? "Needs review" : visit.checkOutTime ? t("gatekeeper.historyCheckedOut") : t("gatekeeper.historyOnSite")}</span></div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
