import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AmberButton from "@/components/amber-button";
import BlueButton from "@/components/blue-button";
import RedButton from "@/components/red-button";
import LanguageToggle from "@/components/language-toggle";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { visitsApi, type PublicSite } from "@/lib/visits-api";
import { RolePill } from "@/components/role-pill";
import { MapPin, Loader2 } from "lucide-react";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import headerBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import backButtonImg from "@assets/Amber-back-button-logo-tuned.png";

type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "ok"; lat: number; lng: number }
  | { kind: "denied" }
  | { kind: "unavailable" };

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function VisitorEntryPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"list" | "code">("list");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";
  const [siteCode, setSiteCode] = useState("");
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });

  const sitesQuery = useQuery<PublicSite[]>({
    queryKey: ["public-sites"],
    queryFn: () => visitsApi.listPublicSites(),
  });

  // Request geolocation when entering list mode
  useEffect(() => {
    if (mode !== "list") return;
    if (geo.kind !== "idle") return;
    if (!("geolocation" in navigator)) {
      setGeo({ kind: "unavailable" });
      return;
    }
    setGeo({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ kind: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setGeo({ kind: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }, [mode, geo.kind]);

  const sortedSites = useMemo(() => {
    const sites = sitesQuery.data ?? [];
    if (geo.kind === "ok") {
      return [...sites]
        .map((s) => ({ ...s, _distance: distanceMeters(geo.lat, geo.lng, s.latitude, s.longitude) }))
        .sort((a, b) => a._distance - b._distance);
    }
    return [...sites]
      .map((s) => ({ ...s, _distance: null as number | null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sitesQuery.data, geo]);

  const cleaned = siteCode.trim().toUpperCase();
  const codeReady = cleaned.length > 0;

  const onSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeReady) return;
    navigate(`/visit/${encodeURIComponent(cleaned)}`);
  };

  const goToSite = (code: string) => {
    navigate(`/visit/${encodeURIComponent(code)}`);
  };

  function formatDistance(m: number | null): string {
    if (m == null) return t("visitor.web.distanceUnknown");
    const miles = m / 1609.344;
    if (miles < 0.1) {
      const feet = Math.round(m * 3.28084);
      return t("visitor.web.ftAway", { ft: feet });
    }
    return t("visitor.web.miAway", { mi: miles.toFixed(miles < 10 ? 1 : 0) });
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ backgroundColor: isDark ? "#3a3d42" : "#f9fafb" }}>
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url(${headerBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          opacity: 0.85,
          height: "240px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
        }}
      />
      <div className="flex justify-between items-center p-4 relative z-20">
        <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant={isDark ? "dark" : "light"} />
        <LanguageToggle variant={isDark ? "dark" : "light"} />
      </div>
      <div className="flex-1 flex items-start justify-center px-4 pb-10 relative z-10">
        <Card className="w-full max-w-md border-2 border-gray-200 shadow-xl">
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <img src={vndrlyLogo} alt="VNDRLY" className="h-10 w-10" />
              <div>
                <CardTitle className="text-lg leading-tight">
                  {t("visitor.web.title")}
                </CardTitle>
                <p className="text-xs text-gray-500">
                  {t("visitor.web.subtitle")}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {mode === "list" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => navigate("/login")}
                      aria-label={t("common.cancel") as string}
                      className="shrink-0 transition-transform hover:scale-105 active:scale-95"
                      data-testid="button-back"
                    >
                      <img src={backButtonImg} alt="" className="h-10 w-10 block" draggable={false} />
                    </button>
                    <Label className="text-sm font-medium">{t("visitor.web.selectSite")}</Label>
                  </div>
                  {geo.kind === "locating" && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 shrink-0">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("visitor.web.locating")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {geo.kind === "denied"
                    ? t("visitor.web.locationDenied")
                    : geo.kind === "unavailable"
                      ? t("visitor.web.locationUnavailable")
                      : t("visitor.web.siteListHint")}
                </p>

                <div
                  className="border border-gray-200 rounded-md overflow-y-auto bg-white divide-y divide-gray-100"
                  style={{ maxHeight: 10 * 64 }}
                  data-testid="visitor-site-list"
                >
                  {sitesQuery.isLoading ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      {t("visitor.web.loadingSites")}
                    </div>
                  ) : sortedSites.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                      {t("visitor.web.noSites")}
                    </div>
                  ) : (
                    sortedSites.map((site, idx) => {
                      const isClosest = idx === 0 && geo.kind === "ok";
                      return (
                        <button
                          key={site.id}
                          type="button"
                          onClick={() => goToSite(site.siteCode)}
                          data-testid={`button-site-${site.siteCode}`}
                          className={
                            "w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3 " +
                            (isClosest ? "bg-amber-50 hover:bg-amber-100 border-l-4 border-l-amber-400" : "")
                          }
                          style={{ minHeight: 64 }}
                        >
                          <MapPin
                            className={"h-4 w-4 mt-0.5 shrink-0 " + (isClosest ? "text-amber-600" : "text-gray-400")}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-900 truncate">{site.name}</span>
                              {isClosest && (
                                <RolePill color="amber" className="uppercase tracking-wide">
                                  {t("visitor.web.closest")}
                                </RolePill>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {site.partnerName ? `${site.partnerName} · ` : ""}
                              {site.address}
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 whitespace-nowrap shrink-0 self-center">
                            {formatDistance(site._distance)}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex justify-center pt-1">
                  <PngPillButton color="red" onClick={() => navigate("/login")} data-testid="link-back-to-login">
                    {t("common.cancel")}
                  </PngPillButton>
                </div>
              </div>
            ) : (
              <form onSubmit={onSubmitCode} className="space-y-4">
                <div>
                  <Label htmlFor="site-code">{t("visitor.web.siteCodeLabel")}</Label>
                  <Input
                    id="site-code"
                    data-testid="input-site-code"
                    value={siteCode}
                    onChange={(e) => setSiteCode(e.target.value)}
                    placeholder={t("visitor.web.siteCodePlaceholder")}
                    autoCapitalize="characters"
                    autoComplete="off"
                    className="mt-1 uppercase tracking-widest font-mono"
                    maxLength={32}
                  />
                  <p className="mt-2 text-xs text-gray-500">{t("visitor.web.siteCodeHint")}</p>
                </div>

                {codeReady ? (
                  <PngPillButton color="amber" type="submit" className="w-full h-11" data-testid="button-visitor-continue">
                    {t("visitor.web.continue")}
                  </PngPillButton>
                ) : (
                  <PngPillButton color="blue" type="submit" disabled className="w-full h-11" data-testid="button-visitor-continue">
                    {t("visitor.web.continue")}
                  </PngPillButton>
                )}

                <button
                  type="button"
                  onClick={() => setMode("list")}
                  className="w-full text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
                  data-testid="link-use-list"
                >
                  {t("visitor.web.useListInstead")}
                </button>

                <div className="flex justify-center pt-1">
                  <PngPillButton color="red" onClick={() => navigate("/login")} data-testid="link-back-to-login">
                    {t("common.cancel")}
                  </PngPillButton>
                </div>
              </form>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
