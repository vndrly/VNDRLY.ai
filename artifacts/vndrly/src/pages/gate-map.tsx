import { MapPin } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import BrandPillButton from "@/components/brand-pill-button";
import { BrandedInput, BrandedSelect } from "@/components/work-hub/chrome";
import { GateCoverageMap } from "@/components/gate-coverage-map";
import { changeOverRequest } from "@/lib/change-over-api";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

export default function GateMapPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [selectedSite, setSelectedSite] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sites = useQuery({
    queryKey: ["gate-station-management-sites", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId],
    queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/station-management/sites"),
    enabled: Boolean(user?.userId), retry: false,
  });
  const available = sites.data?.sites ?? [];
  const siteId = available.find(site => String(site.id) === selectedSite)?.id ?? available[0]?.id;
  const addGate = async (event: FormEvent) => {
    event.preventDefault();
    if (!siteId || !name.trim() || busy || !navigator.onLine || sites.isError) return;
    setBusy(true); setError("");
    try {
      await changeOverRequest("/stations", { siteId, name: name.trim() });
      setName("");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["gate-coverage-map"] }),
        cache.invalidateQueries({ queryKey: ["change-over-stations"] }),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("changeOver.failed"));
    } finally { setBusy(false); }
  };
  return (
    <div className={`${FIELD_OPS_PAGE_CLASS} space-y-5`}>
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href="/gate/change-over" ariaLabel={t("nav.dashboard")} testId="button-back" />
        <MapPin aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("gateNav.map")}</h1>
      </div>
      {sites.isSuccess && available.length > 0 && <form onSubmit={addGate} aria-label={t("changeOver.addGate")} data-gate-workspace-panel
        className="flex flex-wrap items-end gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
        <label className="grid min-w-48 flex-1 gap-1 text-sm font-medium">{t("changeOver.site")}
          <BrandedSelect value={siteId} disabled={busy} onChange={event => { setSelectedSite(event.target.value); setError(""); }}>
            {available.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </BrandedSelect>
        </label>
        <label className="grid min-w-48 flex-1 gap-1 text-sm font-medium">{t("changeOver.newGate")}
          <BrandedInput value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} />
        </label>
        <BrandPillButton type="submit" disabled={busy || !siteId || !name.trim() || !navigator.onLine}>{t("changeOver.addGate")}</BrandPillButton>
        {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
      </form>}
      <GateCoverageMap />
    </div>
  );
}
