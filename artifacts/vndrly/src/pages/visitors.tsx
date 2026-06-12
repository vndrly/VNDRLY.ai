import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Clock, History, UserCheck } from "lucide-react";
import { useListSiteLocations } from "@workspace/api-client-react";
import { visitsApi, type VisitorRow } from "@/lib/visits-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { Card, CardHeader, CardTitle, CardContent, CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { useBrand } from "@/hooks/use-brand";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandPillButton from "@/components/brand-pill-button";
import SphereBackButton from "@/components/sphere-back-button";
import { PngPillButton, brandImagePillSrc } from "@/components/png-pill-rollover";
import { PillColorLayer } from "@/components/png-pill-chrome";
import {
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_READONLY_WRAPPER_CLASS,
  pillLabelToneClass,
} from "@/lib/pill-doctrine";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function VisitorsPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const initialSiteFilter = (() => {
    if (typeof window === "undefined") return "all";
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("siteLocationId");
    return s && /^\d+$/.test(s) ? s : "all";
  })();
  const [siteFilter, setSiteFilter] = useState<string>(initialSiteFilter);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: sites } = useListSiteLocations();

  const queryParams = useMemo(() => {
    const p: { siteLocationId?: number; from?: string; to?: string } = {};
    if (siteFilter !== "all") p.siteLocationId = parseInt(siteFilter, 10);
    if (from) p.from = new Date(from).toISOString();
    if (to) {
      const d = new Date(to);
      d.setHours(23, 59, 59, 999);
      p.to = d.toISOString();
    }
    return p;
  }, [siteFilter, from, to]);

  // Task #710 — back off the visitor list 30s poll when the server
  // returns a `visits.rate_limited` 429. Mirror the notifications-bell
  // pattern: keep a local state copy of the gate's `rateLimited` flag
  // so the same render that trips the gate disables the next refetch
  // instead of immediately re-tripping the limiter. The pause is
  // automatically lifted by `useRateLimitGate` when Retry-After
  // elapses (capped at 5 minutes).
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["visits-list", queryParams],
    queryFn: () => visitsApi.list(queryParams),
    refetchInterval: rateLimitedState ? false : 30000,
    enabled: !rateLimitedState,
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
  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);
  const rows: VisitorRow[] = data ?? [];
  const active = rows.filter((r) => !r.checkOutTime);
  const past = rows.filter((r) => r.checkOutTime);

  const onClear = () => {
    setSiteFilter("all");
    setFrom("");
    setTo("");
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back affordance + page title on a single row. Sphere
          matches the rest of the app's back-button family (ticket /
          visit / partner detail). Uses browser history rather than
          a fixed route so the user returns to whatever page linked
          them in. Falls back to the home/portal route when there is
          no history (e.g. opened in a new tab). */}
      <div className="flex items-center gap-3 mb-1">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              window.history.back();
            } else {
              setLocation("/");
            }
          }}
          className="group inline-flex items-center"
          aria-label={t("common.back", { defaultValue: "Back" })}
          data-testid="button-back"
        >
          <SphereBackButton size={40} />
        </button>
        <h1 className="text-2xl font-semibold">{t("visitor.title")}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t("visitor.subtitle")}</p>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t("visitor.filters.site")}</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger data-testid="select-visitor-site">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("visitor.filters.allSites")}</SelectItem>
                  {(sites ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("visitor.filters.from")}</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="input-visitor-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("visitor.filters.to")}</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="input-visitor-to"
              />
            </div>
            <div>
              <PngPillButton color="blue" onClick={onClear} data-testid="button-clear-filters">
                {t("visitor.filters.clear")}
              </PngPillButton>
            </div>
          </div>
        </CardContent>
      </Card>

      {rateLimited && (
        <div
          className="mb-4 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          data-testid="visitors-slow-down"
          role="status"
          aria-live="polite"
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            {retryAfterSeconds != null
              ? t("common.slowDown.retryIn", { seconds: retryAfterSeconds })
              : t("common.slowDown.brief")}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : error && !rateLimited ? (
        <div className="text-sm text-destructive">{(error as Error).message}</div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
                {t("visitor.currentlyOnSite")}{" "}
                <BrandedCountPill
                  count={active.length}
                  data-testid="badge-currently-on-site-count"
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {active.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t("visitor.noneOnSite")}</div>
              ) : (
                <VisitTable
                  rows={active}
                  showCheckOut={false}
                  onRowClick={(id) => setLocation(`/visits/${id}`)}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
                {t("visitor.recent")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {past.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t("visitor.noPast")}</div>
              ) : (
                <VisitTable
                  rows={past}
                  showCheckOut
                  onRowClick={(id) => setLocation(`/visits/${id}`)}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function BrandedCountPill({
  count,
  "data-testid": testId,
}: {
  count: number;
  "data-testid"?: string;
}) {
  const brand = useBrand();
  const pillSrc = brandImagePillSrc(brand.primary, brand.name);
  return (
    <span
      className={cn(
        PILL_READONLY_WRAPPER_CLASS,
        "min-w-[70px] whitespace-nowrap pointer-events-none align-middle",
      )}
      style={{ height: PILL_HEIGHT_PX }}
      data-testid={testId}
    >
      <PillColorLayer src={pillSrc} />
      <span
        className={cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(false))}
      >
        {count}
      </span>
    </span>
  );
}

type VisitSortKey =
  | "visitor"
  | "company"
  | "site"
  | "host"
  | "purpose"
  | "checkIn"
  | "checkOut";
type VisitSortDir = "asc" | "desc";

function visitorName(r: VisitorRow) {
  return `${r.lastName} ${r.firstName}`.trim();
}

function hostName(r: VisitorRow) {
  return r.hostType === "partner" ? r.hostPartnerName ?? "" : r.hostVendorName ?? "";
}

function compareVisitRows(
  a: VisitorRow,
  b: VisitorRow,
  key: VisitSortKey,
  dir: VisitSortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  switch (key) {
    case "visitor":
      return visitorName(a).localeCompare(visitorName(b)) * mul;
    case "company":
      return (a.company ?? "").localeCompare(b.company ?? "") * mul;
    case "site":
      return (a.siteName ?? "").localeCompare(b.siteName ?? "") * mul;
    case "host":
      return hostName(a).localeCompare(hostName(b)) * mul;
    case "purpose":
      return (a.purpose ?? "").localeCompare(b.purpose ?? "") * mul;
    case "checkIn":
      return (
        (new Date(a.checkInTime).getTime() - new Date(b.checkInTime).getTime()) *
        mul
      );
    case "checkOut": {
      const aOut = a.checkOutTime ? new Date(a.checkOutTime).getTime() : 0;
      const bOut = b.checkOutTime ? new Date(b.checkOutTime).getTime() : 0;
      return (aOut - bOut) * mul;
    }
    default:
      return 0;
  }
}

function VisitTable({
  rows,
  showCheckOut,
  onRowClick,
}: {
  rows: VisitorRow[];
  showCheckOut: boolean;
  onRowClick: (id: number) => void;
}) {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const [sort, setSort] = useState<{ key: VisitSortKey; dir: VisitSortDir }>(() =>
    showCheckOut
      ? { key: "checkOut", dir: "desc" }
      : { key: "checkIn", dir: "desc" },
  );

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => compareVisitRows(a, b, sort.key, sort.dir)),
    [rows, sort],
  );

  const toggleSort = (key: VisitSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const SortableTh = ({
    column,
    label,
    testId,
  }: {
    column: VisitSortKey;
    label: string;
    testId: string;
  }) => (
    <th
      className="py-2 pr-3 cursor-pointer select-none"
      onClick={() => toggleSort(column)}
      data-testid={testId}
    >
      <div className="flex items-center gap-1">
        {label}
        {sort.key === column ? (
          sort.dir === "asc" ? (
            <ArrowUp className="w-3 h-3" style={iconStyle} />
          ) : (
            <ArrowDown className="w-3 h-3" style={iconStyle} />
          )
        ) : null}
      </div>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <SortableTh
              column="visitor"
              label={t("visitor.table.visitor")}
              testId="th-sort-visitor"
            />
            <SortableTh
              column="company"
              label={t("visitor.table.company")}
              testId="th-sort-company"
            />
            <SortableTh
              column="site"
              label={t("visitor.table.site")}
              testId="th-sort-site"
            />
            <SortableTh
              column="host"
              label={t("visitor.table.host")}
              testId="th-sort-host"
            />
            <SortableTh
              column="purpose"
              label={t("visitor.table.purpose")}
              testId="th-sort-purpose"
            />
            <SortableTh
              column="checkIn"
              label={t("visitor.table.checkedIn")}
              testId="th-sort-checked-in"
            />
            {showCheckOut && (
              <SortableTh
                column="checkOut"
                label={t("visitor.table.checkedOut")}
                testId="th-sort-checked-out"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr
              key={r.id}
              className="group border-b last:border-0 cursor-pointer hover:bg-muted/40"
              data-testid={`visit-row-${r.id}`}
              onClick={() => onRowClick(r.id)}
            >
              <td className="py-2 pr-3">
                {/* Visitor name reads as a link — dark grey at rest,
                    transitions to the partner's brand primary on row
                    hover (the row is the click target, so we drive
                    the name color from the row's `group` hover). */}
                <div className="font-medium text-gray-700 transition-colors group-hover:text-[var(--brand-primary)]">
                  {r.firstName} {r.lastName}
                </div>
                <div className="text-xs text-muted-foreground">{r.phone ?? r.email ?? ""}</div>
              </td>
              <td className="py-2 pr-3">{r.company ?? "—"}</td>
              <td className="py-2 pr-3">{r.siteName ?? "—"}</td>
              <td className="py-2 pr-3">
                {r.hostType === "partner" ? r.hostPartnerName : r.hostVendorName}
              </td>
              <td className="py-2 pr-3">{r.purpose ?? "—"}</td>
              <td className="py-2 pr-3">{fmt(r.checkInTime)}</td>
              {showCheckOut && (
                <td className="py-2 pr-3">
                  {fmt(r.checkOutTime)}
                  {r.autoCheckedOut && (
                    <Badge variant="outline" className="ml-2">
                      {t("visitor.table.auto")}
                    </Badge>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
