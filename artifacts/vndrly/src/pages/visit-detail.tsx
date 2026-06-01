import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { BrandZoomControlInMap } from "@/components/brand-zoom-control";
import "leaflet/dist/leaflet.css";
import { visitsApi } from "@/lib/visits-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PngPill from "@/components/png-pill-rollover";
import { ClipboardList, Clock, MapPin } from "lucide-react";
import SphereBackButton from "@/components/sphere-back-button";
import { useBrand } from "@/hooks/use-brand";

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function pinIcon(color: string) {
  const html = `<div style="width:28px;height:36px;transform:translate(-14px,-32px);">
    <svg viewBox="0 0 28 36" width="28" height="36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0 C 6 0 0 6 0 14 C 0 24 14 36 14 36 C 14 36 28 24 28 14 C 28 6 22 0 14 0 Z"
            fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="14" cy="14" r="5" fill="white"/>
    </svg>
  </div>`;
  return L.divIcon({
    html,
    className: "vndrly-visit-pin",
    iconSize: [28, 36],
    iconAnchor: [14, 32],
  });
}

export default function VisitDetailPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const brand = useBrand();
  const visitId = parseInt(id, 10);
  // Task #710 — visit detail is gated by `visits.rate_limited` on the
  // server. There's no poll to suspend, but we still want to (a) avoid
  // burning the limiter budget with retry storms and (b) replace the
  // generic error wall with a calm "slowing down" notice.
  const { data, isLoading, error } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => visitsApi.get(visitId),
    enabled: Number.isFinite(visitId),
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const { rateLimited, retryAfterSeconds } = useRateLimitGate(
    error,
    "visits.rate_limited",
  );

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  if (rateLimited) {
    return (
      <div
        className="p-6 flex items-center gap-1.5 text-sm text-amber-800"
        data-testid="visit-detail-slow-down"
        role="status"
        aria-live="polite"
      >
        <Clock className="w-4 h-4 shrink-0" />
        <span>
          {retryAfterSeconds != null
            ? t("common.slowDown.retryIn", { seconds: retryAfterSeconds })
            : t("common.slowDown.brief")}
        </span>
      </div>
    );
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">{t("visitor.detail.notFound")}</div>;
  }

  const hasPin =
    typeof data.checkInLatitude === "number" &&
    typeof data.checkInLongitude === "number";

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="visit-detail">
      {/* Canonical back-button + header layout matched to the other
          *-detail pages (ticket-detail, partner-detail,
          site-location-detail, field-employee-detail): SphereBackButton
          size={40} + h1 text-2xl font-bold side-by-side, with the
          status pills floated to the right of the same row. */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/visitors"
            className="group inline-flex items-center"
            aria-label={t("visitor.detail.back")}
            data-testid="button-back"
          >
            <SphereBackButton size={40} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {data.firstName} {data.lastName}
            </h1>
            {data.company ? (
              <div className="text-sm text-muted-foreground">{data.company}</div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Visit status — TogglePill chip in the canonical pill
              language. Red = checked out (visit complete), amber =
              currently on-site (active alert color, matches the
              "Currently On Site" red count badge on the visitors
              list and the rest of the status palette). */}
          {data.checkOutTime ? (
            <PngPill color="red" data-testid="badge-visit-status">
              {t("visitor.detail.checkedOut")}
            </PngPill>
          ) : (
            <PngPill color="amber" data-testid="badge-visit-status">
              {t("visitor.detail.onSite")}
            </PngPill>
          )}
          {data.autoCheckedOut && <Badge variant="outline">{t("visitor.detail.autoCheckout")}</Badge>}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            {/* Card-title chrome matched to the Check-in Location
                card below: lucide icon tinted to the partner's
                brand-primary color, with the title text in the
                default foreground for readability. */}
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-[var(--brand-primary)]" /> {t("visitor.detail.details")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row label={t("visitor.detail.site")} value={data.siteName ?? "—"} />
            <Row
              label={t("visitor.detail.host")}
              value={
                data.hostType === "partner"
                  ? data.hostPartnerName ?? "—"
                  : data.hostVendorName ?? "—"
              }
            />
            <Row label={t("visitor.detail.purpose")} value={data.purpose ?? "—"} />
            <Row label={t("visitor.detail.phone")} value={data.phone ?? "—"} />
            <Row label={t("visitor.detail.email")} value={data.email ?? "—"} />
            <Row label={t("visitor.detail.vehiclePlate")} value={data.vehiclePlate ?? "—"} />
            <Row
              label={t("visitor.detail.expectedDuration")}
              value={
                data.expectedDurationMinutes
                  ? `${data.expectedDurationMinutes} ${t("visitor.detail.minutes")}`
                  : "—"
              }
            />
            <Row label={t("visitor.detail.checkedIn")} value={fmt(data.checkInTime)} />
            <Row label={t("visitor.detail.checkedOutLabel")} value={fmt(data.checkOutTime)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[var(--brand-primary)]" /> {t("visitor.detail.checkInLocation")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasPin ? (
              <div className="h-[320px] rounded-md overflow-hidden border">
                <MapContainer
                  center={[data.checkInLatitude as number, data.checkInLongitude as number]}
                  zoom={16}
                  zoomControl={false}
                  style={{ height: "100%", width: "100%" }}
                  scrollWheelZoom={false}
                >
                  <BrandZoomControlInMap />
                  <TileLayer
                    attribution={t("visitor.mapAttribution")}
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker
                    position={[data.checkInLatitude as number, data.checkInLongitude as number]}
                    icon={pinIcon(brand.primary)}
                  >
                    <Popup>
                      <div className="text-xs">
                        <div className="font-semibold">{t("visitor.detail.popupCheckIn")}</div>
                        <div>{fmt(data.checkInTime)}</div>
                      </div>
                    </Popup>
                  </Marker>
                  {typeof data.checkOutLatitude === "number" &&
                  typeof data.checkOutLongitude === "number" ? (
                    <Marker
                      position={[data.checkOutLatitude, data.checkOutLongitude]}
                      icon={pinIcon("#6b7280")}
                    >
                      <Popup>
                        <div className="text-xs">
                          <div className="font-semibold">{t("visitor.detail.popupCheckOut")}</div>
                          <div>{fmt(data.checkOutTime)}</div>
                        </div>
                      </Popup>
                    </Marker>
                  ) : null}
                </MapContainer>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t("visitor.detail.noGps")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
