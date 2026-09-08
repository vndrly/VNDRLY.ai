import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
import { Save } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { visitsApi } from "@/lib/visits-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ImagePill from "@/components/image-pill";
import { ClipboardList, Clock, MapPin } from "lucide-react";
import SphereBackButton from "@/components/sphere-back-button";
import type { MapboxPoint } from "@/components/mapbox-map";
import { formatPlateForDisplay } from "@/lib/plate-display";

const LazyMapboxMap = lazy(() =>
  import("@/components/mapbox-map").then((mod) => ({ default: mod.MapboxMap })),
);

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function resolveVisitPhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/storage/")) return `${BASE}${url}`;
  if (url.startsWith("/objects/")) return `${BASE}/api/storage${url}`;
  if (url.startsWith("objects/")) return `${BASE}/api/storage/${url}`;
  return `${BASE}/api/storage${url.startsWith("/") ? "" : "/"}${url}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function VisitDetailPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [categoryDraft, setCategoryDraft] = useState<string | undefined>();
  const [categoryError, setCategoryError] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  useEffect(() => { setCategoryDraft(undefined); setCategoryError(""); }, [id]);
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
  const mapPoints: MapboxPoint[] = hasPin
    ? [
        {
          id: "check-in",
          latitude: data.checkInLatitude as number,
          longitude: data.checkInLongitude as number,
          color: "var(--brand-primary)",
          label: "IN",
          title: t("visitor.detail.popupCheckIn"),
          popupHtml: `<div class="text-xs"><div class="font-semibold">${escapeHtml(t("visitor.detail.popupCheckIn"))}</div><div>${escapeHtml(fmt(data.checkInTime))}</div></div>`,
        },
        ...(typeof data.checkOutLatitude === "number" &&
        typeof data.checkOutLongitude === "number"
          ? [
              {
                id: "check-out",
                latitude: data.checkOutLatitude,
                longitude: data.checkOutLongitude,
                color: "#6b7280",
                label: "OUT",
                title: t("visitor.detail.popupCheckOut"),
                popupHtml: `<div class="text-xs"><div class="font-semibold">${escapeHtml(t("visitor.detail.popupCheckOut"))}</div><div>${escapeHtml(fmt(data.checkOutTime))}</div></div>`,
              } satisfies MapboxPoint,
            ]
          : []),
      ]
    : [];
  const platePhoto = resolveVisitPhotoUrl(data.platePhotoUrl);
  const vehiclePhoto = resolveVisitPhotoUrl(data.vehiclePhotoUrl);

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
            <ImagePill color="red" data-testid="badge-visit-status">
              {t("visitor.detail.checkedOut")}
            </ImagePill>
          ) : (
            <ImagePill color="amber" data-testid="badge-visit-status">
              {t("visitor.detail.onSite")}
            </ImagePill>
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
            <Row label={t("gateReport.category")} value={t(`gateReport.${data.entryCategory || "unclassified"}`)} />
            {user && ["admin", "partner", "vendor"].includes(user.role) && <div className="flex flex-wrap items-center gap-2">
              <select aria-label={t("gateReport.category")} className="h-10 rounded-md border bg-background px-2" value={categoryDraft ?? data.entryCategory ?? ""} onChange={event => setCategoryDraft(event.target.value)}>
                {["", "visitor", "routine_vendor_work", "partner_admin", "vendor_admin"].map(value => <option key={value} value={value}>{t(`gateReport.${value || "unclassified"}`)}</option>)}
              </select>
              <PngPillButton color="blue" disabled={savingCategory || categoryDraft === undefined} aria-label={t("gateReport.saveCategory")} title={t("gateReport.saveCategory")} onClick={async () => {
                setSavingCategory(true); setCategoryError("");
                try { await visitsApi.setEntryCategory(visitId, (categoryDraft || null) as NonNullable<typeof data>["entryCategory"]); setCategoryDraft(undefined); await queryClient.invalidateQueries({ queryKey: ["visit", visitId] }); await queryClient.invalidateQueries({ queryKey: ["visits-list"] }); }
                catch (failure) { setCategoryError(failure instanceof Error ? failure.message : t("gateReport.error")); }
                finally { setSavingCategory(false); }
              }}><Save className="h-4 w-4" /></PngPillButton>
              {categoryError && <p role="alert" className="text-destructive">{categoryError}</p>}
            </div>}
            <Row label={t("visitor.detail.phone")} value={data.phone ?? "—"} />
            <Row label={t("visitor.detail.email")} value={data.email ?? "—"} />
            <Row
              label={t("visitor.detail.vehiclePlate")}
              value={formatPlateForDisplay(
                data.plateState,
                data.vehiclePlate,
                t("gatekeeper.plateStateUnconfirmed"),
              ) ?? "—"}
            />
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

        {(platePhoto || vehiclePhoto) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-[var(--brand-primary)]" /> {t("visitor.detail.vehicleEvidence")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                <EvidencePhoto
                  label={t("visitor.detail.platePhoto")}
                  url={platePhoto}
                />
                <EvidencePhoto
                  label={t("visitor.detail.vehiclePhoto")}
                  url={vehiclePhoto}
                />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[var(--brand-primary)]" /> {t("visitor.detail.checkInLocation")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasPin ? (
              <div className="h-[320px] rounded-md overflow-hidden border">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
                      {t("common.loading")}
                    </div>
                  }
                >
                  <LazyMapboxMap
                    points={mapPoints}
                    center={[data.checkInLongitude as number, data.checkInLatitude as number]}
                    zoom={16}
                    styleKind="street"
                    height="100%"
                    scrollZoom={false}
                  />
                </Suspense>
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

function EvidencePhoto({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{label}</div>
        <div>—</div>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-md border overflow-hidden bg-muted/30 hover:border-[var(--brand-primary)]"
    >
      <div className="px-3 py-2 text-sm font-medium">{label}</div>
      <img src={url} alt={label} className="h-48 w-full object-cover" />
    </a>
  );
}
