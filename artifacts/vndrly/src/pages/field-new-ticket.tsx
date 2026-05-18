import { TogglePillButton } from "@/components/toggle-pill";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { OFF_GEOFENCE } from "@workspace/visit-error-codes";
import { translateApiError } from "@/lib/api-error";
import { MapPin, Wrench, ChevronDown, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AmberButton from "@/components/amber-button";
import GreyButton from "@/components/grey-button";
import SphereBackButton from "@/components/sphere-back-button";
import { useListFieldSites, useListFieldSiteWorkTypes, useCreateFieldTicket, getListFieldSiteWorkTypesQueryKey } from "@workspace/api-client-react";

interface Gps { latitude: number; longitude: number; }

export default function FieldNewTicket() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [workTypeId, setWorkTypeId] = useState<number | null>(null);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string>("");

  const { data: sites = [] } = useListFieldSites();
  const { data: workTypes = [] } = useListFieldSiteWorkTypes(siteId ?? 0, {
    query: { enabled: siteId != null, queryKey: getListFieldSiteWorkTypesQueryKey(siteId ?? 0) },
  });
  const createTicket = useCreateFieldTicket();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => setGpsError(t("fieldNewTicket.gpsAccessDenied")),
        { enableHighAccuracy: true },
      );
    } else {
      setGpsError(t("fieldNewTicket.gpsNotSupported"));
    }
  }, [t]);

  useEffect(() => {
    setWorkTypeId(null);
  }, [siteId]);

  const selectedSite = sites.find(s => s.id === siteId);
  const ready = !!siteId && !!workTypeId;
  const submitting = createTicket.isPending;

  const handleSubmit = () => {
    if (!ready || siteId == null || workTypeId == null) return;
    createTicket.mutate(
      {
        data: {
          siteLocationId: siteId,
          workTypeId,
          latitude: gps?.latitude ?? null,
          longitude: gps?.longitude ?? null,
        },
      },
      {
        onSuccess: (ticket) => {
          toast({ title: t("fieldNewTicket.createdToast") });
          navigate(`/tickets/${ticket.id}`);
        },
        onError: (err: any) => {
          const data = err?.data;
          if (
            data?.code === OFF_GEOFENCE &&
            typeof data.distanceMeters === "number" &&
            typeof data.radiusMeters === "number"
          ) {
            toast({
              title: t("fieldNewTicket.offGeofence", {
                distance: data.distanceMeters,
                radius: data.radiusMeters,
              }),
              variant: "destructive",
            });
            return;
          }
          toast({ title: translateApiError(err, t, t("fieldNewTicket.createFailed")), variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" data-testid="field-new-ticket">
      <div className="h-1.5" style={{ backgroundColor: "var(--brand-primary)" }} />
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2 max-w-md mx-auto w-full">
        <button
          type="button"
          onClick={() => navigate("/field")}
          className="group w-9 h-9 rounded-md flex items-center justify-center"
          data-testid="button-back"
          aria-label={t("fieldNewTicket.back")}
        >
          <SphereBackButton size={32} />
        </button>
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}>{t("fieldNewTicket.stepIndicator")}</p>
          <h1 className="text-base font-bold text-gray-900">{t("fieldNewTicket.title")}</h1>
        </div>
      </header>

      <div className="px-4 pt-3 max-w-md mx-auto w-full">
        <div className="flex gap-1.5">
          <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: "var(--brand-primary)" }} />
        </div>
      </div>

      <div className="px-4 py-5 space-y-4 max-w-md mx-auto w-full">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            {t("fieldNewTicket.approvedNotice")}
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" style={{ color: "var(--brand-primary)" }} />
            {t("fieldNewTicket.siteLocation")}
          </label>
          <div className="relative mt-1.5">
            <select
              value={siteId ?? ""}
              onChange={e => setSiteId(e.target.value ? parseInt(e.target.value) : null)}
              className={`w-full h-12 px-3 pr-10 rounded-md border-2 ${siteId ? "" : "border-gray-300"} bg-white shadow-sm text-sm font-semibold text-gray-900 appearance-none outline-none`}
              style={siteId ? { borderColor: "var(--brand-primary)" } : undefined}
              data-testid="select-site"
            >
              <option value="">{t("fieldNewTicket.chooseSite")}</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.partnerName ? ` — ${s.partnerName}` : ""}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            {t("fieldNewTicket.approvedSites", { count: sites.length })}
            {selectedSite?.address ? ` · ${selectedSite.address}` : ""}
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" style={{ color: "var(--brand-primary)" }} />
            {t("fieldNewTicket.workType")}
          </label>
          <div className="relative mt-1.5">
            <select
              value={workTypeId ?? ""}
              onChange={e => setWorkTypeId(e.target.value ? parseInt(e.target.value) : null)}
              disabled={!siteId}
              className={`w-full h-12 px-3 pr-10 rounded-md border-2 ${workTypeId ? "" : "border-gray-300"} ${!siteId ? "bg-gray-100 text-gray-400" : "bg-white text-gray-900"} shadow-sm text-sm font-semibold appearance-none outline-none`}
              style={workTypeId ? { borderColor: "var(--brand-primary)" } : undefined}
              data-testid="select-work-type"
            >
              <option value="">{siteId ? t("fieldNewTicket.chooseWorkType") : t("fieldNewTicket.pickSiteFirst")}</option>
              {workTypes.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            {siteId ? t("fieldNewTicket.approvedForSite", { count: workTypes.length }) : t("fieldNewTicket.approvedAfterSite")}
          </p>
        </div>

        {gps ? (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-[11px] text-green-800">
              <span className="font-semibold">{t("fieldNewTicket.gpsCaptured")}</span> {gps.latitude.toFixed(4)}°, {gps.longitude.toFixed(4)}°
            </p>
          </div>
        ) : gpsError ? (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <p className="text-[11px] text-red-800">{gpsError} — {t("fieldNewTicket.gpsWillCreateWithout")}</p>
          </div>
        ) : (
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
            <p className="text-[11px] text-gray-600">{t("fieldNewTicket.gettingLocation")}</p>
          </div>
        )}
      </div>

      <div className="mt-auto px-4 pb-6 pt-3 bg-white border-t border-gray-200 max-w-md mx-auto w-full">
        {ready && !submitting ? (
          <TogglePillButton color="amber"
            onClick={handleSubmit}
            data-testid="button-check-in"
            className="w-full"
          >
            {t("fieldNewTicket.checkInStart")}
          </TogglePillButton>
        ) : (
          <TogglePillButton disabled data-testid="button-check-in" className="w-full">
            {submitting ? t("fieldNewTicket.creating") : t("fieldNewTicket.checkInStart")}
          </TogglePillButton>
        )}
        <p className="text-[10px] text-gray-400 text-center mt-2">
          {t("fieldNewTicket.stamped")}
        </p>
      </div>
    </div>
  );
}
