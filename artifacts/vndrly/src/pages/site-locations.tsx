import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useListSiteLocations, useCreateSiteLocation, useUpdateSiteLocation, useListPartners, getListSiteLocationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, MapPin, ArrowUpDown, Printer, Search, Ruler, LocateFixed } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import BlueButton from "@/components/blue-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import BrandPillButton from "@/components/brand-pill-button";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { SiteLocationMap } from "@/components/site-location-map";
import { forwardGeocode, reverseGeocode } from "@/lib/geocoding";
import { useAuth } from "@/hooks/use-auth";

// Field-ops default geofence: 1 mile (1,609 m). Picked because well
// access roads + rig pads frequently sprawl beyond a tight 500 m
// fence, and Joe Boggs / Winchester reported false "outside fence"
// rejections at lease entrances. Partners can still tighten per-site
// from the site detail page; this is just the create-time default.
const DEFAULT_RADIUS_METERS = 1609;

type AddSiteForm = {
  partnerId: string;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  siteRadiusMeters: string;
  photoUrl: string | null;
  afe: string;
  autoAssignAllVendors: boolean;
};

const emptyForm = (partnerId: string): AddSiteForm => ({
  partnerId,
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  siteRadiusMeters: String(DEFAULT_RADIUS_METERS),
  photoUrl: null,
  afe: "",
  // Default ON: most partners want every approved vendor to see the
  // new site immediately on mobile. Partners who want hand-picked
  // vendor coverage can uncheck before submitting.
  autoAssignAllVendors: true,
});

type SortKey = "name" | "partnerName" | "status";
type SortDir = "asc" | "desc";

