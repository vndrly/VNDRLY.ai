import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { PLATFORM_EULA_TEXT } from "@workspace/platform-eula";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useGetVendorWorkTypeSiteAfes,
  getGetVendorWorkTypeSiteAfesQueryKey,
  useGetVendorSiteAfes,
  getGetVendorSiteAfesQueryKey,
  useGetVendor,
  getGetVendorQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AlertCircle, Info, ShoppingCart } from "lucide-react";
import { PngPillButton } from "@/components/png-pill-rollover";
import SphereBackButton from "@/components/sphere-back-button";
import GreyButton from "@/components/grey-button";
import AfePill from "@/components/afe-pill";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const UNIT_OPTIONS = ["per_hour", "per_day", "per_job", "lump_sum"] as const;
type Unit = (typeof UNIT_OPTIONS)[number];

type WorkTypeRow = {
  id: number;
  name: string;
  category: string | null;
  selected: boolean;
  unitPrice: string | null;
  unit: Unit | null;
  currency: string | null;
  notes: string | null;
};

// Per-row pricing draft we mutate locally before hitting PUT.
type PricingDraft = {
  selected: boolean;
  unitPrice: string;
  unit: Unit | "";
  currency: string;
  notes: string;
};

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${input}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function rowToDraft(wt: WorkTypeRow): PricingDraft {
  return {
    selected: wt.selected,
    unitPrice: wt.unitPrice ?? "",
    unit: (wt.unit ?? "") as Unit | "",
    currency: wt.currency ?? "USD",
    notes: wt.notes ?? "",
  };
}

function draftsEqual(a: PricingDraft, b: PricingDraft): boolean {
  return (
    a.selected === b.selected &&
    a.unitPrice.trim() === b.unitPrice.trim() &&
    a.unit === b.unit &&
    a.currency === b.currency &&
    a.notes.trim() === b.notes.trim()
  );
}

