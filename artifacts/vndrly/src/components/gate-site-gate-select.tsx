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
  const { t } = useTranslation();
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
            <option key={row.id} value={row.id}>{site.name} | {row.name}</option>))}
        </BrandedSelect>;
  return <div className="gate-dashboard-location-selectors gate-site-gate-select">
    <label className="space-y-1 text-sm font-medium">
      {label}
      {showGps ? <GateGpsSelector status={gpsStatus} label={gpsLabel} detail={gpsDetail}>{selector}</GateGpsSelector> : selector}
    </label>
  </div>;
}
