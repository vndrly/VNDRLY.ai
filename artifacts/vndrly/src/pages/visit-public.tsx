import { CardHeading } from "@/components/ui/card-heading";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { OFF_GEOFENCE } from "@workspace/visit-error-codes";
import { formatMetersAsMiles } from "@workspace/map-utils";
import { visitsApi, type SiteContext, type VisitorRow } from "@/lib/visits-api";
import {
  NATIONAL_PLATE_STATE_FALLBACK,
  normalizePlateNumber,
  normalizePlateState,
  type PlateStateCode,
} from "@workspace/plate-state";
import { PlateStatePicker } from "@/components/plate-state-picker";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import PortalButton from "@/components/portal-button";
import SidebarButton from "@/components/sidebar-button";
import {
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_ACCENT,
  brandStyleVars,
  type Brand,
} from "@/hooks/use-brand";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import backButtonImg from "@assets/Amber-back-button-logo-tuned.png";
import headerBg from "@assets/VNDRLY_Header_1776977091600.png";

type Step = "signin" | "checkin" | "active";

export default function VisitPublicPage({ siteCode }: { siteCode: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [plateState, setPlateState] = useState<PlateStateCode | null>(null);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [checkOutNotes, setCheckOutNotes] = useState("");
  const PURPOSE_MAX = 500;
  function formatPhone(raw: string) {
    const d = raw.replace(/\D/g, "").slice(0, 10);
    if (d.length === 0) return "";
    if (d.length < 4) return `(${d}`;
    if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  const [safety, setSafety] = useState(false);

  const [hostKey, setHostKey] = useState<string | null>(null);
  const [duration, setDuration] = useState("60");

  const [active, setActive] = useState<VisitorRow | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const restoredGuestSessionId = useRef<number | null>(null);

  const ctxQuery = useQuery<SiteContext>({
    queryKey: ["site-context-public", siteCode],
    queryFn: () => visitsApi.getSiteContext(siteCode),
    enabled: !!siteCode,
  });
  const preferredPlateStates = useQuery({
    queryKey: [
      "preferred-plate-states-public",
      ctxQuery.data?.site.id,
      siteCode,
    ],
    queryFn: () =>
      visitsApi.listPreferredPlateStates(ctxQuery.data!.site.id, siteCode),
    enabled: Boolean(ctxQuery.data?.site.id && siteCode),
    retry: false,
  });
  const orderedStatePreferences =
    preferredPlateStates.data?.preferred ?? NATIONAL_PLATE_STATE_FALLBACK;

  const guestQuery = useQuery({
    queryKey: ["guest-session-public"],
    queryFn: visitsApi.guestMe,
    retry: false,
  });
  const guestSessionId = guestQuery.data?.guestSessionId ?? null;
  const activeQuery = useQuery({
    queryKey: ["visit-active-public", guestSessionId],
    queryFn: visitsApi.myActive,
    enabled: guestSessionId !== null,
    retry: false,
  });

  useEffect(() => {
    if (guestSessionId === null || !activeQuery.data) return;
    setActive(activeQuery.data);
    setStep("active");
  }, [activeQuery.data, guestSessionId]);

  useEffect(() => {
    if (
      !guestQuery.data ||
      restoredGuestSessionId.current === guestQuery.data.guestSessionId
    )
      return;
    restoredGuestSessionId.current = guestQuery.data.guestSessionId;
    setVehiclePlate(
      normalizePlateNumber(guestQuery.data.profile.vehiclePlate) ?? "",
    );
    setPlateState(normalizePlateState(guestQuery.data.profile.plateState));
  }, [guestQuery.data]);

  const ctxPartnerLogoUrl = ctxQuery.data?.partner?.logoUrl ?? null;
  useEffect(() => {
    setLogoFailed(false);
  }, [ctxPartnerLogoUrl, siteCode]);

  // Task #158: derive a Brand from the site's partner so the visitor
  // sign-in page paints the partner's chrome (header strip, primary
  // CTAs). The visitor route is unauthenticated, so `useBrand` would
  // resolve to the cached/default VNDRLY brand; we override it locally
  // via inline CSS vars on the wrapper instead, which keeps the
  // partner-specific scope contained to this page.
  const partnerCtx = ctxQuery.data?.partner ?? null;
  const partnerBrand: Brand = partnerCtx
    ? (() => {
        const primary = partnerCtx.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
        const accent = partnerCtx.brandAccentColor || primary;
        const logoUrl = partnerCtx.logoUrl?.trim() || null;
        const logoSquareUrl = partnerCtx.logoSquareUrl?.trim() || null;
        return {
          primary,
          accent,
          logoUrl,
          logoSquareUrl,
          name: partnerCtx.name,
          isOrgBranded: !!(
            partnerCtx.brandPrimaryColor ||
            logoUrl ||
            logoSquareUrl
          ),
        };
      })()
    : {
        primary: DEFAULT_BRAND_PRIMARY,
        accent: DEFAULT_BRAND_ACCENT,
        logoUrl: null,
        logoSquareUrl: null,
        name: null,
        isOrgBranded: false,
      };
  const partnerBrandStyle = brandStyleVars(partnerBrand);

  const hostOptions = useMemo(() => {
    const ctx = ctxQuery.data;
    if (!ctx) return [];
    const opts: {
      key: string;
      label: string;
      type: "partner" | "vendor";
      id: number;
    }[] = [];
    if (ctx.partner)
      opts.push({
        key: `partner:${ctx.partner.id}`,
        label: `${ctx.partner.name} (${t("nav.partner")})`,
        type: "partner",
        id: ctx.partner.id,
      });
    for (const v of ctx.vendors)
      opts.push({
        key: `vendor:${v.id}`,
        label: `${v.name} (${t("nav.vendor")})`,
        type: "vendor",
        id: v.id,
      });
    return opts;
  }, [ctxQuery.data, t]);

  const onSignIn = async () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError(t("visitor.public.requireName"));
      return;
    }
    if (!safety) {
      setError(t("visitor.public.requireSafety"));
      return;
    }
    const normalizedPlate = normalizePlateNumber(vehiclePlate);
    setBusy(true);
    try {
      // The guest cookie is replaced by this call, so evict the previous
      // kiosk visitor and its active-visit request before rotating it. These
      // keys are deliberately not shared with staff auth queries.
      await queryClient.cancelQueries({ queryKey: ["visit-active-public"] });
      queryClient.removeQueries({ queryKey: ["visit-active-public"] });
      await queryClient.cancelQueries({ queryKey: ["guest-session-public"] });
      queryClient.removeQueries({ queryKey: ["guest-session-public"] });
      setActive(null);
      const session = await visitsApi.startGuestSession({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        company: company.trim() || undefined,
        vehiclePlate: normalizedPlate ?? undefined,
        plateState: normalizedPlate ? (plateState ?? undefined) : undefined,
        purpose: purpose.trim() || undefined,
        safetyAcknowledged: safety,
      });
      restoredGuestSessionId.current = session.guestSessionId;
      setVehiclePlate(
        normalizePlateNumber(session.profile.vehiclePlate) ??
          normalizedPlate ??
          "",
      );
      setPlateState(
        normalizePlateState(session.profile.plateState) ??
          (normalizedPlate ? plateState : null),
      );
      queryClient.setQueryData(["guest-session-public"], {
        guestSessionId: session.guestSessionId,
        role: session.role,
        expiresAt: session.expiresAt,
        profile: session.profile,
      });
      setStep("checkin");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("visitor.public.errorTitle"));
    } finally {
      setBusy(false);
    }
  };

  const getPosition = (): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error(t("visitor.public.locationDenied")));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
      });
    });

  const onCheckIn = async () => {
    setError(null);
    const normalizedPlate = normalizePlateNumber(vehiclePlate);
    const ctx = ctxQuery.data;
    if (!ctx || !hostKey) {
      setError(t("visitor.public.pickHost"));
      return;
    }
    const host = hostOptions.find((o) => o.key === hostKey);
    if (!host) return;
    setBusy(true);
    try {
      const pos = await getPosition();
      const dur = parseInt(duration, 10);
      const v = await visitsApi.checkIn({
        siteLocationId: ctx.site.id,
        hostType: host.type,
        hostPartnerId: host.type === "partner" ? host.id : undefined,
        hostVendorId: host.type === "vendor" ? host.id : undefined,
        purpose: purpose.trim() || undefined,
        notes: notes.trim() || undefined,
        expectedDurationMinutes:
          Number.isFinite(dur) && dur > 0 ? dur : undefined,
        ...(normalizedPlate
          ? {
              vehiclePlate: normalizedPlate,
              plateState: plateState ?? undefined,
            }
          : {}),
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      setActive(v);
      setStep("active");
    } catch (e) {
      const data = (
        e as {
          data?: {
            code?: string;
            distanceMeters?: number;
            radiusMeters?: number;
          };
        }
      )?.data;
      if (
        data?.code === OFF_GEOFENCE &&
        typeof data.distanceMeters === "number" &&
        typeof data.radiusMeters === "number"
      ) {
        setError(
          t("visitor.public.offGeofence", {
            distance: formatMetersAsMiles(data.distanceMeters),
            radius: formatMetersAsMiles(data.radiusMeters),
          }),
        );
      } else {
        setError(
          e instanceof Error ? e.message : t("visitor.public.errorTitle"),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onCheckOut = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await getPosition();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {}
      await visitsApi.checkOut(active.id, lat, lng, checkOutNotes.trim() || undefined);
      await queryClient.cancelQueries({ queryKey: ["visit-active-public"] });
      queryClient.removeQueries({ queryKey: ["visit-active-public"] });
      try {
        await visitsApi.guestLogout();
      } catch {}
      await queryClient.cancelQueries({ queryKey: ["guest-session-public"] });
      queryClient.removeQueries({ queryKey: ["guest-session-public"] });
      restoredGuestSessionId.current = null;
      setActive(null);
      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setCompany("");
      setVehiclePlate("");
      setPlateState(null);
      setPurpose("");
      setSafety(false);
      setHostKey(null);
      setDuration("60");
      setStep("signin");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("visitor.public.errorTitle"));
    } finally {
      setBusy(false);
    }
  };

  if (ctxQuery.isLoading)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  if (ctxQuery.error)
    return (
      <div className="p-6 text-sm text-destructive">
        {t("visitor.public.siteNotFound")} {(ctxQuery.error as Error).message}
      </div>
    );

  const ctx = ctxQuery.data!;
  const partnerLogoUrl = ctx.partner?.logoUrl ?? null;
  const partnerName = ctx.partner?.name ?? null;
  const showLogo = !!partnerLogoUrl && !logoFailed;

  return (
    <div
      className="min-h-screen bg-background flex items-start justify-center p-4 relative"
      // Scope partner brand colors to this page (Task #158). The visitor
      // route is unauthenticated, so the global --brand-primary set by
      // BrandProvider falls back to VNDRLY amber. Overriding here ensures
      // the primary CTA, accent strip, and other brand-tinted elements
      // adopt the SITE owner's colors regardless of the viewer's session.
      style={partnerBrandStyle}
    >
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url(${headerBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          opacity: 0.85,
          height: "240px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, transparent 100%)",
        }}
      />
      {/* Brand-color accent strip across the very top of the visitor
          page, mirroring the same affordance the field portal renders.
          When the partner has no brand primary configured, this falls
          back to the VNDRLY default amber via partnerBrandStyle. */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] z-10 pointer-events-none"
        style={{ backgroundColor: "var(--brand-primary)" }}
      />
      <div className="w-full max-w-md space-y-4 relative z-10">
        <div
          className="w-full flex items-center justify-center pt-2 pb-1 min-h-[64px]"
          data-testid="partner-branding"
        >
          {showLogo ? (
            <img
              src={partnerLogoUrl!}
              alt={partnerName ? `${partnerName} logo` : "Partner logo"}
              className="max-h-16 max-w-[70%] object-contain"
              onError={() => setLogoFailed(true)}
              data-testid="img-partner-logo"
            />
          ) : partnerName ? (
            <p
              className="text-base font-bold uppercase tracking-wider text-muted-foreground"
              data-testid="text-partner-fallback"
            >
              {partnerName}
            </p>
          ) : null}
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  if (step === "checkin") {
                    setStep("signin");
                    setError(null);
                  } else {
                    window.history.back();
                  }
                }}
                aria-label={t("common.back") as string}
                className="shrink-0 transition-transform hover:scale-105 active:scale-95"
                data-testid="button-back"
              >
                <img
                  src={backButtonImg}
                  alt=""
                  className="h-10 w-10 block"
                  draggable={false}
                />
              </button>
              <div className="min-w-0">
                <CardTitle className="text-lg">
                  {t("visitor.public.headerTitle")}
                </CardTitle>
                <div className="text-xs text-muted-foreground">
                  {t("visitor.public.siteAt")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {ctx.site.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {ctx.site.address}
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {error && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-sm p-3"
            data-testid="visitor-error"
          >
            {error}
          </div>
        )}

        {step === "signin" && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <CardHeading as="h3" className="text-sm font-medium">{t("visitor.public.step1Title")}</CardHeading>
              <div className="text-xs text-muted-foreground">
                {t("visitor.public.step1Note")}
              </div>
              <div>
                <Label>{t("visitor.public.firstName")} *</Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-first-name"
                />
              </div>
              <div>
                <Label>{t("visitor.public.lastName")} *</Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-last-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("visitor.public.phone")} *</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    placeholder="(555) 555-5555"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={14}
                    data-testid="input-phone"
                  />
                </div>
                <div>
                  <Label>{t("visitor.public.email")} *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-email"
                  />
                </div>
              </div>
              <div>
                <Label>{t("visitor.public.company")} *</Label>
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  data-testid="input-company"
                />
              </div>
              <div className="space-y-3">
                <div>
                  <Label>{t("visitor.public.vehicleState")}</Label>
                  <PlateStatePicker
                    value={plateState}
                    onChange={setPlateState}
                    preferredStates={orderedStatePreferences}
                    error={undefined}
                  />
                </div>
                <div>
                  <Label>{t("visitor.public.vehiclePlate")}</Label>
                  <Input
                    value={vehiclePlate}
                    onChange={(e) =>
                      setVehiclePlate(e.target.value.toUpperCase())
                    }
                    maxLength={10}
                    data-testid="input-vehicle-plate"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <Label>{t("visitor.public.purpose")} *</Label>
                  <span className="text-xs text-muted-foreground">
                    {purpose.length}/{PURPOSE_MAX}
                  </span>
                </div>
                <Textarea
                  value={purpose}
                  onChange={(e) =>
                    setPurpose(e.target.value.slice(0, PURPOSE_MAX))
                  }
                  placeholder={t("visitor.public.purposePlaceholder") as string}
                  maxLength={PURPOSE_MAX}
                  rows={6}
                  className="resize-y min-h-[140px]"
                  data-testid="input-purpose"
                />
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={safety}
                onClick={() => setSafety((s) => !s)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setSafety((s) => !s);
                  }
                }}
                className="flex w-full items-start gap-3 rounded-md border p-3 text-left min-h-[44px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="safety-row"
              >
                <Switch
                  checked={safety}
                  className="pointer-events-none mt-0.5"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="switch-safety"
                />
                <div className="text-sm">{t("visitor.public.safetyAck")} *</div>
              </div>
              {(() => {
                const formReady =
                  firstName.trim().length > 0 &&
                  lastName.trim().length > 0 &&
                  phone.trim().length > 0 &&
                  email.trim().length > 0 &&
                  company.trim().length > 0 &&
                  purpose.trim().length > 0 &&
                  safety;
                return formReady ? (
                  <PortalButton
                    onClick={onSignIn}
                    disabled={busy}
                    testId="button-guest-signin"
                  >
                    {busy
                      ? t("common.submitting")
                      : t("visitor.public.continue")}
                  </PortalButton>
                ) : (
                  <PngPillButton
                    color="blue"
                    disabled
                    className="w-full h-11"
                    data-testid="button-guest-signin"
                  >
                    {t("visitor.public.continue")}
                  </PngPillButton>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {step === "checkin" && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <CardHeading as="h3" className="text-sm font-medium">{t("visitor.public.whoVisiting")}</CardHeading>
              {hostOptions.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t("visitor.public.noHosts")}
                </div>
              ) : (
                <div className="space-y-1">
                  {hostOptions.map((opt) => (
                    <div
                      key={opt.key}
                      className="flex min-h-[44px] items-center cursor-pointer"
                      onClick={() => setHostKey(opt.key)}
                      data-testid={`host-option-row-${opt.key}`}
                    >
                      <div className="w-full">
                        <SidebarButton
                          isActive={hostKey === opt.key}
                          testId={`host-option-${opt.key}`}
                          theme="light"
                          activeColor="blue"
                        >
                          {opt.label}
                        </SidebarButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <Label>{t("visitor.public.purpose")}</Label>
                <Input
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder={t("visitor.public.purposePlaceholder")}
                />
              </div>
              <div>
                <Label>{t("visitor.public.notes")}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("visitor.public.notesPlaceholder")}
                  data-testid="input-visitor-notes"
                />
              </div>
              <div>
                <Label>{t("visitor.public.expectedMinutes")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
              <PortalButton
                onClick={onCheckIn}
                disabled={busy || !hostKey}
                testId="button-check-in"
              >
                {busy ? t("common.submitting") : t("visitor.public.checkIn")}
              </PortalButton>
              <div className="text-xs text-muted-foreground text-center">
                {t("visitor.public.geofenceNote")} ({ctx.site.siteRadiusMeters}
                {t("visitor.public.metersSuffix")})
              </div>
            </CardContent>
          </Card>
        )}

        {step === "active" && active && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <CardHeading as="h3" className="text-base font-semibold">{t("visitor.public.activeAt")} {active.siteName ?? ctx.site.name}</CardHeading>
              </div>
              <div className="text-sm">
                <div>
                  <span className="text-muted-foreground">
                    {t("visitor.public.host")}:
                  </span>{" "}
                  {active.hostType === "partner"
                    ? active.hostPartnerName
                    : active.hostVendorName}
                </div>
                {active.purpose && (
                  <div>
                    <span className="text-muted-foreground">
                      {t("visitor.public.purpose")}:
                    </span>{" "}
                    {active.purpose}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">
                    {t("visitor.public.checkedInAt")}:
                  </span>{" "}
                  {new Date(active.checkInTime).toLocaleString()}
                </div>
              </div>
              <div>
                <Label>{t("visitor.public.checkOutNotes")}</Label>
                <Textarea
                  value={checkOutNotes}
                  onChange={(e) => setCheckOutNotes(e.target.value)}
                  placeholder={t("visitor.public.notesPlaceholder")}
                  data-testid="input-visitor-checkout-notes"
                />
              </div>
              <PillButton
                color="blue"
                className="w-full"
                onClick={onCheckOut}
                disabled={busy}
                data-testid="button-check-out"
              >
                {busy ? t("common.submitting") : t("visitor.public.checkOut")}
              </PillButton>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