export default function VendorCatalog() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Vendor users self-edit; system admins can edit any vendor by adding
  // ?vendorId=N. We surface this so support can fix things up without
  // impersonating a vendor login.
  const queryVendorId = (() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("vendorId");
    return v ? parseInt(v, 10) : null;
  })();
  const vendorId =
    user?.role === "vendor" ? user.vendorId : queryVendorId ?? null;

  const { data: vendorRecord } = useGetVendor(vendorId ?? 0, {
    query: { enabled: !!vendorId, queryKey: getGetVendorQueryKey(vendorId ?? 0) },
  });

  const queryKey = ["vendor-work-types", vendorId];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      jsonFetch<{ vendorId: number; items: WorkTypeRow[] }>(
        `/api/vendors/${vendorId}/work-types`,
      ),
    enabled: !!vendorId,
  });

  // Bulk site-AFE fetch for the entire vendor. Powers the inline AFE
  // pills on each work type row so we don't have to fire a per-row
  // request just to learn whether to render them. The modal still uses
  // the per-work-type endpoint so we keep authoritative ordering and
  // can paginate later if a single vendor ever has thousands of sites.
  const {
    data: bulkAfes,
    isLoading: isLoadingBulkAfes,
  } = useGetVendorSiteAfes(vendorId ?? 0, {
    query: {
      enabled: !!vendorId,
      queryKey: getGetVendorSiteAfesQueryKey(vendorId ?? 0),
    },
  });

  // Group bulk items by workTypeId, dedupe AFE values per work type
  // (the same AFE may appear at multiple sites), and remember whether
  // there are sites without an AFE so the row UI can decide whether
  // to surface the "+N more" affordance even when ≤ 3 unique AFEs are
  // shown inline.
  const afesByWorkType = useMemo(() => {
    const m = new Map<
      number,
      {
        uniqueAfes: { afe: string; siteNames: string[] }[];
        totalSites: number;
        sitesWithoutAfe: number;
      }
    >();
    for (const it of bulkAfes?.items ?? []) {
      let entry = m.get(it.workTypeId);
      if (!entry) {
        entry = { uniqueAfes: [], totalSites: 0, sitesWithoutAfe: 0 };
        m.set(it.workTypeId, entry);
      }
      entry.totalSites += 1;
      if (it.afe) {
        let group = entry.uniqueAfes.find((g) => g.afe === it.afe);
        if (!group) {
          group = { afe: it.afe, siteNames: [] };
          entry.uniqueAfes.push(group);
        }
        group.siteNames.push(it.siteName);
      } else {
        entry.sitesWithoutAfe += 1;
      }
    }
    return m;
  }, [bulkAfes]);

  // Partner-by-work-type mapping powers the partner filter dropdown.
  // It only reflects vendor↔partner relationships that already exist
  // via SWAs, so a brand-new vendor sees an empty dropdown — that's
  // intentional, the filter only makes sense once the vendor has been
  // assigned somewhere.
  const partnersQueryKey = ["vendor-work-type-partners", vendorId];
  const { data: partnersData } = useQuery({
    queryKey: partnersQueryKey,
    queryFn: () =>
      jsonFetch<{
        vendorId: number;
        partners: { id: number; name: string }[];
        workTypePartners: { workTypeId: number; partnerId: number }[];
        partnerWorkTypes: { partnerId: number; workTypeId: number }[];
      }>(`/api/vendors/${vendorId}/work-type-partners`),
    enabled: !!vendorId,
  });

  // Persist the filter state in the URL so a vendor's last selection
  // (and shareable filtered links) survives page reloads. We initialize
  // from the query string on mount and write back via
  // history.replaceState so we don't pollute the browser back stack.
  const initialFilters = (() => {
    if (typeof window === "undefined") {
      return { q: "", partner: "__all__" };
    }
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q") ?? "";
    const partner = sp.get("partner");
    return {
      q,
      partner: partner && /^\d+$/.test(partner) ? partner : "__all__",
    };
  })();
  const [search, setSearch] = useState<string>(initialFilters.q);
  const [partnerFilter, setPartnerFilter] = useState<string>(
    initialFilters.partner,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const trimmed = search.trim();
    if (trimmed) {
      sp.set("q", trimmed);
    } else {
      sp.delete("q");
    }
    if (partnerFilter !== "__all__") {
      sp.set("partner", partnerFilter);
    } else {
      sp.delete("partner");
    }
    const qs = sp.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [search, partnerFilter]);

  // Reverse-index workTypeId → Set<partnerId> for O(1) filter checks.
  const workTypePartnerMap = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const wp of partnersData?.workTypePartners ?? []) {
      if (!m.has(wp.workTypeId)) m.set(wp.workTypeId, new Set());
      m.get(wp.workTypeId)!.add(wp.partnerId);
    }
    return m;
  }, [partnersData]);

  const filteredItems = useMemo(() => {
    const all = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    const partnerId =
      partnerFilter === "__all__" ? null : Number(partnerFilter);
    return all.filter((wt) => {
      if (needle) {
        const hay = `${wt.name} ${wt.category ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (partnerId !== null) {
        const partners = workTypePartnerMap.get(wt.id);
        if (!partners || !partners.has(partnerId)) return false;
      }
      return true;
    });
  }, [data, search, partnerFilter, workTypePartnerMap]);

  const filterActive =
    search.trim().length > 0 || partnerFilter !== "__all__";

  // Local draft state, keyed by workTypeId. We diverge from the server
  // version while editing and reset whenever the server snapshot
  // changes (e.g. another tab saved different selections).
  const [drafts, setDrafts] = useState<Record<number, PricingDraft>>({});
  useEffect(() => {
    if (!data) return;
    const next: Record<number, PricingDraft> = {};
    for (const wt of data.items) next[wt.id] = rowToDraft(wt);
    setDrafts(next);
  }, [data]);

  const setDraft = (id: number, patch: Partial<PricingDraft>): void => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  // Task #788 — when a partner is selected, surface the work types
  // that partner pays *some* vendor for but this vendor hasn't
  // selected yet. Drives the "Recommended for this partner" section
  // so the vendor can opt in with one click and grow their book of
  // business. We respect the search needle so the recommendations
  // stay aligned with the rest of the list.
  const recommendedItems = useMemo(() => {
    if (partnerFilter === "__all__") return [] as WorkTypeRow[];
    const partnerId = Number(partnerFilter);
    if (!Number.isFinite(partnerId)) return [] as WorkTypeRow[];
    const partnerWtIds = new Set(
      (partnersData?.partnerWorkTypes ?? [])
        .filter((p) => p.partnerId === partnerId)
        .map((p) => p.workTypeId),
    );
    if (partnerWtIds.size === 0) return [] as WorkTypeRow[];
    // Use draft state (not the server snapshot) so a recommended row
    // disappears immediately after the vendor clicks Add, even before
    // the next save round-trip.
    const selectedIds = new Set(
      (data?.items ?? [])
        .filter((wt) => (drafts[wt.id]?.selected ?? wt.selected))
        .map((wt) => wt.id),
    );
    const needle = search.trim().toLowerCase();
    return (data?.items ?? []).filter((wt) => {
      if (!partnerWtIds.has(wt.id)) return false;
      if (selectedIds.has(wt.id)) return false;
      if (needle) {
        const hay = `${wt.name} ${wt.category ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [data, partnerFilter, partnersData, search]);

  // AFE-by-site modal — purely informational, never mutates drafts.
  const [afeModalWorkType, setAfeModalWorkType] = useState<WorkTypeRow | null>(
    null,
  );

  const grouped = useMemo(() => {
    const map = new Map<string, WorkTypeRow[]>();
    for (const wt of filteredItems) {
      const key = wt.category?.trim() || t("vendorCatalog.uncategorized");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(wt);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredItems, t]);

  const initialDrafts = useMemo(() => {
    const m: Record<number, PricingDraft> = {};
    for (const wt of data?.items ?? []) m[wt.id] = rowToDraft(wt);
    return m;
  }, [data]);

  const dirty = useMemo(() => {
    for (const id of Object.keys(drafts)) {
      const a = drafts[Number(id)];
      const b = initialDrafts[Number(id)];
      if (!b || !draftsEqual(a, b)) return true;
    }
    return false;
  }, [drafts, initialDrafts]);

  const selectedCount = useMemo(
    () => Object.values(drafts).filter((d) => d.selected).length,
    [drafts],
  );

  const missingPriceCount = useMemo(
    () =>
      Object.values(drafts).filter(
        (d) => d.selected && d.unitPrice.trim() === "",
      ).length,
    [drafts],
  );

  const save = useMutation({
    mutationFn: () => {
      const items = Object.entries(drafts)
        .filter(([, d]) => d.selected)
        .map(([id, d]) => ({
          workTypeId: Number(id),
          unitPrice: d.unitPrice.trim() === "" ? null : d.unitPrice.trim(),
          unit: d.unit === "" ? null : d.unit,
          currency: d.currency.trim() || "USD",
          notes: d.notes.trim() === "" ? null : d.notes.trim(),
        }));
      return jsonFetch<{
        vendorId: number;
        added: number;
        removed: number;
        updated: number;
      }>(`/api/vendors/${vendorId}/work-types`, {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: t("vendorCatalog.savedToast") });
    },
    onError: (e: Error) =>
      toast({
        title: translateApiError(e, t, t("vendorCatalog.saveFailedToast")),
        variant: "destructive",
      }),
  });

  if (!vendorId) {
    return (
      <div className="container max-w-3xl py-8">
        <p className="text-sm text-muted-foreground">
          {t("vendorCatalog.noVendor")}
        </p>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-8 space-y-4" data-testid="page-vendor-catalog">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => window.history.back()} className="group inline-flex items-center gap-2" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></button>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <ShoppingCart className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
          {vendorRecord?.name ? `${vendorRecord.name} Catalog` : t("vendorCatalog.title")}
        </h1>
      </div>
      <Card>
        <CardHeader>
          <p className="text-xs text-muted-foreground">
            {t("vendorCatalog.subtitle")}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className="flex flex-col sm:flex-row gap-2"
            data-testid="vendor-catalog-filters"
          >
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("vendorCatalog.searchPlaceholder")}
              aria-label={t("vendorCatalog.searchPlaceholder")}
              className="sm:flex-1"
              data-testid="input-search-work-types"
            />
            <Select
              value={partnerFilter}
              onValueChange={setPartnerFilter}
              disabled={(partnersData?.partners.length ?? 0) === 0}
            >
              <SelectTrigger
                className="sm:w-[220px]"
                aria-label={t("vendorCatalog.partnerFilterLabel")}
                data-testid="select-partner-filter"
              >
                <SelectValue
                  placeholder={t("vendorCatalog.partnerFilterPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("vendorCatalog.allPartners")}
                </SelectItem>
                {(partnersData?.partners ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">
              {(error as Error).message}
            </p>
          ) : grouped.length === 0 && recommendedItems.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid={
                filterActive ? "text-no-filter-matches" : "text-empty-catalog"
              }
            >
              {filterActive
                ? t("vendorCatalog.noFilterMatches")
                : t("vendorCatalog.empty")}
            </p>
          ) : (
            <>
            {recommendedItems.length > 0 ? (
              <div
                className="space-y-2 rounded border p-3"
                style={{
                  background:
                    "color-mix(in srgb, var(--brand-primary) 6%, white)",
                  borderColor:
                    "color-mix(in srgb, var(--brand-primary) 35%, white)",
                }}
                data-testid="section-recommended-for-partner"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <h3
                      className="text-sm font-semibold"
                      style={{ color: "var(--brand-primary)" }}
                    >
                      {t("vendorCatalog.recommendedTitle", {
                        count: recommendedItems.length,
                      })}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {t("vendorCatalog.recommendedSubtitle")}
                    </p>
                  </div>
                  <PngPillButton
                    color="blue"
                    onClick={() => {
                      setDrafts((prev) => {
                        const next = { ...prev };
                        for (const wt of recommendedItems) {
                          next[wt.id] = {
                            ...(next[wt.id] ?? rowToDraft(wt)),
                            selected: true,
                          };
                        }
                        return next;
                      });
                    }}
                    className="px-3 shrink-0"
                    data-testid="button-add-all-recommended"
                  >
                    {t("vendorCatalog.recommendedAddAll")}
                  </PngPillButton>
                </div>
                <div className="space-y-1">
                  {recommendedItems.map((wt) => (
                    <div
                      key={wt.id}
                      className="flex items-center justify-between gap-2 rounded border bg-card px-2 py-1.5"
                      data-testid={`recommended-row-${wt.id}`}
                    >
                      <div className="min-w-0 text-sm">
                        <span className="truncate">{wt.name}</span>
                        {wt.category ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {wt.category}
                          </span>
                        ) : null}
                        <span
                          className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium"
                          style={{ color: "var(--brand-primary)" }}
                          data-testid={`badge-not-in-catalog-${wt.id}`}
                        >
                          <AlertCircle className="w-3 h-3" />
                          {t("vendorCatalog.notInYourCatalog")}
                        </span>
                      </div>
                      <PngPillButton
                        color="blue"
                        onClick={() =>
                          setDrafts((prev) => ({
                            ...prev,
                            [wt.id]: {
                              ...(prev[wt.id] ?? rowToDraft(wt)),
                              selected: true,
                            },
                          }))
                        }
                        className="px-3 shrink-0"
                        data-testid={`button-add-recommended-${wt.id}`}
                      >
                        {t("vendorCatalog.recommendedAdd")}
                      </PngPillButton>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {grouped.map(([category, items]) => (
              <div key={category} className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {category}
                </h3>
                <div className="space-y-2">
                  {items.map((wt) => {
                    const draft = drafts[wt.id] ?? rowToDraft(wt);
                    const id = `wt-${wt.id}`;
                    const afeInfo = afesByWorkType.get(wt.id);
                    const uniqueAfes = afeInfo?.uniqueAfes ?? [];
                    const sitesWithoutAfe = afeInfo?.sitesWithoutAfe ?? 0;
                    // Show up to 3 inline pills. Anything beyond — extra
                    // unique AFEs or sites that have no AFE on file —
                    // collapses into a single "+N more" pill that opens
                    // the existing modal for the full breakdown. Each
                    // inline pill shows an "× N" suffix when the same
                    // AFE is shared by multiple sites, and tooltips the
                    // list of those sites.
                    const inlineAfes = uniqueAfes.slice(0, 3);
                    const overflowCount =
                      Math.max(uniqueAfes.length - inlineAfes.length, 0) +
                      sitesWithoutAfe;
                    return (
                      <div
                        key={wt.id}
                        className={`p-3 rounded border transition-colors ${
                          draft.selected
                            ? "border-[var(--brand-primary)]"
                            : "bg-card"
                        }`}
                        style={
                          draft.selected
                            ? {
                                background:
                                  "color-mix(in srgb, var(--brand-primary) 8%, white)",
                              }
                            : undefined
                        }
                        data-testid={`work-type-row-${wt.id}`}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={id}
                            checked={draft.selected}
                            onCheckedChange={(v) =>
                              setDraft(wt.id, { selected: !!v })
                            }
                            data-testid={`work-type-checkbox-${wt.id}`}
                            className="mt-1 border-[var(--brand-primary)] data-[state=checked]:bg-[var(--brand-primary)] data-[state=checked]:border-[var(--brand-primary)] data-[state=checked]:text-white"
                          />
                          <div className="flex-1 min-w-0 space-y-1">
                            <button
                              type="button"
                              onClick={() => setAfeModalWorkType(wt)}
                              className="text-left text-sm hover:underline focus:outline-none focus:underline w-full"
                              data-testid={`button-open-afe-modal-${wt.id}`}
                              title={t("vendorCatalog.openAfeModal")}
                            >
                              <span className="inline-flex items-center gap-1">
                                <span className="truncate">{wt.name}</span>
                                <Info
                                  className="w-3.5 h-3.5 text-muted-foreground shrink-0"
                                  aria-hidden="true"
                                />
                              </span>
                            </button>
                            {isLoadingBulkAfes ? (
                              <Skeleton
                                className="h-5 w-32"
                                data-testid={`afe-pills-loading-${wt.id}`}
                              />
                            ) : inlineAfes.length > 0 || overflowCount > 0 ? (
                              <div
                                className="flex flex-wrap items-center gap-1.5"
                                data-testid={`afe-pills-${wt.id}`}
                              >
                                {inlineAfes.map(({ afe, siteNames }) => {
                                  const count = siteNames.length;
                                  const tooltip =
                                    count > 1
                                      ? t("vendorCatalog.afeSitesTooltip", {
                                          count,
                                          sites: siteNames.join(", "),
                                        })
                                      : t("vendorCatalog.afeSiteTooltip", {
                                          site: siteNames[0] ?? "",
                                        });
                                  return (
                                    <AfePill
                                      key={afe}
                                      data-testid={`inline-pill-afe-${wt.id}-${afe}`}
                                      title={tooltip}
                                    >
                                      {afe}
                                      {count > 1 ? (
                                        <span
                                          className="ml-1 opacity-90"
                                          data-testid={`inline-pill-afe-count-${wt.id}-${afe}`}
                                        >
                                          {t("vendorCatalog.afeSiteCount", {
                                            count,
                                          })}
                                        </span>
                                      ) : null}
                                    </AfePill>
                                  );
                                })}
                                {overflowCount > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setAfeModalWorkType(wt)}
                                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus:underline px-1"
                                    data-testid={`button-afe-more-${wt.id}`}
                                    title={t("vendorCatalog.openAfeModal")}
                                  >
                                    {t("vendorCatalog.moreAfes", {
                                      count: overflowCount,
                                    })}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          {draft.selected && draft.unitPrice.trim() === "" ? (
                            <span
                              className="inline-flex items-center gap-1 text-xs shrink-0"
                              style={{ color: "var(--brand-primary)" }}
                              data-testid={`badge-missing-price-${wt.id}`}
                              title={t("vendorCatalog.missingPriceHelp")}
                            >
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t("vendorCatalog.missingPrice")}
                            </span>
                          ) : null}
                        </div>
                        {draft.selected ? (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[140px_140px_100px] gap-2">
                            <label className="text-xs space-y-1">
                              <span className="text-muted-foreground">
                                {t("vendorCatalog.priceLabel")}
                              </span>
                              <Input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                placeholder={t("vendorCatalog.pricePlaceholder")}
                                value={draft.unitPrice}
                                onChange={(e) =>
                                  setDraft(wt.id, {
                                    unitPrice: e.target.value,
                                  })
                                }
                                className="bg-white"
                                data-testid={`input-price-${wt.id}`}
                              />
                            </label>
                            <label className="text-xs space-y-1">
                              <span className="text-muted-foreground">
                                {t("vendorCatalog.unitLabel")}
                              </span>
                              <Select
                                value={draft.unit || "__none__"}
                                onValueChange={(v) =>
                                  setDraft(wt.id, {
                                    unit: v === "__none__" ? "" : (v as Unit),
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="bg-white"
                                  data-testid={`select-unit-${wt.id}`}
                                >
                                  <SelectValue
                                    placeholder={t("vendorCatalog.unitLabel")}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">—</SelectItem>
                                  {UNIT_OPTIONS.map((u) => (
                                    <SelectItem key={u} value={u}>
                                      {t(`vendorCatalog.units.${u}`)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </label>
                            <label className="text-xs space-y-1">
                              <span className="text-muted-foreground">
                                {t("vendorCatalog.currencyLabel")}
                              </span>
                              <Input
                                value={draft.currency}
                                onChange={(e) =>
                                  setDraft(wt.id, {
                                    currency: e.target.value
                                      .toUpperCase()
                                      .slice(0, 3),
                                  })
                                }
                                maxLength={3}
                                className="bg-white"
                                data-testid={`input-currency-${wt.id}`}
                              />
                            </label>
                            <label className="text-xs space-y-1 sm:col-span-3">
                              <span className="text-muted-foreground">
                                {t("vendorCatalog.notesLabel")}
                              </span>
                              <Input
                                placeholder={t(
                                  "vendorCatalog.notesPlaceholder",
                                )}
                                value={draft.notes}
                                onChange={(e) =>
                                  setDraft(wt.id, { notes: e.target.value })
                                }
                                maxLength={500}
                                className="bg-white"
                                data-testid={`input-notes-${wt.id}`}
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <span
              className="text-xs text-muted-foreground mr-auto"
              data-testid="text-selected-count"
            >
              {t("vendorCatalog.selectedCount", { count: selectedCount })}
              {missingPriceCount > 0 ? (
                <span
                  className="ml-2"
                  style={{ color: "var(--brand-primary)" }}
                  data-testid="text-missing-price-count"
                >
                  · {t("vendorCatalog.missingPrice")} ({missingPriceCount})
                </span>
              ) : null}
            </span>
            {dirty ? (
              <PngPillButton
                color="blue"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="px-3"
                data-testid="button-save-work-types"
              >
                {save.isPending
                  ? t("vendorCatalog.saving")
                  : t("vendorCatalog.save")}
              </PngPillButton>
            ) : (
              <PngPillButton disabled data-testid="button-save-work-types">
                {t("vendorCatalog.save")}
              </PngPillButton>
            )}
          </div>
        </CardContent>
      </Card>

      <VendorWorkTypeAfeModal
        vendorId={vendorId}
        workType={afeModalWorkType}
        onOpenChange={(open) => {
          if (!open) setAfeModalWorkType(null);
        }}
      />

      <PublishCatalogPanel vendorId={vendorId} hasWorkTypes={selectedCount > 0} />
    </div>
  );
}

// Task #1156 — vendor-side panel for publishing a new catalog version.
// Surfaces the impact-count up-front (so the vendor knows how many of
// their approved partners will be flipped to "Re-approval pending")
// and forces an authority attestation + EULA before the server will
// accept the publish.
function PublishCatalogPanel({
  vendorId,
  hasWorkTypes,
}: {
  vendorId: number;
  hasWorkTypes: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [eulaText, setEulaText] = useState(PLATFORM_EULA_TEXT);
  const [changeSummary, setChangeSummary] = useState("");
  const [attest, setAttest] = useState(false);

  const impactKey = ["vendor-catalog-publish-impact", vendorId];
  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: impactKey,
    queryFn: () =>
      jsonFetch<{
        vendorId: number;
        approvedCount: number;
        pendingCount: number;
        willAutoUnapprove: number;
        willStayPending: number;
        missingCompliance?: string[];
      }>(`/api/vendors/${vendorId}/catalog/publish-impact`),
    enabled: !!vendorId,
  });
  const missingCompliance = impact?.missingCompliance ?? [];
  const hasMissingCompliance = missingCompliance.length > 0;

  const publish = useMutation({
    mutationFn: () =>
      jsonFetch<{ versionId: number; version: number }>(
        `/api/vendors/${vendorId}/catalog/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            eulaText: eulaText.trim(),
            changeSummary: changeSummary.trim() || null,
            attestAuthority: attest,
          }),
        },
      ),
    onSuccess: (r) => {
      toast({
        title: t("vendorCatalog.publish.publishedToast", {
          version: r.version,
        }),
      });
      setEulaText(PLATFORM_EULA_TEXT);
      setChangeSummary("");
      setAttest(false);
      qc.invalidateQueries({ queryKey: impactKey });
    },
    onError: (e: Error) =>
      toast({
        title: translateApiError(
          e,
          t,
          t("vendorCatalog.publish.publishFailedToast"),
        ),
        variant: "destructive",
      }),
  });

  const canPublish =
    hasWorkTypes &&
    eulaText.trim().length > 0 &&
    attest &&
    !hasMissingCompliance &&
    !publish.isPending;

  return (
    <Card data-testid="card-publish-catalog">
      <CardHeader>
        <CardTitle className="text-lg">
          {t("vendorCatalog.publish.sectionTitle")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("vendorCatalog.publish.sectionSubtitle")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasMissingCompliance && (
          <div
            className="text-sm rounded border p-2 bg-red-50 border-red-200 text-red-900"
            data-testid="banner-publish-compliance-missing"
          >
            <div className="font-medium">
              <AlertCircle className="inline w-3.5 h-3.5 mr-1" />
              {t("vendorCatalog.publish.complianceMissingTitle")}
            </div>
            <div className="text-xs mt-1">
              {t("vendorCatalog.publish.complianceMissingHelp")}
            </div>
          </div>
        )}
        <div
          className="text-sm rounded border p-2"
          style={{
            background:
              "color-mix(in srgb, var(--brand-primary) 8%, white)",
            borderColor:
              "color-mix(in srgb, var(--brand-primary) 35%, white)",
          }}
          data-testid="text-publish-impact"
        >
          {impactLoading ? (
            t("vendorCatalog.publish.impactLoading")
          ) : impact && impact.willAutoUnapprove > 0 ? (
            <span style={{ color: "var(--brand-primary)" }}>
              <AlertCircle className="inline w-3.5 h-3.5 mr-1" />
              {t("vendorCatalog.publish.impactWarning", {
                count: impact.willAutoUnapprove,
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("vendorCatalog.publish.impactNone")}
            </span>
          )}
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">
            {t("vendorCatalog.publish.changeSummaryLabel")}
          </span>
          <Input
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder={t("vendorCatalog.publish.changeSummaryPlaceholder")}
            data-testid="input-publish-change-summary"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">
            {t("vendorCatalog.publish.eulaLabel")}
          </span>
          <textarea
            value={eulaText}
            onChange={(e) => setEulaText(e.target.value)}
            placeholder={t("vendorCatalog.publish.eulaPlaceholder")}
            rows={6}
            className="w-full text-sm border rounded-md p-2 font-mono"
            data-testid="textarea-publish-eula"
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={attest}
            onCheckedChange={(v) => setAttest(!!v)}
            className="border-[var(--brand-primary)] data-[state=checked]:bg-[var(--brand-primary)] data-[state=checked]:border-[var(--brand-primary)] data-[state=checked]:text-white"
            data-testid="checkbox-publish-attest"
          />
          <span>{t("vendorCatalog.publish.attestLabel")}</span>
        </label>
        <div className="flex justify-end pt-2 border-t">
          {canPublish ? (
            <PngPillButton
              color="blue"
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
              className="px-3"
              data-testid="button-publish-catalog"
            >
              {publish.isPending
                ? t("vendorCatalog.publish.publishing")
                : t("vendorCatalog.publish.publishButton")}
            </PngPillButton>
          ) : (
            <PngPillButton disabled data-testid="button-publish-catalog">
              {t("vendorCatalog.publish.publishButton")}
            </PngPillButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VendorWorkTypeAfeModal({
  vendorId,
  workType,
  onOpenChange,
}: {
  vendorId: number;
  workType: WorkTypeRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const open = workType !== null;
  const workTypeId = workType?.id ?? 0;

  const { data, isLoading, isError } = useGetVendorWorkTypeSiteAfes(
    vendorId,
    workTypeId,
    {
      query: {
        enabled: open && workTypeId > 0,
        queryKey: getGetVendorWorkTypeSiteAfesQueryKey(vendorId, workTypeId),
      },
    },
  );

  const items = data?.items ?? [];
  const categoryLabel =
    workType?.category?.trim() || t("vendorCatalog.afeModal.uncategorized");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-vendor-afe">
        <DialogHeader>
          <DialogTitle data-testid="text-vendor-afe-title">
            {workType?.name ?? t("vendorCatalog.afeModal.title")}
          </DialogTitle>
          <DialogDescription>
            {t("vendorCatalog.afeModal.category", { category: categoryLabel })}
          </DialogDescription>
          <p className="text-xs text-muted-foreground pt-1">
            {t("vendorCatalog.afeModal.subtitle")}
          </p>
        </DialogHeader>

        <div className="space-y-2">
          {isLoading ? (
            <div className="space-y-2" data-testid="state-vendor-afe-loading">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p
              className="text-sm text-destructive"
              data-testid="state-vendor-afe-error"
            >
              {t("vendorCatalog.afeModal.error")}
            </p>
          ) : items.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="state-vendor-afe-empty"
            >
              {t("vendorCatalog.afeModal.empty")}
            </p>
          ) : (
            <div className="rounded border divide-y">
              <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <span>{t("vendorCatalog.afeModal.siteHeader")}</span>
                <span>{t("vendorCatalog.afeModal.afeHeader")}</span>
              </div>
              {items.map((it) => (
                <div
                  key={it.assignmentId}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2"
                  data-testid={`row-vendor-afe-${it.assignmentId}`}
                >
                  <div className="min-w-0" data-testid={`text-site-${it.assignmentId}`}>
                    <div className="text-sm font-medium truncate">
                      <span className="font-mono text-xs text-muted-foreground mr-2">
                        {it.siteCode}
                      </span>
                      {it.siteName}
                    </div>
                    {it.partnerName ? (
                      <div className="text-xs text-muted-foreground truncate">
                        {it.partnerName}
                      </div>
                    ) : null}
                  </div>
                  {it.afe ? (
                    <AfePill
                      data-testid={`pill-afe-${it.assignmentId}`}
                    >
                      {it.afe}
                    </AfePill>
                  ) : (
                    <span
                      className="text-xs text-muted-foreground italic"
                      data-testid={`text-no-afe-${it.assignmentId}`}
                    >
                      {t("vendorCatalog.afeModal.noAfe")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
