import { useId } from "react";
import { useLinkedGates } from "@/hooks/use-linked-gates";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import { BrandedSelect } from "@/components/work-hub/chrome";
import GateGpsSelector from "./gate-gps-selector";
import "./gate-dashboard.css";

type GateChoice = { id: string; name: string; siteId: number };
export default function GateSiteGateSelect({ sites, siteId, gate, onChange, gpsStatus = "unavailable", gpsLabel = "", gpsDetail, testId, history = false, showGps = true, gateOptions, allOptionLabel }: {
  sites: { id: number; name: string }[];
  siteId: number;
  gate?: { id: string; name: string };
  onChange: (siteId: number, gateId: string) => void;
  gpsStatus?: "verified" | "mismatch" | "unavailable";
  gpsLabel?: string;
  gpsDetail?: string;
  testId?: string;
  history?: boolean;
  showGps?: boolean;
  gateOptions?: GateChoice[];
  allOptionLabel?: string;
}) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const es = i18n?.language?.startsWith("es"), gradientId = useId();
  const reportConnection = /^\/gate(?:\/change-over)?\/?$/.test(window.location.pathname);
  const link = useLinkedGates(siteId, gate?.id, reportConnection);
  const linked = Boolean(link.data?.groupId) && (link.data?.gates?.length ?? 0) > 1;
  const selectedConnection = linked && !link.isError ? link.data?.gates?.find(row => row.id === gate?.id)?.connection ?? "unknown" : "unknown";
  const online = link.data?.gates?.filter(row => row.connection === "online").length ?? 0;
  const connectionText = selectedConnection === "online" ? (es ? "Caseta conectada" : "Booth connected") : selectedConnection === "offline" ? (es ? "Sin conexión reciente de caseta" : "No recent booth connection") : (es ? "Conexión de caseta desconocida" : "Booth connection unknown");
  const linkTitle = !linked ? (es ? "Sin accesos vinculados" : "No linked gates") : `${link.data?.name || (es ? "Accesos vinculados" : "Linked gates")} · ${connectionText} · ${online}/${link.data?.gates?.length ?? 0} ${es ? "conectados" : "connected"}`;
  const endpoint = selectedConnection === "online" ? "#22c55e" : selectedConnection === "offline" ? "#ef4444" : "#9ca3af";
  const label = `${t("changeOver.site")} | ${t("changeOver.gate")}`;
  const options = useQuery({
    queryKey: ["gate-site-gate-options", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, history, ...(history ? sites.map(site => site.id) : [])],
    queryFn: async () => history ? { gates: (await Promise.all(sites.map(async site => {
      const result = await changeOverRequest<{ stations: { id: string; name: string }[] }>(`/stations?siteId=${site.id}&mode=history`);
      return result.stations.map(gate => ({ ...gate, siteId: site.id }));
    }))).flat() } : changeOverRequest<{ gates: GateChoice[] }>("/map"),
    enabled: gateOptions === undefined && sites.length > 0,
    retry: false,
  });
  const gates = [...(gateOptions ?? options.data?.gates ?? [])];
  // Keep the current selection visible while the all-site choices are loading.
  if (gate && !gates.some(row => row.id === gate.id)) gates.push({ ...gate, siteId });
  const selector = <BrandedSelect className="gate-dashboard-location-select" aria-label={label} data-testid={testId}
          value={gate ? gate.id : ""} onChange={event => {
            if (allOptionLabel && !event.target.value) { onChange(0, ""); return; }
            const selected = gates.find(row => row.id === event.target.value);
            if (selected) onChange(selected.siteId, selected.id);
          }}>
          <option value="" disabled={!allOptionLabel}>{allOptionLabel ?? t("changeOver.choose")}</option>
          {sites.flatMap(site => gates.filter(row => row.siteId === site.id).map(row =>
            <option key={row.id} value={row.id}>{site.name} | {row.name}{linked && link.data?.gates?.some(g => g.id === row.id && g.connection === "online") ? (es ? " · Conectado" : " · Online") : ""}</option>))}
        </BrandedSelect>;
  return <div className="gate-dashboard-location-selectors gate-site-gate-select">
    <label className="space-y-1 text-sm font-medium">
      <span className="gate-site-gate-label">{label}</span>
      <span className="gate-linked-selector">
        {showGps ? <GateGpsSelector status={gpsStatus} label={gpsLabel} detail={gpsDetail}>{selector}</GateGpsSelector> : selector}
        {gate && linked && <span className="gate-link-indicator" role="img" aria-label={linkTitle} title={linkTitle} data-testid="gate-link-indicator" data-connection={selectedConnection}>
          <svg viewBox="0 0 32 52" aria-hidden="true" focusable="false"><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b"/><stop offset="100%" stopColor={endpoint}/></linearGradient></defs><g transform="translate(32 0) scale(-1 1)"><path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke="#151719" strokeWidth="8" strokeLinecap="round"/><path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke={`url(#${gradientId})`} strokeWidth="5" strokeLinecap="round"/><path d="M 20 9 L 23 6 M 27 26 L 31 26 M 20 43 L 23 46" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".7"/></g></svg>
        </span>}
      </span>
    </label>
  </div>;
}
