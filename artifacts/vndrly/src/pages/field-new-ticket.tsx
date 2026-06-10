import { PngPillButton } from "@/components/png-pill-rollover";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { OFF_GEOFENCE } from "@workspace/visit-error-codes";
import { translateApiError } from "@/lib/api-error";
import { MapPin, Wrench, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useListFieldSites,
  useListFieldSiteWorkTypes,
  useCreateFieldTicket,
  getListFieldSiteWorkTypesQueryKey,
} from "@workspace/api-client-react";
import { usePortalBase } from "@/lib/portal-base";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

interface Gps {
  latitude: number;
  longitude: number;
}

export default function FieldNewTicket() {
  const [, navigate] = useLocation();
  const portalBase = usePortalBase();
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
        (pos) => setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
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

  const selectedSite = sites.find((s) => s.id === siteId);
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
        onError: (err: unknown) => {
          const data = (err as { data?: { code?: string; distanceMeters?: number; radiusMeters?: number } })?.data;
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
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="field-new-ticket">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href={portalBase} ariaLabel={t("fieldNewTicket.back")} testId="button-back" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--brand-primary)]">
            {t("fieldNewTicket.stepIndicator")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("fieldNewTicket.title")}</h1>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-5">
          <div className="rounded-lg border border-amber-300/50 bg-card p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground/90 leading-relaxed">
              {t("fieldNewTicket.approvedNotice")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="w-3.5 h-3.5 text-[color:var(--brand-primary)]" />
              {t("fieldNewTicket.siteLocation")}
            </Label>
            <Select
              value={siteId != null ? String(siteId) : ""}
              onValueChange={(v) => setSiteId(v ? parseInt(v, 10) : null)}
            >
              <SelectTrigger className="h-11 font-semibold" data-testid="select-site">
                <SelectValue placeholder={t("fieldNewTicket.chooseSite")} />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.partnerName ? ` — ${s.partnerName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t("fieldNewTicket.approvedSites", { count: sites.length })}
              {selectedSite?.address ? ` · ${selectedSite.address}` : ""}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
              <Wrench className="w-3.5 h-3.5 text-[color:var(--brand-primary)]" />
              {t("fieldNewTicket.workType")}
            </Label>
            <Select
              value={workTypeId != null ? String(workTypeId) : ""}
              onValueChange={(v) => setWorkTypeId(v ? parseInt(v, 10) : null)}
              disabled={!siteId}
            >
              <SelectTrigger className="h-11 font-semibold" data-testid="select-work-type">
                <SelectValue
                  placeholder={
                    siteId ? t("fieldNewTicket.chooseWorkType") : t("fieldNewTicket.pickSiteFirst")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {workTypes.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {siteId
                ? t("fieldNewTicket.approvedForSite", { count: workTypes.length })
                : t("fieldNewTicket.approvedAfterSite")}
            </p>
          </div>

          {gps ? (
            <div className="rounded-lg border border-green-300/60 bg-card p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-[11px] text-foreground">
                <span className="font-semibold">{t("fieldNewTicket.gpsCaptured")}</span>{" "}
                {gps.latitude.toFixed(4)}°, {gps.longitude.toFixed(4)}°
              </p>
            </div>
          ) : gpsError ? (
            <div className="rounded-lg border border-red-300/60 bg-card p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <p className="text-[11px] text-foreground">
                {gpsError} — {t("fieldNewTicket.gpsWillCreateWithout")}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              <p className="text-[11px] text-muted-foreground">{t("fieldNewTicket.gettingLocation")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <PngPillButton
          color="blue"
          onClick={handleSubmit}
          disabled={!ready || submitting}
          data-testid="button-check-in"
          className="w-full"
        >
          {submitting ? t("fieldNewTicket.creating") : t("fieldNewTicket.checkInStart")}
        </PngPillButton>
        <p className="text-[10px] text-muted-foreground text-center">{t("fieldNewTicket.stamped")}</p>
      </div>
    </div>
  );
}