export default function SiteLocations() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isVendor = user?.role === "vendor" && user.vendorId;
  const isPartner = user?.role === "partner" && !!user.partnerId;
  const siteParams = isPartner ? { partnerId: user!.partnerId! } : undefined;
  const { data: sites, isLoading } = useListSiteLocations(siteParams, {
    query: { queryKey: getListSiteLocationsQueryKey(siteParams) },
  });
  const { data: partners } = useListPartners();
  const createSite = useCreateSiteLocation();
  const updateSite = useUpdateSiteLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const initialPartnerId = isPartner ? String(user!.partnerId!) : "";
  const [form, setForm] = useState<AddSiteForm>(() => emptyForm(initialPartnerId));
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  // Successfully-resolved address text — used so we don't re-geocode the same
  // string on a second blur. Failed lookups are intentionally NOT cached so
  // transient network errors don't permanently block retries.
  const lastResolvedAddressRef = useRef<string>("");
  // Successfully-reverse-geocoded coord key (lat,lng rounded to 5dp) — same
  // policy as above: only updated on success.
  const lastResolvedReverseKeyRef = useRef<string>("");
  // Monotonic request tokens: any in-flight geocoding callback whose token
  // is older than the latest is discarded, so a slow request can never
  // overwrite fresher state the user (or another lookup) just produced.
  const forwardReqIdRef = useRef(0);
  const reverseReqIdRef = useRef(0);

  const parsedLat = parseFloat(form.latitude);
  const parsedLng = parseFloat(form.longitude);
  const hasCoords = Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
  const parsedRadius = parseInt(form.siteRadiusMeters, 10);
  const previewRadius = Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : DEFAULT_RADIUS_METERS;

  const reverseFromCoords = (lat: number, lng: number) => {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (lastResolvedReverseKeyRef.current === key) return;
    const myId = ++reverseReqIdRef.current;
    void reverseGeocode(lat, lng).then((r) => {
      // Stale-response guard: a newer reverse-geocode (or forward-geocode
      // that moved coords again) has superseded this one.
      if (myId !== reverseReqIdRef.current) return;
      if (!r) return;
      setForm((prev) => {
        // Only fill address if the user still hasn't typed one and the
        // coords this reverse-lookup ran against are still current.
        if (prev.address.trim() !== "") return prev;
        if (prev.latitude !== String(lat.toFixed(6)) || prev.longitude !== String(lng.toFixed(6))) return prev;
        lastResolvedReverseKeyRef.current = key;
        return { ...prev, address: r.displayName };
      });
    });
  };

  const updateCoords = (lat: number, lng: number, opts?: { fillAddress?: boolean }) => {
    setForm((prev) => ({ ...prev, latitude: String(lat.toFixed(6)), longitude: String(lng.toFixed(6)) }));
    if (opts?.fillAddress) reverseFromCoords(lat, lng);
  };

  const handleUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast({ title: t("siteLocations.geolocationUnavailable"), variant: "destructive" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        updateCoords(pos.coords.latitude, pos.coords.longitude, { fillAddress: true });
      },
      (err) => {
        setLocating(false);
        const msg = err.code === err.PERMISSION_DENIED
          ? t("siteLocations.geolocationDenied")
          : t("siteLocations.geolocationFailed");
        toast({ title: msg, variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const handleAddressBlur = async () => {
    const q = form.address.trim();
    if (!q || q === lastResolvedAddressRef.current) return;
    if (form.latitude.trim() !== "" && form.longitude.trim() !== "") return;
    const myId = ++forwardReqIdRef.current;
    setGeocoding(true);
    try {
      const r = await forwardGeocode(q);
      // Stale-response guard.
      if (myId !== forwardReqIdRef.current) return;
      if (!r) {
        // Failed lookups are NOT cached — the user can blur again to retry.
        toast({ title: t("siteLocations.geocodingFailed"), variant: "destructive" });
        return;
      }
      // Only apply if the address the user has now still matches what we
      // looked up — otherwise they've already typed something newer.
      setForm((prev) => {
        if (prev.address.trim() !== q) return prev;
        lastResolvedAddressRef.current = q;
        return { ...prev, latitude: String(r.latitude.toFixed(6)), longitude: String(r.longitude.toFixed(6)) };
      });
    } finally {
      if (myId === forwardReqIdRef.current) setGeocoding(false);
    }
  };

  const handleLatLngBlur = () => {
    if (!hasCoords) return;
    if (form.address.trim() !== "") return;
    reverseFromCoords(parsedLat, parsedLng);
  };
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [radiusEditingSite, setRadiusEditingSite] = useState<{ id: number; name: string } | null>(null);
  const [radiusInput, setRadiusInput] = useState<string>("");

  const canEditRadius = !isVendor;

  const openRadiusDialog = (site: { id: number; name: string; siteRadiusMeters: number | null }) => {
    setRadiusEditingSite({ id: site.id, name: site.name });
    setRadiusInput(site.siteRadiusMeters != null ? String(site.siteRadiusMeters) : "");
  };

  const closeRadiusDialog = () => {
    setRadiusEditingSite(null);
    setRadiusInput("");
  };

  const handleSaveRadius = () => {
    if (!radiusEditingSite) return;
    const trimmed = radiusInput.trim();
    const next = trimmed === "" ? null : parseInt(trimmed, 10);
    if (next !== null && (Number.isNaN(next) || next < 1 || next > 10000)) {
      toast({
        title: t("siteLocations.radiusInvalid"),
        variant: "destructive",
      });
      return;
    }
    updateSite.mutate(
      { id: radiusEditingSite.id, data: { siteRadiusMeters: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          if (siteParams) {
            queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey(siteParams) });
          }
          toast({ title: t("siteLocations.radiusUpdated") });
          closeRadiusDialog();
        },
        onError: () => {
          toast({ title: t("siteLocations.radiusUpdateFailed"), variant: "destructive" });
        },
      },
    );
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrintSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    window.open(
      `${import.meta.env.BASE_URL}print-visitor-qrs?ids=${ids.join(",")}`,
      "_blank",
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedSites = useMemo(() => {
    if (!sites) return [];
    return [...sites].sort((a, b) => {
      let valA = "";
      let valB = "";
      if (sortKey === "name") {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortKey === "partnerName") {
        valA = (a.partnerName || "").toLowerCase();
        valB = (b.partnerName || "").toLowerCase();
      } else if (sortKey === "status") {
        valA = (a.status || "").toLowerCase();
        valB = (b.status || "").toLowerCase();
      }
      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [sites, sortKey, sortDir]);

  const filteredSites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedSites.filter((s) => {
      if (partnerFilter !== "all" && String(s.partnerId) !== partnerFilter) return false;
      if (statusFilter !== "all" && (s.status || "") !== statusFilter) return false;
      if (q) {
        const haystack = [s.name, s.partnerName || "", s.address || "", s.siteCode || ""]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [sortedSites, searchQuery, partnerFilter, statusFilter]);

  const availablePartners = useMemo(() => {
    if (!sites) return [];
    const map = new Map<number, string>();
    for (const s of sites) {
      if (s.partnerId != null && !map.has(s.partnerId)) {
        map.set(s.partnerId, s.partnerName || "");
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sites]);

  const statusOptions: Array<"active" | "inactive" | "standby" | "offline"> = [
    "active",
    "inactive",
    "standby",
    "offline",
  ];

  const filtersActive = searchQuery.trim() !== "" || partnerFilter !== "all" || statusFilter !== "all";

  const allFilteredSelected =
    filteredSites.length > 0 && filteredSites.every((s) => selectedIds.has(s.id));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const radiusTrim = form.siteRadiusMeters.trim();
    const radiusNum = radiusTrim === "" ? null : parseInt(radiusTrim, 10);
    if (radiusNum !== null && (Number.isNaN(radiusNum) || radiusNum < 1 || radiusNum > 10000)) {
      toast({ title: t("siteLocations.radiusInvalid"), variant: "destructive" });
      return;
    }
    createSite.mutate(
      {
        data: {
          partnerId: parseInt(form.partnerId),
          name: form.name,
          address: form.address,
          latitude: parseFloat(form.latitude),
          longitude: parseFloat(form.longitude),
          siteRadiusMeters: radiusNum,
          photoUrl: form.photoUrl,
          afe: form.afe.trim() ? form.afe.trim() : null,
          autoAssignAllVendors: form.autoAssignAllVendors,
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() });
          setOpen(false);
          const wasAutoAssigned = form.autoAssignAllVendors;
          setForm(emptyForm(initialPartnerId));
          lastResolvedAddressRef.current = "";
          lastResolvedReverseKeyRef.current = "";
          forwardReqIdRef.current++;
          reverseReqIdRef.current++;
          toast({
            title: wasAutoAssigned
              ? t("siteLocations.createSuccessAutoAssigned")
              : t("siteLocations.createSuccess"),
          });
          // Hybrid UX: when the partner did NOT auto-assign vendors, drop
          // them straight onto the new site's detail page so they see the
          // "0 vendors assigned" banner and can immediately assign. When
          // auto-assign was on, they can stay on the list (no action
          // needed). `created` may be undefined in older codegen, so we
          // guard before navigating.
          if (!wasAutoAssigned && created && (created as any).id != null) {
            navigate(`/site-locations/${(created as any).id}`);
          }
        },
        onError: () => {
          toast({ title: t("siteLocations.createFailed"), variant: "destructive" });
        },
      },
    );
  };

  const SortableHeader = ({ label, sortField }: { label: string; sortField: SortKey }) => (
    <TableHead className="cursor-pointer select-none" onClick={() => handleSort(sortField)}>
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={`w-3 h-3 ${sortKey === sortField ? "" : "text-muted-foreground"}`}
          style={sortKey === sortField ? { color: "var(--brand-primary)" } : undefined}
        />
      </div>
    </TableHead>
  );

  return (
    <div className="space-y-6" data-testid="site-locations-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{t("siteLocations.title")}</h1>
            <p className="text-muted-foreground text-sm mt-1">{isVendor ? t("siteLocations.subtitleVendor") : t("siteLocations.subtitleAdmin")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isVendor && selectedIds.size > 0 && (
            <PngPillButton color="blue"
              type="button"
              onClick={handlePrintSelected}
              data-testid="button-print-selected-qrs"
            >
              <Printer className="w-4 h-4" />
              {t("siteLocations.printSelectedQrs", { count: selectedIds.size })}
            </PngPillButton>
          )}
        {!isVendor && <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <PngPillButton color="blue" className="px-2" data-testid="button-add-site"><Plus className="w-4 h-4" />{t("siteLocations.addSite")}</PngPillButton>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t("siteLocations.addSiteLocation")}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>{t("siteLocations.partner")}</Label>
                {isPartner ? (
                  <Input
                    data-testid="input-partner-locked"
                    value={partners?.find((p) => p.id === user!.partnerId!)?.name ?? ""}
                    readOnly
                    disabled
                    className="bg-muted cursor-not-allowed"
                  />
                ) : (
                  <Select value={form.partnerId} onValueChange={(v) => setForm({ ...form, partnerId: v })}>
                    <SelectTrigger data-testid="select-partner"><SelectValue placeholder={t("siteLocations.selectPartner")} /></SelectTrigger>
                    <SelectContent>
                      {partners?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>{t("siteLocations.siteName")}</Label>
                <Input data-testid="input-site-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>

              <div className="flex justify-end">
                <BrandPillButton
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={locating}
                  data-testid="button-use-my-location"
                >
                  <LocateFixed className="w-4 h-4" />
                  {locating ? t("siteLocations.locating") : t("siteLocations.useMyLocation")}
                </BrandPillButton>
              </div>

              <div>
                <Label>{t("siteLocations.address")}</Label>
                <Input
                  data-testid="input-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  onBlur={handleAddressBlur}
                  required
                />
                {geocoding && (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-geocoding">
                    {t("siteLocations.locating")}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("siteLocations.latitude")}</Label>
                  <Input
                    data-testid="input-latitude"
                    type="number"
                    step="any"
                    value={form.latitude}
                    onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                    onBlur={handleLatLngBlur}
                    required
                  />
                </div>
                <div>
                  <Label>{t("siteLocations.longitude")}</Label>
                  <Input
                    data-testid="input-longitude"
                    type="number"
                    step="any"
                    value={form.longitude}
                    onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                    onBlur={handleLatLngBlur}
                    required
                  />
                </div>
              </div>

              <div>
                <Label>{t("siteLocations.afeOptional")}</Label>
                <Input
                  data-testid="input-create-afe"
                  type="text"
                  placeholder={t("siteLocations.afePlaceholder")}
                  value={form.afe}
                  onChange={(e) => setForm({ ...form, afe: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("siteLocations.afeHelp")}
                </p>
              </div>

              <div>
                <Label>{t("siteLocations.radiusOptionalLabel")}</Label>
                <Input
                  data-testid="input-create-radius-meters"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  step={1}
                  placeholder={String(DEFAULT_RADIUS_METERS)}
                  value={form.siteRadiusMeters}
                  onChange={(e) => setForm({ ...form, siteRadiusMeters: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("siteLocations.radiusHelp", { defaultMeters: DEFAULT_RADIUS_METERS })}
                </p>
              </div>

              {hasCoords && (
                <div className="space-y-2">
                  <Label>{t("siteLocations.mapPreview")}</Label>
                  <SiteLocationMap
                    lat={parsedLat}
                    lng={parsedLng}
                    radiusMeters={previewRadius}
                    onMove={(lat, lng) => updateCoords(lat, lng, { fillAddress: form.address.trim() === "" })}
                  />
                  <p className="text-xs text-muted-foreground">{t("siteLocations.mapDragHint")}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("siteLocations.wellheadPhoto")}</Label>
                <PhotoUploadField
                  value={form.photoUrl}
                  onChange={(url) => setForm({ ...form, photoUrl: url })}
                  testIdPrefix="site-wellhead"
                />
                <p className="text-xs text-muted-foreground">{t("siteLocations.wellheadPhotoHelp")}</p>
              </div>

              <p className="text-xs text-muted-foreground" data-testid="text-site-code-hint">
                {t("siteLocations.siteCodeAutoHint")}
              </p>

              <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
                <Checkbox
                  id="auto-assign-all-vendors"
                  data-testid="checkbox-auto-assign-vendors"
                  checked={form.autoAssignAllVendors}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, autoAssignAllVendors: checked === true })
                  }
                />
                <div className="space-y-1">
                  <Label htmlFor="auto-assign-all-vendors" className="cursor-pointer">
                    {t("siteLocations.autoAssignAllVendorsLabel")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("siteLocations.autoAssignAllVendorsHelp")}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <PngPillButton color="blue" type="submit" disabled={createSite.isPending} data-testid="button-submit-site" className="w-full">
                  {createSite.isPending ? t("siteLocations.creating") : t("siteLocations.createSite")}
                </PngPillButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
        </div>
      </div>

      {!isLoading && sortedSites.length > 0 && (
        <div className="flex flex-wrap items-center gap-3" data-testid="site-locations-filters">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              data-testid="input-search-sites"
              placeholder={t("siteLocations.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[260px]"
            />
          </div>
          {!isPartner && availablePartners.length > 1 && (
            <Select value={partnerFilter} onValueChange={setPartnerFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-filter-partner">
                <SelectValue placeholder={t("siteLocations.filterPartnerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("siteLocations.filterAllPartners")}</SelectItem>
                {availablePartners.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name || `#${p.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-status">
              <SelectValue placeholder={t("siteLocations.filterStatusPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("siteLocations.filterAllStatuses")}</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s} data-testid={`select-filter-status-option-${s}`}>
                  {t(`siteLocations.statusOption.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <PillButton
              type="button"
              color="image"
              onClick={() => {
                setSearchQuery("");
                setPartnerFilter("all");
                setStatusFilter("all");
              }}
              data-testid="button-clear-site-filters"
            >
              {t("siteLocations.clearFilters")}
            </PillButton>
          )}
          <span className="text-sm text-muted-foreground ml-auto" data-testid="text-filtered-count">
            {t("siteLocations.filteredCount", { shown: filteredSites.length, total: sortedSites.length })}
          </span>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : sortedSites.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {!isVendor && (
                    <TableHead className="w-10">
                      <Checkbox
                        data-testid="checkbox-select-all-sites"
                        checked={allFilteredSelected}
                        disabled={filteredSites.length === 0}
                        onCheckedChange={(checked) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (checked) {
                              for (const s of filteredSites) next.add(s.id);
                            } else {
                              for (const s of filteredSites) next.delete(s.id);
                            }
                            return next;
                          });
                        }}
                        aria-label="Select all sites"
                      />
                    </TableHead>
                  )}
                  <SortableHeader label={t("siteLocations.siteName")} sortField="name" />
                  <SortableHeader label={t("siteLocations.partner")} sortField="partnerName" />
                  <TableHead>{t("siteLocations.address")}</TableHead>
                  <TableHead>{t("siteLocations.siteCode")}</TableHead>
                  <SortableHeader label={t("siteLocations.status")} sortField="status" />
                  <TableHead>{t("siteLocations.geofenceRadius")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSites.map((s) => (
                  <TableRow key={s.id} data-testid={`row-site-${s.id}`}>
                    {!isVendor && (
                      <TableCell className="w-10">
                        <Checkbox
                          data-testid={`checkbox-select-site-${s.id}`}
                          checked={selectedIds.has(s.id)}
                          onCheckedChange={() => toggleSelected(s.id)}
                          aria-label={`Select ${s.name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Link href={`/site-locations/${s.id}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors" data-testid={`link-site-${s.id}`}>
                        <div className="flex items-center gap-2"><MapPin className="w-4 h-4 shrink-0" />{s.name}</div>
                      </Link>
                    </TableCell>
                    <TableCell>{s.partnerName || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{s.address}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">{s.siteCode}</code></TableCell>
                    <TableCell><StatusBadge status={s.status} className="w-[100px] justify-center" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground" data-testid={`text-radius-${s.id}`}>
                          {s.siteRadiusMeters != null
                            ? t("siteLocations.radiusMeters", { meters: s.siteRadiusMeters })
                            : t("siteLocations.radiusDefault", { meters: DEFAULT_RADIUS_METERS })}
                        </span>
                        {canEditRadius && (
                          <PngPillButton
                            type="button"
                            color="blue"
                            className="min-w-[120px]"
                            onClick={() => openRadiusDialog(s)}
                            data-testid={`button-edit-radius-${s.id}`}
                          >
                            <Ruler className="w-3.5 h-3.5" />
                            {t("siteLocations.editRadius")}
                          </PngPillButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredSites.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isVendor ? 6 : 7} className="p-8 text-center text-muted-foreground" data-testid="text-no-filter-matches">
                      {t("siteLocations.noFilterMatches")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t("siteLocations.empty")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={radiusEditingSite !== null}
        onOpenChange={(o) => {
          if (!o) closeRadiusDialog();
        }}
      >
        <DialogContent data-testid="dialog-edit-radius">
          <DialogHeader>
            <DialogTitle>
              {radiusEditingSite
                ? t("siteLocations.editRadiusFor", { name: radiusEditingSite.name })
                : t("siteLocations.editRadius")}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveRadius();
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="input-radius-meters">{t("siteLocations.radiusLabel")}</Label>
              <Input
                id="input-radius-meters"
                data-testid="input-radius-meters"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                step={1}
                placeholder={String(DEFAULT_RADIUS_METERS)}
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-2">
                {t("siteLocations.radiusHelp", { defaultMeters: DEFAULT_RADIUS_METERS })}
              </p>
            </div>
            <DialogFooter>
              <PngPillButton
                type="button"
                color="red"
                className="px-2"
                onClick={closeRadiusDialog}
                data-testid="button-cancel-radius"
              >
                {t("siteLocations.cancel", { defaultValue: "Cancel" })}
              </PngPillButton>
              <PngPillButton
                type="submit"
                color="blue"
                className="px-2"
                disabled={updateSite.isPending}
                data-testid="button-save-radius"
              >
                {updateSite.isPending
                  ? t("siteLocations.saving")
                  : t("siteLocations.save")}
              </PngPillButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
