import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/pill";
import { TogglePillButton } from "@/components/toggle-pill";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GoToPageForm } from "@/components/go-to-page-form";
import {
  FileText,
  FileSpreadsheet,
  Package,
  RotateCcw,
  Save,
  Cloud,
  CloudOff,
  Plug,
  Loader2,
  Layers,
  Upload,
  Download,
  Copy,
  Undo2,
  ChevronDown,
  ChevronRight,
  History,
  AlertTriangle,
  ExternalLink,
  Trash2,
  Search,
  X,
  Settings2,
  ListFilter,
  Clock,
  TrendingUp,
  TrendingDown,
  Percent,
  Users,
  CreditCard,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useGetVendor, useUpdateVendor } from "@workspace/api-client-react";
import {
  formatPushWarningLine,
  formatPushWarningsForCopy,
  type PushWarning,
} from "@workspace/api-zod";
import { useQueryClient } from "@tanstack/react-query";
import { readCsv, suggestCanonicalName, writeCsv } from "@/lib/csv";
import { formatSnapshotBytes } from "@/lib/format-bytes";
import { Link } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";

import {
  CsvImportPreviewDialog,
  buildEditedCsv,
  computeBulkRenameCandidates,
  type CsvImportPreviewDialogProps,
  type CsvPreviewError,
  type CsvPreviewRow,
  type CsvPreviewState,
  type CsvPreviewUpdateRow,
  type EditableCells,
} from "./reports/csv-import-preview";
import {
  BulkActionsHistoryDialog,
  BulkActionDetailsDialog,
  type BulkActionsHistoryDialogProps,
  type BulkActionDetailsDialogProps,
  type QbBulkActionCleanupAuditRow,
  type QbBulkActionRow,
  type QbBulkActionsResponse,
  type QbBulkActionCleanupAuditResponse,
} from "./reports/bulk-actions-history";
import { QbAccountMappingAuditCard } from "./reports/qb-mapping-audit";

// Re-export so existing test imports (./reports) keep resolving after
// the split into ./reports/* sub-modules (see task #395).
export {
  CsvImportPreviewDialog,
  buildEditedCsv,
  computeBulkRenameCandidates,
  BulkActionsHistoryDialog,
  BulkActionDetailsDialog,
};
export type {
  CsvImportPreviewDialogProps,
  CsvPreviewError,
  CsvPreviewRow,
  CsvPreviewState,
  CsvPreviewUpdateRow,
  EditableCells,
  BulkActionsHistoryDialogProps,
  BulkActionDetailsDialogProps,
  QbBulkActionRow,
  QbBulkActionCleanupAuditRow,
};

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "ytd",
  "custom",
] as const;
type PeriodPreset = (typeof PERIOD_PRESETS)[number];

interface PeriodSelection {
  preset: PeriodPreset;
  customStart: string;
  customEnd: string;
}

function defaultPeriod(): PeriodSelection {
  return { preset: "ytd", customStart: "", customEnd: "" };
}

/** Convert a PeriodSelection to URL params accepted by /api/reports endpoints. */
function periodParams(p: PeriodSelection): Record<string, string> {
  if (p.preset === "custom") {
    if (!p.customStart || !p.customEnd) return {};
    return { periodStart: p.customStart, periodEnd: p.customEnd };
  }
  return { preset: p.preset };
}

function buildUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${qs.toString() ? sep + qs.toString() : ""}`;
}

/** Return an ISO YYYY-MM-DD date string for an *inclusive* period
 *  bound (e.g. `period.start.toISOString()` from the server). Accepts
 *  either a date-only string or a full ISO datetime; truncates at the
 *  `T`. Used for `periodStart` when building deep-links: the start of
 *  a `[start, end)` half-open interval is already the date the user
 *  thinks of as "from", so no offset is needed.
 *
 *  Round-trip: the date-only value we emit lands in the
 *  `?periodStart=` URL parameter, the frontend stores it as
 *  `customStart`, and the server's `resolvePeriod` parses the
 *  date-only string at midnight UTC — same instant as the original
 *  inclusive bound. */
function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
}

/** Return an ISO YYYY-MM-DD date string for an *exclusive* period
 *  bound — e.g. `period.end.toISOString()` from the server, which
 *  represents the half-open upper boundary of the interval. We
 *  subtract one millisecond before truncating, converting the
 *  exclusive datetime back into the inclusive last day of the period.
 *
 *  Round-trip: the inclusive date we emit lands in the `?periodEnd=`
 *  URL parameter, the frontend stores it as `customEnd`, and the
 *  server's `resolvePeriod` re-bumps date-only `periodEnd` by one day
 *  to recover the original exclusive boundary. Without subtracting
 *  here the server would bump *again*, widening the period by a day. */
function toInclusiveEndDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Date-only inputs are already inclusive — pass straight through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Step back one millisecond to land on the last instant of the
  // previous UTC day, then format as YYYY-MM-DD.
  const inclusive = new Date(d.getTime() - 1);
  return `${inclusive.getUTCFullYear()}-${String(
    inclusive.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(inclusive.getUTCDate()).padStart(2, "0")}`;
}

/** Parse a server-formatted period label ("YYYY-MM-DD – YYYY-MM-DD",
 *  *inclusive* end as produced by `formatPeriod` on the API) into a
 *  start/end pair of ISO YYYY-MM-DD strings. The inclusive end is
 *  preserved as-is so the deep-link round-trip lines up: the server's
 *  `resolvePeriod` will bump the date-only `periodEnd` by one day to
 *  recover the original exclusive boundary. Returns `null` for either
 *  bound that fails to parse. */
function parsePushPeriodLabel(
  label: string,
): { periodStart: string | null; periodEnd: string | null } {
  const m = /(\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})/.exec(label);
  if (!m) return { periodStart: null, periodEnd: null };
  return { periodStart: m[1], periodEnd: m[2] };
}

/** Reconciliation deep-link: open the matching invoice in a new tab from
 *  a per-invoice drift warning. Calls window.open synchronously (so the
 *  browser doesn't treat the later async navigation as a popup) and
 *  resolves the warning's invoice number to an id via /api/invoices.
 *  Falls back to the listing page filtered by invoiceNumber when no
 *  exact match comes back (e.g. the invoice was deleted between the
 *  sync and the click), so the operator still lands somewhere useful. */
function openInvoiceByNumberInNewTab(
  vendorId: number | null,
  invoiceNumber: string,
): void {
  // Synchronous open avoids popup-blocker — most browsers only allow
  // window.open during the same call stack as the user gesture.
  const target = window.open("about:blank", "_blank", "noopener");
  const fallbackHref = `${API_BASE}/invoices?invoiceNumber=${encodeURIComponent(invoiceNumber)}`;
  const params = new URLSearchParams({ invoiceNumber, limit: "1" });
  if (vendorId !== null) params.set("vendorId", String(vendorId));
  fetch(`${API_BASE}/api/invoices?${params.toString()}`, {
    credentials: "include",
  })
    .then(async (r) => (r.ok ? r.json() : { items: [] }))
    .then((j: { items?: Array<{ id?: number }> }) => {
      const id = j.items?.[0]?.id;
      const href =
        typeof id === "number"
          ? `${API_BASE}/invoices/${id}`
          : fallbackHref;
      if (target) {
        target.location.href = href;
      } else {
        window.location.assign(href);
      }
    })
    .catch(() => {
      if (target) target.location.href = fallbackHref;
    });
}

/** Reconciliation deep-link: the URL to open the Sales-Tax-by-State
 *  report card scoped to a state and an audit row's period. The
 *  ReportsPage reads `card`, `periodStart`, `periodEnd`, `state` on
 *  mount and forwards them to the matching ReportCard, which switches
 *  itself to a custom period, scrolls into view, and highlights the
 *  matching state row. */
function buildSalesTaxStateLink(args: {
  state: string;
  periodStart: string;
  periodEnd: string;
}): string {
  const qs = new URLSearchParams({
    card: "salesTaxByState",
    state: args.state,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });
  return `${API_BASE}/reports?${qs.toString()}`;
}

/** Shape of a single deep-link request parsed off the ReportsPage URL.
 *  Children that own a matching ReportCard look at `cardId` and apply
 *  the period + row highlight. */
interface ReportDeepLink {
  cardId: string;
  periodStart: string;
  periodEnd: string;
  /** Optional per-row highlight key — currently used by the
   *  Sales-Tax-by-State card to flash the row whose state matches. */
  highlightKey?: string;
}

/** Parse the current ReportsPage URL into a deep-link record, or null
 *  if no `card` param is present. Read once on mount; subsequent
 *  in-page navigations don't re-trigger so the highlight doesn't
 *  flash repeatedly when the user changes period manually. */
function parseReportDeepLinkFromUrl(): ReportDeepLink | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const cardId = sp.get("card");
  const periodStart = sp.get("periodStart") ?? "";
  const periodEnd = sp.get("periodEnd") ?? "";
  if (!cardId || !periodStart || !periodEnd) return null;
  return {
    cardId,
    periodStart,
    periodEnd,
    highlightKey: sp.get("state") ?? undefined,
  };
}

interface PeriodControlsProps {
  value: PeriodSelection;
  onChange: (v: PeriodSelection) => void;
}

function PeriodControls({ value, onChange }: PeriodControlsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={value.preset}
        onValueChange={(v) => onChange({ ...value, preset: v as PeriodPreset })}
      >
        <SelectTrigger className="w-44" data-testid="select-period-preset">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_PRESETS.map((p) => (
            <SelectItem key={p} value={p}>
              {t(`reports.preset.${p}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={value.customStart}
            onChange={(e) =>
              onChange({ ...value, customStart: e.target.value })
            }
            className="w-40"
            data-testid="input-period-start"
            aria-label={t("reports.preset.from")}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            value={value.customEnd}
            onChange={(e) => onChange({ ...value, customEnd: e.target.value })}
            className="w-40"
            data-testid="input-period-end"
            aria-label={t("reports.preset.to")}
          />
        </div>
      )}
    </div>
  );
}

interface GroupOption {
  value: string;
  label: string;
  /** Override apiPath when this group is selected. */
  apiPath: string;
  /** Override columns rendering when this group is selected. */
  renderPreview: (data: unknown) => ReactElement | null;
}

interface ReportCardProps {
  title: string;
  /** Optional brand-colored icon rendered left of the card title. */
  icon?: LucideIcon;
  description?: string;
  apiPath: string;
  /** Extra query params (besides format/period) — e.g. year. */
  extraParams?: Record<string, string>;
  /** Whether the report supports period selection. */
  hasPeriod?: boolean;
  /** Whether the report supports a year selector (1099). */
  hasYear?: boolean;
  /** Render the JSON payload as a table preview. */
  renderPreview: (data: unknown) => ReactElement | null;
  /** Group-by toggle — when present, the user can switch the dimension. */
  groups?: GroupOption[];
  /** If false, hides the CSV button. */
  showCsv?: boolean;
  /** If false, hides the PDF button. */
  showPdf?: boolean;
  /** Stable identifier matched against `?card=` in the URL — opt-in
   *  deep-link target. When the URL's `card` matches `cardId`, the
   *  card initializes its period from `?periodStart=&periodEnd=` and
   *  scrolls itself into view on mount. */
  cardId?: string;
  /** Deep-link request parsed off the URL by ReportsPage. The card
   *  applies it once on mount when `deepLink.cardId === cardId`. */
  deepLink?: ReportDeepLink | null;
}

function ReportCard(props: ReportCardProps): ReactElement {
  const { t } = useTranslation();
  // Apply a matching deep-link as the initial period so the very first
  // fetch already uses the requested range (no flicker between the
  // default-period fetch and the deep-linked fetch).
  const initialDeepLinkMatch =
    props.cardId !== undefined &&
    props.deepLink?.cardId === props.cardId &&
    props.deepLink?.periodStart &&
    props.deepLink?.periodEnd
      ? props.deepLink
      : null;
  const [period, setPeriod] = useState<PeriodSelection>(() =>
    initialDeepLinkMatch && props.hasPeriod
      ? {
          preset: "custom",
          customStart: initialDeepLinkMatch.periodStart,
          customEnd: initialDeepLinkMatch.periodEnd,
        }
      : defaultPeriod(),
  );
  const [year, setYear] = useState<string>(() =>
    String(new Date().getUTCFullYear()),
  );
  // Self-scroll into view + soft focus on mount when this card is the
  // deep-link target. The ref is attached to the outer Card element.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!initialDeepLinkMatch || !cardRef.current) return;
    cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    // We intentionally only run on mount — subsequent period changes by
    // the user shouldn't yank the page back to this card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [groupValue, setGroupValue] = useState<string>(
    props.groups?.[0]?.value ?? "",
  );
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const activeGroup = props.groups?.find((g) => g.value === groupValue);
  const apiPath = activeGroup?.apiPath ?? props.apiPath;
  const renderPreview = activeGroup?.renderPreview ?? props.renderPreview;

  const params = useMemo<Record<string, string>>(() => {
    const p: Record<string, string> = { ...(props.extraParams ?? {}) };
    if (props.hasPeriod) Object.assign(p, periodParams(period));
    if (props.hasYear) p.year = year;
    return p;
  }, [props.extraParams, props.hasPeriod, props.hasYear, period, year]);

  // Don't fetch when custom is selected but dates aren't filled in.
  const canFetch =
    !props.hasPeriod ||
    period.preset !== "custom" ||
    Boolean(period.customStart && period.customEnd);

  useEffect(() => {
    if (!canFetch) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setErr(null);
    fetch(buildUrl(apiPath, { ...params, format: "json" }), {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (active) setData(j);
      })
      .catch((e: Error) => {
        if (active) setErr(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiPath, params, canFetch]);

  return (
    <Card
      ref={cardRef}
      data-testid={`card-report-${props.apiPath.replace(/[^a-z0-9]/gi, "-")}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              {props.icon && (
                <props.icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: "var(--brand-primary)" }}
                  aria-hidden="true"
                />
              )}
              {props.title}
            </CardTitle>
            {props.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {props.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {props.groups && props.groups.length > 0 && (
              <Select value={groupValue} onValueChange={setGroupValue}>
                <SelectTrigger className="w-44" data-testid="select-group-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {props.groups.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {props.hasPeriod && (
              <PeriodControls value={period} onChange={setPeriod} />
            )}
            {props.hasYear && (
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-28" data-testid="select-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4].map((delta) => {
                    const y = String(new Date().getUTCFullYear() - delta);
                    return (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
            {(props.showCsv ?? true) && (
              <TogglePillButton
                color="green"

                disabled={!canFetch}
                onClick={() =>
                  triggerDownload(
                    buildUrl(apiPath, { ...params, format: "csv" }),
                  )
                }
                data-testid="link-download-csv"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {t("reports.download.csv")}
              </TogglePillButton>
            )}
            {(props.showPdf ?? true) && (
              <TogglePillButton
                color="red"

                disabled={!canFetch}
                onClick={() =>
                  triggerDownload(
                    buildUrl(apiPath, { ...params, format: "pdf" }),
                  )
                }
                data-testid="link-download-pdf"
              >
                <FileText className="h-3.5 w-3.5" />
                {t("reports.download.pdf")}
              </TogglePillButton>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!canFetch && (
          <p className="text-sm text-muted-foreground">
            {t("reports.preset.customHelper")}
          </p>
        )}
        {canFetch && loading && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {canFetch && err && (
          <p className="text-sm text-destructive" data-testid="text-error">
            {err}
          </p>
        )}
        {canFetch && !loading && !err && Boolean(data) && renderPreview(data)}
      </CardContent>
    </Card>
  );
}

// ── chart helper ─────────────────────────────────────────────────

interface ChartSpec {
  /** Field name on each row to use as the x-axis label. */
  labelKey: string;
  /** Field name on each row to use as the bar height (numeric). */
  valueKey: string;
  /** Optional chart title. */
  title?: string;
}

function ReportChart({
  rows,
  spec,
}: {
  rows: Array<Record<string, unknown>>;
  spec: ChartSpec;
}): ReactElement | null {
  const data = rows.slice(0, 12).map((r) => ({
    label: String(r[spec.labelKey] ?? "").slice(0, 24),
    value: Number(r[spec.valueKey]) || 0,
  }));
  if (data.length === 0) return null;
  return (
    <div className="mb-4" data-testid="report-chart">
      {spec.title && (
        <p className="text-xs font-semibold text-muted-foreground mb-1">
          {spec.title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "#ccc", fillOpacity: 0.5 }}
            formatter={(v: number) =>
              v.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            }
          />
          <Bar
            dataKey="value"
            maxBarSize={28}
            shape={(p: object) => <VerticalPillBarShape {...p} flatBottom />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── preview renderers ────────────────────────────────────────────

function renderTable<T extends Record<string, unknown>>(
  data: { rows?: T[]; totals?: T },
  cols: { key: keyof T & string; label: string; align?: "left" | "right" }[],
  /** Optional row decorator. When `match(row)` returns true, the row gets
   *  a highlighted background + a stable test id so deep-link consumers
   *  (e.g. the reconciliation state-badge link) can verify their target
   *  was found. Out of band of the column model so it stays opt-in.
   *
   *  When `filterToMatch` is true, the rendered rows are restricted to
   *  those satisfying `match` before the 25-row preview slice — this is
   *  what backs single-state Sales-Tax deep-links so the target is
   *  always visible (rather than hidden behind the row cap) and the
   *  preview reads as a true filtered view rather than a highlighted
   *  needle in a 50-state haystack. */
  decorate?: {
    match: (row: T) => boolean;
    testId: string;
    /** Tailwind classes applied to the matching row. */
    className?: string;
    filterToMatch?: boolean;
  },
): ReactElement {
  const allRows = data?.rows ?? [];
  const filteredRows =
    decorate?.filterToMatch === true
      ? allRows.filter((r) => decorate.match(r))
      : allRows;
  const rows = filteredRows.slice(0, 25);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-data">
        No data for this period.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead
                key={c.key}
                className={c.align === "right" ? "text-right" : undefined}
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const isMatch = decorate?.match(r) ?? false;
            return (
              <TableRow
                key={i}
                className={
                  isMatch
                    ? (decorate?.className ??
                      "bg-amber-100 dark:bg-amber-900/30")
                    : undefined
                }
                data-testid={isMatch ? decorate?.testId : undefined}
              >
                {cols.map((c) => (
                  <TableCell
                    key={c.key}
                    className={c.align === "right" ? "text-right" : undefined}
                  >
                    {String(r[c.key] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {data.totals && (
            <TableRow className="font-semibold border-t-2">
              {cols.map((c) => (
                <TableCell
                  key={c.key}
                  className={c.align === "right" ? "text-right" : undefined}
                >
                  {String(data.totals?.[c.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          )}
        </TableBody>
      </Table>
      {(data.rows?.length ?? 0) > 25 && (
        <p className="text-xs text-muted-foreground mt-2">
          Showing first 25 rows. Download CSV/PDF for full data.
        </p>
      )}
    </div>
  );
}

/** Hook that wraps clipboard writes with toast feedback so admins know
 *  the copy actually landed. Falls back to a destructive toast if the
 *  clipboard is unavailable (e.g. http page or denied permission). */
function useCopyWarnings(): (text: string, label: string) => Promise<void> {
  const { toast } = useToast();
  const { t } = useTranslation();
  return async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("reports.push.copied", { label }) });
    } catch {
      toast({
        title: t("reports.push.copyFailed"),
        variant: "destructive",
      });
    }
  };
}

/** Reconciliation warnings are emitted by the server's post-push QBO
 *  reconcile step. They share the `PushWarning` shape but are flagged by
 *  one of three identifier/message conventions defined in
 *  `artifacts/api-server/src/lib/accounting/qbo.ts`:
 *    - identifier `"(reconciliation)"` — the reconcile step itself failed
 *      (network / auth)
 *    - identifier `"(state:XX)"` — per-state aggregate tax mismatch
 *    - any warning whose `message` starts with `"reconciliation:"` —
 *      per-invoice total/tax drift
 *  Treating these visually distinct from "row failed to post" warnings
 *  helps operators tell "QuickBooks accepted everything but numbers
 *  drifted" from "row failed to post". */
function isReconciliationWarning(w: PushWarning): boolean {
  // `identifier` and `message` are typed as required strings on `PushWarning`,
  // but the audit log stores raw `detailJson` from arbitrary historical push
  // runs (and future warning shapes may not even use `identifier`). Treat any
  // missing/non-string field as "not a reconciliation warning" instead of
  // throwing — otherwise a single malformed entry crashes the whole AuditCard.
  const identifier = typeof w.identifier === "string" ? w.identifier : "";
  const message = typeof w.message === "string" ? w.message : "";
  return (
    identifier === "(reconciliation)" ||
    identifier.startsWith("(state:") ||
    /reconciliation/i.test(message)
  );
}

/** Returns the state code (e.g. `"CA"`) for a state-aggregate warning,
 *  or `null` if the identifier isn't a `(state:XX)` token. Defensive against
 *  warnings without an `identifier` for the same reason as
 *  `isReconciliationWarning` above. */
function parseReconciliationStateCode(w: PushWarning): string | null {
  if (typeof w.identifier !== "string") return null;
  const m = /^\(state:(.+)\)$/.exec(w.identifier);
  return m ? m[1] : null;
}

/** Map an audit row's `reportKind` to the accounting provider whose push
 *  produced it, so reconciliation copy can name the right product
 *  ("QuickBooks accepted these rows…" vs. "OpenAccountant accepted these
 *  rows…"). Returns `null` for non-push audit kinds (the partition still
 *  works, it just defaults to the QuickBooks-flavored copy that already
 *  shipped). */
function pushProviderFromReportKind(
  reportKind: string | null | undefined,
): "qbo" | "oa" | null {
  if (reportKind === "vendor.openaccountantPush") return "oa";
  if (reportKind === "vendor.quickbooksPush") return "qbo";
  return null;
}

/** True when an audit row records an admin clearing (forgetting) a single
 *  invoice's QuickBooks/OpenAccountant push mapping. The scope payload for
 *  these rows is shaped differently from regular pushes (it carries the
 *  per-invoice fields snapshotted at delete time — invoiceNumber,
 *  externalInvoiceId, previouslyPushedAt) so the audit UI renders them with
 *  a forget-specific summary instead of the generic JSON dump used for
 *  bulk push/resync rows. */
function isForgetFormat(format: string): boolean {
  return format === "qbo_api_forget" || format === "oa_api_forget";
}

/** Pull the snapshotted forget-row fields out of an audit row's `scope`
 *  jsonb. All fields are optional — older rows or rows that arrived from a
 *  different code path may be missing one or more, in which case the UI
 *  hides the corresponding line rather than showing "undefined". */
function readForgetScope(scope: Record<string, unknown>): {
  invoiceNumber: string | null;
  externalInvoiceId: string | null;
  externalDocNumber: string | null;
  previouslyPushedAt: string | null;
  provider: "qbo" | "oa" | null;
} {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const provRaw = scope.provider;
  const provider =
    provRaw === "qbo" || provRaw === "oa" ? provRaw : null;
  return {
    invoiceNumber: str(scope.invoiceNumber),
    externalInvoiceId: str(scope.externalInvoiceId),
    externalDocNumber: str(scope.externalDocNumber),
    previouslyPushedAt: str(scope.previouslyPushedAt),
    provider,
  };
}

/** Splits a warnings list into three buckets: failed pushes (the original
 *  per-row sync errors), per-state reconciliation aggregates, and
 *  per-invoice/general reconciliation issues. Order within each bucket is
 *  preserved from the source list. */
function partitionWarnings(warnings: PushWarning[]): {
  failed: PushWarning[];
  reconciliationStateAggregates: PushWarning[];
  reconciliationOther: PushWarning[];
} {
  const failed: PushWarning[] = [];
  const reconciliationStateAggregates: PushWarning[] = [];
  const reconciliationOther: PushWarning[] = [];
  for (const w of warnings) {
    if (!isReconciliationWarning(w)) {
      failed.push(w);
    } else if (parseReconciliationStateCode(w) !== null) {
      reconciliationStateAggregates.push(w);
    } else {
      reconciliationOther.push(w);
    }
  }
  return { failed, reconciliationStateAggregates, reconciliationOther };
}

/** Inline link rendering of a per-invoice reconciliation warning's
 *  invoice number. Resolves `vendorId + invoiceNumber → invoice id` on
 *  click and opens the detail page in a new tab. Falls back to plain
 *  text when we don't know which vendor's books the warning came from
 *  (e.g. an unscoped audit row), since the cross-vendor lookup would be
 *  ambiguous. */
function ReconciliationInvoiceCell({
  warning,
  vendorId,
  testId,
}: {
  warning: PushWarning;
  vendorId: number | null;
  testId: string;
}): ReactElement {
  const { t } = useTranslation();
  // Some warnings in the "other reconciliation" bucket are not actually
  // per-invoice — e.g. `(reconciliation)` for the reconcile step itself
  // failing, or any other parenthesized synthetic token. Vendor-issued
  // invoice numbers never start with `(`, so a leading paren is a
  // reliable signal that this isn't a real invoice id and we should
  // render the identifier as plain text instead of a link that would
  // fruitlessly query `/api/invoices?invoiceNumber=(reconciliation)`.
  const isInvoiceLike = !warning.identifier.startsWith("(");
  if (vendorId === null || !isInvoiceLike) {
    return <span className="font-mono">{warning.identifier}</span>;
  }
  return (
    <button
      type="button"
      className="font-mono text-left text-amber-900 underline-offset-2 hover:underline focus:underline focus:outline-none dark:text-amber-200 inline-flex items-center gap-1"
      onClick={() =>
        openInvoiceByNumberInNewTab(vendorId, warning.identifier)
      }
      title={t("reports.reconciliation.openInvoice", {
        invoice: warning.identifier,
      })}
      aria-label={t("reports.reconciliation.openInvoice", {
        invoice: warning.identifier,
      })}
      data-testid={testId}
    >
      <span className="break-all">{warning.identifier}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  );
}

/** Per-warning "Re-push this invoice" control. Resolves the warning's
 *  invoice number to an id, calls the same single-invoice resync
 *  endpoint the invoice detail page uses, and renders the new outcome
 *  (success / still drifting / error) in place of the button so the
 *  operator sees one row resolve without opening the invoice. Returns
 *  null when the warning isn't a real per-invoice row, when there's no
 *  vendor scope (we couldn't deep-link either), or when we don't know
 *  which provider to retarget. The same RBAC the bulk push uses
 *  (rbacVendor on the server) gates the actual call. */
function ReconciliationRePushControl({
  warning,
  vendorId,
  provider,
  testId,
}: {
  warning: PushWarning;
  vendorId: number | null;
  provider: "qbo" | "oa" | null;
  testId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const isInvoiceLike = !warning.identifier.startsWith("(");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; ok: boolean; message: string }
  >({ status: "idle" });
  if (!isInvoiceLike || vendorId === null || provider === null) return null;

  const onClick = async (): Promise<void> => {
    setState({ status: "running" });
    try {
      // Resolve invoice number → id the same way the deep-link does.
      const lookup = new URLSearchParams({
        invoiceNumber: warning.identifier,
        vendorId: String(vendorId),
        limit: "1",
      });
      const r0 = await fetch(`${API_BASE}/api/invoices?${lookup.toString()}`, {
        credentials: "include",
      });
      const j0 = (await r0.json().catch(() => ({}))) as {
        items?: Array<{ id?: number }>;
      };
      const invoiceId = j0.items?.[0]?.id;
      if (typeof invoiceId !== "number") {
        setState({
          status: "done",
          ok: false,
          message: t("reports.reconciliation.rePush.notFound"),
        });
        return;
      }
      const path = provider === "qbo" ? "qbo-resync" : "oa-resync";
      const r1 = await fetch(
        `${API_BASE}/api/reports/vendor/${vendorId}/invoices/${invoiceId}/${path}`,
        { method: "POST", credentials: "include" },
      );
      const j1 = (await r1.json().catch(() => ({}))) as {
        error?: string;
        warnings?: Array<{ message?: string }>;
        auditLogId?: number;
      };
      if (!r1.ok) {
        setState({
          status: "done",
          ok: false,
          message: j1.error ?? `HTTP ${r1.status}`,
        });
        return;
      }
      const newWarnings = (j1.warnings ?? []).filter(
        (w) => typeof w.message === "string" && w.message.length > 0,
      );
      if (newWarnings.length > 0) {
        setState({
          status: "done",
          ok: false,
          message: t("reports.reconciliation.rePush.stillDrifting", {
            message: newWarnings.map((w) => w.message).join("; "),
          }),
        });
      } else {
        setState({
          status: "done",
          ok: true,
          message:
            typeof j1.auditLogId === "number"
              ? t("reports.reconciliation.rePush.successWithId", {
                  id: j1.auditLogId,
                })
              : t("reports.reconciliation.rePush.success"),
        });
      }
    } catch (e) {
      setState({
        status: "done",
        ok: false,
        message: (e as Error).message,
      });
    }
  };

  if (state.status === "done") {
    return (
      <span
        className={
          "text-xs " +
          (state.ok
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-destructive")
        }
        data-testid={`${testId}-result`}
      >
        {state.message}
      </span>
    );
  }
  return (
    <PillButton
      type="button"
      color="image"
      className="h-6 text-xs px-2"
      disabled={state.status === "running"}
      onClick={() => void onClick()}
      data-testid={testId}
    >
      {state.status === "running" ? (
        <>
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          {t("reports.reconciliation.rePush.running")}
        </>
      ) : (
        t("reports.reconciliation.rePush.label")
      )}
    </PillButton>
  );
}

/** Inline link rendering of a per-state reconciliation warning's state
 *  badge. Opens the Sales-Tax-by-State report scoped to the audit row's
 *  period with the matching state row highlighted. Falls back to a plain
 *  badge when we don't know the period (e.g. a synthetic warning that
 *  didn't come from a bulk push) since the deep-link wouldn't be useful
 *  without one. */
function ReconciliationStateBadgeCell({
  warning,
  periodStart,
  periodEnd,
  testId,
}: {
  warning: PushWarning;
  periodStart: string | null;
  periodEnd: string | null;
  testId: string;
}): ReactElement {
  const { t } = useTranslation();
  const code = parseReconciliationStateCode(warning) ?? warning.identifier;
  if (!periodStart || !periodEnd || code === warning.identifier) {
    // No period to deep-link to, or the identifier isn't a real state
    // code (defensive — shouldn't happen for state-aggregate warnings).
    return (
      <Badge variant="outline" className="font-mono">
        {code}
      </Badge>
    );
  }
  const href = buildSalesTaxStateLink({
    state: code,
    periodStart,
    periodEnd,
  });
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline focus:underline focus:outline-none"
      title={t("reports.reconciliation.openSalesTaxState", { state: code })}
      aria-label={t("reports.reconciliation.openSalesTaxState", { state: code })}
      data-testid={testId}
    >
      <Badge variant="outline" className="font-mono">
        {code}
      </Badge>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

interface AuditRow {
  id: number;
  reportKind: string;
  format: string;
  rowCount: number | null;
  fileBytes: number;
  userRole: string;
  downloadedByUserId: number | null;
  createdAt: string;
  scope: Record<string, unknown>;
  detailJson: { warnings?: PushWarning[] } | null;
  /** Ordered list of audit ids (oldest → newest, inclusive of self) when
   *  this row is part of a multi-step retry chain. Omitted entirely when
   *  the row is not part of any chain. */
  retryChain?: number[];
}

/** Modal that shows the full scope + per-row warnings of an audit row.
 *  Triggered from the "Details" link in the audit log table. */
function AuditDetailDialog({
  row,
  retriedByAuditIds,
  open,
  onOpenChange,
  rowsById,
  inWindowIds,
  onJumpToRow,
}: {
  row: AuditRow | null;
  /** Ids of later audit rows whose `scope.retriedFromAuditId` points at
   *  `row.id` — i.e. rows that re-ran this sync. Empty when there are none
   *  in the visible window. */
  retriedByAuditIds: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lookup of every audit row known to the client (in-window + chain
   *  members the server pulled in: ancestors, descendants, and any
   *  warnings-filtered chain participants). Used to render chain entries. */
  rowsById: Map<number, AuditRow>;
  /** Set of audit ids that are currently rendered in the table (i.e. the
   *  100-row window). Chain entries outside this set cannot be scrolled to. */
  inWindowIds: Set<number>;
  /** Closes the dialog and scrolls the given audit row into view. */
  onJumpToRow: (id: number) => void;
}): ReactElement {
  const { t } = useTranslation();
  const warnings = row?.detailJson?.warnings ?? [];
  const { failed, reconciliationStateAggregates, reconciliationOther } =
    partitionWarnings(warnings);
  // Pick the provider-appropriate copy for the reconciliation section so
  // an OpenAccountant push doesn't claim "QuickBooks accepted these rows".
  // Defaults to the QuickBooks-flavored copy when the row isn't a known
  // push kind (the description only renders when reconciliation warnings
  // exist, which today only happens for the QBO/OA push kinds).
  const provider = pushProviderFromReportKind(row?.reportKind);
  const reconciliationDescriptionKey =
    provider === "oa"
      ? "reports.audit.details.reconciliationDescription_oa"
      : "reports.audit.details.reconciliationDescription";
  const retriedFromAuditId =
    row && typeof row.scope.retriedFromAuditId === "number"
      ? row.scope.retriedFromAuditId
      : null;
  const copy = useCopyWarnings();
  const chain = row?.retryChain ?? [];
  // The single-line "Retry of #N" card is redundant once we render the full
  // chain list, so suppress it whenever a chain is present.
  const showSimpleRetryOf =
    retriedFromAuditId !== null && chain.length < 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="dialog-audit-details"
      >
        <DialogHeader>
          <DialogTitle>{t("reports.audit.details.title")}</DialogTitle>
          {row && (
            <DialogDescription className="font-mono text-xs">
              {row.reportKind} · {row.format} ·{" "}
              {new Date(row.createdAt).toLocaleString()}
            </DialogDescription>
          )}
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            {isForgetFormat(row.format) && (() => {
              // Forget rows record an admin clearing the local
              // QuickBooks/OpenAccountant push mapping for one invoice.
              // Surface the snapshotted scope fields up-front so admins
              // investigating an unexpected re-push can see at a glance
              // which invoice was cleared, by whom, and what the
              // previous remote id / push timestamp were — without
              // squinting at the raw JSON dump below.
              const f = readForgetScope(row.scope);
              // Prefer the explicit `scope.provider` snapshot, but fall
              // back to deriving it from the row's `format` so legacy
              // forget rows that didn't record a provider field still
              // get the correct QuickBooks/OpenAccountant label.
              const providerForLabel =
                f.provider ??
                (row.format === "oa_api_forget" ? "oa" : "qbo");
              const provLabel =
                providerForLabel === "oa"
                  ? t("reports.audit.details.forget.providerOa")
                  : t("reports.audit.details.forget.providerQbo");
              return (
                <div
                  className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1"
                  data-testid="text-audit-detail-forget"
                >
                  <p className="font-semibold">
                    {t("reports.audit.details.forget.heading", {
                      provider: provLabel,
                    })}
                  </p>
                  {f.invoiceNumber && (
                    <p data-testid="text-audit-detail-forget-invoice">
                      {t("reports.audit.details.forget.invoice", {
                        invoiceNumber: f.invoiceNumber,
                      })}
                    </p>
                  )}
                  {f.externalInvoiceId && (
                    <p data-testid="text-audit-detail-forget-external-id">
                      {f.externalDocNumber
                        ? t("reports.audit.details.forget.externalIdWithDoc", {
                            id: f.externalInvoiceId,
                            docNumber: f.externalDocNumber,
                          })
                        : t("reports.audit.details.forget.externalId", {
                            id: f.externalInvoiceId,
                          })}
                    </p>
                  )}
                  {f.previouslyPushedAt && (
                    <p data-testid="text-audit-detail-forget-pushed-at">
                      {t("reports.audit.details.forget.previouslyPushedAt", {
                        when: new Date(
                          f.previouslyPushedAt,
                        ).toLocaleString(),
                      })}
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    {t("reports.audit.details.forget.actor", {
                      role: row.userRole,
                      id: row.downloadedByUserId ?? "—",
                    })}
                  </p>
                </div>
              );
            })()}
            {showSimpleRetryOf && (
              <div
                className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
                data-testid="text-audit-detail-retry-of"
              >
                {t("reports.audit.details.retryOf", {
                  id: retriedFromAuditId,
                })}
              </div>
            )}
            {retriedByAuditIds.length > 0 && (
              <div
                className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
                data-testid="text-audit-detail-retried-by"
              >
                {t("reports.audit.details.retriedBy", {
                  count: retriedByAuditIds.length,
                  ids: retriedByAuditIds.map((id) => `#${id}`).join(", "),
                })}
              </div>
            )}
            {chain.length >= 2 && (
              <div className="space-y-2" data-testid="list-retry-chain">
                <h4 className="text-sm font-semibold">
                  {t("reports.audit.details.chainHeading", {
                    count: chain.length,
                  })}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {t("reports.audit.details.chainDescription")}
                </p>
                <ol className="space-y-1 rounded-md border divide-y">
                  {chain.map((id, idx) => {
                    const entryRow = rowsById.get(id);
                    const isCurrent = id === row.id;
                    const isInWindow = inWindowIds.has(id);
                    const wcount =
                      entryRow?.detailJson?.warnings?.length ?? 0;
                    return (
                      <li
                        key={id}
                        className={
                          "flex items-center gap-2 px-2 py-1.5 text-xs " +
                          (isCurrent ? "bg-primary/10" : "")
                        }
                        data-testid={`row-chain-entry-${id}`}
                      >
                        <span className="font-mono text-muted-foreground w-6 text-right">
                          {idx + 1}.
                        </span>
                        <span className="font-mono font-semibold">
                          #{id}
                        </span>
                        {entryRow && (
                          <>
                            <span className="text-muted-foreground">
                              {new Date(entryRow.createdAt).toLocaleString()}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {entryRow.format}
                            </span>
                            {wcount > 0 && (
                              <Badge
                                variant="destructive"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {t("reports.audit.details.chainWarnings", {
                                  count: wcount,
                                })}
                              </Badge>
                            )}
                          </>
                        )}
                        <span className="ml-auto">
                          {isCurrent ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {t("reports.audit.details.chainCurrent")}
                            </Badge>
                          ) : (
                            <button
                              type="button"
                              className="text-primary underline-offset-2 hover:underline"
                              onClick={() => onJumpToRow(id)}
                              data-testid={`button-chain-jump-${id}`}
                              title={
                                isInWindow
                                  ? t("reports.audit.retryOfHint")
                                  : t("reports.audit.retryOfMissingHint")
                              }
                            >
                              {isInWindow
                                ? t("reports.audit.details.chainJump")
                                : t("reports.audit.details.chainJumpToPage")}
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            {failed.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-destructive">
                    {t("reports.audit.details.warningsHeading")} ({failed.length})
                  </h4>
                  <PillButton
                    color="image"
                    onClick={() =>
                      void copy(
                        formatPushWarningsForCopy(failed),
                        t("reports.push.copyLabel.all"),
                      )
                    }
                    data-testid="button-audit-copy-warnings"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {t("reports.push.copyAll")}
                  </PillButton>
                </div>
                <div
                  className="max-h-72 overflow-y-auto rounded-md border border-destructive/30"
                  data-testid="list-audit-warnings"
                >
                  <Table>
                    <TableBody>
                      {failed.map((w, i) => (
                        <TableRow key={i} data-testid={`row-audit-warning-${i}`}>
                          <TableCell className="text-xs w-24 align-top">
                            {t(`reports.push.warningKind.${w.kind}`)}
                          </TableCell>
                          <TableCell className="text-xs font-mono w-40 align-top break-all">
                            {w.identifier}
                          </TableCell>
                          <TableCell className="text-xs text-destructive align-top">
                            {w.message}
                          </TableCell>
                          <TableCell className="w-8 align-top">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={t("reports.push.copyRow")}
                              title={t("reports.push.copyRow")}
                              onClick={() =>
                                void copy(
                                  formatPushWarningLine(w),
                                  t("reports.push.copyLabel.row"),
                                )
                              }
                              data-testid={`button-audit-copy-warning-${i}`}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            {(reconciliationOther.length > 0 ||
              reconciliationStateAggregates.length > 0) && (
              <div
                className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50/40 p-3 dark:bg-amber-950/20"
                data-testid="section-audit-reconciliation"
              >
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {t("reports.audit.details.reconciliationHeading")} (
                  {reconciliationOther.length +
                    reconciliationStateAggregates.length}
                  )
                </h4>
                <p className="text-xs text-muted-foreground">
                  {t(reconciliationDescriptionKey)}
                </p>
                {reconciliationOther.length > 0 && (
                  <div
                    className="max-h-56 overflow-y-auto rounded-md border border-amber-500/30 bg-background"
                    data-testid="list-audit-reconciliation-other"
                  >
                    <Table>
                      <TableBody>
                        {reconciliationOther.map((w, i) => (
                          <TableRow
                            key={i}
                            data-testid={`row-audit-reconciliation-${i}`}
                          >
                            <TableCell className="text-xs w-40 break-all align-top">
                              <ReconciliationInvoiceCell
                                warning={w}
                                vendorId={
                                  typeof row.scope.vendorId === "number"
                                    ? row.scope.vendorId
                                    : null
                                }
                                testId={`link-audit-reconciliation-invoice-${i}`}
                              />
                            </TableCell>
                            <TableCell className="text-xs text-amber-900 dark:text-amber-200 align-top">
                              {w.message}
                            </TableCell>
                            <TableCell className="text-xs w-44 align-top">
                              <ReconciliationRePushControl
                                warning={w}
                                vendorId={
                                  typeof row.scope.vendorId === "number"
                                    ? row.scope.vendorId
                                    : null
                                }
                                provider={provider}
                                testId={`button-audit-reconciliation-repush-${i}`}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {reconciliationStateAggregates.length > 0 && (
                  <div className="space-y-1">
                    <h5 className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      {t(
                        "reports.audit.details.reconciliationStateGroupHeading",
                      )}{" "}
                      ({reconciliationStateAggregates.length})
                    </h5>
                    <div
                      className="max-h-56 overflow-y-auto rounded-md border border-amber-500/30 bg-background"
                      data-testid="list-audit-reconciliation-states"
                    >
                      <Table>
                        <TableBody>
                          {reconciliationStateAggregates.map((w, i) => (
                            <TableRow
                              key={i}
                              data-testid={`row-audit-reconciliation-state-${i}`}
                            >
                              <TableCell className="text-xs w-20 align-top">
                                <ReconciliationStateBadgeCell
                                  warning={w}
                                  periodStart={toIsoDate(
                                    row.scope.periodStart,
                                  )}
                                  periodEnd={toInclusiveEndDate(
                                    row.scope.periodEnd,
                                  )}
                                  testId={`link-audit-reconciliation-state-${i}`}
                                />
                              </TableCell>
                              <TableCell className="text-xs text-amber-900 dark:text-amber-200 align-top">
                                {w.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("reports.audit.details.scopeHeading")}
              </h4>
              <pre
                className="text-xs font-mono bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap"
                data-testid="text-audit-scope"
              >
                {JSON.stringify(row.scope, null, 2)}
              </pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            data-testid="button-audit-details-close"
          >
            {t("reports.audit.details.close")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AUDIT_PAGE_SIZE = 100;

interface AuditFilters {
  /** Raw YYYY-MM-DD date input value (the user's picked day), or "" if
   *  unset. Converted to an ISO timestamp at fetch time so the active-filter
   *  chips can display the user's date directly. */
  from: string;
  /** Raw YYYY-MM-DD date input value (the user's picked day, inclusive),
   *  or "" if unset. */
  to: string;
}

const EMPTY_FILTERS: AuditFilters = { from: "", to: "" };

/** Convert a yyyy-mm-dd date input value into an ISO timestamp at the start
 *  of that UTC day. Empty string → "" (no filter). When `inclusiveEnd` is
 *  true we bump to the start of the *next* UTC day so the server's exclusive
 *  upper-bound (`lt(createdAt, to)`) still includes everything on the picked
 *  day. */
function dateInputToIso(date: string, inclusiveEnd = false): string {
  if (!date) return "";
  if (!inclusiveEnd) return `${date}T00:00:00.000Z`;
  // Add one UTC day so 2025-01-15 → 2025-01-16T00:00:00Z; combined with the
  // server's `lt` this lets all of Jan 15 through.
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Snapshot of the audit filter state encoded in the page URL — read once
 *  at mount to seed component state, and written back via `replaceState`
 *  whenever filters change. Persisting these in the query string makes
 *  filtered audit-log views shareable, bookmarkable, and survive a
 *  browser refresh (the existing `?auditId=N` accounting-digest deep
 *  link is folded into `anchor` once consumed: after the dialog opens,
 *  the resolved row id is written back as `?anchor=N`). */
interface AuditUrlState {
  filters: AuditFilters;
  onlyWarnings: boolean;
  anchor: number | null;
}

/** Parse audit-log filter state from the current page URL. Unknown or
 *  malformed values are dropped (a stray `?from=banana` shouldn't break
 *  the page). Returns an empty state in non-browser contexts so the
 *  module is safe to evaluate during SSR/test. */
function parseAuditFiltersFromUrl(): AuditUrlState {
  if (typeof window === "undefined") {
    return { filters: EMPTY_FILTERS, onlyWarnings: false, anchor: null };
  }
  const sp = new URLSearchParams(window.location.search);
  const fromRaw = sp.get("from") ?? "";
  const toRaw = sp.get("to") ?? "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : "";
  // Accept both `warnings=1` (the canonical param this card writes back via
  // `syncAuditFiltersToUrl`) and `onlyWarnings=1` (the friendlier name used
  // by the accounting digest email's "Show only syncs with warnings" deep
  // link). Either form pre-toggles the switch on mount.
  const warningsRaw = sp.get("warnings") ?? sp.get("onlyWarnings");
  const onlyWarnings = warningsRaw === "1" || warningsRaw === "true";
  const anchorRaw = sp.get("anchor");
  const anchorNum = anchorRaw !== null ? Number(anchorRaw) : NaN;
  const anchor =
    Number.isInteger(anchorNum) && anchorNum > 0 ? anchorNum : null;
  return { filters: { from, to }, onlyWarnings, anchor };
}

/** Write the audit-log filter state into the URL query string via
 *  `replaceState` (no new history entry — pagination/anchor changes
 *  shouldn't pollute the back button). Other unrelated params are
 *  preserved untouched so this can co-exist with the cross-card
 *  `?card=&periodStart=&periodEnd=&state=` deep-link convention used
 *  by the report cards above. */
function syncAuditFiltersToUrl(state: AuditUrlState): void {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (state.filters.from) sp.set("from", state.filters.from);
  else sp.delete("from");
  if (state.filters.to) sp.set("to", state.filters.to);
  else sp.delete("to");
  if (state.onlyWarnings) sp.set("warnings", "1");
  else sp.delete("warnings");
  // The accounting digest email links use `onlyWarnings=1` as a friendlier
  // synonym; once consumed at mount we collapse it into the canonical
  // `warnings=1` so the URL doesn't carry both forms after a refresh.
  sp.delete("onlyWarnings");
  if (state.anchor !== null) sp.set("anchor", String(state.anchor));
  else sp.delete("anchor");
  const qs = sp.toString();
  const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  const currentUrl =
    window.location.pathname + window.location.search + window.location.hash;
  if (newUrl !== currentUrl) {
    window.history.replaceState({}, "", newUrl);
  }
}

/** Format a YYYY-MM-DD audit-filter date for display in the active-filter
 *  chips (e.g. "Apr 1, 2026"). Parses the date in UTC and formats in UTC
 *  so the displayed day always matches what the user picked, regardless
 *  of their browser's local time zone. */
function formatAuditFilterDate(date: string): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function AuditCard(): ReactElement {
  const { t } = useTranslation();
  /** Snapshot of URL-encoded filter state read once at mount. We seed
   *  draftFilters/appliedFilters/onlyWarnings/pendingAnchorId from this
   *  so refreshing the Reports page (or pasting a teammate's link) lands
   *  on the same filtered view with the chips already rendered. */
  const initialUrlStateRef = useRef<AuditUrlState>(parseAuditFiltersFromUrl());
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  /** Chain-member rows the server pulled in alongside the current page so
   *  the chain dialog can show every hop's metadata and root rows can
   *  surface "Retried by #N" badges. Includes ancestors, descendants, any
   *  in-window chain members the warnings filter hid, and chain members
   *  that landed on a different page. */
  const [chainRows, setChainRows] = useState<AuditRow[]>([]);
  const [totalWithWarnings, setTotalWithWarnings] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<AuditRow | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  /** Filters bound to the input controls. Applied filters live in
   *  `appliedFilters` so typing into the date inputs doesn't refetch on every
   *  keystroke; the user clicks "Go" or presses Enter to apply. */
  const [draftFilters, setDraftFilters] = useState<AuditFilters>(
    initialUrlStateRef.current.filters,
  );
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(
    initialUrlStateRef.current.filters,
  );
  /** Draft for the "Go to ID" input. */
  const [goToIdDraft, setGoToIdDraft] = useState("");
  /** When set, the next fetch resolves the page that contains this id and we
   *  scroll/highlight the row once it loads. Seeded from `?anchor=N` in the
   *  URL so a shared link lands on the same row. */
  const [pendingAnchorId, setPendingAnchorId] = useState<number | null>(
    initialUrlStateRef.current.anchor,
  );
  /** Banner shown when an anchor request couldn't be resolved (the target id
   *  doesn't exist or doesn't match the current filters). */
  const [anchorWarning, setAnchorWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // When on, only rows with `detailJson.warnings` non-empty are rendered.
  // Filtering happens server-side (the endpoint accepts `hasWarnings=true`)
  // so the toggle reflects the current page consistently. The badge count
  // (`totalWithWarnings`) always comes from the unfiltered current page so
  // admins see "N of the visible syncs have warnings" regardless of the
  // toggle state.
  const [onlyWarnings, setOnlyWarnings] = useState(
    initialUrlStateRef.current.onlyWarnings,
  );
  /** The audit row id the current page is anchored to — set after a
   *  successful "Go to ID" jump (or auditId deep-link) so the active-filter
   *  chip row can render an "Anchored to #N ×" chip. Cleared when the user
   *  paginates, changes a filter, submits a different anchor, or removes
   *  the chip. Purely informational: clearing it doesn't trigger a refetch
   *  because the page already resolved to the row's location. */
  const [currentAnchorId, setCurrentAnchorId] = useState<number | null>(
    initialUrlStateRef.current.anchor,
  );

  /** Stable ref to the latest pendingAnchorId so the fetch effect can scroll
   *  after the rows render without re-firing on the state change itself. */
  const anchorScrollRef = useRef<number | null>(null);

  /** Persist the active filter set into the URL query string so the view
   *  is shareable, bookmarkable, and survives a refresh. We use
   *  `replaceState` (no new history entry) — pagination and anchor
   *  changes shouldn't require Back-button navigation to undo. The
   *  helper preserves any unrelated params (e.g. `auditId` while it's
   *  being consumed by the deep-link effect below, or the cross-card
   *  `card`/`periodStart`/`periodEnd`/`state` deep-link convention). */
  useEffect(() => {
    syncAuditFiltersToUrl({
      filters: appliedFilters,
      onlyWarnings,
      anchor: currentAnchorId,
    });
  }, [appliedFilters, onlyWarnings, currentAnchorId]);

  useEffect(() => {
    setLoading(true);
    // NOTE: do not clear anchorWarning here — the response handler may have
    // just set it (anchorOutsideFilter) and also called setPage, which
    // re-fires this effect. Clearing on every fetch wipes the warning
    // before the user sees it. Explicit user actions (filter change,
    // pagination, new Go-to-ID submit, dismiss) clear it themselves.
    const params = new URLSearchParams();
    params.set("pageSize", String(AUDIT_PAGE_SIZE));
    if (pendingAnchorId !== null) {
      params.set("anchorId", String(pendingAnchorId));
    } else {
      params.set("page", String(page));
    }
    if (appliedFilters.from) {
      params.set("from", dateInputToIso(appliedFilters.from));
    }
    if (appliedFilters.to) {
      params.set("to", dateInputToIso(appliedFilters.to, true));
    }
    if (onlyWarnings) params.set("hasWarnings", "true");
    let cancelled = false;
    fetch(`${API_BASE}/api/reports/exports/audit?${params.toString()}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(
        (j: {
          rows: AuditRow[];
          chainRows?: AuditRow[];
          page: number;
          pageSize: number;
          totalRows: number;
          totalWithWarnings?: number;
          anchorId?: number;
          anchorOutsideFilter?: boolean;
        }) => {
          if (cancelled) return;
          setRows(j.rows);
          setChainRows(j.chainRows ?? []);
          setTotalRows(j.totalRows);
          if (typeof j.totalWithWarnings === "number") {
            setTotalWithWarnings(j.totalWithWarnings);
          }
          setErr(null);
          // Sync local page state to whatever page the server actually
          // returned (anchor jumps adjust it server-side).
          if (j.page !== page) setPage(j.page);
          if (pendingAnchorId !== null) {
            if (j.anchorOutsideFilter) {
              setAnchorWarning(
                t("reports.audit.filters.anchorNotFound", {
                  id: pendingAnchorId,
                }),
              );
              anchorScrollRef.current = null;
              setCurrentAnchorId(null);
            } else {
              const found = j.rows.some((r) => r.id === pendingAnchorId);
              if (!found) {
                setAnchorWarning(
                  t("reports.audit.filters.anchorMissing", {
                    id: pendingAnchorId,
                  }),
                );
                anchorScrollRef.current = null;
                setCurrentAnchorId(null);
              } else {
                anchorScrollRef.current = pendingAnchorId;
                setCurrentAnchorId(pendingAnchorId);
              }
            }
            setPendingAnchorId(null);
          }
        },
      )
      .catch((e: Error) => {
        if (cancelled) return;
        setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, appliedFilters, pendingAnchorId, onlyWarnings, t]);

  // After rows render, scroll to & highlight the anchor row if one is set.
  useEffect(() => {
    if (anchorScrollRef.current === null || !rows) return;
    const id = anchorScrollRef.current;
    anchorScrollRef.current = null;
    // Defer to next tick so the table has rendered the rows. Capture both
    // timer handles so we can cancel them on unmount — otherwise vitest's
    // jsdom teardown leaves the queued callback to fire against a torn-down
    // `document`, surfacing as a `ReferenceError: document is not defined`
    // unhandled rejection that fails the suite even when every test passed.
    let highlightTimer: number | undefined;
    const scrollTimer = window.setTimeout(() => {
      if (typeof document === "undefined") return;
      const el = document.getElementById(`audit-row-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedId(id);
        highlightTimer = window.setTimeout(() => {
          setHighlightedId((curr) => (curr === id ? null : curr));
        }, 2500);
      }
    }, 50);
    return () => {
      window.clearTimeout(scrollTimer);
      if (highlightTimer !== undefined) window.clearTimeout(highlightTimer);
    };
  }, [rows]);

  // Set of audit ids visible in the current page — used to decide whether a
  // "Retry of #N" badge can scroll in-page or needs to jump to another page.
  const knownIds = useMemo(
    () => new Set((rows ?? []).map((r) => r.id)),
    [rows],
  );
  // Reverse index of the "Retry of #N" backward link: for each original audit
  // id, the list of later rows that retried it. Built from BOTH the in-window
  // rows and any descendants the server pulled into `chainRows` (e.g. when
  // the warnings filter hides a successful retry, when a chain straddles the
  // current page, or when a chain crosses the 100-row window). Out-of-window
  // retry ids render as a non-clickable badge in the table — same fallback
  // the "Retry of #N" badge uses when its parent has scrolled off the window.
  // Multiple retries are rare but possible (retry of a retry chain), and we
  // render one badge per retry so admins can jump directly to the resolving
  // row.
  const retriedByMap = useMemo(() => {
    const m = new Map<number, number[]>();
    const seen = new Set<string>();
    const all: AuditRow[] = [...(rows ?? []), ...chainRows];
    for (const r of all) {
      const orig =
        typeof r.scope.retriedFromAuditId === "number"
          ? r.scope.retriedFromAuditId
          : null;
      if (orig === null) continue;
      const key = `${orig}:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const arr = m.get(orig);
      if (arr) arr.push(r.id);
      else m.set(orig, [r.id]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  }, [rows, chainRows]);
  // Combined lookup of all audit rows the client knows about (in-window +
  // chain members the server pulled in: ancestors, descendants, and any
  // warnings-filtered or off-page chain participants). Used by the chain
  // list in the details dialog so it can render metadata for hops that
  // scrolled off the table.
  const rowsById = useMemo(() => {
    const m = new Map<number, AuditRow>();
    for (const r of rows ?? []) m.set(r.id, r);
    for (const r of chainRows) if (!m.has(r.id)) m.set(r.id, r);
    return m;
  }, [rows, chainRows]);
  // Set of in-page audit ids that are pointed at by some other in-page row's
  // `retriedFromAuditId`. Rows NOT in this set are the leaf of their chain in
  // the current view, which is where the "X-step chain" hint goes.
  const parentedIds = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows ?? []) {
      const p = r.scope.retriedFromAuditId;
      if (typeof p === "number") s.add(p);
    }
    return s;
  }, [rows]);
  const scrollToRow = useCallback((id: number) => {
    const el = document.getElementById(`audit-row-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(id);
    window.setTimeout(() => {
      setHighlightedId((curr) => (curr === id ? null : curr));
    }, 2500);
  }, []);

  /** Either scroll to the row in the current page, or trigger a server fetch
   *  for the page containing it. The caller doesn't need to know which case
   *  applies. */
  const jumpToAuditId = useCallback(
    (id: number) => {
      if (knownIds.has(id)) {
        scrollToRow(id);
      } else {
        setAnchorWarning(null);
        setPendingAnchorId(id);
      }
    },
    [knownIds, scrollToRow],
  );

  // Deep link from the accounting digest email (`?auditId=<n>`) auto-opens
  // the matching "Sync details" dialog once rows have loaded. Fires once
  // per page load; the param is then cleared so re-renders don't reopen it.
  // If the target id is not on page 1, we anchor-fetch it first.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    if (!rows) return;
    const params = new URLSearchParams(window.location.search);
    const target = Number(params.get("auditId"));
    if (!Number.isInteger(target) || target <= 0) {
      deepLinkedRef.current = true;
      return;
    }
    deepLinkedRef.current = true;
    params.delete("auditId");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
    );
    const match = rows.find((r) => r.id === target);
    if (match) {
      setDetailRow(match);
    } else {
      // Trigger an anchor fetch — when it returns, open the dialog.
      setPendingAnchorId(target);
      // Stash a one-shot "open this row when it arrives" cue. We re-use the
      // existing rows effect by checking after render.
      pendingDetailIdRef.current = target;
    }
  }, [rows]);

  /** When set, the next fetch should also pop open the details dialog for
   *  this id (used by the deep-link flow when the row isn't on page 1). */
  const pendingDetailIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingDetailIdRef.current === null || !rows) return;
    const id = pendingDetailIdRef.current;
    const match = rows.find((r) => r.id === id);
    if (match) {
      pendingDetailIdRef.current = null;
      setDetailRow(match);
    }
  }, [rows]);

  const jumpFromDialog = useCallback(
    (id: number) => {
      setDetailRow(null);
      // Defer the scroll/jump so the dialog's close animation doesn't fight
      // the smooth-scroll on the underlying page.
      window.setTimeout(() => jumpToAuditId(id), 50);
    },
    [jumpToAuditId],
  );

  const applyDraftFilters = useCallback(() => {
    setAnchorWarning(null);
    setCurrentAnchorId(null);
    setPage(1);
    setAppliedFilters({
      from: draftFilters.from,
      to: draftFilters.to,
    });
  }, [draftFilters]);

  const clearFilters = useCallback(() => {
    setAnchorWarning(null);
    setCurrentAnchorId(null);
    setOnlyWarnings(false);
    setPage(1);
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setGoToIdDraft("");
  }, []);

  /** Apply a "last N days" preset: sets the date range to today (inclusive)
   *  back N-1 days in UTC so today + the previous N-1 days are included.
   *  Updates both draft and applied state and resets pagination so the new
   *  range fetches immediately, matching the badge to the same window. */
  const applyDaysPreset = useCallback((days: number) => {
    const today = new Date();
    const toIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
    const fromDate = new Date(today);
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const fromIso = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, "0")}-${String(fromDate.getUTCDate()).padStart(2, "0")}`;
    const next: AuditFilters = { from: fromIso, to: toIso };
    setAnchorWarning(null);
    setCurrentAnchorId(null);
    setPage(1);
    setDraftFilters(next);
    setAppliedFilters(next);
  }, []);

  const submitGoToId = useCallback(() => {
    const n = Number(goToIdDraft);
    if (!Number.isInteger(n) || n <= 0) return;
    setAnchorWarning(null);
    setCurrentAnchorId(null);
    setPendingAnchorId(n);
  }, [goToIdDraft]);

  /** True while the CSV download is in flight so the button shows a busy
   *  state and we don't kick off concurrent downloads on double-click. */
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  /** Banner shown when the server hit the row cap so the admin knows the
   *  CSV is a partial export. Cleared on the next download attempt. */
  const [csvCapWarning, setCsvCapWarning] = useState<string | null>(null);
  const downloadCsv = useCallback(async () => {
    setDownloadingCsv(true);
    setCsvCapWarning(null);
    try {
      const params = new URLSearchParams();
      if (appliedFilters.from) {
        params.set("from", dateInputToIso(appliedFilters.from));
      }
      if (appliedFilters.to) {
        params.set("to", dateInputToIso(appliedFilters.to, true));
      }
      if (onlyWarnings) params.set("hasWarnings", "true");
      const url = `${API_BASE}/api/reports/exports/audit/csv${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const capped = r.headers.get("X-Audit-Export-Capped") === "true";
      const cap = Number(r.headers.get("X-Audit-Export-Cap") ?? "0");
      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "audit-log.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      if (capped) {
        setCsvCapWarning(
          t("reports.audit.csv.capWarning", {
            cap: Number.isFinite(cap) && cap > 0 ? cap : 50000,
          }),
        );
      }
    } catch (e) {
      setCsvCapWarning(
        t("reports.audit.csv.error", { message: (e as Error).message }),
      );
    } finally {
      setDownloadingCsv(false);
    }
  }, [appliedFilters, onlyWarnings, t]);

  /** Clear the From date filter while leaving To, warnings-only, and the
   *  goto-id draft alone. */
  const removeFromFilter = useCallback(() => {
    setAnchorWarning(null);
    setCurrentAnchorId(null);
    setPage(1);
    setDraftFilters((f) => ({ ...f, from: "" }));
    setAppliedFilters((f) => ({ ...f, from: "" }));
  }, []);

  /** Clear the To date filter while leaving From, warnings-only, and the
   *  goto-id draft alone. */
  const removeToFilter = useCallback(() => {
    setAnchorWarning(null);
    setCurrentAnchorId(null);
    setPage(1);
    setDraftFilters((f) => ({ ...f, to: "" }));
    setAppliedFilters((f) => ({ ...f, to: "" }));
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalRows / AUDIT_PAGE_SIZE));
  const filtersActive =
    appliedFilters.from !== "" || appliedFilters.to !== "";

  return (
    <Card data-testid="card-audit-log">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle>{t("reports.audit.title")}</CardTitle>
              {totalWithWarnings > 0 && (
                <Badge
                  variant="destructive"
                  data-testid="badge-audit-warnings-count"
                >
                  {t("reports.audit.warningsBadge", {
                    count: totalWithWarnings,
                  })}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("reports.audit.description")}
            </p>
          </div>
          <label
            className="flex items-center gap-2 text-sm cursor-pointer select-none"
            htmlFor="audit-only-warnings"
          >
            <Switch
              id="audit-only-warnings"
              checked={onlyWarnings}
              onCheckedChange={(checked) => {
                // Toggling warnings filters the dataset; the previously
                // anchored row may no longer be visible (or may live on
                // another page now). Clear the anchor chip + warning so
                // the chip row reflects the current view truthfully.
                setAnchorWarning(null);
                setCurrentAnchorId(null);
                setOnlyWarnings(checked);
              }}
              data-testid="switch-audit-only-warnings"
            />
            <span>{t("reports.audit.onlyWarnings")}</span>
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter & jump-to bar */}
        <div
          className="mb-4 flex flex-wrap items-end gap-3"
          data-testid="row-audit-filters"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="audit-filter-from" className="text-xs">
              {t("reports.audit.filters.from")}
            </Label>
            <Input
              id="audit-filter-from"
              type="date"
              value={draftFilters.from}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, from: e.target.value }))
              }
              className="h-8 w-40"
              data-testid="input-audit-filter-from"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="audit-filter-to" className="text-xs">
              {t("reports.audit.filters.to")}
            </Label>
            <Input
              id="audit-filter-to"
              type="date"
              value={draftFilters.to}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, to: e.target.value }))
              }
              className="h-8 w-40"
              data-testid="input-audit-filter-to"
            />
          </div>
          <PillButton
            type="button"
            color="blue"
            onClick={applyDraftFilters}
            data-testid="button-audit-filter-apply"
          >
            {t("reports.audit.filters.go")}
          </PillButton>
          <div
            className="flex flex-col gap-1"
            data-testid="row-audit-filter-presets"
          >
            <Label className="text-xs">
              {t("reports.audit.filters.presetsLabel")}
            </Label>
            <div className="flex gap-1">
              <PillButton
                type="button"
                color="image"
                className="h-8"
                onClick={() => applyDaysPreset(7)}
                data-testid="button-audit-filter-preset-7"
              >
                {t("reports.audit.filters.preset7")}
              </PillButton>
              <PillButton
                type="button"
                color="image"
                className="h-8"
                onClick={() => applyDaysPreset(30)}
                data-testid="button-audit-filter-preset-30"
              >
                {t("reports.audit.filters.preset30")}
              </PillButton>
              <PillButton
                type="button"
                color="image"
                className="h-8"
                onClick={() => applyDaysPreset(90)}
                data-testid="button-audit-filter-preset-90"
              >
                {t("reports.audit.filters.preset90")}
              </PillButton>
            </div>
          </div>
          <PillButton
            type="button"
            color="image"
            onClick={downloadCsv}
            disabled={downloadingCsv}
            title={t("reports.audit.csv.help")}
            data-testid="button-audit-download-csv"
          >
            <Download className="mr-1 h-3 w-3" aria-hidden="true" />
            {downloadingCsv
              ? t("reports.audit.csv.downloading")
              : t("reports.audit.csv.download")}
          </PillButton>
          {(filtersActive ||
            draftFilters.from ||
            draftFilters.to ||
            goToIdDraft ||
            onlyWarnings ||
            currentAnchorId !== null) && (
            <PillButton
              type="button"
              color="image"
              onClick={clearFilters}
              data-testid="button-audit-filter-clear"
            >
              {t("reports.audit.filters.clear")}
            </PillButton>
          )}
          <div className="ml-auto flex flex-col gap-1">
            <Label htmlFor="audit-goto-id" className="text-xs">
              {t("reports.audit.filters.goToId")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="audit-goto-id"
                type="number"
                inputMode="numeric"
                placeholder={t("reports.audit.filters.goToIdPlaceholder")}
                value={goToIdDraft}
                onChange={(e) => setGoToIdDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitGoToId();
                  }
                }}
                className="h-8 w-32"
                data-testid="input-audit-goto-id"
              />
              <PillButton
                type="button"
                color="blue"
                onClick={submitGoToId}
                disabled={!goToIdDraft}
                data-testid="button-audit-goto-id"
              >
                {t("reports.audit.filters.go")}
              </PillButton>
            </div>
          </div>
        </div>
        {/* Active filter chips. One chip per applied filter (warnings-only,
         *  From date, To date, current anchor) so the active filter state is
         *  obvious at a glance and admins can peel filters off one at a time
         *  without re-typing dates or hunting for the right toggle. The row
         *  hides itself when nothing is active. */}
        {(onlyWarnings ||
          appliedFilters.from ||
          appliedFilters.to ||
          currentAnchorId !== null) && (
          <div
            className="mb-3 flex flex-wrap items-center gap-2"
            data-testid="row-audit-active-filters"
          >
            {onlyWarnings && (
              <Badge
                variant="secondary"
                className="gap-1 pr-1"
                data-testid="chip-audit-filter-warnings"
              >
                <span>{t("reports.audit.chips.warnings")}</span>
                <button
                  type="button"
                  onClick={() => setOnlyWarnings(false)}
                  className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("reports.audit.chips.removeWarnings")}
                  data-testid="button-chip-remove-warnings"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {appliedFilters.from && (
              <Badge
                variant="secondary"
                className="gap-1 pr-1"
                data-testid="chip-audit-filter-from"
              >
                <span>
                  {t("reports.audit.chips.from", {
                    date: formatAuditFilterDate(appliedFilters.from),
                  })}
                </span>
                <button
                  type="button"
                  onClick={removeFromFilter}
                  className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("reports.audit.chips.removeFrom")}
                  data-testid="button-chip-remove-from"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {appliedFilters.to && (
              <Badge
                variant="secondary"
                className="gap-1 pr-1"
                data-testid="chip-audit-filter-to"
              >
                <span>
                  {t("reports.audit.chips.to", {
                    date: formatAuditFilterDate(appliedFilters.to),
                  })}
                </span>
                <button
                  type="button"
                  onClick={removeToFilter}
                  className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("reports.audit.chips.removeTo")}
                  data-testid="button-chip-remove-to"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {currentAnchorId !== null && (
              <Badge
                variant="secondary"
                className="gap-1 pr-1"
                data-testid="chip-audit-filter-anchor"
              >
                <span>
                  {t("reports.audit.chips.anchor", { id: currentAnchorId })}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentAnchorId(null)}
                  className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("reports.audit.chips.removeAnchor")}
                  data-testid="button-chip-remove-anchor"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        )}
        {anchorWarning && (
          <p
            className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            data-testid="text-audit-anchor-warning"
          >
            {anchorWarning}
          </p>
        )}
        {csvCapWarning && (
          <p
            className="mb-3 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid="text-audit-csv-cap-warning"
          >
            {csvCapWarning}
          </p>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!err && loading && rows === null && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {!err && rows && rows.length === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-audit-empty"
          >
            {onlyWarnings
              ? t("reports.audit.emptyWarnings")
              : filtersActive
                ? t("reports.audit.emptyFiltered")
                : t("reports.audit.empty")}
          </p>
        )}
        {!err && rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.audit.col.when")}</TableHead>
                  <TableHead>{t("reports.audit.col.kind")}</TableHead>
                  <TableHead>{t("reports.audit.col.format")}</TableHead>
                  <TableHead>{t("reports.audit.col.user")}</TableHead>
                  <TableHead className="text-right">
                    {t("reports.audit.col.rows")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("reports.audit.col.bytes")}
                  </TableHead>
                  <TableHead>{t("reports.audit.col.scope")}</TableHead>
                  <TableHead>{t("reports.audit.col.details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const allWarnings = r.detailJson?.warnings ?? [];
                  const warningCount = allWarnings.length;
                  const {
                    failed: failedRow,
                    reconciliationStateAggregates: recStatesRow,
                    reconciliationOther: recOtherRow,
                  } = partitionWarnings(allWarnings);
                  const failedCount = failedRow.length;
                  const reconciliationCount =
                    recStatesRow.length + recOtherRow.length;
                  const retriedFromAuditId =
                    typeof r.scope.retriedFromAuditId === "number"
                      ? r.scope.retriedFromAuditId
                      : null;
                  const retriedByAuditIds = retriedByMap.get(r.id) ?? [];
                  // Retried rows (in either direction) always get a "View"
                  // link so the dialog can surface the retry notes even when
                  // there are no warnings to show.
                  const hasDetails =
                    warningCount > 0 ||
                    Boolean(r.detailJson && Object.keys(r.detailJson).length) ||
                    retriedFromAuditId !== null ||
                    retriedByAuditIds.length > 0 ||
                    // Forget rows have no warnings and no detailJson, but
                    // their snapshotted scope (invoice #, prior remote id,
                    // previously-pushed-at) is the whole point of the audit
                    // entry — always offer a "View" link so admins can open
                    // the detail dialog.
                    isForgetFormat(r.format);
                  const isHighlighted = highlightedId === r.id;
                  // Show the "X-step chain" hint only on the leaf row of a
                  // chain that has more than one prior retry (chain length
                  // ≥ 3 including this row). Intermediate rows already carry
                  // the "Retry of #N" badge, so adding the chain hint there
                  // would be noisy.
                  const chainLength = r.retryChain?.length ?? 0;
                  const showChainBadge =
                    chainLength >= 3 && !parentedIds.has(r.id);
                  return (
                    <TableRow
                      key={r.id}
                      id={`audit-row-${r.id}`}
                      data-testid={`row-audit-${r.id}`}
                      className={
                        "transition-colors" +
                        (isHighlighted ? " bg-primary/15" : "")
                      }
                    >
                      <TableCell className="text-xs">
                        {new Date(r.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <div className="flex flex-col gap-1">
                          <span>{r.reportKind}</span>
                          {retriedFromAuditId !== null && (
                            <button
                              type="button"
                              onClick={() =>
                                jumpToAuditId(retriedFromAuditId)
                              }
                              className="self-start"
                              data-testid={`button-retry-of-${r.id}`}
                              title={
                                knownIds.has(retriedFromAuditId)
                                  ? t("reports.audit.retryOfHint")
                                  : t("reports.audit.retryOfMissingHint")
                              }
                            >
                              <Badge
                                variant="secondary"
                                className="cursor-pointer hover:bg-secondary/80"
                              >
                                {t("reports.audit.retryOf", {
                                  id: retriedFromAuditId,
                                })}
                              </Badge>
                            </button>
                          )}
                          {retriedByAuditIds.map((retryId) => (
                            <button
                              key={retryId}
                              type="button"
                              onClick={() => jumpToAuditId(retryId)}
                              className="self-start"
                              data-testid={`button-retried-by-${r.id}-${retryId}`}
                              title={
                                knownIds.has(retryId)
                                  ? t("reports.audit.retriedByHint")
                                  : t("reports.audit.retriedByMissingHint")
                              }
                            >
                              <Badge
                                variant="secondary"
                                className="cursor-pointer hover:bg-secondary/80"
                              >
                                {t("reports.audit.retriedBy", {
                                  id: retryId,
                                })}
                              </Badge>
                            </button>
                          ))}
                          {showChainBadge && (
                            <button
                              type="button"
                              onClick={() => setDetailRow(r)}
                              className="self-start"
                              data-testid={`button-chain-length-${r.id}`}
                              title={t("reports.audit.chainLengthHint")}
                            >
                              <Badge
                                variant="default"
                                className="cursor-pointer"
                              >
                                {t("reports.audit.chainLength", {
                                  count: chainLength,
                                })}
                              </Badge>
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{r.format}</TableCell>
                      <TableCell className="text-xs">
                        {r.userRole}
                        {r.downloadedByUserId
                          ? ` (#${r.downloadedByUserId})`
                          : ""}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.rowCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {(r.fileBytes / 1024).toFixed(1)}KB
                      </TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-xs">
                        {isForgetFormat(r.format) ? (() => {
                          // Friendly one-liner for forget rows so admins
                          // scanning the audit table can see "cleared
                          // INV-123 (was QBO #456)" at a glance instead of
                          // a raw JSON dump. Falls back to JSON if any of
                          // the snapshotted scope fields are missing
                          // (legacy/unexpected payload shapes).
                          const f = readForgetScope(r.scope);
                          if (!f.invoiceNumber) return JSON.stringify(r.scope);
                          return (
                            <span
                              className="font-sans"
                              data-testid={`text-audit-forget-summary-${r.id}`}
                            >
                              {t("reports.audit.row.forgetSummary", {
                                invoiceNumber: f.invoiceNumber,
                                externalId:
                                  f.externalInvoiceId ?? "—",
                              })}
                            </span>
                          );
                        })() : JSON.stringify(r.scope)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {hasDetails ? (
                          <button
                            type="button"
                            className="inline-flex flex-wrap items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                            onClick={() => setDetailRow(r)}
                            data-testid={`link-audit-details-${r.id}`}
                          >
                            <span>{t("reports.audit.details.view")}</span>
                            {failedCount > 0 && (
                              <Badge
                                variant="destructive"
                                data-testid={`badge-audit-failed-${r.id}`}
                              >
                                {t("reports.push.failedBadge", {
                                  count: failedCount,
                                })}
                              </Badge>
                            )}
                            {reconciliationCount > 0 && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                                data-testid={`badge-audit-reconciliation-${r.id}`}
                              >
                                {t("reports.push.reconciliationBadge", {
                                  count: reconciliationCount,
                                })}
                              </Badge>
                            )}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("reports.audit.details.none")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {/* Pagination row. Always visible when there are any rows so admins
         *  see the total count and current page even on a single page. */}
        {!err && rows && totalRows > 0 && (
          <div
            className="mt-3 flex items-center gap-2"
            data-testid="row-audit-pagination"
          >
            <PillButton
              type="button"
              color="image"
              onClick={() => {
                setAnchorWarning(null);
                setCurrentAnchorId(null);
                setPage((p) => Math.max(1, p - 1));
              }}
              disabled={loading || page <= 1}
              data-testid="button-audit-prev-page"
            >
              {t("reports.audit.pagination.prev")}
            </PillButton>
            <PillButton
              type="button"
              color="image"
              onClick={() => {
                setAnchorWarning(null);
                setCurrentAnchorId(null);
                setPage((p) => Math.min(totalPages, p + 1));
              }}
              disabled={loading || page >= totalPages}
              data-testid="button-audit-next-page"
            >
              {t("reports.audit.pagination.next")}
            </PillButton>
            <span
              className="text-xs text-muted-foreground"
              data-testid="text-audit-pagination-summary"
            >
              {loading
                ? t("reports.audit.pagination.loading")
                : t("reports.audit.pagination.summary", {
                    page,
                    totalPages,
                    totalRows,
                  })}
            </span>
            <GoToPageForm
              totalPages={totalPages}
              disabled={loading}
              onGo={(target) => {
                setAnchorWarning(null);
                setPage(target);
              }}
              testIdPrefix="audit"
              className="ml-2 flex items-center gap-2"
            />
          </div>
        )}
      </CardContent>
      <AuditDetailDialog
        row={detailRow}
        retriedByAuditIds={
          detailRow ? (retriedByMap.get(detailRow.id) ?? []) : []
        }
        open={detailRow !== null}
        onOpenChange={(o) => {
          if (!o) setDetailRow(null);
        }}
        rowsById={rowsById}
        inWindowIds={knownIds}
        onJumpToRow={jumpFromDialog}
      />
    </Card>
  );
}

interface QbExportCardProps {
  vendorId: number;
}

interface ConnectionView {
  id: number;
  vendorId: number;
  provider: "qbo" | "oa";
  realmId: string | null;
  displayName: string | null;
  hasRefreshToken: boolean;
  accessTokenExpiresAt: string | null;
  status: "active" | "expired" | "revoked";
  apiBaseUrl: string | null;
  scopes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PushResult {
  ok: boolean;
  period: string;
  /** id of the audit_log row created for this push (used by retry). */
  auditLogId: number | null;
  /** id of the audit row this push was a retry of, if any. */
  retriedFromAuditId: number | null;
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
  /** Customers/vendors that already existed in the remote and were
   *  re-used instead of being created. */
  customersAlreadyExisted: number;
  vendorsAlreadyExisted: number;
  /** Invoices skipped because they were already pushed in a previous sync. */
  invoicesAlreadyUpToDate: number;
  warnings: PushWarning[];
}

interface PushState {
  provider: "qbo" | "oa";
  result: PushResult;
  /** Set when the most recent run was a retry — distinguishes the summary
   *  text shown above the warnings list. */
  wasRetry: boolean;
}

/** Inline result panel rendered after a QuickBooks/OpenAccountant push.
 *  Shows the summary line, the per-row warnings list, and a retry button
 *  when the push had any warnings. */
export function PushResultPanel({
  state,
  retrying,
  onRetry,
  vendorId,
}: {
  state: PushState;
  retrying: boolean;
  onRetry: () => void;
  /** Vendor whose books were pushed to. Used to resolve invoice-number →
   *  invoice-id for reconciliation deep-links. */
  vendorId: number;
}): ReactElement {
  const { t } = useTranslation();
  const copy = useCopyWarnings();
  const { result, wasRetry } = state;
  const warnCount = result.warnings.length;
  const { failed, reconciliationStateAggregates, reconciliationOther } =
    partitionWarnings(result.warnings);
  // Period bounds parsed from the server-formatted label, used to
  // deep-link state badges into Sales-Tax-by-State scoped to the same
  // period the push reconciled.
  const { periodStart: pushPeriodStart, periodEnd: pushPeriodEnd } = useMemo(
    () => parsePushPeriodLabel(result.period),
    [result.period],
  );
  const failedCount = failed.length;
  const reconciliationCount =
    reconciliationStateAggregates.length + reconciliationOther.length;
  const tArgs = {
    customersCreated: result.customersCreated,
    vendorsCreated: result.vendorsCreated,
    invoicesCreated: result.invoicesCreated,
    customersAlreadyExisted: result.customersAlreadyExisted,
    vendorsAlreadyExisted: result.vendorsAlreadyExisted,
    invoicesAlreadyUpToDate: result.invoicesAlreadyUpToDate,
    warnings: warnCount,
    period: result.period,
  };
  const summary = wasRetry
    ? t("reports.push.retrySuccess", tArgs)
    : t("reports.push.summary", tArgs);
  // Color the summary line by severity: clean → emerald, reconciliation
  // only → amber (numbers drifted but QBO accepted everything),
  // anything actually failed → destructive.
  const summaryClass =
    warnCount === 0
      ? "text-xs text-emerald-700"
      : failedCount === 0
        ? "text-xs text-amber-800 dark:text-amber-300"
        : "text-xs text-destructive";
  return (
    <div className="space-y-2">
      <p className={summaryClass} data-testid="text-push-result">
        {summary}
      </p>
      {failedCount > 0 && (
        <div className="space-y-2 rounded-md border border-destructive/30 p-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-semibold text-destructive">
              {t("reports.push.warningsHeading", { count: failedCount })}
            </p>
            <div className="flex items-center gap-2">
              <PillButton
                color="image"
                onClick={() =>
                  void copy(
                    formatPushWarningsForCopy(result.warnings),
                    t("reports.push.copyLabel.all"),
                  )
                }
                data-testid="button-push-copy-warnings"
              >
                <Copy className="h-3 w-3 mr-1" />
                {t("reports.push.copyAll")}
              </PillButton>
              {result.auditLogId !== null && (
                <PillButton
                  color="image"
                  disabled={retrying}
                  onClick={onRetry}
                  data-testid="button-push-retry"
                >
                  {retrying ? t("reports.push.retrying") : t("reports.push.retry")}
                </PillButton>
              )}
            </div>
          </div>
          <div
            className="max-h-56 overflow-y-auto"
            data-testid="list-push-warnings"
          >
            <Table>
              <TableBody>
                {failed.map((w, i) => (
                  <TableRow key={i} data-testid={`row-push-warning-${i}`}>
                    <TableCell className="text-xs w-20 align-top">
                      {t(`reports.push.warningKind.${w.kind}`)}
                    </TableCell>
                    <TableCell className="text-xs font-mono w-40 align-top break-all">
                      {w.identifier}
                    </TableCell>
                    <TableCell className="text-xs align-top">
                      {w.message}
                    </TableCell>
                    <TableCell className="w-8 align-top">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t("reports.push.copyRow")}
                        title={t("reports.push.copyRow")}
                        onClick={() =>
                          void copy(
                            formatPushWarningLine(w),
                            t("reports.push.copyLabel.row"),
                          )
                        }
                        data-testid={`button-push-copy-warning-${i}`}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {reconciliationCount > 0 && (
        <div
          className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50/40 p-2 dark:bg-amber-950/20"
          data-testid="section-push-reconciliation"
        >
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            {t("reports.push.reconciliationHeading", {
              count: reconciliationCount,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              state.provider === "oa"
                ? "reports.push.reconciliationDescription_oa"
                : "reports.push.reconciliationDescription",
            )}
          </p>
          {reconciliationOther.length > 0 && (
            <div
              className="max-h-56 overflow-y-auto rounded-md border border-amber-500/30 bg-background"
              data-testid="list-push-reconciliation-other"
            >
              <Table>
                <TableBody>
                  {reconciliationOther.map((w, i) => (
                    <TableRow
                      key={i}
                      data-testid={`row-push-reconciliation-${i}`}
                    >
                      <TableCell className="text-xs w-40 align-top break-all">
                        <ReconciliationInvoiceCell
                          warning={w}
                          vendorId={vendorId}
                          testId={`link-push-reconciliation-invoice-${i}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-amber-900 dark:text-amber-200 align-top">
                        {w.message}
                      </TableCell>
                      <TableCell className="text-xs w-44 align-top">
                        <ReconciliationRePushControl
                          warning={w}
                          vendorId={vendorId}
                          provider={state.provider}
                          testId={`button-push-reconciliation-repush-${i}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {reconciliationStateAggregates.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                {t("reports.push.reconciliationStateGroupHeading")} (
                {reconciliationStateAggregates.length})
              </p>
              <div
                className="max-h-56 overflow-y-auto rounded-md border border-amber-500/30 bg-background"
                data-testid="list-push-reconciliation-states"
              >
                <Table>
                  <TableBody>
                    {reconciliationStateAggregates.map((w, i) => (
                      <TableRow
                        key={i}
                        data-testid={`row-push-reconciliation-state-${i}`}
                      >
                        <TableCell className="text-xs w-20 align-top">
                          <ReconciliationStateBadgeCell
                            warning={w}
                            periodStart={pushPeriodStart}
                            periodEnd={pushPeriodEnd}
                            testId={`link-push-reconciliation-state-${i}`}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-amber-900 dark:text-amber-200 align-top">
                          {w.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Prepare QuickBooks Items (admin-triggered cache warm-up) ──────
//
// Lets a vendor admin pre-create the per-line-type Product/Service rows
// in QBO from the Reports / Accounting Connections card, instead of
// paying that cost lazily on the first invoice push (and getting any
// per-line failure mid-push). The result table renders one row per
// MAPPABLE line type with a status of existing / created / failed.

interface PrepareItemRow {
  lineType: string;
  label: string;
  accountName: string | null;
  accountNumber: string | null;
  status: "existing" | "created" | "failed";
  qboItemId: string | null;
  qboAccountId: string | null;
  message: string | null;
}

interface PrepareItemsResponse {
  ok: boolean;
  environment: "production" | "sandbox";
  counts: { existing: number; created: number; failed: number };
  items: PrepareItemRow[];
}

function PrepareQboItemsPanel({
  vendorId,
  disabled,
}: {
  vendorId: number;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PrepareItemsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPrepare = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/reports/vendor/${vendorId}/quickbooks/prepare-items`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const j = (await res.json().catch(() => ({}))) as
        | (PrepareItemsResponse & { error?: string })
        | { error?: string };
      if (!res.ok) {
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setResult(j as PrepareItemsResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="section-prepare-qbo-items"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {t("reports.prepareItems.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("reports.prepareItems.description")}
          </p>
        </div>
        <PillButton
          color="image"
          onClick={() => void onPrepare()}
          disabled={disabled || running}
          data-testid="button-prepare-qbo-items"
        >
          {running && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {running
            ? t("reports.prepareItems.preparing")
            : t("reports.prepareItems.prepare")}
        </PillButton>
      </div>
      {error && (
        <p
          className="text-xs text-destructive"
          data-testid="text-prepare-qbo-items-error"
        >
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2">
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-prepare-qbo-items-summary"
          >
            {t("reports.prepareItems.summary", {
              existing: result.counts.existing,
              created: result.counts.created,
              failed: result.counts.failed,
            })}
          </p>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">
                    {t("reports.prepareItems.col.lineType")}
                  </TableHead>
                  <TableHead className="text-xs">
                    {t("reports.prepareItems.col.account")}
                  </TableHead>
                  <TableHead className="text-xs">
                    {t("reports.prepareItems.col.status")}
                  </TableHead>
                  <TableHead className="text-xs">
                    {t("reports.prepareItems.col.detail")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((it) => (
                  <TableRow
                    key={it.lineType}
                    data-testid={`row-prepare-qbo-item-${it.lineType}`}
                  >
                    <TableCell className="text-xs">{it.label}</TableCell>
                    <TableCell className="text-xs">
                      {it.accountName ?? "—"}
                      {it.accountNumber ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({it.accountNumber})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge
                        variant={
                          it.status === "failed"
                            ? "destructive"
                            : it.status === "created"
                              ? "default"
                              : "secondary"
                        }
                        data-testid={`badge-prepare-qbo-item-status-${it.lineType}`}
                      >
                        {t(`reports.prepareItems.status.${it.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {it.status === "failed"
                        ? (it.message ?? "—")
                        : it.qboItemId
                          ? t("reports.prepareItems.itemId", {
                              id: it.qboItemId,
                            })
                          : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Hook: load + manage accounting connections for a vendor. */
function useAccountingConnections(vendorId: number): {
  connections: ConnectionView[];
  loading: boolean;
  reload: () => void;
  remove: (id: number) => Promise<void>;
} {
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${API_BASE}/api/accounting/connections?vendorId=${vendorId}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((j) => {
        if (active) setConnections(j.connections ?? []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [vendorId, tick]);
  // Listen for the popup-postMessage from the OAuth callback page.
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (
        e.data &&
        typeof e.data === "object" &&
        (e.data as { type?: string }).type === "vndrly.accounting.connected"
      ) {
        setTick((n) => n + 1);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const remove = async (id: number) => {
    await fetch(
      `${API_BASE}/api/accounting/connections/${id}?vendorId=${vendorId}`,
      { method: "DELETE", credentials: "include" },
    );
    setTick((n) => n + 1);
  };
  return { connections, loading, reload: () => setTick((n) => n + 1), remove };
}

interface OaConnectDialogProps {
  vendorId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function OaConnectDialog({
  vendorId,
  open,
  onOpenChange,
  onSaved,
}: OaConnectDialogProps): ReactElement {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onSubmit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/accounting/oa/connect-api-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            vendorId,
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setApiKey("");
      setBaseUrl("");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-oa-connect">
        <DialogHeader>
          <DialogTitle>
            {t("reports.openaccountant.apiKeyTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("reports.openaccountant.apiKeyDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* Mirrors the QBO connect screen: tells operators that 1099
           *  income categories ride along with each invoice line so they
           *  know vendor 1099 totals will match what they'd get from the
           *  OA CSV import. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-oa-1099-note"
          >
            {t("reports.openaccountant.income1099Note")}
          </p>
          <div className="space-y-1">
            <Label htmlFor="oa-api-key">
              {t("reports.openaccountant.apiKeyLabel")}
            </Label>
            <Input
              id="oa-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="input-oa-api-key"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="oa-base-url">
              {t("reports.openaccountant.baseUrlLabel")}
            </Label>
            <Input
              id="oa-base-url"
              type="url"
              placeholder="https://api.openaccountant.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              data-testid="input-oa-base-url"
            />
          </div>
          {err && (
            <p className="text-sm text-destructive" data-testid="text-oa-error">
              {err}
            </p>
          )}
        </div>
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </PillButton>
          <PillButton
            color="blue"
            onClick={onSubmit}
            disabled={saving || apiKey.trim().length < 8}
            data-testid="button-oa-save"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t("reports.openaccountant.save")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface QbItemMapRow {
  lineType: string;
  label: string;
  desiredAccountName: string;
  desiredAccountNumber: string;
  qboItemId: string | null;
  qboAccountId: string | null;
  qboAccountName: string | null;
  updatedAt: string | null;
  stale: boolean;
}

function QbItemMapTable({ vendorId }: { vendorId: number }): ReactElement {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rows, setRows] = useState<QbItemMapRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(
    async (mode: "load" | "refresh") => {
      const setBusy = mode === "refresh" ? setRefreshing : setLoading;
      setBusy(true);
      setError(null);
      try {
        const url =
          mode === "refresh"
            ? `${API_BASE}/api/reports/vendor/${vendorId}/quickbooks/item-map/refresh`
            : `${API_BASE}/api/reports/vendor/${vendorId}/quickbooks/item-map`;
        const r = await fetch(url, {
          method: mode === "refresh" ? "POST" : "GET",
          credentials: "include",
        });
        const body = (await r.json().catch(() => ({}))) as {
          rows?: QbItemMapRow[];
          error?: string;
          code?: string;
        };
        if (!r.ok) {
          const msg = translateApiError(
            { data: { code: body.code, message: body.error } },
            t,
            body.error ?? t("reports.quickbooks.itemMap.refresh"),
          );
          setError(msg);
          if (mode === "refresh") {
            toast({ title: msg, variant: "destructive" });
          }
          return;
        }
        setRows(body.rows ?? []);
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        if (mode === "refresh") {
          toast({ title: msg, variant: "destructive" });
        }
      } finally {
        setBusy(false);
      }
    },
    [vendorId, t, toast],
  );

  useEffect(() => {
    void fetchRows("load");
  }, [fetchRows]);

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold">
            {t("reports.quickbooks.itemMap.title")}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t("reports.quickbooks.itemMap.description")}
          </p>
        </div>
        <PillButton
          type="button"
          color="image"
          onClick={() => void fetchRows("refresh")}
          disabled={refreshing || loading}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">
            {t("reports.quickbooks.itemMap.refresh")}
          </span>
        </PillButton>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {loading && !rows && (
        <p className="text-xs text-muted-foreground">
          {t("reports.quickbooks.itemMap.loading")}
        </p>
      )}
      {rows && rows.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">
          {t("reports.quickbooks.itemMap.empty")}
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("reports.quickbooks.itemMap.col.lineType")}
                </TableHead>
                <TableHead>
                  {t("reports.quickbooks.itemMap.col.desiredAccount")}
                </TableHead>
                <TableHead>
                  {t("reports.quickbooks.itemMap.col.qboItem")}
                </TableHead>
                <TableHead>
                  {t("reports.quickbooks.itemMap.col.qboAccount")}
                </TableHead>
                <TableHead>
                  {t("reports.quickbooks.itemMap.col.updatedAt")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.lineType}
                  className={
                    row.stale ? "bg-amber-50 dark:bg-amber-950/30" : undefined
                  }
                >
                  <TableCell className="font-medium">
                    <div>{row.label}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {row.lineType}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{row.desiredAccountName}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {row.desiredAccountNumber}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.qboItemId ?? (
                      <span className="text-muted-foreground italic">
                        {t("reports.quickbooks.itemMap.notResolved")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.qboAccountId ? (
                      <div>
                        <div>
                          {row.qboAccountName ?? (
                            <span className="text-muted-foreground italic">
                              {t("reports.quickbooks.itemMap.unknownAccountName")}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-muted-foreground">
                          {row.qboAccountId}
                        </div>
                        {row.stale && (
                          <Badge variant="outline" className="mt-1 border-amber-500 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t("reports.quickbooks.itemMap.stale")}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">
                        {t("reports.quickbooks.itemMap.notResolved")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.updatedAt
                      ? new Date(row.updatedAt).toLocaleString()
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function QbExportCard({ vendorId }: QbExportCardProps): ReactElement {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<PeriodSelection>(defaultPeriod());
  const base = `/api/reports/vendor/${vendorId}`;
  const canDownload =
    period.preset !== "custom" ||
    Boolean(period.customStart && period.customEnd);
  // Memoized so consumers (notably the preview dialog's useEffect) get a
  // stable reference between renders and don't re-fetch on every keystroke.
  const params = useMemo(() => periodParams(period), [period]);
  // Inline running totals for the currently selected period. Debounced so
  // typing into the custom-date inputs doesn't fire a request per
  // keystroke. Reads the lightweight `/quickbooks-export-summary`
  // endpoint (single SQL aggregate) — the heavyweight preview endpoint
  // is reserved for the dialog. `paramsKey` is a serialized snapshot of
  // the current period so changing presets / dates re-triggers the
  // effect even when `params` retains the same identity.
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  const [summary, setSummary] = useState<{
    invoiceCount: number;
    totalAmount: string;
  } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  useEffect(() => {
    if (!canDownload) {
      setSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSummaryLoading(true);
    const handle = window.setTimeout(() => {
      const url = buildUrl(`${base}/quickbooks-export-summary`, params);
      fetch(url, { credentials: "include", signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(j.error ?? `HTTP ${r.status}`);
          }
          return (await r.json()) as {
            invoiceCount: number;
            totalAmount: string;
          };
        })
        .then((j) => {
          if (cancelled) return;
          setSummary({
            invoiceCount: j.invoiceCount,
            totalAmount: j.totalAmount,
          });
          setSummaryError(null);
        })
        .catch((e: Error) => {
          if (cancelled || e.name === "AbortError") return;
          setSummaryError(e.message);
          setSummary(null);
        })
        .finally(() => {
          if (!cancelled) setSummaryLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(handle);
    };
    // paramsKey captures the selection; base and canDownload guard the fetch.
  }, [base, canDownload, params, paramsKey]);
  const guard = (e: React.MouseEvent) => {
    if (!canDownload) e.preventDefault();
  };
  const [previewFormat, setPreviewFormat] = useState<"iif" | "zip" | null>(
    null,
  );

  const { connections, loading, reload, remove } =
    useAccountingConnections(vendorId);
  const qbo = connections.find((c) => c.provider === "qbo") ?? null;
  const oa = connections.find((c) => c.provider === "oa") ?? null;
  const [oaOpen, setOaOpen] = useState(false);
  const [pushing, setPushing] = useState<"qbo" | "oa" | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // Vendor-level toggle: when ON, vendor admins receive an email digest
  // after a push that produced any per-row warnings. PATCH /vendors/:id is
  // role-gated upstream; toast surfaces failures so the user knows the
  // setting didn't stick.
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const vendorQuery = useGetVendor(vendorId);
  const notifyEnabled =
    vendorQuery.data?.accountingFailureNotificationsEnabled ?? true;
  // Reconciliation drift notifications are a separate opt-in (default
  // false on the server) so existing vendors aren't surprised by new
  // emails on the first push after the feature lands.
  const notifyReconciliationEnabled =
    vendorQuery.data?.accountingReconciliationNotificationsEnabled ?? false;
  // Task #368 — vendors who opted into reconciliation alerts can pick
  // between one email per push (legacy) and one weekly recap.
  const reconciliationCadence: "per_push" | "weekly_recap" =
    vendorQuery.data?.accountingReconciliationDigestCadence === "weekly_recap"
      ? "weekly_recap"
      : "per_push";
  const updateVendor = useUpdateVendor({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: vendorQuery.queryKey });
      },
      onError: (err: unknown) => {
        toast({
          title: translateApiError(err, t, t("reports.push.notifyAdmins.saveError")),
          variant: "destructive",
        });
      },
    },
  });
  const onToggleNotify = (next: boolean): void => {
    updateVendor.mutate({
      id: vendorId,
      data: { accountingFailureNotificationsEnabled: next },
    });
  };
  const onToggleNotifyReconciliation = (next: boolean): void => {
    updateVendor.mutate({
      id: vendorId,
      data: { accountingReconciliationNotificationsEnabled: next },
    });
  };
  const onChangeReconciliationCadence = (
    next: "per_push" | "weekly_recap",
  ): void => {
    updateVendor.mutate({
      id: vendorId,
      data: { accountingReconciliationDigestCadence: next },
    });
  };

  const openConnectPopup = (provider: "qbo" | "oa"): void => {
    const w = window.open(
      `${API_BASE}/api/accounting/${provider}/connect?vendorId=${vendorId}`,
      `${provider}-connect`,
      "width=720,height=820",
    );
    if (!w) {
      setPushError(t("reports.quickbooks.popupBlocked"));
      return;
    }
    // The popup posts back to us via window.opener.postMessage; the
    // useAccountingConnections hook listens for that and reloads.
  };
  const connectQbo = (): void => openConnectPopup("qbo");
  const connectOa = (): void => openConnectPopup("oa");

  const doPush = async (
    provider: "qbo" | "oa",
    opts: { retryFromAuditId?: number } = {},
  ): Promise<void> => {
    setPushing(provider);
    setPushError(null);
    try {
      const path =
        provider === "qbo" ? "quickbooks-push" : "openaccountant-push";
      const url = buildUrl(`${base}/${path}`, params);
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          opts.retryFromAuditId !== undefined
            ? { retryFromAuditId: opts.retryFromAuditId }
            : {},
        ),
      });
      const j = (await res.json().catch(() => ({}))) as
        | (PushResult & { error?: string })
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          (j as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      const r = j as PushResult;
      setPushState({
        provider,
        result: r,
        wasRetry: opts.retryFromAuditId !== undefined,
      });
    } catch (e) {
      setPushError((e as Error).message);
    } finally {
      setPushing(null);
    }
  };

  const onRetry = (): void => {
    if (!pushState || pushState.result.auditLogId == null) return;
    void doPush(pushState.provider, {
      retryFromAuditId: pushState.result.auditLogId,
    });
  };

  function ConnectionStatus({
    label,
    conn,
  }: {
    label: string;
    conn: ConnectionView | null;
  }): ReactElement {
    if (loading) {
      return (
        <span className="text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />
          {t("common.loading")}
        </span>
      );
    }
    if (!conn) {
      return (
        <span
          className="text-xs text-muted-foreground inline-flex items-center"
          data-testid={`status-${label.toLowerCase()}-disconnected`}
        >
          <CloudOff className="h-3 w-3 mr-1" />
          {t("reports.connection.notConnected")}
        </span>
      );
    }
    return (
      <span
        className="text-xs text-emerald-600 inline-flex items-center"
        data-testid={`status-${label.toLowerCase()}-connected`}
      >
        <Cloud className="h-3 w-3 mr-1" />
        {t("reports.connection.connected", {
          name: conn.displayName ?? label,
        })}
      </span>
    );
  }

  return (
    <Card data-testid="card-quickbooks">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>{t("reports.quickbooks.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("reports.quickbooks.description")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <PeriodControls value={period} onChange={setPeriod} />
            {/* Inline running-total chip — debounced fetch so users can
             *  pick the right range without opening the preview dialog
             *  to discover the period is empty. Hidden when the custom
             *  range is incomplete (the "needs both dates" helper text
             *  in the manual-download section already covers that). */}
            {canDownload && (
              <p
                className="text-xs text-muted-foreground min-h-[1rem]"
                data-testid="text-qb-export-summary"
                aria-live="polite"
              >
                {summaryError ? (
                  <span className="text-destructive">
                    {t("reports.quickbooks.summary.error")}
                  </span>
                ) : summaryLoading && !summary ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("reports.quickbooks.summary.loading")}
                  </span>
                ) : summary ? (
                  summary.invoiceCount === 0 ? (
                    t("reports.quickbooks.summary.empty")
                  ) : (
                    t("reports.quickbooks.summary.totals", {
                      count: summary.invoiceCount,
                      amount: formatMoney(summary.totalAmount),
                    })
                  )
                ) : null}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live API push section */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t("reports.push.sectionTitle")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("reports.push.sectionDescription")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <TogglePillButton
                color="green"

                className="px-3 gap-2"
                onClick={() => doPush("qbo")}
                disabled={!qbo || !canDownload || pushing !== null}
                data-testid="button-push-qbo"
              >
                {pushing === "qbo" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4" />
                )}
                {t("reports.push.qbo")}
              </TogglePillButton>
              {!qbo ? (
                <TogglePillButton
                  color="blue"

                  className="px-3"
                  onClick={connectQbo}
                  data-testid="button-connect-qbo"
                >
                  {t("reports.connection.connectQbo")}
                </TogglePillButton>
              ) : (
                <TogglePillButton
                  color="red"

                  className="px-3"
                  onClick={() => void remove(qbo.id)}
                  data-testid="button-disconnect-qbo"
                >
                  {t("reports.connection.disconnect")}
                </TogglePillButton>
              )}
              <ConnectionStatus label="QBO" conn={qbo} />
            </div>

            <div className="flex items-center gap-2">
              <TogglePillButton
                color="green"

                className="px-3 gap-2"
                onClick={() => doPush("oa")}
                disabled={!oa || !canDownload || pushing !== null}
                data-testid="button-push-oa"
              >
                {pushing === "oa" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4" />
                )}
                {t("reports.push.oa")}
              </TogglePillButton>
              {!oa ? (
                <>
                  <TogglePillButton
                    color="blue"

                    className="px-3"
                    onClick={connectOa}
                    data-testid="button-connect-oa"
                  >
                    {t("reports.connection.connectOa")}
                  </TogglePillButton>
                  <button
                    type="button"
                    onClick={() => setOaOpen(true)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    data-testid="button-connect-oa-api-key"
                  >
                    {t("reports.openaccountant.useApiKey")}
                  </button>
                </>
              ) : (
                <TogglePillButton
                  color="red"

                  className="px-3"
                  onClick={() => void remove(oa.id)}
                  data-testid="button-disconnect-oa"
                >
                  {t("reports.connection.disconnect")}
                </TogglePillButton>
              )}
              <ConnectionStatus label="OA" conn={oa} />
            </div>
          </div>

          {oa && (() => {
            // Task #248 — surface stale / revoked OA credentials inline
            // so vendors don't discover the breakage at month-end.
            // Mirrors the daily reminder worker's heuristic so a banner
            // appearing here predicts an email + in-app reminder will
            // also fire on the worker's next tick:
            //   • revoked        — connection was rejected on refresh.
            //   • expiring_soon  — access token expires within 7 days
            //                      AND no refresh in the last 7 days
            //                      (a healthy connection would have
            //                      bumped updated_at on the last push).
            const EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
            const STALE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
            const nowMs = Date.now();
            const expiresAt = oa.accessTokenExpiresAt
              ? new Date(oa.accessTokenExpiresAt).getTime()
              : null;
            const updatedAt = oa.updatedAt
              ? new Date(oa.updatedAt).getTime()
              : null;
            const isRevoked = oa.status === "revoked";
            const isExpiringSoon =
              !isRevoked &&
              oa.status === "active" &&
              expiresAt !== null &&
              expiresAt <= nowMs + EXPIRING_SOON_WINDOW_MS &&
              updatedAt !== null &&
              updatedAt < nowMs - STALE_REFRESH_MS;
            if (!isRevoked && !isExpiringSoon) return null;
            const variantClass = isRevoked
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700";
            return (
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${variantClass}`}
                data-testid={
                  isRevoked
                    ? "banner-oa-revoked"
                    : "banner-oa-expiring"
                }
                role="alert"
              >
                <CloudOff className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">
                    {isRevoked
                      ? t("reports.openaccountant.banner.revokedTitle")
                      : t("reports.openaccountant.banner.expiringTitle")}
                  </p>
                  <p>
                    {isRevoked
                      ? t("reports.openaccountant.banner.revokedBody")
                      : t("reports.openaccountant.banner.expiringBody")}
                  </p>
                </div>
              </div>
            );
          })()}
          {pushError && (
            <p
              className="text-xs text-destructive"
              data-testid="text-push-error"
            >
              {pushError}
            </p>
          )}
          {pushState && (
            <PushResultPanel
              state={pushState}
              retrying={pushing !== null}
              onRetry={onRetry}
              vendorId={vendorId}
            />
          )}

          {qbo && (
            <>
              <PrepareQboItemsPanel
                vendorId={vendorId}
                disabled={pushing !== null}
              />
              <QbItemMapTable vendorId={vendorId} />
            </>
          )}

          <div className="flex items-start justify-between gap-3 pt-2 border-t">
            <div className="space-y-0.5">
              <Label
                htmlFor="toggle-notify-admins"
                className="text-xs font-medium"
              >
                {t("reports.push.notifyAdmins.label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("reports.push.notifyAdmins.description")}
              </p>
            </div>
            <Switch
              id="toggle-notify-admins"
              checked={notifyEnabled}
              disabled={vendorQuery.isLoading || updateVendor.isPending}
              onCheckedChange={onToggleNotify}
              className="data-[state=checked]:bg-[var(--brand-primary)]"
              data-testid="toggle-notify-admins"
            />
          </div>
          {/* Reconciliation drift is a separate, opt-in alert: a push that
           *  posted every row but where the post-push reconciler found
           *  total or per-state tax drift (silent until somebody opens the
           *  Reports page). Default OFF on the server so existing vendors
           *  aren't surprised by new emails. */}
          <div className="flex items-start justify-between gap-3 pt-2">
            <div className="space-y-0.5">
              <Label
                htmlFor="toggle-notify-reconciliation"
                className="text-xs font-medium"
              >
                {t("reports.push.notifyReconciliation.label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("reports.push.notifyReconciliation.description")}
              </p>
            </div>
            <Switch
              id="toggle-notify-reconciliation"
              checked={notifyReconciliationEnabled}
              disabled={vendorQuery.isLoading || updateVendor.isPending}
              onCheckedChange={onToggleNotifyReconciliation}
              className="data-[state=checked]:bg-[var(--brand-primary)]"
              data-testid="toggle-notify-reconciliation"
            />
          </div>
          {/* Task #368 — cadence selector. Only meaningful when the
           *  reconciliation toggle above is on, but we render it
           *  disabled rather than hidden so admins can preview the
           *  option while the toggle is off. */}
          {notifyReconciliationEnabled ? (
            <div className="flex flex-col gap-2 pt-2 pl-1 border-l-2 border-muted-foreground/15 ml-1 pl-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">
                  {t("reports.push.notifyReconciliation.cadenceLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("reports.push.notifyReconciliation.cadenceDescription")}
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label={t(
                  "reports.push.notifyReconciliation.cadenceLabel",
                )}
                className="flex flex-col gap-1.5"
              >
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="reconciliation-cadence"
                    value="per_push"
                    checked={reconciliationCadence === "per_push"}
                    disabled={
                      vendorQuery.isLoading || updateVendor.isPending
                    }
                    onChange={() => onChangeReconciliationCadence("per_push")}
                    data-testid="radio-reconciliation-cadence-per-push"
                  />
                  {t("reports.push.notifyReconciliation.cadencePerPush")}
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="reconciliation-cadence"
                    value="weekly_recap"
                    checked={reconciliationCadence === "weekly_recap"}
                    disabled={
                      vendorQuery.isLoading || updateVendor.isPending
                    }
                    onChange={() =>
                      onChangeReconciliationCadence("weekly_recap")
                    }
                    data-testid="radio-reconciliation-cadence-weekly-recap"
                  />
                  {t("reports.push.notifyReconciliation.cadenceWeeklyRecap")}
                </label>
              </div>
            </div>
          ) : null}
        </div>

        {/* Manual download section (legacy fallbacks) */}
        <div className="flex flex-wrap gap-2">
          <TogglePillButton
            color="green"

            className="px-3 gap-2"
            data-testid="link-download-iif"
            disabled={!canDownload}
            onClick={() => setPreviewFormat("iif")}
          >
            <Package className="h-4 w-4" />
            {t("reports.quickbooks.iif")}
          </TogglePillButton>
          <TogglePillButton
            color="green"

            className="px-3 gap-2"
            data-testid="link-download-qbo-zip"
            disabled={!canDownload}
            onClick={() => setPreviewFormat("zip")}
          >
            <Package className="h-4 w-4" />
            {t("reports.quickbooks.qboZip")}
          </TogglePillButton>
          <a
            href={buildUrl(`${base}/openaccountant-export`, params)}
            download
            onClick={guard}
            aria-disabled={!canDownload}
            className="inline-flex"
          >
            <TogglePillButton
              color="green"

              className="px-3 gap-2"
              data-testid="link-download-oa-zip"
              disabled={!canDownload}
            >
              <Package className="h-4 w-4" />
              {t("reports.openaccountant.zip")}
            </TogglePillButton>
          </a>
        </div>
        <QbExportPreviewDialog
          open={previewFormat !== null}
          onOpenChange={(next) => {
            if (!next) setPreviewFormat(null);
          }}
          vendorId={vendorId}
          format={previewFormat}
          params={params}
          downloadUrl={
            previewFormat
              ? buildUrl(`${base}/quickbooks-export`, {
                  ...params,
                  format: previewFormat,
                })
              : ""
          }
        />
        {!canDownload && (
          <p className="text-sm text-muted-foreground mt-2">
            {t("reports.preset.customHelper")}
          </p>
        )}

        <OaConnectDialog
          vendorId={vendorId}
          open={oaOpen}
          onOpenChange={setOaOpen}
          onSaved={reload}
        />
      </CardContent>
    </Card>
  );
}

// ── QuickBooks export preview dialog ─────────────────────────────

interface QbExportPreviewContributingInvoice {
  id: number | null;
  invoiceNumber: string;
  amount: string;
}

interface QbExportPreviewAccount {
  name: string;
  number: string;
  qbType: string;
  kind: "income" | "ar" | "tax" | "other";
  rowCount: number;
  amount: string;
  invoices: QbExportPreviewContributingInvoice[];
}

interface QbExportPreviewSampleInvoice {
  id: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  partnerName: string;
  lineCount: number;
  subtotal: string;
  taxTotal: string;
  total: string;
}

interface QbExportPreviewData {
  format: "iif" | "zip";
  period: { start: string; end: string; label: string; display: string };
  vendorName: string;
  totals: {
    invoices: number;
    invoicesWithLines: number;
    customers: number;
    vendors: number;
    subtotal: string;
    taxTotal: string;
    totalAmount: string;
  };
  accounts: QbExportPreviewAccount[];
  sampleInvoices: QbExportPreviewSampleInvoice[];
  sampleInvoicesShown: number;
  sampleInvoicesTotal: number;
}

interface QbExportPreviewDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  vendorId: number;
  format: "iif" | "zip" | null;
  params: Record<string, string>;
  downloadUrl: string;
}

function formatMoney(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPreviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function QbExportPreviewDialog({
  open,
  onOpenChange,
  vendorId,
  format,
  params,
  downloadUrl,
}: QbExportPreviewDialogProps): ReactElement {
  const { t } = useTranslation();
  const [data, setData] = useState<QbExportPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Per-account expansion state. Keys match `${kind}-${name}` so they
  // remain stable across re-renders. Reset whenever the dialog
  // re-fetches so accounts that disappear from the new payload don't
  // leave stale entries hanging around.
  const [expandedAccountKeys, setExpandedAccountKeys] = useState<
    Set<string>
  >(() => new Set());
  const toggleAccountExpanded = useCallback((key: string): void => {
    setExpandedAccountKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Fetch the preview JSON whenever the dialog opens for a given format /
  // period combination. We deliberately re-fetch on every open so the
  // preview always reflects the user's most recent period selection.
  useEffect(() => {
    if (!open || !format) {
      setData(null);
      setErr(null);
      return;
    }
    let active = true;
    setLoading(true);
    setErr(null);
    setData(null);
    setExpandedAccountKeys(new Set());
    const url = buildUrl(
      `/api/reports/vendor/${vendorId}/quickbooks-export-preview`,
      { ...params, format },
    );
    fetch(url, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        return (await r.json()) as QbExportPreviewData;
      })
      .then((j) => {
        if (active) setData(j);
      })
      .catch((e: Error) => {
        if (active) setErr(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, format, vendorId, params]);

  const handleDownload = (): void => {
    if (!downloadUrl) return;
    // Trigger the browser download by clicking a hidden anchor — keeps
    // the dialog open momentarily so the user can see the request fire,
    // then closes it. We don't navigate away from the page.
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onOpenChange(false);
  };

  const formatLabel =
    format === "iif"
      ? t("reports.quickbooks.iif")
      : format === "zip"
        ? t("reports.quickbooks.qboZip")
        : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        data-testid="dialog-qb-export-preview"
      >
        <DialogHeader>
          <DialogTitle>
            {t("reports.quickbooks.preview.title", { format: formatLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("reports.quickbooks.preview.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {loading && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-preview-loading"
            >
              <Loader2 className="h-4 w-4 inline mr-1 animate-spin" />
              {t("common.loading")}
            </p>
          )}
          {err && (
            <p
              className="text-sm text-destructive"
              data-testid="text-qb-preview-error"
            >
              {err}
            </p>
          )}
          {data && (
            <>
              <div
                className="rounded-md border p-3 space-y-1 text-sm"
                data-testid="section-qb-preview-summary"
              >
                <div className="font-medium">
                  {t("reports.quickbooks.preview.periodLabel", {
                    period: data.period.display,
                  })}
                </div>
                <div className="text-muted-foreground">
                  {t("reports.quickbooks.preview.vendorLabel", {
                    name: data.vendorName,
                  })}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                  <div data-testid="text-preview-invoice-count">
                    <div className="text-xs text-muted-foreground">
                      {t("reports.quickbooks.preview.totalInvoices")}
                    </div>
                    <div className="text-base font-semibold">
                      {data.totals.invoices}
                    </div>
                  </div>
                  <div data-testid="text-preview-customer-count">
                    <div className="text-xs text-muted-foreground">
                      {t("reports.quickbooks.preview.totalCustomers")}
                    </div>
                    <div className="text-base font-semibold">
                      {data.totals.customers}
                    </div>
                  </div>
                  <div data-testid="text-preview-vendor-count">
                    <div className="text-xs text-muted-foreground">
                      {t("reports.quickbooks.preview.totalVendors")}
                    </div>
                    <div className="text-base font-semibold">
                      {data.totals.vendors}
                    </div>
                  </div>
                  <div data-testid="text-preview-total-amount">
                    <div className="text-xs text-muted-foreground">
                      {t("reports.quickbooks.preview.totalAmount")}
                    </div>
                    <div className="text-base font-semibold">
                      {formatMoney(data.totals.totalAmount)}
                    </div>
                  </div>
                </div>
              </div>

              {data.totals.invoices === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-preview-empty"
                >
                  {t("reports.quickbooks.preview.empty")}
                </p>
              ) : (
                <>
                  <div data-testid="section-qb-preview-accounts">
                    <h4 className="text-sm font-semibold mb-1">
                      {t("reports.quickbooks.preview.accountsHeading")}
                    </h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("reports.quickbooks.preview.accountsHint")}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            {t("reports.quickbooks.preview.col.account")}
                          </TableHead>
                          <TableHead>
                            {t("reports.quickbooks.preview.col.kind")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("reports.quickbooks.preview.col.rows")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("reports.quickbooks.preview.col.amount")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.accounts.map((a) => {
                          const key = `${a.kind}-${a.name}`;
                          const isExpanded = expandedAccountKeys.has(key);
                          const hasInvoices = a.invoices.length > 0;
                          return (
                            <Fragment key={key}>
                              <TableRow
                                data-testid={`row-preview-account-${a.kind}-${a.name.replace(/\s+/g, "-")}`}
                              >
                                <TableCell>
                                  <div className="flex items-start gap-1">
                                    {hasInvoices && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleAccountExpanded(key)
                                        }
                                        className="text-muted-foreground hover:text-foreground mt-0.5"
                                        aria-label={
                                          isExpanded
                                            ? t(
                                                "reports.quickbooks.preview.collapseInvoices",
                                              )
                                            : t(
                                                "reports.quickbooks.preview.expandInvoices",
                                              )
                                        }
                                        data-testid={`button-toggle-account-${a.kind}-${a.name.replace(/\s+/g, "-")}`}
                                      >
                                        {isExpanded ? (
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        ) : (
                                          <ChevronRight className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    )}
                                    <div>
                                      <div className="font-medium">
                                        {a.name}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {a.number} · {a.qbType}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  {t(
                                    `reports.quickbooks.preview.kind.${a.kind}`,
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {a.rowCount}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatMoney(a.amount)}
                                </TableCell>
                              </TableRow>
                              {isExpanded && hasInvoices && (
                                <TableRow
                                  data-testid={`row-preview-account-invoices-${a.kind}-${a.name.replace(/\s+/g, "-")}`}
                                >
                                  <TableCell colSpan={4} className="bg-muted/30">
                                    <div className="text-xs text-muted-foreground mb-1">
                                      {t(
                                        "reports.quickbooks.preview.contributingInvoices",
                                        { count: a.invoices.length },
                                      )}
                                    </div>
                                    <ul className="space-y-1">
                                      {a.invoices.map((inv) => (
                                        <li
                                          key={inv.invoiceNumber}
                                          className="flex items-center justify-between gap-2 text-xs"
                                        >
                                          {inv.id !== null ? (
                                            <a
                                              href={`${API_BASE}/invoices/${inv.id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                                              data-testid={`link-account-invoice-${a.kind}-${inv.invoiceNumber}`}
                                            >
                                              {inv.invoiceNumber}
                                              <ExternalLink className="h-3 w-3" />
                                            </a>
                                          ) : (
                                            <span className="font-mono">
                                              {inv.invoiceNumber}
                                            </span>
                                          )}
                                          <span className="font-mono">
                                            {formatMoney(inv.amount)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div data-testid="section-qb-preview-invoices">
                    <h4 className="text-sm font-semibold mb-1">
                      {t("reports.quickbooks.preview.sampleHeading", {
                        shown: data.sampleInvoicesShown,
                        total: data.sampleInvoicesTotal,
                      })}
                    </h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            {t("reports.quickbooks.preview.col.invoice")}
                          </TableHead>
                          <TableHead>
                            {t("reports.quickbooks.preview.col.date")}
                          </TableHead>
                          <TableHead>
                            {t("reports.quickbooks.preview.col.customer")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("reports.quickbooks.preview.col.lines")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("reports.quickbooks.preview.col.invoiceTotal")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.sampleInvoices.map((inv) => (
                          <TableRow
                            key={inv.invoiceNumber}
                            data-testid={`row-preview-invoice-${inv.invoiceNumber}`}
                          >
                            <TableCell className="font-mono text-xs">
                              {inv.id !== null ? (
                                <a
                                  href={`${API_BASE}/invoices/${inv.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline inline-flex items-center gap-1"
                                  data-testid={`link-preview-invoice-${inv.invoiceNumber}`}
                                >
                                  {inv.invoiceNumber}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                inv.invoiceNumber
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {formatPreviewDate(inv.invoiceDate)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {inv.partnerName}
                            </TableCell>
                            <TableCell className="text-right">
                              {inv.lineCount}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatMoney(inv.total)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {data.sampleInvoicesTotal >
                      data.sampleInvoicesShown && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("reports.quickbooks.preview.moreInvoices", {
                          count:
                            data.sampleInvoicesTotal -
                            data.sampleInvoicesShown,
                        })}
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            data-testid="button-qb-preview-cancel"
          >
            {t("reports.quickbooks.preview.cancel")}
          </PillButton>
          <PillButton
            color="image"
            onClick={handleDownload}
            disabled={!data || loading || (data?.totals.invoices ?? 0) === 0}
            data-testid="button-qb-preview-download"
          >
            <Download className="h-4 w-4 mr-1" />
            {t("reports.quickbooks.preview.download")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── per-role sections ────────────────────────────────────────────

function VendorReports({
  vendorId,
  deepLink,
}: {
  vendorId: number;
  deepLink?: ReportDeepLink | null;
}): ReactElement {
  const { t } = useTranslation();
  const base = `/api/reports/vendor/${vendorId}`;
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t("reports.section.vendor")}</h2>
      <ReportCard
        icon={Clock}
        title={t("reports.aging.title")}
        description={t("reports.aging.descriptionVendor")}
        apiPath={`${base}/aging`}
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "partnerName", label: t("reports.col.partner") },
            { key: "current", label: t("reports.col.current"), align: "right" },
            { key: "bucket1_15", label: "1-15", align: "right" },
            { key: "bucket16_30", label: "16-30", align: "right" },
            { key: "bucket31_60", label: "31-60", align: "right" },
            { key: "bucket60_plus", label: "60+", align: "right" },
            { key: "total", label: t("reports.col.total"), align: "right" },
          ])
        }
      />
      <ReportCard
        icon={TrendingUp}
        title={t("reports.revenueBreakdown.title")}
        description={t("reports.revenueBreakdown.description")}
        apiPath={`${base}/revenue-by-partner`}
        hasPeriod
        renderPreview={(d) => {
          const data = d as { rows?: Array<Record<string, unknown>> };
          const rows = data?.rows ?? [];
          return (
            <>
              <ReportChart
                rows={rows}
                spec={{ labelKey: "partnerName", valueKey: "total" }}
              />
              {renderTable(d as never, [
                { key: "partnerName", label: t("reports.col.partner") },
                {
                  key: "invoiceCount",
                  label: t("reports.col.invoices"),
                  align: "right",
                },
                { key: "subtotal", label: t("reports.col.subtotal"), align: "right" },
                { key: "taxTotal", label: t("reports.col.tax"), align: "right" },
                { key: "total", label: t("reports.col.total"), align: "right" },
              ])}
            </>
          );
        }}
        groups={[
          {
            value: "partner",
            label: t("reports.groupBy.partner"),
            apiPath: `${base}/revenue-by-partner`,
            renderPreview: (d) => {
              const data = d as { rows?: Array<Record<string, unknown>> };
              const rows = data?.rows ?? [];
              return (
                <>
                  <ReportChart
                    rows={rows}
                    spec={{ labelKey: "partnerName", valueKey: "total" }}
                  />
                  {renderTable(d as never, [
                    { key: "partnerName", label: t("reports.col.partner") },
                    {
                      key: "invoiceCount",
                      label: t("reports.col.invoices"),
                      align: "right",
                    },
                    {
                      key: "subtotal",
                      label: t("reports.col.subtotal"),
                      align: "right",
                    },
                    { key: "taxTotal", label: t("reports.col.tax"), align: "right" },
                    { key: "total", label: t("reports.col.total"), align: "right" },
                  ])}
                </>
              );
            },
          },
          {
            value: "workType",
            label: t("reports.groupBy.workType"),
            apiPath: `${base}/revenue-by-work-type`,
            renderPreview: (d) => {
              const data = d as { rows?: Array<Record<string, unknown>> };
              const rows = data?.rows ?? [];
              return (
                <>
                  <ReportChart
                    rows={rows}
                    spec={{ labelKey: "workTypeName", valueKey: "amount" }}
                  />
                  {renderTable(d as never, [
                    { key: "workTypeName", label: t("reports.col.workType") },
                    {
                      key: "lineCount",
                      label: t("reports.col.lines"),
                      align: "right",
                    },
                    { key: "amount", label: t("reports.col.amount"), align: "right" },
                  ])}
                </>
              );
            },
          },
          {
            value: "afe",
            label: t("reports.groupBy.afe"),
            apiPath: `${base}/revenue-by-afe`,
            renderPreview: (d) => {
              const data = d as { rows?: Array<Record<string, unknown>> };
              const rows = data?.rows ?? [];
              return (
                <>
                  <ReportChart
                    rows={rows}
                    spec={{ labelKey: "afe", valueKey: "amount" }}
                  />
                  {renderTable(d as never, [
                    { key: "afe", label: "AFE" },
                    {
                      key: "lineCount",
                      label: t("reports.col.lines"),
                      align: "right",
                    },
                    { key: "amount", label: t("reports.col.amount"), align: "right" },
                  ])}
                </>
              );
            },
          },
        ]}
      />
      <ReportCard
        icon={Percent}
        title={t("reports.salesTax.title")}
        description={t("reports.salesTax.descriptionVendor")}
        apiPath={`${base}/sales-tax`}
        hasPeriod
        cardId="salesTaxByState"
        deepLink={deepLink}
        renderPreview={(d) =>
          renderTable(
            d as never,
            [
              { key: "state", label: t("reports.col.state") },
              {
                key: "taxableSales",
                label: t("reports.col.taxableSales"),
                align: "right",
              },
              {
                key: "exemptSales",
                label: t("reports.col.exemptSales"),
                align: "right",
              },
              {
                key: "taxCollected",
                label: t("reports.col.taxCollected"),
                align: "right",
              },
              {
                key: "effectiveRate",
                label: t("reports.col.effRate"),
                align: "right",
              },
            ],
            deepLink?.cardId === "salesTaxByState" && deepLink.highlightKey
              ? {
                  match: (r) =>
                    typeof r.state === "string" &&
                    r.state.toUpperCase() ===
                      deepLink.highlightKey!.toUpperCase(),
                  testId: "row-sales-tax-state-highlight",
                  className:
                    "bg-amber-50/60 ring-1 ring-inset ring-amber-400/60 dark:bg-amber-950/30",
                  filterToMatch: true,
                }
              : undefined,
          )
        }
      />
      <ReportCard
        icon={Users}
        title={t("reports.crewCost.title")}
        description={t("reports.crewCost.description")}
        apiPath={`${base}/crew-cost`}
        hasPeriod
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "employeeName", label: t("reports.col.employee") },
            { key: "hours", label: t("reports.col.hours"), align: "right" },
            { key: "cost", label: t("reports.col.cost"), align: "right" },
            { key: "billed", label: t("reports.col.billed"), align: "right" },
            { key: "margin", label: t("reports.col.margin"), align: "right" },
          ])
        }
      />
      <ReportCard
        icon={FileText}
        title={t("reports.nec1099.titleVendor")}
        description={t("reports.nec1099.descriptionVendor")}
        apiPath={`${base}/1099-nec`}
        hasYear
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "payerPartnerName", label: t("reports.col.payerPartner") },
            { key: "vendorName", label: t("reports.col.recipient") },
            { key: "federalTaxId", label: "TIN/EIN" },
            { key: "totalPaid", label: "Box 1 NEC", align: "right" },
            {
              key: "sharedEinWarning",
              label: t("reports.col.einWarning"),
              align: "right",
            },
          ])
        }
      />
      <ReportCard
        icon={FileText}
        title={t("reports.misc1099.titleVendor")}
        description={t("reports.misc1099.descriptionVendor")}
        apiPath={`${base}/1099-misc`}
        hasYear
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "payerPartnerName", label: t("reports.col.payerPartner") },
            { key: "vendorName", label: t("reports.col.recipient") },
            { key: "box1Rents", label: "Box 1 Rents", align: "right" },
            { key: "box2Royalties", label: "Box 2 Royalties", align: "right" },
            { key: "box3OtherIncome", label: "Box 3 Other", align: "right" },
            { key: "box6MedicalHealth", label: "Box 6 Medical", align: "right" },
            { key: "box10Attorney", label: "Box 10 Attorney", align: "right" },
            { key: "totalReportable", label: t("reports.col.total"), align: "right" },
          ])
        }
      />
      <ReportCard
        icon={CreditCard}
        title={t("reports.k1099.titleVendor")}
        description={t("reports.k1099.descriptionVendor")}
        apiPath={`${base}/1099-k`}
        hasYear
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "payerPartnerName", label: t("reports.col.payerPartner") },
            { key: "vendorName", label: t("reports.col.recipient") },
            { key: "grossAmount", label: "Box 1a Gross", align: "right" },
            { key: "transactionCount", label: "Box 3 Txns", align: "right" },
          ])
        }
      />
      <ReportCard
        icon={ListChecks}
        title={t("reports.categoryAudit.titleVendor")}
        description={t("reports.categoryAudit.description")}
        apiPath={`${base}/1099-category-audit`}
        renderPreview={(d) => {
          const data = d as {
            rows?: Array<Record<string, unknown>>;
            summary?: { totalAmount?: string };
          };
          const rows = data?.rows ?? [];
          if (rows.length === 0) {
            return (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-categoryaudit-empty"
              >
                {t("reports.categoryAudit.empty")}
              </p>
            );
          }
          return (
            <>
              <p
                className="text-xs text-muted-foreground mb-2"
                data-testid="text-categoryaudit-summary"
              >
                {t("reports.categoryAudit.summary", {
                  count: rows.length,
                  total: data.summary?.totalAmount ?? "0.00",
                })}
              </p>
              {renderTable(rows as never, [
                {
                  key: "invoiceNumber",
                  label: t("reports.col.invoiceNumber"),
                },
                { key: "partnerName", label: t("reports.col.partner") },
                { key: "lineType", label: t("reports.col.lineType") },
                {
                  key: "incomeCategory",
                  label: t("reports.col.incomeCategory"),
                },
                { key: "amount", label: t("reports.col.amount"), align: "right" },
              ])}
            </>
          );
        }}
      />
      <EDeliveryConsentCard vendorId={vendorId} />
      <QbExportCard vendorId={vendorId} />
    </div>
  );
}

function PartnerReports({
  partnerId,
  deepLink,
}: {
  partnerId: number;
  deepLink?: ReportDeepLink | null;
}): ReactElement {
  const { t } = useTranslation();
  const base = `/api/reports/partner/${partnerId}`;
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t("reports.section.partner")}</h2>
      <ReportCard
        icon={Clock}
        title={t("reports.aging.titleAp")}
        description={t("reports.aging.descriptionPartner")}
        apiPath={`${base}/aging`}
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "vendorName", label: t("reports.col.vendor") },
            { key: "current", label: t("reports.col.current"), align: "right" },
            { key: "bucket1_15", label: "1-15", align: "right" },
            { key: "bucket16_30", label: "16-30", align: "right" },
            { key: "bucket31_60", label: "31-60", align: "right" },
            { key: "bucket60_plus", label: "60+", align: "right" },
            { key: "total", label: t("reports.col.total"), align: "right" },
          ])
        }
      />
      <ReportCard
        icon={TrendingDown}
        title={t("reports.spendBreakdown.title")}
        description={t("reports.spendBreakdown.description")}
        apiPath={`${base}/spend-by-vendor`}
        hasPeriod
        renderPreview={(d) => {
          const data = d as { rows?: Array<Record<string, unknown>> };
          const rows = data?.rows ?? [];
          return (
            <>
              <ReportChart
                rows={rows}
                spec={{ labelKey: "vendorName", valueKey: "total" }}
              />
              {renderTable(d as never, [
                { key: "vendorName", label: t("reports.col.vendor") },
                {
                  key: "invoiceCount",
                  label: t("reports.col.invoices"),
                  align: "right",
                },
                { key: "subtotal", label: t("reports.col.subtotal"), align: "right" },
                { key: "taxTotal", label: t("reports.col.tax"), align: "right" },
                { key: "total", label: t("reports.col.total"), align: "right" },
              ])}
            </>
          );
        }}
        groups={[
          {
            value: "vendor",
            label: t("reports.groupBy.vendor"),
            apiPath: `${base}/spend-by-vendor`,
            renderPreview: (d) => {
              const data = d as { rows?: Array<Record<string, unknown>> };
              const rows = data?.rows ?? [];
              return (
                <>
                  <ReportChart
                    rows={rows}
                    spec={{ labelKey: "vendorName", valueKey: "total" }}
                  />
                  {renderTable(d as never, [
                    { key: "vendorName", label: t("reports.col.vendor") },
                    {
                      key: "invoiceCount",
                      label: t("reports.col.invoices"),
                      align: "right",
                    },
                    {
                      key: "subtotal",
                      label: t("reports.col.subtotal"),
                      align: "right",
                    },
                    { key: "taxTotal", label: t("reports.col.tax"), align: "right" },
                    { key: "total", label: t("reports.col.total"), align: "right" },
                  ])}
                </>
              );
            },
          },
          {
            value: "workType",
            label: t("reports.groupBy.workType"),
            apiPath: `${base}/spend-by-work-type`,
            renderPreview: (d) => {
              const data = d as { rows?: Array<Record<string, unknown>> };
              const rows = data?.rows ?? [];
              return (
                <>
                  <ReportChart
                    rows={rows}
                    spec={{ labelKey: "workTypeName", valueKey: "amount" }}
                  />
                  {renderTable(d as never, [
                    { key: "workTypeName", label: t("reports.col.workType") },
                    {
                      key: "lineCount",
                      label: t("reports.col.lines"),
                      align: "right",
                    },
                    { key: "amount", label: t("reports.col.amount"), align: "right" },
                  ])}
                </>
              );
            },
          },
          {
            value: "afe",
            label: t("reports.groupBy.afe"),
            apiPath: `${base}/spend-by-afe`,
            renderPreview: (d) => {
              const data = d as { rows?: Array<Record<string, unknown>> };
              const rows = data?.rows ?? [];
              return (
                <>
                  <ReportChart
                    rows={rows}
                    spec={{ labelKey: "afe", valueKey: "amount" }}
                  />
                  {renderTable(d as never, [
                    { key: "afe", label: "AFE" },
                    {
                      key: "lineCount",
                      label: t("reports.col.lines"),
                      align: "right",
                    },
                    { key: "amount", label: t("reports.col.amount"), align: "right" },
                  ])}
                </>
              );
            },
          },
        ]}
      />
      <ReportCard
        icon={Percent}
        title={t("reports.salesTax.titlePaid")}
        description={t("reports.salesTax.descriptionPartner")}
        apiPath={`${base}/sales-tax`}
        hasPeriod
        cardId="salesTaxByState"
        deepLink={deepLink}
        renderPreview={(d) =>
          renderTable(
            d as never,
            [
              { key: "state", label: t("reports.col.state") },
              {
                key: "taxableSales",
                label: t("reports.col.taxableSpend"),
                align: "right",
              },
              {
                key: "exemptSales",
                label: t("reports.col.exemptSpend"),
                align: "right",
              },
              {
                key: "taxCollected",
                label: t("reports.col.taxPaid"),
                align: "right",
              },
              {
                key: "effectiveRate",
                label: t("reports.col.effRate"),
                align: "right",
              },
            ],
            deepLink?.cardId === "salesTaxByState" && deepLink.highlightKey
              ? {
                  match: (r) =>
                    typeof r.state === "string" &&
                    r.state.toUpperCase() ===
                      deepLink.highlightKey!.toUpperCase(),
                  testId: "row-sales-tax-state-highlight",
                  className:
                    "bg-amber-50/60 ring-1 ring-inset ring-amber-400/60 dark:bg-amber-950/30",
                  filterToMatch: true,
                }
              : undefined,
          )
        }
      />
      <ReportCard
        icon={FileText}
        title={t("reports.nec1099.titlePartner")}
        description={t("reports.nec1099.descriptionPartner")}
        apiPath={`${base}/1099-worksheet`}
        hasYear
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "vendorName", label: t("reports.col.recipient") },
            { key: "federalTaxId", label: "TIN/EIN" },
            { key: "totalPaid", label: "Box 1 NEC", align: "right" },
            {
              key: "sharedEinWarning",
              label: t("reports.col.einWarning"),
              align: "right",
            },
          ])
        }
      />
      <ReportCard
        icon={FileText}
        title={t("reports.misc1099.titlePartner")}
        description={t("reports.misc1099.descriptionPartner")}
        apiPath={`${base}/1099-misc`}
        hasYear
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "vendorName", label: t("reports.col.recipient") },
            { key: "federalTaxId", label: "TIN/EIN" },
            { key: "box1Rents", label: "Box 1 Rents", align: "right" },
            { key: "box2Royalties", label: "Box 2 Royalties", align: "right" },
            { key: "box6MedicalHealth", label: "Box 6 Medical", align: "right" },
            { key: "box10Attorney", label: "Box 10 Attorney", align: "right" },
            { key: "totalReportable", label: t("reports.col.total"), align: "right" },
          ])
        }
      />
      <ReportCard
        icon={CreditCard}
        title={t("reports.k1099.titlePartner")}
        description={t("reports.k1099.descriptionPartner")}
        apiPath={`${base}/1099-k`}
        hasYear
        renderPreview={(d) =>
          renderTable(d as never, [
            { key: "vendorName", label: t("reports.col.recipient") },
            { key: "federalTaxId", label: "TIN/EIN" },
            { key: "grossAmount", label: "Box 1a Gross", align: "right" },
            { key: "transactionCount", label: "Box 3 Txns", align: "right" },
          ])
        }
      />
      <ReportCard
        icon={ListChecks}
        title={t("reports.categoryAudit.titlePartner")}
        description={t("reports.categoryAudit.description")}
        apiPath={`${base}/1099-category-audit`}
        renderPreview={(d) => {
          const data = d as {
            rows?: Array<Record<string, unknown>>;
            summary?: { totalAmount?: string };
          };
          const rows = data?.rows ?? [];
          if (rows.length === 0) {
            return (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-categoryaudit-empty-partner"
              >
                {t("reports.categoryAudit.empty")}
              </p>
            );
          }
          return (
            <>
              <p
                className="text-xs text-muted-foreground mb-2"
                data-testid="text-categoryaudit-summary-partner"
              >
                {t("reports.categoryAudit.summary", {
                  count: rows.length,
                  total: data.summary?.totalAmount ?? "0.00",
                })}
              </p>
              {renderTable(rows as never, [
                {
                  key: "invoiceNumber",
                  label: t("reports.col.invoiceNumber"),
                },
                { key: "vendorName", label: t("reports.col.vendor") },
                { key: "lineType", label: t("reports.col.lineType") },
                {
                  key: "incomeCategory",
                  label: t("reports.col.incomeCategory"),
                },
                { key: "amount", label: t("reports.col.amount"), align: "right" },
              ])}
            </>
          );
        }}
      />
      <Dashboard1099Card scope={`partner/${partnerId}`} />
      <FireExportCard scope={`partner/${partnerId}`} />
    </div>
  );
}

function AdminReports({
  deepLink,
}: {
  deepLink?: ReportDeepLink | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t("reports.section.admin")}</h2>
      <ReportCard
        icon={Percent}
        title={t("reports.adminSalesTax.title")}
        description={t("reports.adminSalesTax.description")}
        apiPath="/api/reports/admin/sales-tax"
        hasPeriod
        cardId="salesTaxByState"
        deepLink={deepLink}
        renderPreview={(d) =>
          renderTable(
            d as never,
            [
              { key: "state", label: t("reports.col.state") },
              {
                key: "taxableSales",
                label: t("reports.col.taxableSales"),
                align: "right",
              },
              {
                key: "exemptSales",
                label: t("reports.col.exemptSales"),
                align: "right",
              },
              {
                key: "taxCollected",
                label: t("reports.col.taxCollected"),
                align: "right",
              },
              {
                key: "effectiveRate",
                label: t("reports.col.effRate"),
                align: "right",
              },
            ],
            deepLink?.cardId === "salesTaxByState" && deepLink.highlightKey
              ? {
                  match: (r) =>
                    typeof r.state === "string" &&
                    r.state.toUpperCase() ===
                      deepLink.highlightKey!.toUpperCase(),
                  testId: "row-sales-tax-state-highlight",
                  className:
                    "bg-amber-50/60 ring-1 ring-inset ring-amber-400/60 dark:bg-amber-950/30",
                  filterToMatch: true,
                }
              : undefined,
          )
        }
      />
      <QbAccountMappingCard />
      <QbAccountMappingAuditCard />
      <Dashboard1099Card scope="admin" />
      <CategoryChangeLogCard />
      <FireExportCard scope="admin" />
      <AuditCard />
    </div>
  );
}

// "Show recent category changes" — surfaces the new
// `invoice_line_category_audit` table on the 1099 dashboard so an
// accountant can answer "who flipped these lines and when?". Filters
// mirror the audit endpoint: vendorId narrows the feed to one vendor,
// year bounds by createdAt. Rendered as a thin card on the admin
// reports page next to the other 1099 cards.
function CategoryChangeLogCard(): ReactElement {
  const { t } = useTranslation();
  type AuditRow = {
    id: number;
    batchId: string;
    action: "bulk_set" | "undo" | "vendor_recategorize";
    invoiceId: number | null;
    invoiceNumber: string | null;
    lineId: number | null;
    vendorId: number | null;
    vendorName: string | null;
    partnerId: number | null;
    partnerName: string | null;
    priorIncomeCategory: string;
    priorIsManualOverride: boolean;
    newIncomeCategory: string;
    newIsManualOverride: boolean;
    actorUserId: number | null;
    actorRole: string;
    actorDisplayName: string | null;
    actorUsername: string | null;
    createdAt: string;
  };
  const [vendorIdInput, setVendorIdInput] = useState("");
  const [yearInput, setYearInput] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<{
    vendorId?: string;
    year?: string;
  }>({});
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (appliedFilter.vendorId) params.set("vendorId", appliedFilter.vendorId);
    if (appliedFilter.year) params.set("year", appliedFilter.year);
    params.set("limit", "100");
    fetch(`${API_BASE}/api/invoices/audit/1099-categories?${params.toString()}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { rows: AuditRow[] };
      })
      .then((j) => {
        if (cancelled) return;
        setRows(j.rows ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedFilter]);

  const apply = (): void => {
    setAppliedFilter({
      vendorId: vendorIdInput.trim() || undefined,
      year: yearInput.trim() || undefined,
    });
  };
  const clear = (): void => {
    setVendorIdInput("");
    setYearInput("");
    setAppliedFilter({});
  };

  const actionLabel = (a: AuditRow["action"]): string => {
    if (a === "bulk_set") return t("reports.categoryChangeLog.actionBulkSet");
    if (a === "undo") return t("reports.categoryChangeLog.actionUndo");
    return t("reports.categoryChangeLog.actionVendorRecategorize");
  };

  return (
    <Card data-testid="card-1099-category-change-log">
      <CardHeader>
        <CardTitle>{t("reports.categoryChangeLog.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("reports.categoryChangeLog.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label
              className="text-xs text-muted-foreground"
              htmlFor="catauditlog-vendor"
            >
              {t("reports.categoryChangeLog.filterVendor")}
            </label>
            <Input
              id="catauditlog-vendor"
              type="number"
              min={1}
              value={vendorIdInput}
              onChange={(e) => setVendorIdInput(e.target.value)}
              className="w-32"
              data-testid="input-catauditlog-vendor"
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-xs text-muted-foreground"
              htmlFor="catauditlog-year"
            >
              {t("reports.categoryChangeLog.filterYear")}
            </label>
            <Input
              id="catauditlog-year"
              type="number"
              min={2020}
              max={2100}
              value={yearInput}
              onChange={(e) => setYearInput(e.target.value)}
              className="w-24"
              data-testid="input-catauditlog-year"
            />
          </div>
          <PillButton
            color="blue"
            onClick={apply}
            data-testid="btn-catauditlog-apply"
          >
            {t("reports.categoryChangeLog.apply")}
          </PillButton>
          <PillButton
            color="image"
            onClick={clear}
            data-testid="btn-catauditlog-clear"
          >
            {t("reports.categoryChangeLog.clear")}
          </PillButton>
        </div>
        {err && (
          <p className="text-sm text-destructive" data-testid="text-catauditlog-error">
            {err}
          </p>
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">
            {t("reports.categoryChangeLog.loading")}
          </p>
        )}
        {!loading && rows && rows.length === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-catauditlog-empty"
          >
            {t("reports.categoryChangeLog.empty")}
          </p>
        )}
        {!loading && rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table
              className="w-full text-xs"
              data-testid="table-catauditlog-rows"
            >
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.when")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.actor")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.action")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.vendor")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.invoice")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.line")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.from")}
                  </th>
                  <th className="py-1 pr-2">
                    {t("reports.categoryChangeLog.to")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b align-top"
                    data-testid={`row-catauditlog-${r.id}`}
                  >
                    <td className="py-1 pr-2 whitespace-nowrap tabular-nums">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="py-1 pr-2">
                      {r.actorDisplayName ?? r.actorUsername ?? "—"}
                      <span className="ml-1 text-muted-foreground">
                        ({r.actorRole})
                      </span>
                    </td>
                    <td className="py-1 pr-2">{actionLabel(r.action)}</td>
                    <td className="py-1 pr-2">
                      {r.vendorName ?? (r.vendorId != null ? `#${r.vendorId}` : "—")}
                    </td>
                    <td className="py-1 pr-2">
                      {r.invoiceNumber ?? (r.invoiceId != null ? `#${r.invoiceId}` : "—")}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      {r.lineId != null ? `#${r.lineId}` : "—"}
                    </td>
                    <td className="py-1 pr-2">
                      <span>{r.priorIncomeCategory}</span>{" "}
                      <span className="text-muted-foreground">
                        (
                        {r.priorIsManualOverride
                          ? t("reports.categoryChangeLog.manualBadge")
                          : t("reports.categoryChangeLog.engineBadge")}
                        )
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      <span>{r.newIncomeCategory}</span>{" "}
                      <span className="text-muted-foreground">
                        (
                        {r.newIsManualOverride
                          ? t("reports.categoryChangeLog.manualBadge")
                          : t("reports.categoryChangeLog.engineBadge")}
                        )
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── QuickBooks account mapping (admin settings) ──────────────────

interface QbMappingItem {
  lineType: string;
  label: string;
  defaultAccountName: string;
  defaultAccountNumber: string;
  accountName: string;
  accountNumber: string;
  isOverride: boolean;
  overrideId: number | null;
}

interface QbMappingScope {
  vendorId: number | null;
  partnerId: number | null;
}

interface VendorOption { id: number; name: string }
interface PartnerOption { id: number; name: string }



export function QbAccountMappingCard(): ReactElement {
  const { t } = useTranslation();
  const [scope, setScope] = useState<QbMappingScope>({ vendorId: null, partnerId: null });
  const [items, setItems] = useState<QbMappingItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    upserted: number;
    errors: { rowNumber: number; message: string }[];
  } | null>(null);
  // Preview state for the two-step CSV import flow. Selecting a file
  // first does a dry-run POST so we can render this preview; only an
  // explicit "Apply" click writes anything.
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<CsvPreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Most-recent bulk action that hasn't been undone yet — drives the
  // "Undo last bulk change" banner at the top of the card.
  const [latestAction, setLatestAction] = useState<QbBulkActionRow | null>(
    null,
  );
  // Active undo-retention window in days, sourced from the server so
  // the banner copy reads the env-configured value rather than a
  // hardcoded "90 days".
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Number of bulk actions in the most recent 100 that are still
  // "Active" (not undone, not past their retention window). Surfaced as
  // a badge next to the History trigger so admins notice unfinished
  // cleanup work without opening the dialog. `null` while the first
  // fetch is in flight; rendered as hidden when zero.
  const [activeBulkActionCount, setActiveBulkActionCount] = useState<
    number | null
  >(null);
  // When set, the vendor + partner Selects below the card header are
  // narrowed to just the entities a single bulk action snapshotted, and
  // a clearable "Showing scopes from bulk action #N" chip explains the
  // narrowing. Sourced from the History dialog's "Show in mapping
  // table" jump. Stays null when the user is browsing the full mapping.
  const [bulkActionFilter, setBulkActionFilter] = useState<{
    actionId: number;
    kind: "bulk_apply" | "csv_import";
    vendorIds: number[];
    partnerIds: number[];
    includesGlobalVendor: boolean;
    includesGlobalPartner: boolean;
  } | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  // Live snapshot of how much database space the bulk-action table is
  // currently occupying. Surfaced above the "Clean up old snapshots"
  // button so admins can gauge growth without opening the cleanup
  // preview dialog. Refreshed on mount and whenever the cleanup dialog
  // closes (so the figure tracks any deletions). `null` while the first
  // fetch is in flight; `error` is captured separately so the rest of
  // the card still renders if the storage endpoint is briefly unhappy.
  const [storageStats, setStorageStats] = useState<{
    totalCount: number;
    totalBytes: number;
    pastRetentionCount: number;
    pastRetentionBytes: number;
    retentionDays: number;
  } | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  // Admin-tunable retention dialog. When this dialog saves, the new value
  // also lands in `retentionDays` (via `reloadLatestAction`) so the banner
  // copy reflects the change without a page reload.
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(
    null,
  );
  // Local edits keyed by lineType so we don't write back on every keystroke.
  const [edits, setEdits] = useState<
    Record<string, { accountName: string; accountNumber: string }>
  >({});

  // Fetch vendor + partner option lists once.
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/vendors`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: VendorOption[]) => {
        if (active) setVendors(Array.isArray(j) ? j : []);
      })
      .catch(() => {
        /* admins can manage mapping even if vendor list fails */
      });
    fetch(`${API_BASE}/api/partners`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: PartnerOption[]) => {
        if (active) setPartners(Array.isArray(j) ? j : []);
      })
      .catch(() => {
        /* same */
      });
    return () => {
      active = false;
    };
  }, []);

  const reload = useMemo(
    () => () => {
      const params = new URLSearchParams();
      if (scope.vendorId != null) params.set("vendorId", String(scope.vendorId));
      if (scope.partnerId != null)
        params.set("partnerId", String(scope.partnerId));
      const url = `${API_BASE}/api/reports/qb-account-mapping${
        params.toString() ? `?${params}` : ""
      }`;
      setLoading(true);
      setErr(null);
      fetch(url, { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: { items: QbMappingItem[] }) => {
          setItems(j.items);
          // Reset local edits so the inputs reflect the freshly-loaded values.
          const initial: Record<string, { accountName: string; accountNumber: string }> = {};
          for (const it of j.items) {
            initial[it.lineType] = {
              accountName: it.accountName,
              accountNumber: it.accountNumber,
            };
          }
          setEdits(initial);
        })
        .catch((e: Error) => setErr(e.message))
        .finally(() => setLoading(false));
    },
    [scope.vendorId, scope.partnerId],
  );

  // Pulls the latest non-undone bulk action so the "Undo" banner shows
  // even after a page reload. We only need the most recent row that is
  // still inside the retention window — an expired row would 404 on
  // undo as soon as the cleanup worker ran, so we don't surface it.
  const reloadLatestAction = useMemo(
    () => () => {
      fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions?limit=10`,
        { credentials: "include" },
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: QbBulkActionsResponse) => {
          // Skip rows whose snapshot is past retention. Recomputing
          // from `expiresAt` (rather than the server-supplied
          // `isExpired` flag) keeps the banner in sync if a row aged
          // out between fetches without the page being reloaded.
          const now = Date.now();
          const next =
            j.rows.find(
              (r) =>
                r.undoneAt == null &&
                new Date(r.expiresAt).getTime() > now,
            ) ?? null;
          setLatestAction(next);
          if (typeof j.retentionDays === "number") {
            setRetentionDays(j.retentionDays);
          }
        })
        .catch(() => {
          // Non-fatal: the rest of the card still works without an
          // "Undo" banner.
        });
    },
    [],
  );

  // Pulls the most recent 100 bulk actions and counts how many are
  // still "Active" (not undone and not past their retention window).
  // The same definition the History dialog uses for its Status=Active
  // filter, so the badge matches what admins would see if they opened
  // the dialog. Keeping a separate fetch (rather than reusing
  // `reloadLatestAction`'s limit=10) ensures the count covers the same
  // 100-row window the dialog audits.
  const reloadActiveBulkActionCount = useMemo(
    () => () => {
      fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions?limit=100`,
        { credentials: "include" },
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: QbBulkActionsResponse) => {
          const now = Date.now();
          const rows = Array.isArray(j.rows) ? j.rows : [];
          const count = rows.reduce(
            (acc, r) =>
              r.undoneAt == null &&
              new Date(r.expiresAt).getTime() > now
                ? acc + 1
                : acc,
            0,
          );
          setActiveBulkActionCount(count);
        })
        .catch(() => {
          // Non-fatal: the badge just stays hidden. The rest of the
          // card (and the dialog itself) still works normally.
        });
    },
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    reloadLatestAction();
  }, [reloadLatestAction]);

  useEffect(() => {
    reloadActiveBulkActionCount();
  }, [reloadActiveBulkActionCount]);

  // Live "snapshot footprint" baseline. Cheap server-side aggregate so
  // re-fetching after every cleanup is fine — see the storage endpoint
  // comment in routes/reports.ts.
  const reloadStorageStats = useMemo(
    () => () => {
      fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/storage`,
        { credentials: "include" },
      )
        .then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error ?? `HTTP ${r.status}`);
          }
          return r.json();
        })
        .then((j: {
          totalCount: number;
          totalBytes: number;
          pastRetentionCount: number;
          pastRetentionBytes: number;
          retentionDays: number;
        }) => {
          setStorageStats({
            totalCount: Number(j.totalCount ?? 0),
            totalBytes: Number(j.totalBytes ?? 0),
            pastRetentionCount: Number(j.pastRetentionCount ?? 0),
            pastRetentionBytes: Number(j.pastRetentionBytes ?? 0),
            retentionDays: Number(j.retentionDays ?? 0),
          });
          setStorageError(null);
        })
        .catch((e: unknown) => {
          // Non-fatal — the rest of the card still works without the
          // baseline. Surface the error inline so admins know the
          // figure is stale rather than silently missing.
          setStorageError(e instanceof Error ? e.message : String(e));
        });
    },
    [],
  );

  useEffect(() => {
    reloadStorageStats();
  }, [reloadStorageStats]);

  async function handleUndoLatest(): Promise<void> {
    if (!latestAction) return;
    setUndoing(true);
    setErr(null);
    setUndoMessage(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/${latestAction.id}/undo`,
        { method: "POST", credentials: "include" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setUndoMessage(
        t("reports.qbMapping.undoSuccess", {
          restored: j.restored ?? 0,
          removed: j.removed ?? 0,
        }),
      );
      reload();
      reloadLatestAction();
      reloadActiveBulkActionCount();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUndoing(false);
    }
  }

  async function handleSave(item: QbMappingItem): Promise<void> {
    const edit = edits[item.lineType];
    if (!edit) return;
    setSavingKey(item.lineType);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/reports/qb-account-mapping`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: scope.vendorId,
          partnerId: scope.partnerId,
          lineType: item.lineType,
          accountName: edit.accountName.trim(),
          accountNumber: edit.accountNumber.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  }

  async function handleReset(item: QbMappingItem): Promise<void> {
    if (!item.overrideId) return;
    setSavingKey(item.lineType);
    setErr(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/reports/qb-account-mapping/${item.overrideId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  }

  function rowIsDirty(item: QbMappingItem): boolean {
    const e = edits[item.lineType];
    if (!e) return false;
    return (
      e.accountName.trim() !== item.accountName ||
      (e.accountNumber.trim() || "") !== (item.accountNumber || "")
    );
  }

  function handleExportCsv(): void {
    // Trigger a download via a hidden anchor so the browser uses the
    // server-supplied filename. The endpoint is admin-gated; non-admins
    // can't reach this UI in the first place.
    const url = `${API_BASE}/api/reports/qb-account-mapping/csv`;
    window.location.assign(url);
  }

  // Step 1 of the two-step CSV import: parse + classify on the server
  // without writing. Opens the preview dialog with the row counts and a
  // sample of changes; the user must explicitly click "Apply" to commit.
  async function runPreview(text: string): Promise<void> {
    setPreviewLoading(true);
    setPreviewError(null);
    setErr(null);
    setImportResult(null);
    setUndoMessage(null);
    try {
      const r = await fetch(`${API_BASE}/api/reports/qb-account-mapping/csv`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, dryRun: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setPreview({
        csv: text,
        inserts: Array.isArray(j.inserts) ? j.inserts : [],
        updates: Array.isArray(j.updates) ? j.updates : [],
        unchanged: Array.isArray(j.unchanged) ? j.unchanged : [],
        errors: Array.isArray(j.errors) ? j.errors : [],
        vendorNames:
          j.vendorNames && typeof j.vendorNames === "object"
            ? j.vendorNames
            : {},
        partnerNames:
          j.partnerNames && typeof j.partnerNames === "object"
            ? j.partnerNames
            : {},
      });
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleImportCsv(file: File): Promise<void> {
    setPreview(null);
    try {
      const text = await file.text();
      await runPreview(text);
    } finally {
      // Reset the file input so picking the same file again re-triggers
      // the change handler — important if the user closes the dialog
      // and re-imports the same file.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Step 2 of the two-step flow: actually POST the CSV (no dryRun) so
  // the server writes. We re-use the original CSV text the user picked,
  // not a re-serialised version, so what they see in the preview is
  // exactly what gets applied.
  async function applyPreviewedImport(): Promise<void> {
    if (!preview) return;
    setImporting(true);
    setErr(null);
    setImportResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/reports/qb-account-mapping/csv`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: preview.csv }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setImportResult({
          upserted: typeof j.upserted === "number" ? j.upserted : 0,
          errors: Array.isArray(j.errors) ? j.errors : [],
        });
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setImportResult({
        upserted: typeof j.upserted === "number" ? j.upserted : 0,
        errors: Array.isArray(j.errors) ? j.errors : [],
      });
      setPreview(null);
      reload();
      reloadLatestAction();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function handleBulkApply(args: {
    vendorIds: number[];
    partnerIds: number[];
    lineType: string;
    accountName: string;
    accountNumber: string;
  }): Promise<{ upserted: number; scopes: number }> {
    const r = await fetch(`${API_BASE}/api/reports/qb-account-mapping/bulk`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorIds: args.vendorIds.length > 0 ? args.vendorIds : null,
        partnerIds: args.partnerIds.length > 0 ? args.partnerIds : null,
        items: [
          {
            lineType: args.lineType,
            accountName: args.accountName.trim(),
            accountNumber: args.accountNumber.trim() || null,
          },
        ],
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    const j = (await r.json()) as { upserted: number; scopes: number };
    setUndoMessage(null);
    reload();
    reloadLatestAction();
    return j;
  }

  // Narrow the scope dropdowns to just the entities a single bulk
  // action snapshotted when the "Show in mapping table" filter is
  // applied. Keeps the option ordering stable (alphabetical via the
  // server-supplied vendor/partner lists). When the filter snapshot
  // referenced an id that has since been deleted, the dropdown will
  // simply omit it — the missing scope can still be browsed by
  // clearing the bulk-action filter.
  const visibleVendors = useMemo(() => {
    if (bulkActionFilter == null) return vendors;
    const allowed = new Set(bulkActionFilter.vendorIds);
    return vendors.filter((v) => allowed.has(v.id));
  }, [vendors, bulkActionFilter]);
  const visiblePartners = useMemo(() => {
    if (bulkActionFilter == null) return partners;
    const allowed = new Set(bulkActionFilter.partnerIds);
    return partners.filter((p) => allowed.has(p.id));
  }, [partners, bulkActionFilter]);
  // The mapping table's scope dropdowns include an "All vendors" /
  // "All partners" entry by default. While a bulk-action filter is
  // applied we hide those entries unless the action's snapshot
  // actually touched a global-scoped row, otherwise the dropdown
  // would offer a scope the action never affected.
  const showAllVendorsOption =
    bulkActionFilter == null || bulkActionFilter.includesGlobalVendor;
  const showAllPartnersOption =
    bulkActionFilter == null || bulkActionFilter.includesGlobalPartner;

  // Apply a bulk-action filter sourced from the History dialog. Picks a
  // sensible default scope for the mapping table so the admin lands on
  // an actually-affected (vendor, partner) combo instead of an empty
  // intersection: prefer the only touched id when a single one was
  // snapshotted, otherwise prefer the global "All …" sentinel when the
  // action scoped any row to it, and finally fall back to the first id.
  const applyBulkActionFilter = useCallback(
    (row: QbBulkActionRow): void => {
      const next = {
        actionId: row.id,
        kind: row.kind,
        vendorIds: row.affectedVendorIds,
        partnerIds: row.affectedPartnerIds,
        includesGlobalVendor: row.affectedIncludesGlobalVendor,
        includesGlobalPartner: row.affectedIncludesGlobalPartner,
      };
      setBulkActionFilter(next);
      const pickScope = (
        ids: number[],
        includesGlobal: boolean,
      ): number | null => {
        if (ids.length === 1 && !includesGlobal) return ids[0];
        if (includesGlobal) return null;
        return ids[0] ?? null;
      };
      setScope({
        vendorId: pickScope(next.vendorIds, next.includesGlobalVendor),
        partnerId: pickScope(next.partnerIds, next.includesGlobalPartner),
      });
      setHistoryOpen(false);
    },
    [],
  );

  return (
    <Card data-testid="card-qb-account-mapping">
      <CardHeader>
        <CardTitle>{t("reports.qbMapping.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("reports.qbMapping.description")}
        </p>
        {bulkActionFilter && (
          <div
            className="mt-2 rounded-md border border-sky-300 bg-sky-50 p-2 text-sm flex items-center gap-2 flex-wrap"
            data-testid="banner-bulk-action-filter"
          >
            <ListFilter className="h-4 w-4 text-sky-700" />
            <span
              className="text-sky-900"
              data-testid="text-bulk-action-filter-summary"
            >
              {t(
                "reports.qbMapping.bulkActionFilter.summary",
                {
                  id: bulkActionFilter.actionId,
                  vendors:
                    bulkActionFilter.vendorIds.length +
                    (bulkActionFilter.includesGlobalVendor ? 1 : 0),
                  partners:
                    bulkActionFilter.partnerIds.length +
                    (bulkActionFilter.includesGlobalPartner ? 1 : 0),
                },
              )}
            </span>
            <PillButton
              color="image"
              className="ml-auto"
              onClick={() => setBulkActionFilter(null)}
              data-testid="button-bulk-action-filter-clear"
            >
              <X className="h-4 w-4 mr-1" />
              {t("reports.qbMapping.bulkActionFilter.clear")}
            </PillButton>
          </div>
        )}
        {/*
          Live snapshot footprint baseline. Rendered above the action
          row (which contains the "Clean up old snapshots" button) so
          admins can see how much database space the bulk-action history
          is using right now without opening the cleanup preview dialog.
          Counts and bytes match what the cleanup dialog reports because
          both go through `pg_column_size(snapshots)` server-side.
        */}
        <div
          className="text-sm text-muted-foreground pt-2"
          data-testid="text-bulk-storage"
        >
          {storageError ? (
            <span
              className="text-destructive"
              data-testid="text-bulk-storage-error"
            >
              {t("reports.qbMapping.storage.error", { msg: storageError })}
            </span>
          ) : storageStats == null ? (
            <span data-testid="text-bulk-storage-loading">
              {t("reports.qbMapping.storage.loading")}
            </span>
          ) : storageStats.totalCount === 0 ? (
            <span data-testid="text-bulk-storage-empty">
              {t("reports.qbMapping.storage.empty")}
            </span>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {t("reports.qbMapping.storage.label")}
              </span>{" "}
              <span data-testid="text-bulk-storage-summary">
                {t("reports.qbMapping.storage.summary", {
                  count: storageStats.totalCount,
                  size: formatSnapshotBytes(storageStats.totalBytes),
                })}
              </span>
              {storageStats.pastRetentionCount > 0 && (
                <>
                  {" · "}
                  <span data-testid="text-bulk-storage-past-retention">
                    {t("reports.qbMapping.storage.pastRetention", {
                      count: storageStats.pastRetentionCount,
                      size: formatSnapshotBytes(
                        storageStats.pastRetentionBytes,
                      ),
                      days: storageStats.retentionDays,
                    })}
                  </span>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap pt-2">
          <span className="text-sm text-muted-foreground">
            {t("reports.qbMapping.scopeLabel")}
          </span>
          <Select
            value={scope.vendorId == null ? "all" : String(scope.vendorId)}
            onValueChange={(v) =>
              setScope((s) => ({
                ...s,
                vendorId: v === "all" ? null : Number(v),
              }))
            }
          >
            <SelectTrigger className="w-56" data-testid="select-mapping-vendor">
              <SelectValue placeholder={t("reports.qbMapping.allVendors")} />
            </SelectTrigger>
            <SelectContent>
              {showAllVendorsOption && (
                <SelectItem value="all">{t("reports.qbMapping.allVendors")}</SelectItem>
              )}
              {visibleVendors.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={scope.partnerId == null ? "all" : String(scope.partnerId)}
            onValueChange={(v) =>
              setScope((s) => ({
                ...s,
                partnerId: v === "all" ? null : Number(v),
              }))
            }
          >
            <SelectTrigger className="w-56" data-testid="select-mapping-partner">
              <SelectValue placeholder={t("reports.qbMapping.allPartners")} />
            </SelectTrigger>
            <SelectContent>
              {showAllPartnersOption && (
                <SelectItem value="all">{t("reports.qbMapping.allPartners")}</SelectItem>
              )}
              {visiblePartners.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <PillButton
              color="blue"
              onClick={() => {
                setImportResult(null);
                setBulkOpen(true);
              }}
              data-testid="button-bulk-apply"
            >
              <Layers className="h-4 w-4 mr-1" />
              {t("reports.qbMapping.bulkApply")}
            </PillButton>
            <PillButton
              color="image"
              onClick={() => setHistoryOpen(true)}
              data-testid="button-bulk-history"
            >
              <History className="h-4 w-4 mr-1" />
              {t("reports.qbMapping.history")}
              {activeBulkActionCount != null && activeBulkActionCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-2 px-1.5 py-0 h-5 text-xs"
                  title={t("reports.qbMapping.historyActiveBadgeTooltip", {
                    count: activeBulkActionCount,
                  })}
                  data-testid="badge-bulk-history-active"
                >
                  {t("reports.qbMapping.historyActiveBadge", {
                    count: activeBulkActionCount,
                  })}
                </Badge>
              )}
            </PillButton>
            <PillButton
              color="image"
              onClick={() => {
                setCleanupMessage(null);
                setCleanupOpen(true);
              }}
              data-testid="button-bulk-cleanup"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t("reports.qbMapping.cleanup.button")}
            </PillButton>
            <PillButton
              color="image"
              onClick={() => {
                setRetentionMessage(null);
                setRetentionOpen(true);
              }}
              data-testid="button-bulk-retention"
            >
              <Settings2 className="h-4 w-4 mr-1" />
              {t("reports.qbMapping.retention.button")}
            </PillButton>
            <PillButton
              color="image"
              onClick={handleExportCsv}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-1" />
              {t("reports.qbMapping.exportCsv")}
            </PillButton>
            <PillButton
              color="image"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || previewLoading}
              data-testid="button-import-csv"
            >
              <Upload className="h-4 w-4 mr-1" />
              {previewLoading
                ? t("reports.qbMapping.importPreview.loading")
                : importing
                  ? t("reports.qbMapping.importing")
                  : t("reports.qbMapping.importCsv")}
            </PillButton>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="input-csv-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportCsv(f);
              }}
            />
          </div>
        </div>
        {(latestAction || undoMessage) && (
          <div
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm flex items-center gap-2 flex-wrap"
            data-testid="banner-bulk-undo"
          >
            {latestAction ? (
              <>
                <span className="text-amber-900" data-testid="text-bulk-undo-summary">
                  {t("reports.qbMapping.undoBanner", {
                    summary: latestAction.summary,
                    actor:
                      latestAction.actorDisplayName ??
                      latestAction.actorUsername ??
                      latestAction.actorRole,
                    when: new Date(latestAction.createdAt).toLocaleString(),
                  })}
                </span>
                {retentionDays != null && (
                  <span
                    className="text-xs text-amber-800"
                    data-testid="text-bulk-undo-retention"
                  >
                    {t("reports.qbMapping.undoRetentionBanner", {
                      count: retentionDays,
                    })}
                  </span>
                )}
                <PillButton
                  color="image"
                  className="ml-auto"
                  onClick={() => setHistoryOpen(true)}
                  data-testid="button-banner-view-history"
                >
                  <History className="h-4 w-4 mr-1" />
                  {t("reports.qbMapping.viewHistory")}
                </PillButton>
                <PillButton
                  color="image"
                  disabled={undoing}
                  onClick={handleUndoLatest}
                  data-testid="button-undo-bulk"
                >
                  <Undo2 className="h-4 w-4 mr-1" />
                  {undoing
                    ? t("reports.qbMapping.undoing")
                    : t("reports.qbMapping.undo")}
                </PillButton>
              </>
            ) : (
              <span
                className="text-emerald-700"
                data-testid="text-bulk-undo-message"
              >
                {undoMessage}
              </span>
            )}
          </div>
        )}
        {cleanupMessage && (
          <div
            className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800 flex items-center gap-2"
            data-testid="text-cleanup-banner-message"
          >
            <Trash2 className="h-4 w-4" />
            <span>{cleanupMessage}</span>
            <PillButton
              color="red"
              className="ml-auto"
              onClick={() => setCleanupMessage(null)}
              data-testid="button-cleanup-dismiss"
            >
              {t("reports.qbMapping.cleanup.dismiss")}
            </PillButton>
          </div>
        )}
        {retentionMessage && (
          <div
            className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800 flex items-center gap-2"
            data-testid="text-retention-banner-message"
          >
            <Settings2 className="h-4 w-4" />
            <span>{retentionMessage}</span>
            <PillButton
              color="red"
              className="ml-auto"
              onClick={() => setRetentionMessage(null)}
              data-testid="button-retention-dismiss"
            >
              {t("reports.qbMapping.retention.dismiss")}
            </PillButton>
          </div>
        )}
        {importResult && (
          <div
            className="mt-2 rounded-md border p-2 text-sm"
            data-testid="text-import-result"
          >
            <div>
              {t("reports.qbMapping.importUpserted", {
                count: importResult.upserted,
              })}
            </div>
            {importResult.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-destructive">
                {importResult.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    {t("reports.qbMapping.importRowError", {
                      row: e.rowNumber,
                      msg: e.message,
                    })}
                  </li>
                ))}
                {importResult.errors.length > 10 && (
                  <li>
                    {t("reports.qbMapping.importMoreErrors", {
                      count: importResult.errors.length - 10,
                    })}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {err && (
          <p className="text-sm text-destructive" data-testid="text-mapping-error">
            {err}
          </p>
        )}
        {!loading && items && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.qbMapping.col.lineType")}</TableHead>
                  <TableHead>{t("reports.qbMapping.col.accountName")}</TableHead>
                  <TableHead>{t("reports.qbMapping.col.accountNumber")}</TableHead>
                  <TableHead>{t("reports.qbMapping.col.source")}</TableHead>
                  <TableHead className="text-right">
                    {t("reports.qbMapping.col.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const e = edits[item.lineType] ?? {
                    accountName: item.accountName,
                    accountNumber: item.accountNumber,
                  };
                  const dirty = rowIsDirty(item);
                  const busy = savingKey === item.lineType;
                  return (
                    <TableRow
                      key={item.lineType}
                      data-testid={`row-mapping-${item.lineType}`}
                    >
                      <TableCell>
                        <div className="font-medium">{item.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.defaultAccountName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={e.accountName}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [item.lineType]: {
                                ...e,
                                accountName: ev.target.value,
                              },
                            }))
                          }
                          className="w-56"
                          data-testid={`input-account-name-${item.lineType}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={e.accountNumber}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [item.lineType]: {
                                ...e,
                                accountNumber: ev.target.value,
                              },
                            }))
                          }
                          className="w-28"
                          placeholder={item.defaultAccountNumber}
                          data-testid={`input-account-number-${item.lineType}`}
                        />
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            item.isOverride
                              ? "text-xs font-medium text-amber-600"
                              : "text-xs text-muted-foreground"
                          }
                          data-testid={`text-source-${item.lineType}`}
                        >
                          {item.isOverride
                            ? t("reports.qbMapping.source.override")
                            : t("reports.qbMapping.source.default")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {item.isOverride && (
                            <PillButton
                              color="image"
                              disabled={busy}
                              onClick={() => handleReset(item)}
                              data-testid={`button-reset-${item.lineType}`}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              {t("reports.qbMapping.reset")}
                            </PillButton>
                          )}
                          <PillButton
                            color="blue"
                            disabled={!dirty || busy || !e.accountName.trim()}
                            onClick={() => handleSave(item)}
                            data-testid={`button-save-${item.lineType}`}
                          >
                            <Save className="h-3 w-3 mr-1" />
                            {t("reports.qbMapping.save")}
                          </PillButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <BulkApplyDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        vendors={vendors}
        partners={partners}
        items={items}
        onApply={handleBulkApply}
      />
      <CsvImportPreviewDialog
        open={preview != null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        preview={preview}
        applying={importing}
        revalidating={previewLoading}
        previewError={previewError}
        onApply={applyPreviewedImport}
        onRevalidate={runPreview}
      />
      <BulkActionsHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onAfterUndo={() => {
          // Refresh the editable mapping table + the banner so the
          // card reflects the just-restored values without a manual
          // reload. Also refresh the active-actions badge next to the
          // History trigger so the count drops as undos clear them.
          reload();
          reloadLatestAction();
          reloadActiveBulkActionCount();
        }}
        onShowInMappingTable={applyBulkActionFilter}
      />
      <BulkActionsCleanupDialog
        open={cleanupOpen}
        onOpenChange={(next) => {
          setCleanupOpen(next);
          // Whenever the cleanup dialog closes — whether because the
          // admin cancelled, applied, or just clicked away — refresh
          // the storage baseline so it reflects any deletions that
          // happened. Done on close (rather than only on `onCleanedUp`)
          // so concurrent cleanups by other admins also surface.
          if (!next) reloadStorageStats();
        }}
        onCleanedUp={(deleted, bytesFreed) => {
          // The "Last bulk change" banner is sourced from the most-recent
          // 10 rows; if cleanup pruned the table out from under us we want
          // the banner to refresh too.
          reloadLatestAction();
          setCleanupMessage(
            t("reports.qbMapping.cleanup.successBanner", {
              count: deleted,
              size: formatSnapshotBytes(bytesFreed),
            }),
          );
        }}
      />
      <BulkActionsRetentionDialog
        open={retentionOpen}
        onOpenChange={setRetentionOpen}
        currentEffectiveDays={retentionDays}
        onSaved={(effectiveDays, usedDefault) => {
          // Refresh the bulk-actions list so its `retentionDays` (and the
          // banner copy) match the value we just persisted.
          reloadLatestAction();
          setRetentionMessage(
            usedDefault
              ? t("reports.qbMapping.retention.savedDefault", {
                  count: effectiveDays,
                })
              : t("reports.qbMapping.retention.saved", {
                  count: effectiveDays,
                }),
          );
        }}
      />
    </Card>
  );
}

// Exported for the focused integration tests in reports.csv-import.test.tsx;
// keeping the type public lets tests build a realistic preview prop.


// ── 1099 e-delivery consent (vendor self-service) ────────────────

interface EDeliveryConsentCardProps {
  vendorId: number;
}

function EDeliveryConsentCard({
  vendorId,
}: EDeliveryConsentCardProps): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    consent: boolean;
    consentAt: string | null;
    consentEmail: string | null;
  } | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = (): void => {
    fetch(`${API_BASE}/api/vendors/${vendorId}/e-delivery-consent`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((j) => {
        setState(j);
        if (j.consentEmail) setEmail(j.consentEmail);
      })
      .catch((e: Error) => setErr(e.message));
  };
  useEffect(reload, [vendorId]);

  const submit = async (consent: boolean): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/vendors/${vendorId}/e-delivery-consent`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent, email: consent ? email : null }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-edelivery-consent">
      <CardHeader>
        <CardTitle>{t("reports.eDelivery.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("reports.eDelivery.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {state && (
          <p className="text-sm">
            <span className="font-medium">
              {state.consent
                ? t("reports.eDelivery.statusOptedIn")
                : t("reports.eDelivery.statusOptedOut")}
            </span>
            {state.consentAt && (
              <span className="text-muted-foreground">
                {" — "}
                {new Date(state.consentAt).toLocaleString()}
              </span>
            )}
            {state.consentEmail && (
              <span className="text-muted-foreground">
                {" · "}
                {state.consentEmail}
              </span>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            placeholder={t("reports.eDelivery.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="input-edelivery-email"
            className="max-w-xs"
          />
          <TogglePillButton
            color="green"

            className="px-3"
            disabled={busy || email.length === 0}
            onClick={() => submit(true)}
            data-testid="btn-edelivery-grant"
          >
            {t("reports.eDelivery.grantBtn")}
          </TogglePillButton>
          <TogglePillButton
            color="red"

            className="px-3"
            disabled={busy || !state?.consent}
            onClick={() => submit(false)}
            data-testid="btn-edelivery-revoke"
          >
            {t("reports.eDelivery.revokeBtn")}
          </TogglePillButton>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 1099 dashboard (filing-status table per recipient) ───────────

// Month labels used in the 1099-K monthly breakout. Index matches the
// dashboard row's `monthly` array (Jan = 0 … Dec = 11) so we can render
// straight from the API response without juggling a separate map.
const K_MONTH_LABEL_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

function KMonthlyBreakout({
  monthly,
  transactionCount,
  crossedAtMonthIdx,
  taxYear,
  threshold,
  testIdPrefix,
}: {
  monthly: string[];
  transactionCount: number;
  crossedAtMonthIdx: number | null;
  taxYear: number;
  /**
   * IRS 1099-K reporting threshold for `taxYear`. Sourced from the
   * dashboard summary (`summary.kThreshold`) so the UI doesn't mirror
   * the threshold schedule.
   */
  threshold: number;
  testIdPrefix: string;
}): ReactElement {
  const { t } = useTranslation();
  // Pre-compute the running YTD total per month so each cell can show
  // a "YTD: $X" line under the per-month gross. Auditors used to mentally
  // add cells to answer "what was this vendor at by month X?" — having
  // the cumulative on every cell removes that arithmetic, and keeps the
  // crossed-month tooltip's spelled-out YTD-at-cross consistent.
  const monthlyYtd: string[] = [];
  {
    let running = 0;
    for (let i = 0; i < 12; i++) {
      running += Number(monthly[i] ?? 0);
      monthlyYtd.push(running.toFixed(2));
    }
  }
  const ytdAtCross =
    crossedAtMonthIdx !== null &&
    crossedAtMonthIdx >= 0 &&
    crossedAtMonthIdx < 12
      ? Number(monthlyYtd[crossedAtMonthIdx])
      : null;
  // Defensive: API guarantees length 12, but render even partial data
  // rather than crashing if the contract drifts.
  const months = K_MONTH_LABEL_KEYS.map((labelKey, i) => ({
    labelKey,
    amount: monthly[i] ?? "0.00",
    ytd: monthlyYtd[i] ?? "0.00",
    isCrossed: i === crossedAtMonthIdx,
  }));
  return (
    <UiTooltipProvider delayDuration={150}>
      <div
        className="space-y-2"
        data-testid={`monthly-breakout-${testIdPrefix}`}
      >
        <div className="text-xs text-muted-foreground">
          {t("reports.dashboard1099.k.monthlyHeading")}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-1">
          {months.map(({ labelKey, amount, ytd, isCrossed }) => {
            const numeric = Number(amount);
            const isZero = !Number.isFinite(numeric) || numeric === 0;
            const cellClasses =
              "rounded border p-1.5 text-center " +
              (isCrossed
                ? "bg-amber-100 border-amber-400 ring-1 ring-amber-400 dark:bg-amber-900/40 dark:border-amber-500"
                : isZero
                  ? "opacity-60"
                  : "bg-background");
            const cell = (
              <div
                className={cellClasses}
                data-testid={`monthly-${testIdPrefix}-${labelKey}`}
                data-crossed={isCrossed ? "true" : undefined}
              >
                <div className="text-[10px] uppercase text-muted-foreground">
                  {t(`reports.dashboard1099.k.month.${labelKey}`)}
                </div>
                <div className="text-xs font-mono">${amount}</div>
                {/*
                  Cumulative YTD through this month. Smaller, italic and
                  muted so reviewers don't confuse it with the per-month
                  gross sitting above it.
                */}
                <div
                  className="mt-0.5 text-[9px] italic font-mono text-muted-foreground"
                  data-testid={`monthly-${testIdPrefix}-${labelKey}-ytd`}
                  title={t("reports.dashboard1099.k.ytdHelp")}
                >
                  {t("reports.dashboard1099.k.ytdLabel", { amount: ytd })}
                </div>
                {isCrossed && (
                  <div
                    className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
                    data-testid={`monthly-${testIdPrefix}-${labelKey}-crossed-badge`}
                  >
                    {t("reports.dashboard1099.k.crossedBadge")}
                  </div>
                )}
              </div>
            );
            if (!isCrossed || ytdAtCross === null) {
              return <div key={labelKey}>{cell}</div>;
            }
            return (
              <UiTooltip key={labelKey}>
                <UiTooltipTrigger asChild>{cell}</UiTooltipTrigger>
                <UiTooltipContent
                  side="top"
                  data-testid={`monthly-${testIdPrefix}-${labelKey}-crossed-tooltip`}
                >
                  {t("reports.dashboard1099.k.crossedTooltip", {
                    ytd: ytdAtCross.toFixed(2),
                    threshold: threshold.toFixed(2),
                    year: taxYear,
                  })}
                </UiTooltipContent>
              </UiTooltip>
            );
          })}
        </div>
        <div
          className="text-xs text-muted-foreground"
          data-testid={`monthly-${testIdPrefix}-txn-count`}
        >
          {t("reports.dashboard1099.k.transactionCount", {
            count: transactionCount,
          })}
        </div>
      </div>
    </UiTooltipProvider>
  );
}

interface DashboardScopeProps {
  /** "admin" or "partner/123" */
  scope: string;
}

type CorrectedStatus = "none" | "g" | "c";

interface DashboardRow {
  taxYear: number;
  formType: "NEC" | "MISC" | "K";
  payerPartnerId: number;
  payerPartnerName: string;
  recipientVendorId: number;
  recipientName: string;
  federalTaxId: string | null;
  totalReportable: string;
  /**
   * Per-month gross amounts (Jan…Dec, length 12). Only populated for
   * 1099-K rows (Boxes 5a-5l on the form); NEC/MISC come back as 12
   * zeros so we can read the field unconditionally.
   */
  monthly: string[];
  /** Number of payment transactions (Box 3 on 1099-K). 0 for NEC/MISC. */
  transactionCount: number;
  /**
   * Index (0-11) of the month the K row's running YTD total first
   * reached the IRS threshold for the year. `null` for NEC/MISC and for
   * K rows where no month crossed (e.g. a custom threshold override).
   */
  crossedAtMonthIdx: number | null;
  eDeliveryConsent: boolean;
  filingId: number | null;
  status: string;
  filingMethod: string;
  /** Pub 1220 correction indicator: "none" | "g" | "c". */
  correctedStatus: CorrectedStatus;
  /** Most-recent corrected_status transition recorded for this filing.
   *  Drives the "Marked CORR-G on {date} by {user}" tooltip next to
   *  the CORR badge. `null` when no transition has ever been logged
   *  (e.g. a fresh row, or rows from before audit logging existed). */
  lastCorrectionAudit: {
    at: string;
    fromStatus: string;
    toStatus: string;
    actorUserId: number | null;
    actorDisplayName: string | null;
    actorUsername: string | null;
  } | null;
  externalReference: string | null;
  // SendGrid event-webhook fields. Populated only after the recipient
  // email has been delivered and the event-webhook relayed an outcome.
  sendgridMessageId: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  bounceReason: string | null;
  openedAt: string | null;
}

// A row is eligible for "mark as corrected" once it has been filed (or
// further along the lifecycle). Applying a corrected indicator to a
// pending/queued row would be meaningless — the next FIRE export would
// just be the original anyway.
const FILED_STATUSES = new Set([
  "filed",
  "accepted",
  "rejected",
  "delivered",
]);

interface DeliverResult {
  attempted: number;
  delivered: number;
  skippedNoConsent: number;
  errors: Array<{
    recipientVendorId: number;
    recipientName: string;
    formType: string;
    message: string;
  }>;
}

// Live shape returned by GET /reports/.../1099-deliver/jobs/:jobId.
// `status` drives the polling loop: terminal once it hits "completed"
// or "failed". `totalCount` is 0 until the worker has finished its
// initial dashboard scan, then it pins so progress reads "x / N".
interface DeliverJobStatus {
  jobId: number;
  status: "pending" | "running" | "completed" | "failed";
  attempted: number;
  delivered: number;
  skippedNoConsent: number;
  totalCount: number;
  errors: DeliverResult["errors"];
  lastErrorMessage: string | null;
}

// Income categories supported by invoice_lines.income_category. Mirrors the
// server-side enum so the admin "recategorize draft lines for vendor"
// dropdown stays in sync without an extra round-trip.
const DASHBOARD_INCOME_CATEGORIES = [
  "nec",
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
  "k_third_party_network",
  "none",
] as const;
type DashboardIncomeCategory = (typeof DASHBOARD_INCOME_CATEGORIES)[number];

// Scheduled "year-end 1099-K monthly breakout" email opt-in (Task #806).
//
// Inline row beneath the deliver/download controls. Shows current
// schedule status (enabled/disabled, recipient count, last send) and
// expands into a small editor when "Configure" is clicked. Uses the
// same `${API_BASE}/api/reports/${scope}/1099-dashboard/email-settings`
// path family as the dashboard endpoints.
type Dashboard1099EmailFormat = "pdf" | "csv";
interface Dashboard1099EmailSettingsState {
  scope: "admin" | "partner";
  partnerId: number | null;
  enabled: boolean;
  formats: Dashboard1099EmailFormat[];
  recipients: string[];
  taxYearOverride: number | null;
  updatedAt: string | null;
  lastSend: {
    sentAt: string;
    cadence: string;
    periodLabel: string;
    taxYear: number;
    recipients: string[];
    formats: Dashboard1099EmailFormat[];
    failureMessage: string | null;
  } | null;
}

function Dashboard1099EmailScheduleRow({
  scope,
}: DashboardScopeProps): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<Dashboard1099EmailSettingsState | null>(
    null,
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Local edit buffers — only flushed to the server on Save.
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftFormats, setDraftFormats] = useState<Dashboard1099EmailFormat[]>([
    "pdf",
  ]);
  const [draftRecipientsText, setDraftRecipientsText] = useState("");
  const [draftYearOverrideText, setDraftYearOverrideText] = useState("");

  const url = `${API_BASE}/api/reports/${scope}/1099-dashboard/email-settings`;

  const refresh = (): void => {
    setLoadErr(null);
    fetch(url, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Dashboard1099EmailSettingsState;
      })
      .then((s) => {
        setState(s);
        setDraftEnabled(s.enabled);
        setDraftFormats(s.formats.length > 0 ? s.formats : ["pdf"]);
        setDraftRecipientsText(s.recipients.join("\n"));
        setDraftYearOverrideText(
          s.taxYearOverride != null ? String(s.taxYearOverride) : "",
        );
      })
      .catch((e: Error) => setLoadErr(e.message));
  };
  useEffect(refresh, [scope]);

  const toggleFormat = (f: Dashboard1099EmailFormat): void => {
    setDraftFormats((prev) => {
      const has = prev.includes(f);
      // Always keep at least one format selected.
      if (has && prev.length === 1) return prev;
      return has ? prev.filter((x) => x !== f) : [...prev, f];
    });
  };

  const onSave = async (): Promise<void> => {
    setSaving(true);
    setSaveErr(null);
    try {
      const recipients = draftRecipientsText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s);
      const yearOverride = draftYearOverrideText.trim();
      const body = {
        enabled: draftEnabled,
        formats: draftFormats,
        recipients,
        taxYearOverride: yearOverride === "" ? null : Number(yearOverride),
      };
      const res = await fetch(url, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const next = (await res.json()) as Dashboard1099EmailSettingsState;
      setState(next);
      setDraftEnabled(next.enabled);
      setDraftFormats(next.formats);
      setDraftRecipientsText(next.recipients.join("\n"));
      setDraftYearOverrideText(
        next.taxYearOverride != null ? String(next.taxYearOverride) : "",
      );
      setOpen(false);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const summary = state
    ? state.enabled
      ? t("reports.dashboard1099.emailSchedule.summaryOn", {
          count: state.recipients.length,
          formats: state.formats.join(", ").toUpperCase(),
        })
      : t("reports.dashboard1099.emailSchedule.summaryOff")
    : t("common.loading");

  return (
    <div
      className="rounded border p-2 bg-muted/20 space-y-2"
      data-testid="row-1099-email-schedule"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">
          {t("reports.dashboard1099.emailSchedule.label")}
        </span>
        <span
          className="text-muted-foreground"
          data-testid="text-email-schedule-summary"
        >
          {summary}
        </span>
        {state?.lastSend && (
          <span
            className="text-muted-foreground"
            data-testid="text-email-schedule-last"
          >
            {t("reports.dashboard1099.emailSchedule.lastSent", {
              when: new Date(state.lastSend.sentAt).toLocaleString(),
              period: state.lastSend.periodLabel,
            })}
            {state.lastSend.failureMessage && (
              <span className="text-destructive ml-1">
                ({state.lastSend.failureMessage})
              </span>
            )}
          </span>
        )}
        <TogglePillButton
          color="blue"

          className="ml-auto"
          onClick={() => setOpen((v) => !v)}
          data-testid="btn-email-schedule-toggle"
        >
          {open
            ? t("common.cancel")
            : t("reports.dashboard1099.emailSchedule.configure")}
        </TogglePillButton>
      </div>
      {loadErr && <p className="text-xs text-destructive">{loadErr}</p>}
      {open && state && (
        <div className="space-y-2 text-xs border-t pt-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draftEnabled}
              onChange={(e) => setDraftEnabled(e.target.checked)}
              data-testid="checkbox-email-schedule-enabled"
            />
            <span>{t("reports.dashboard1099.emailSchedule.enabled")}</span>
          </label>
          <div className="flex items-center gap-3">
            <span>{t("reports.dashboard1099.emailSchedule.formats")}</span>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draftFormats.includes("pdf")}
                onChange={() => toggleFormat("pdf")}
                data-testid="checkbox-email-schedule-format-pdf"
              />
              <span>PDF</span>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draftFormats.includes("csv")}
                onChange={() => toggleFormat("csv")}
                data-testid="checkbox-email-schedule-format-csv"
              />
              <span>CSV</span>
            </label>
          </div>
          <div className="space-y-1">
            <label
              htmlFor="email-schedule-recipients"
              className="block font-medium"
            >
              {t("reports.dashboard1099.emailSchedule.recipients")}
            </label>
            <textarea
              id="email-schedule-recipients"
              value={draftRecipientsText}
              onChange={(e) => setDraftRecipientsText(e.target.value)}
              placeholder={t(
                "reports.dashboard1099.emailSchedule.recipientsPlaceholder",
              )}
              rows={3}
              className="w-full border rounded p-1 font-mono text-xs"
              data-testid="textarea-email-schedule-recipients"
            />
            <p className="text-muted-foreground">
              {t("reports.dashboard1099.emailSchedule.recipientsHelp")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="email-schedule-year-override">
              {t("reports.dashboard1099.emailSchedule.taxYearOverride")}
            </label>
            <Input
              id="email-schedule-year-override"
              type="number"
              value={draftYearOverrideText}
              min={2000}
              max={2100}
              onChange={(e) => setDraftYearOverrideText(e.target.value)}
              className="w-24 h-7"
              data-testid="input-email-schedule-year-override"
            />
            <span className="text-muted-foreground">
              {t("reports.dashboard1099.emailSchedule.taxYearOverrideHelp")}
            </span>
          </div>
          <p className="text-muted-foreground">
            {t("reports.dashboard1099.emailSchedule.cadenceNote")}
          </p>
          {saveErr && <p className="text-destructive">{saveErr}</p>}
          <div className="flex gap-2">
            <TogglePillButton
              color="blue"

              onClick={() => void onSave()}
              disabled={saving}
              data-testid="btn-email-schedule-save"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("common.saveChanges")}
            </TogglePillButton>
            <TogglePillButton
              color="red"

              onClick={() => {
                setOpen(false);
                refresh();
              }}
              data-testid="btn-email-schedule-cancel"
            >
              {t("common.cancel")}
            </TogglePillButton>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard1099Card({ scope }: DashboardScopeProps): ReactElement {
  const { t } = useTranslation();
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [data, setData] = useState<{
    summary: {
      totalRecipients: number;
      byForm: Record<string, number>;
      byStatus: Record<string, number>;
      totalReportable: string;
      /**
       * IRS 1099-K reporting threshold in effect for this tax year, as
       * computed server-side. Drives the "crossed-over" tooltip in the
       * monthly breakout so the UI doesn't have to mirror the schedule.
       */
      kThreshold: number;
    };
    rows: DashboardRow[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recategorizingVendorId, setRecategorizingVendorId] = useState<
    number | null
  >(null);
  const [recategorizeMessage, setRecategorizeMessage] = useState<string | null>(
    null,
  );
  // Snapshot of the per-line state before the most recent vendor-level
  // recategorize. Powers the Undo affordance on the dashboard banner: if
  // present, the banner shows an Undo button that hands this snapshot
  // back to the restore endpoint to revert each affected line to its
  // prior (category, manual-override flag).
  type VendorRecategorizeSnapshot = {
    lineId: number;
    incomeCategory: DashboardIncomeCategory;
    isManualOverride: boolean;
  };
  const [recategorizeUndo, setRecategorizeUndo] = useState<{
    vendorName: string;
    snapshot: VendorRecategorizeSnapshot[];
  } | null>(null);
  const [undoingRecategorize, setUndoingRecategorize] = useState(false);
  // Admin-only one-shot backfill of 1099 income_category on existing draft
  // invoice lines (POST /invoices/backfill-1099-categories). The dashboard
  // is the natural surface for this so admins don't need terminal access.
  type BackfillResult = {
    scanned: number;
    updated: number;
    skippedAlreadyCorrect: number;
    skippedUnknownLineType?: number;
    countsByLineType: Record<string, Record<string, number>>;
  };
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(
    null,
  );
  const [deliverFormType, setDeliverFormType] = useState<"NEC" | "MISC" | "K">(
    "NEC",
  );
  const [delivering, setDelivering] = useState(false);
  const [deliverResult, setDeliverResult] = useState<DeliverResult | null>(
    null,
  );
  // Live progress while a background delivery job is running. Cleared
  // when the next send is enqueued and replaced with a fresh snapshot
  // on each poll. The loop stops on terminal status and copies the
  // final counts into `deliverResult` for the existing summary panel.
  const [deliverJob, setDeliverJob] = useState<DeliverJobStatus | null>(
    null,
  );
  const deliverPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which 1099-K row is currently expanded to show its monthly
  // breakout. Only one row at a time keeps the table compact and matches
  // how reviewers actually scan the dashboard (vendor by vendor).
  const [expandedKKey, setExpandedKKey] = useState<string | null>(null);

  const isAdminScope = scope === "admin";

  const load = (): void => {
    setData(null);
    setErr(null);
    fetch(`${API_BASE}/api/reports/${scope}/1099-dashboard?year=${year}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  };
  useEffect(load, [scope, year]);

  // Cancel any in-flight poll on unmount so a long-running delivery
  // job doesn't keep hitting the server after the operator navigates
  // away.
  useEffect(() => {
    return () => {
      if (deliverPollRef.current) {
        clearTimeout(deliverPollRef.current);
        deliverPollRef.current = null;
      }
    };
  }, []);

  const sendStatements = async (): Promise<void> => {
    setDelivering(true);
    setDeliverResult(null);
    setDeliverJob(null);
    setErr(null);
    if (deliverPollRef.current) {
      clearTimeout(deliverPollRef.current);
      deliverPollRef.current = null;
    }
    try {
      // Enqueue the job. The server returns 202 with a `jobId`
      // immediately so the browser request can't time out on a long
      // recipient list.
      const res = await fetch(
        `${API_BASE}/api/reports/${scope}/1099-deliver`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, formType: deliverFormType }),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const enq = (await res.json()) as { jobId: number };
      // Poll for live progress every 1.5s until the job reaches a
      // terminal state. We chain via `setTimeout` (not `setInterval`)
      // so a slow status request never overlaps the next tick.
      const poll = async (): Promise<void> => {
        try {
          const r = await fetch(
            `${API_BASE}/api/reports/${scope}/1099-deliver/jobs/${enq.jobId}`,
            { credentials: "include" },
          );
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }
          const status = (await r.json()) as DeliverJobStatus;
          setDeliverJob(status);
          if (status.status === "completed" || status.status === "failed") {
            setDeliverResult({
              attempted: status.attempted,
              delivered: status.delivered,
              skippedNoConsent: status.skippedNoConsent,
              errors: status.errors,
            });
            if (status.status === "failed" && status.lastErrorMessage) {
              setErr(status.lastErrorMessage);
            }
            setDelivering(false);
            // Refresh the dashboard now that filings rows have been
            // upserted.
            load();
            return;
          }
          deliverPollRef.current = setTimeout(() => {
            void poll();
          }, 1500);
        } catch (e) {
          setErr((e as Error).message);
          setDelivering(false);
        }
      };
      void poll();
    } catch (e) {
      setErr((e as Error).message);
      setDelivering(false);
    }
  };

  // Vendor-level cleanup: send the chosen 1099 category to every DRAFT
  // invoice line for this vendor in the current dashboard year. Admin only
  // (the server enforces this too). Refreshes the dashboard so updated
  // amounts and form-type bucketing show immediately.
  const recategorizeVendor = async (
    row: DashboardRow,
    incomeCategory: DashboardIncomeCategory,
  ): Promise<void> => {
    setRecategorizingVendorId(row.recipientVendorId);
    setRecategorizeMessage(null);
    setRecategorizeUndo(null);
    setErr(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/invoices/bulk-recategorize-1099`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendorId: row.recipientVendorId,
            incomeCategory,
            year,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          json.error ?? `HTTP ${res.status}`,
        );
      }
      setRecategorizeMessage(
        t("reports.dashboard1099.recategorize.summary", {
          vendor: row.recipientName,
          lines: json.linesUpdated ?? 0,
          invoices: json.invoicesScanned ?? 0,
        }),
      );
      // Stash the per-line snapshot the server returned so the banner can
      // offer an Undo. Filter to recognized categories defensively in case
      // the server enum drifts ahead of the client list.
      const previous: Array<{
        lineId: number;
        incomeCategory: string;
        isManualOverride: boolean;
      }> = Array.isArray(json.previousCategories)
        ? json.previousCategories
        : [];
      const validSet = new Set<string>(DASHBOARD_INCOME_CATEGORIES);
      const snapshot: VendorRecategorizeSnapshot[] = previous
        .filter((p) => validSet.has(p.incomeCategory))
        .map((p) => ({
          lineId: p.lineId,
          incomeCategory: p.incomeCategory as DashboardIncomeCategory,
          isManualOverride: p.isManualOverride,
        }));
      if (snapshot.length > 0) {
        setRecategorizeUndo({ vendorName: row.recipientName, snapshot });
      }
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRecategorizingVendorId(null);
    }
  };

  // Undo handler for the vendor-level recategorize. Sends the snapshot we
  // captured from the bulk endpoint to the restore endpoint, which writes
  // each line's prior (category, manual-override) back. Lines whose
  // invoices left draft between the action and the undo are skipped
  // server-side; we surface that in the banner copy.
  const undoRecategorizeVendor = async (): Promise<void> => {
    if (!recategorizeUndo) return;
    setUndoingRecategorize(true);
    setErr(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/invoices/restore-1099-categories`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: recategorizeUndo.snapshot }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const restored = Number(json.restored ?? 0);
      // The server returns `skipped` as an array of
      // `{ lineId, invoiceNumber, reason }` so we can tell the user exactly
      // which lines were left in their changed state and why. Old responses
      // returned a number; tolerate that for forward/backward compat by
      // coercing to an empty array when the shape isn't what we expect.
      type SkippedEntry = {
        lineId: number;
        invoiceNumber: string | null;
        reason: "not_draft" | "not_found";
      };
      const skippedRaw = Array.isArray(json.skipped)
        ? (json.skipped as SkippedEntry[])
        : [];
      if (skippedRaw.length > 0) {
        // Bucket lines by reason so we can phrase each bucket on its own.
        // We count lines (not invoices) so a single multi-line invoice
        // is reported as "3 lines stayed changed" rather than "1 line".
        // We also collect the unique invoice numbers per bucket purely
        // for readability — listing the same invoice three times wouldn't
        // help the user.
        const notDraftLines = skippedRaw.filter(
          (s) => s.reason === "not_draft",
        );
        const notFoundLines = skippedRaw.filter(
          (s) => s.reason === "not_found",
        );
        const detailParts: string[] = [];
        if (notDraftLines.length > 0) {
          const uniqueInvoices = Array.from(
            new Set(
              notDraftLines
                .map((s) => s.invoiceNumber)
                .filter((n): n is string => !!n),
            ),
          ).sort();
          detailParts.push(
            t("reports.dashboard1099.recategorize.undoSkippedNotDraft", {
              count: notDraftLines.length,
              invoices:
                uniqueInvoices.length > 0
                  ? uniqueInvoices.join(", ")
                  : String(notDraftLines.length),
            }),
          );
        }
        if (notFoundLines.length > 0) {
          // List the actual line IDs so the user can search for them
          // (helpful when the lines were deleted as part of a regenerate).
          const ids = notFoundLines.map((s) => s.lineId).sort((a, b) => a - b);
          detailParts.push(
            t("reports.dashboard1099.recategorize.undoSkippedNotFound", {
              count: notFoundLines.length,
              lineIds: ids.join(", "),
            }),
          );
        }
        setRecategorizeMessage(
          t("reports.dashboard1099.recategorize.undoSummaryPartial", {
            vendor: recategorizeUndo.vendorName,
            restored,
            skipped: skippedRaw.length,
            details: detailParts.join(" "),
          }),
        );
      } else {
        setRecategorizeMessage(
          t("reports.dashboard1099.recategorize.undoSummary", {
            vendor: recategorizeUndo.vendorName,
            restored,
          }),
        );
      }
      setRecategorizeUndo(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUndoingRecategorize(false);
    }
  };

  // Admin-only: trigger the server-side backfill that re-derives the 1099
  // income_category on every existing DRAFT invoice line the engine still
  // owns. Sent / paid / cancelled / supplemental invoices and any line
  // marked is_manual_override = true are intentionally untouched server
  // side. The endpoint returns per-line-type → target-category counts that
  // we render in the result panel.
  const runBackfill = async (): Promise<void> => {
    setBackfillRunning(true);
    setBackfillResult(null);
    setErr(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/invoices/backfill-1099-categories`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setBackfillResult({
        scanned: Number(json.scanned ?? 0),
        updated: Number(json.updated ?? 0),
        skippedAlreadyCorrect: Number(json.skippedAlreadyCorrect ?? 0),
        skippedUnknownLineType:
          json.skippedUnknownLineType != null
            ? Number(json.skippedUnknownLineType)
            : undefined,
        countsByLineType:
          (json.countsByLineType as Record<
            string,
            Record<string, number>
          >) ?? {},
      });
      setBackfillOpen(false);
      // Reload the dashboard so updated category buckets are reflected
      // immediately (form-type totals can shift after a backfill).
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBackfillRunning(false);
    }
  };

  // Single-field updater for either the workflow status (pending →
  // delivered) or the IRS corrected-return indicator. The two share the
  // same request shape, so a single helper keeps the table-action code
  // small and consistent (POST when no filing row exists yet, PATCH
  // when one does).
  const patchFiling = async (
    row: DashboardRow,
    fields: { status?: string; correctedStatus?: CorrectedStatus },
  ): Promise<void> => {
    const key = `${row.formType}-${row.recipientVendorId}`;
    setBusyId(key);
    try {
      const url = row.filingId
        ? `${API_BASE}/api/reports/1099-filing-status/${row.filingId}`
        : `${API_BASE}/api/reports/1099-filing-status`;
      const method = row.filingId ? "PATCH" : "POST";
      const body = row.filingId
        ? fields
        : {
            taxYear: row.taxYear,
            formType: row.formType,
            payerPartnerId: row.payerPartnerId,
            recipientVendorId: row.recipientVendorId,
            totalReportable: row.totalReportable,
            ...fields,
          };
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = (row: DashboardRow, status: string): Promise<void> =>
    patchFiling(row, { status });

  const updateCorrected = (
    row: DashboardRow,
    correctedStatus: CorrectedStatus,
  ): Promise<void> => patchFiling(row, { correctedStatus });

  return (
    <Card data-testid="card-1099-dashboard">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{t("reports.dashboard1099.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("reports.dashboard1099.description")}
          </p>
        </div>
        <Input
          type="number"
          value={year}
          min={2020}
          max={2100}
          onChange={(e) => setYear(Number(e.target.value) || year)}
          className="w-24"
          data-testid="input-dashboard-year"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!err && !data && (
          <p className="text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        )}
        {data && (
          <>
            <div
              className="flex flex-wrap items-center gap-2 rounded border p-2 bg-muted/30"
              data-testid="row-1099-deliver"
            >
              <span className="text-xs text-muted-foreground">
                {t("reports.dashboard1099.deliver.label")}
              </span>
              <select
                value={deliverFormType}
                onChange={(e) =>
                  setDeliverFormType(e.target.value as "NEC" | "MISC" | "K")
                }
                className="text-xs border rounded p-1"
                disabled={delivering}
                data-testid="select-deliver-form"
              >
                <option value="NEC">1099-NEC</option>
                <option value="MISC">1099-MISC</option>
                <option value="K">1099-K</option>
              </select>
              <TogglePillButton
                color="blue"

                onClick={sendStatements}
                disabled={delivering}
                data-testid="btn-send-1099-statements"
              >
                {delivering && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {t("reports.dashboard1099.deliver.send")}
              </TogglePillButton>
              <span className="text-xs text-muted-foreground">
                {t("reports.dashboard1099.deliver.help")}
              </span>
              {delivering && deliverJob && (
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  data-testid="text-1099-deliver-progress"
                >
                  {deliverJob.totalCount > 0
                    ? `Sending… ${deliverJob.attempted} / ${deliverJob.totalCount}`
                    : "Sending…"}
                </span>
              )}
              <TogglePillButton
                color="blue"

                className="ml-auto"
                onClick={() => {
                  // Trigger a download via window.location so the
                  // browser uses the server-supplied filename. The
                  // endpoint honors the same partner/admin scope and
                  // year filter the dashboard is rendered with.
                  window.location.assign(
                    `${API_BASE}/api/reports/${scope}/1099-dashboard?year=${year}&format=csv`,
                  );
                }}
                data-testid="btn-download-monthly-csv"
                title={t("reports.dashboard1099.k.downloadCsvHelp")}
              >
                <Download className="h-3.5 w-3.5" />
                {t("reports.dashboard1099.k.downloadCsv")}
              </TogglePillButton>
              <TogglePillButton
                color="blue"

                onClick={() => {
                  // Same scope/year as the CSV button; the server
                  // emits a paginated landscape-letter PDF mirroring
                  // the CSV columns for printing or filing packets.
                  window.location.assign(
                    `${API_BASE}/api/reports/${scope}/1099-dashboard?year=${year}&format=pdf`,
                  );
                }}
                data-testid="btn-download-monthly-pdf"
                title={t("reports.dashboard1099.k.downloadPdfHelp")}
              >
                <Download className="h-3.5 w-3.5" />
                {t("reports.dashboard1099.k.downloadPdf")}
              </TogglePillButton>
            </div>
            <Dashboard1099EmailScheduleRow scope={scope} />
            {isAdminScope && (
              <div
                className="flex flex-wrap items-center gap-2 rounded border p-2 bg-muted/30"
                data-testid="row-1099-backfill"
              >
                <span className="text-xs text-muted-foreground">
                  {t("reports.dashboard1099.backfill.label")}
                </span>
                <TogglePillButton
                  color="blue"

                  onClick={() => setBackfillOpen(true)}
                  disabled={backfillRunning}
                  data-testid="btn-backfill-1099-categories"
                >
                  {backfillRunning && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {t("reports.dashboard1099.backfill.button")}
                </TogglePillButton>
                <span className="text-xs text-muted-foreground">
                  {t("reports.dashboard1099.backfill.help")}
                </span>
              </div>
            )}
            {isAdminScope && backfillResult && (
              <div
                className="rounded border p-2 text-xs space-y-1 bg-emerald-50 dark:bg-emerald-950"
                data-testid="row-1099-backfill-result"
              >
                <div className="font-medium">
                  {t("reports.dashboard1099.backfill.summary", {
                    scanned: backfillResult.scanned,
                    updated: backfillResult.updated,
                    skipped: backfillResult.skippedAlreadyCorrect,
                  })}
                </div>
                {Object.keys(backfillResult.countsByLineType).length === 0 ? (
                  <div className="text-muted-foreground">
                    {t("reports.dashboard1099.backfill.noChanges")}
                  </div>
                ) : (
                  <div>
                    <div className="text-muted-foreground mb-1">
                      {t("reports.dashboard1099.backfill.breakdownHeading")}
                    </div>
                    <ul
                      className="list-disc pl-4 space-y-0.5"
                      data-testid="list-backfill-counts"
                    >
                      {Object.entries(backfillResult.countsByLineType)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([lineType, perCategory]) => (
                          <li key={lineType}>
                            <span className="font-medium">{lineType}</span>:{" "}
                            {Object.entries(perCategory)
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(
                                ([cat, count]) => `${count} → ${cat}`,
                              )
                              .join(", ")}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {isAdminScope && (
              <AlertDialog
                open={backfillOpen}
                onOpenChange={(open) => {
                  if (!backfillRunning) setBackfillOpen(open);
                }}
              >
                <AlertDialogContent data-testid="dialog-backfill-1099">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("reports.dashboard1099.backfill.dialog.title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <p>
                          {t("reports.dashboard1099.backfill.dialog.body")}
                        </p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>
                            {t(
                              "reports.dashboard1099.backfill.dialog.bulletDrafts",
                            )}
                          </li>
                          <li>
                            {t(
                              "reports.dashboard1099.backfill.dialog.bulletOverrides",
                            )}
                          </li>
                          <li>
                            {t(
                              "reports.dashboard1099.backfill.dialog.bulletSent",
                            )}
                          </li>
                        </ul>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      disabled={backfillRunning}
                      data-testid="button-backfill-cancel"
                    >
                      {t("common.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={backfillRunning}
                      onClick={(e) => {
                        e.preventDefault();
                        void runBackfill();
                      }}
                      data-testid="button-backfill-confirm"
                    >
                      {backfillRunning && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      )}
                      {t("reports.dashboard1099.backfill.dialog.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {recategorizeMessage && (
              <div
                className="rounded border p-2 text-xs bg-emerald-50 dark:bg-emerald-950 flex items-center justify-between gap-2"
                data-testid="row-1099-recategorize-result"
              >
                <span>{recategorizeMessage}</span>
                {recategorizeUndo && (
                  <PillButton
                    color="image"
                    disabled={undoingRecategorize}
                    onClick={() => {
                      void undoRecategorizeVendor();
                    }}
                    data-testid="button-undo-recategorize-vendor"
                  >
                    {undoingRecategorize
                      ? t("reports.dashboard1099.recategorize.undoing")
                      : t("reports.dashboard1099.recategorize.undo")}
                  </PillButton>
                )}
              </div>
            )}
            {deliverResult && (
              <div
                className="rounded border p-2 text-xs space-y-1"
                data-testid="row-1099-deliver-result"
              >
                <div className="font-medium">
                  {t("reports.dashboard1099.deliver.summary", {
                    delivered: deliverResult.delivered,
                    attempted: deliverResult.attempted,
                  })}
                </div>
                <div className="text-muted-foreground">
                  {t("reports.dashboard1099.deliver.skipped", {
                    count: deliverResult.skippedNoConsent,
                  })}
                </div>
                {deliverResult.errors.length > 0 && (
                  <div className="text-destructive">
                    <div>
                      {t("reports.dashboard1099.deliver.errorsHeading", {
                        count: deliverResult.errors.length,
                      })}
                    </div>
                    <ul className="list-disc pl-4">
                      {deliverResult.errors.map((e, i) => (
                        <li key={`${e.recipientVendorId}-${i}`}>
                          {e.recipientName} ({e.formType}): {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded border p-2">
                <div className="text-muted-foreground">
                  {t("reports.dashboard1099.totalRecipients")}
                </div>
                <div className="text-lg font-semibold">
                  {data.summary.totalRecipients}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">
                  {t("reports.dashboard1099.totalReportable")}
                </div>
                <div className="text-lg font-semibold">
                  ${data.summary.totalReportable}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">NEC / MISC / K</div>
                <div className="text-sm font-mono">
                  {data.summary.byForm.NEC ?? 0} / {data.summary.byForm.MISC ?? 0}{" "}
                  / {data.summary.byForm.K ?? 0}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground">
                  {t("reports.dashboard1099.pending")}
                </div>
                <div className="text-lg font-semibold">
                  {data.summary.byStatus.pending ?? 0}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("reports.dashboard1099.col.form")}</TableHead>
                    <TableHead>
                      {t("reports.dashboard1099.col.recipient")}
                    </TableHead>
                    <TableHead>TIN/EIN</TableHead>
                    <TableHead className="text-right">
                      {t("reports.col.total")}
                    </TableHead>
                    <TableHead>{t("reports.dashboard1099.col.eDelivery")}</TableHead>
                    <TableHead>{t("reports.dashboard1099.col.status")}</TableHead>
                    <TableHead className="text-right">
                      {t("reports.dashboard1099.col.action")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("reports.dashboard1099.col.corrected")}
                    </TableHead>
                    {isAdminScope && (
                      <TableHead className="text-right">
                        {t("reports.dashboard1099.col.recategorize")}
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.flatMap((r) => {
                    // In admin scope the same vendor may appear under
                    // multiple partners, so include payerPartnerId so the
                    // React key, expanded-state key, and per-row testids
                    // never collide across partners.
                    const key = `${r.payerPartnerId}-${r.formType}-${r.recipientVendorId}`;
                    const isK = r.formType === "K";
                    const expanded = isK && expandedKKey === key;
                    // Total visible columns: Form, Recipient, TIN, Total,
                    // Delivery, Status, Action, plus optional Recategorize.
                    const colSpan = isAdminScope ? 8 : 7;
                    const rows: ReactElement[] = [
                      <TableRow
                        key={key}
                        data-testid={`row-1099-${key}`}
                      >
                        <TableCell>
                          {isK ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedKKey(expanded ? null : key)
                              }
                              className="inline-flex items-center gap-1 text-left hover:underline"
                              aria-expanded={expanded}
                              aria-controls={`row-1099-${key}-monthly`}
                              data-testid={`btn-toggle-monthly-${key}`}
                              title={t(
                                expanded
                                  ? "reports.dashboard1099.k.hideMonthly"
                                  : "reports.dashboard1099.k.showMonthly",
                              )}
                            >
                              {expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              {r.formType}
                            </button>
                          ) : (
                            r.formType
                          )}
                        </TableCell>
                        <TableCell>{r.recipientName}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.federalTaxId ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          ${r.totalReportable}
                        </TableCell>
                        <TableCell>
                          {r.eDeliveryConsent
                            ? t("reports.dashboard1099.eYes")
                            : t("reports.dashboard1099.eNo")}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              r.status === "filed" ||
                              r.status === "accepted" ||
                              r.status === "delivered"
                                ? "text-green-700"
                                : r.status === "rejected" ||
                                    r.status === "error"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                            }
                          >
                            {t(`reports.dashboard1099.status.${r.status}`, {
                              defaultValue: r.status,
                            })}
                          </span>
                          {r.correctedStatus !== "none" && (
                            <span
                              className="ml-1 inline-block rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                              data-testid={`badge-corrected-${key}`}
                              title={(() => {
                                const help = t(
                                  `reports.dashboard1099.corrected.help.${r.correctedStatus}`,
                                );
                                const a = r.lastCorrectionAudit;
                                if (!a) return help;
                                const who =
                                  a.actorDisplayName ??
                                  a.actorUsername ??
                                  t(
                                    "reports.dashboard1099.corrected.markedBy.unknown",
                                  );
                                const when = new Date(a.at).toLocaleDateString(
                                  undefined,
                                  {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  },
                                );
                                const badge = t(
                                  `reports.dashboard1099.corrected.badge.${r.correctedStatus}`,
                                );
                                return `${t(
                                  "reports.dashboard1099.corrected.markedBy.tooltip",
                                  { badge, date: when, user: who },
                                )}\n\n${help}`;
                              })()}
                            >
                              {t(
                                `reports.dashboard1099.corrected.badge.${r.correctedStatus}`,
                              )}
                            </span>
                          )}
                          {r.openedAt && (
                            <span
                              className="ml-1 inline-block rounded bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                              data-testid={`badge-opened-${key}`}
                              title={`Opened ${new Date(r.openedAt).toLocaleString()}`}
                            >
                              opened
                            </span>
                          )}
                          {r.bounceReason && (
                            <span
                              className="ml-1 inline-block rounded bg-red-100 px-1.5 text-[10px] font-semibold text-red-900 dark:bg-red-900 dark:text-red-100"
                              data-testid={`badge-bounced-${key}`}
                              title={r.bounceReason}
                            >
                              bounced
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <select
                            disabled={busyId === key}
                            value={r.status}
                            onChange={(e) => updateStatus(r, e.target.value)}
                            className="text-xs border rounded p-1"
                            data-testid={`select-status-${key}`}
                          >
                            {[
                              "pending",
                              "queued",
                              "filed",
                              "accepted",
                              "rejected",
                              "delivered",
                              "error",
                            ].map((s) => (
                              <option key={s} value={s}>
                                {t(`reports.dashboard1099.status.${s}`, {
                                  defaultValue: s,
                                })}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell className="text-right">
                          <select
                            disabled={
                              busyId === key || !FILED_STATUSES.has(r.status)
                            }
                            value={r.correctedStatus}
                            onChange={(e) =>
                              updateCorrected(
                                r,
                                e.target.value as CorrectedStatus,
                              )
                            }
                            className="text-xs border rounded p-1"
                            data-testid={`select-corrected-${key}`}
                            title={t("reports.dashboard1099.corrected.help.tip")}
                          >
                            {(["none", "g", "c"] as CorrectedStatus[]).map(
                              (s) => (
                                <option key={s} value={s}>
                                  {t(
                                    `reports.dashboard1099.corrected.option.${s}`,
                                  )}
                                </option>
                              ),
                            )}
                          </select>
                        </TableCell>
                        {isAdminScope && (
                          <TableCell className="text-right">
                            <select
                              disabled={
                                recategorizingVendorId === r.recipientVendorId
                              }
                              defaultValue=""
                              onChange={(e) => {
                                const v = e.target.value;
                                e.target.value = "";
                                if (!v) return;
                                void recategorizeVendor(
                                  r,
                                  v as DashboardIncomeCategory,
                                );
                              }}
                              className="text-xs border rounded p-1"
                              data-testid={`select-recategorize-${r.recipientVendorId}`}
                              title={t(
                                "reports.dashboard1099.recategorize.help",
                              )}
                            >
                              <option value="">
                                {t(
                                  "reports.dashboard1099.recategorize.placeholder",
                                )}
                              </option>
                              {DASHBOARD_INCOME_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {t(`invoices.incomeCategory.${c}`)}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                        )}
                      </TableRow>,
                    ];
                    if (expanded) {
                      rows.push(
                        <TableRow
                          key={`${key}-monthly`}
                          data-testid={`row-1099-${key}-monthly`}
                          className="bg-muted/40"
                        >
                          <TableCell colSpan={colSpan} className="p-3">
                            <KMonthlyBreakout
                              monthly={r.monthly}
                              transactionCount={r.transactionCount}
                              crossedAtMonthIdx={r.crossedAtMonthIdx}
                              taxYear={r.taxYear}
                              threshold={data.summary.kThreshold}
                              testIdPrefix={key}
                            />
                          </TableCell>
                        </TableRow>,
                      );
                    }
                    return rows;
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── IRS FIRE TXT export buttons (per form type) ─────────────────

// Shape returned by GET /reports/{admin,partner/:id}/1099-fire/transmitter.
// Mirrors the server's `TransmitterPreviewResponse` so the card can show
// the operator exactly which transmitter info will be written into the
// FIRE T-record, plus a list of any required env vars that are still
// unset/blank. Read-only — fetched once per (scope, test) combination.
interface FireTransmitterPreview {
  test: boolean;
  ok: boolean;
  missing: string[];
  transmitter: {
    tcc: string;
    ein: string;
    name: string;
    mailingAddress: string;
    city: string;
    state: string;
    zip: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
  };
}

function FireExportCard({ scope }: DashboardScopeProps): ReactElement {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [test, setTest] = useState(true);
  const [transmitter, setTransmitter] =
    useState<FireTransmitterPreview | null>(null);
  const [transmitterErr, setTransmitterErr] = useState<string | null>(null);
  const [transmitterLoading, setTransmitterLoading] = useState(false);

  // Re-fetch whenever the scope or the test toggle changes — the test
  // preview substitutes placeholder values so what we display has to
  // match what the actual download will write to the file. We clear the
  // previous payload up front so the UI doesn't briefly show the old
  // mode's data (and, critically, doesn't leave the real-mode download
  // buttons enabled while the new preview is in flight). AbortController
  // prevents a slow request from clobbering a newer one (e.g. operator
  // toggling the test checkbox quickly).
  useEffect(() => {
    const ctrl = new AbortController();
    setTransmitter(null);
    setTransmitterLoading(true);
    setTransmitterErr(null);
    fetch(
      `${API_BASE}/api/reports/${scope}/1099-fire/transmitter?test=${test ? "true" : "false"}`,
      { credentials: "include", signal: ctrl.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as FireTransmitterPreview;
      })
      .then((j) => {
        setTransmitter(j);
        setTransmitterLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setTransmitterErr(e.message);
        setTransmitterLoading(false);
      });
    return () => ctrl.abort();
  }, [scope, test]);

  const url = (formType: "NEC" | "MISC" | "K"): string =>
    `${API_BASE}/api/reports/${scope}/1099-fire?formType=${formType}&year=${year}&test=${test ? "true" : "false"}`;

  // Real (non-test) downloads are blocked when required transmitter env
  // vars are unset — the server would reject the request anyway, so we
  // disable the button up-front and explain why. We also block during
  // the in-flight refetch and on outright fetch errors so the operator
  // can't sneak a click while the preview is stale or unknown — better
  // a moment of disabled buttons than a confusing IRS rejection.
  // Test downloads stay enabled because the IRS test FIRE system
  // accepts placeholder info.
  const blockRealDownload =
    !test &&
    (transmitterErr !== null ||
      transmitterLoading ||
      transmitter === null ||
      !transmitter.ok);
  const t1 = transmitter?.transmitter;
  const cityStateZip = t1
    ? [t1.city, t1.state].filter(Boolean).join(", ") +
      (t1.zip ? ` ${t1.zip}` : "")
    : "";

  return (
    <Card data-testid="card-fire-export">
      <CardHeader>
        <CardTitle>{t("reports.fire.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("reports.fire.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">
            {t("reports.fire.year")}
          </label>
          <Input
            type="number"
            value={year}
            min={2020}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value) || year)}
            className="w-24"
            data-testid="input-fire-year"
          />
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={test}
              onChange={(e) => setTest(e.target.checked)}
              data-testid="checkbox-fire-test"
            />
            {t("reports.fire.test")}
          </label>
        </div>

        {/* Transmitter preview — what will be written into the FIRE
            T-record. The server applies placeholder defaults in test
            mode, so we re-fetch on the test toggle and label the
            section accordingly. */}
        <div
          className="rounded-md border bg-muted/30 p-3 text-sm"
          data-testid="section-fire-transmitter"
        >
          <div className="font-medium text-sm mb-1">
            {test
              ? t("reports.fire.transmitter.headingTest")
              : t("reports.fire.transmitter.heading")}
          </div>
          {transmitterLoading && !transmitter && (
            <div
              className="text-xs text-muted-foreground"
              data-testid="text-fire-transmitter-loading"
            >
              {t("reports.fire.transmitter.loading")}
            </div>
          )}
          {transmitterErr && (
            <div
              className="text-xs text-destructive"
              data-testid="text-fire-transmitter-error"
            >
              {t("reports.fire.transmitter.error", {
                message: transmitterErr,
              })}
            </div>
          )}
          {t1 && (
            <dl
              className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2"
              data-testid="grid-fire-transmitter-fields"
            >
              <div className="flex gap-1">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.name")}:
                </dt>
                <dd
                  className="font-medium"
                  data-testid="text-fire-transmitter-name"
                >
                  {t1.name || "—"}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.tcc")}:
                </dt>
                <dd
                  className="font-mono"
                  data-testid="text-fire-transmitter-tcc"
                >
                  {t1.tcc || "—"}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.ein")}:
                </dt>
                <dd
                  className="font-mono"
                  data-testid="text-fire-transmitter-ein"
                >
                  {t1.ein || "—"}
                </dd>
              </div>
              <div className="flex gap-1 sm:col-span-2">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.address")}:
                </dt>
                <dd data-testid="text-fire-transmitter-address">
                  {t1.mailingAddress || "—"}
                  {cityStateZip ? ` · ${cityStateZip}` : ""}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.contact")}:
                </dt>
                <dd data-testid="text-fire-transmitter-contact">
                  {t1.contactName || "—"}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.phone")}:
                </dt>
                <dd
                  className="font-mono"
                  data-testid="text-fire-transmitter-phone"
                >
                  {t1.contactPhone || "—"}
                </dd>
              </div>
              <div className="flex gap-1 sm:col-span-2">
                <dt className="text-muted-foreground">
                  {t("reports.fire.transmitter.email")}:
                </dt>
                <dd data-testid="text-fire-transmitter-email">
                  {t1.contactEmail || "—"}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {/* Missing-settings warning — only meaningful when a real
            (non-test) preview reports unset env vars. Test mode is
            always `ok:true` server-side, so this block stays hidden
            when the operator has the test checkbox on. */}
        {transmitter && !transmitter.ok && transmitter.missing.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="alert-fire-transmitter-missing"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <div className="font-medium">
                {t("reports.fire.transmitter.missingHeading")}
              </div>
              <ul className="list-disc pl-4 font-mono text-xs">
                {transmitter.missing.map((key) => (
                  <li
                    key={key}
                    data-testid={`text-fire-transmitter-missing-${key}`}
                  >
                    {key}
                  </li>
                ))}
              </ul>
              <div className="text-xs">
                {t("reports.fire.transmitter.missingNote")}
              </div>
              {user?.role === "admin" && (
                <div className="pt-1">
                  <Link
                    href="/admin/1099-transmitter"
                    className="text-xs font-medium underline underline-offset-2"
                    data-testid="link-fire-transmitter-configure"
                  >
                    {t("reports.fire.transmitter.configureLink")}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(["NEC", "MISC", "K"] as const).map((ft) =>
            blockRealDownload ? (
              <PillButton
                key={ft}
                type="button"
                color="image"
                disabled
                data-testid={`button-fire-${ft.toLowerCase()}-disabled`}
                title={t("reports.fire.transmitter.downloadDisabledTitle")}
              >
                {t("reports.fire.downloadFor", { form: `1099-${ft}` })}
              </PillButton>
            ) : (
              <a
                key={ft}
                href={url(ft)}
                data-testid={`link-fire-${ft.toLowerCase()}`}
              >
                <PillButton type="button" color="image">
                  {t("reports.fire.downloadFor", { form: `1099-${ft}` })}
                </PillButton>
              </a>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bulk-actions history dialog ──────────────────────────────────


// ── Bulk-actions cleanup dialog ───────────────────────────────────
// Wraps the admin-only "Clean up old snapshots" action. The retention
// worker normally fires once at server startup and then every 24 hours;
// this dialog gives admins a way to reclaim snapshot blob space on
// demand (e.g. right after a 5,000-cell CSV import that's no longer
// needed) and shows a count-only preview before any rows are touched.
//
// Flow:
//   1. Open the dialog → fire `dryRun=true` → show "would delete N row(s)".
//   2. Admin clicks "Clean up N rows" → fire `dryRun=false` → show the
//      actual count and surface a banner on the parent card.
//   3. Closing and reopening the dialog re-runs the dry-run so the count
//      stays in sync if other admins are also pruning concurrently.

// Exported alongside the dialog so the focused integration tests in
// reports.cleanup-dialog.test.tsx can build a realistic prop set
// (`onCleanedUp` is the bridge that drives the parent's freed-space
// banner).
export interface BulkActionsCleanupDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCleanedUp: (deleted: number, bytesFreed: number) => void;
}

interface CleanupPreview {
  deleted: number;
  bytesFreed: number;
  protectedRecent: number;
  retentionDays: number;
  minRetained: number;
  cutoff: string;
}

// `formatSnapshotBytes` lives in `../lib/format-bytes` so the cleanup
// dialog component test can import the helper directly and assert the
// byte→KB→MB→GB transitions without rendering React.

export function BulkActionsCleanupDialog({
  open,
  onOpenChange,
  onCleanedUp,
}: BulkActionsCleanupDialogProps): ReactElement {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function fetchPreview(): Promise<void> {
    setPreviewLoading(true);
    setPreviewError(null);
    setApplyError(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/cleanup?dryRun=true`,
        { method: "POST", credentials: "include" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setPreview({
        deleted: Number(j.deleted ?? 0),
        bytesFreed: Number(j.bytesFreed ?? 0),
        protectedRecent: Number(j.protectedRecent ?? 0),
        retentionDays: Number(j.retentionDays ?? 0),
        minRetained: Number(j.minRetained ?? 0),
        cutoff: typeof j.cutoff === "string" ? j.cutoff : "",
      });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Re-fetch the preview every time the dialog is opened so a stale count
  // from a previous open doesn't persist if other admins were pruning in
  // the meantime. Reset all transient state on close.
  useEffect(() => {
    if (open) {
      void fetchPreview();
    } else {
      setPreview(null);
      setPreviewError(null);
      setApplyError(null);
      setApplying(false);
    }
    // We intentionally only respond to `open` toggling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleApply(): Promise<void> {
    setApplying(true);
    setApplyError(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/cleanup`,
        { method: "POST", credentials: "include" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const deleted = Number(j.deleted ?? 0);
      const bytesFreed = Number(j.bytesFreed ?? 0);
      onCleanedUp(deleted, bytesFreed);
      onOpenChange(false);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  const hasPreview = preview != null;
  const nothingToDo = hasPreview && preview.deleted === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="dialog-bulk-actions-cleanup"
      >
        <DialogHeader>
          <DialogTitle>{t("reports.qbMapping.cleanup.title")}</DialogTitle>
          <DialogDescription>
            {t("reports.qbMapping.cleanup.description")}
          </DialogDescription>
        </DialogHeader>
        {previewLoading && (
          <p
            className="text-sm text-muted-foreground flex items-center gap-2"
            data-testid="text-cleanup-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("reports.qbMapping.cleanup.loading")}
          </p>
        )}
        {previewError && (
          <p
            className="text-sm text-destructive"
            data-testid="text-cleanup-preview-error"
          >
            {t("reports.qbMapping.cleanup.previewError", {
              msg: previewError,
            })}
          </p>
        )}
        {hasPreview && !previewLoading && (
          <div className="space-y-2 text-sm">
            <p
              className="font-medium"
              data-testid="text-cleanup-preview-count"
            >
              {t("reports.qbMapping.cleanup.previewCount", {
                count: preview.deleted,
              })}
            </p>
            {!nothingToDo && (
              <p
                className="text-muted-foreground"
                data-testid="text-cleanup-preview-freed"
              >
                {t("reports.qbMapping.cleanup.freed", {
                  size: formatSnapshotBytes(preview.bytesFreed),
                })}
              </p>
            )}
            <p
              className="text-muted-foreground"
              data-testid="text-cleanup-policy"
            >
              {t("reports.qbMapping.cleanup.policy", {
                days: preview.retentionDays,
                kept: preview.minRetained,
              })}
            </p>
            {nothingToDo && (
              <p
                className="text-muted-foreground"
                data-testid="text-cleanup-nothing"
              >
                {t("reports.qbMapping.cleanup.nothing")}
              </p>
            )}
          </div>
        )}
        {applyError && (
          <p
            className="text-sm text-destructive"
            data-testid="text-cleanup-apply-error"
          >
            {applyError}
          </p>
        )}
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            disabled={applying}
            data-testid="button-cleanup-cancel"
          >
            {t("reports.qbMapping.cleanup.cancel")}
          </PillButton>
          <PillButton
            color="blue"
            disabled={
              applying || previewLoading || !hasPreview || nothingToDo
            }
            onClick={handleApply}
            data-testid="button-cleanup-confirm"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {applying
              ? t("reports.qbMapping.cleanup.applying")
              : hasPreview
                ? t("reports.qbMapping.cleanup.confirm", {
                    count: preview.deleted,
                  })
                : t("reports.qbMapping.cleanup.confirmDisabled")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk-action retention dialog ─────────────────────────────────
//
// Lets an admin tune the QuickBooks-mapping bulk-action undo retention
// window without touching env vars or shipping a deploy. The current
// value is read from /platform-settings (server-side that field
// `qbBulkActionRetentionDays` overrides the QB_BULK_ACTION_RETENTION_DAYS
// env var, which itself overrides the 90-day code default). Saving the
// dialog PATCHes the same row; clearing the value falls the server back
// to the env-var default.
//
// We surface the *currently effective* value (read from the bulk-actions
// list payload) as the placeholder so the admin can see "what is the
// undo window today?" even when the override is unset.

interface BulkActionsRetentionDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Currently effective retention window in days, sourced from the
   *  bulk-actions list payload. May be null if that response hasn't
   *  loaded yet. Used as placeholder copy when no override is set. */
  currentEffectiveDays: number | null;
  /** Called after a successful save with the new effective window
   *  (resolved server-side) and whether the value cleared the override
   *  (true) or set an explicit one (false). */
  onSaved: (effectiveDays: number, usedDefault: boolean) => void;
}

const RETENTION_MIN_DAYS = 1;
const RETENTION_MAX_DAYS = 1825;

// Last-change record for the retention setting. Mirrors the
// `PlatformSettingsFieldChange` schema in the OpenAPI spec — kept as a
// local interface to avoid pulling the generated types into this file.
interface RetentionLastChange {
  changedAt: string;
  actorUserId: number | null;
  actorDisplayName: string | null;
  actorRole: string;
  prevValue: string | null;
  newValue: string | null;
}

function BulkActionsRetentionDialog({
  open,
  onOpenChange,
  currentEffectiveDays,
  onSaved,
}: BulkActionsRetentionDialogProps): ReactElement {
  const { t, i18n } = useTranslation();
  // `null` means "use default" (clear the override); a number is the
  // explicit override the admin wants to persist.
  const [override, setOverride] = useState<number | null>(null);
  const [hasOverride, setHasOverride] = useState<boolean>(false);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<RetentionLastChange | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      // Reset transient state on close so a stale error from a prior open
      // doesn't flash on the next open.
      setLoadError(null);
      setSaveError(null);
      setSaving(false);
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetch(`${API_BASE}/api/platform-settings`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(
        (j: {
          qbBulkActionRetentionDays?: number | null;
          qbBulkActionRetentionLastChange?: RetentionLastChange | null;
        }) => {
          if (!active) return;
          const v = j?.qbBulkActionRetentionDays;
          if (typeof v === "number" && Number.isInteger(v)) {
            setOverride(v);
            setHasOverride(true);
            setText(String(v));
          } else {
            setOverride(null);
            setHasOverride(false);
            setText("");
          }
          setLastChange(j?.qbBulkActionRetentionLastChange ?? null);
        },
      )
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Format an audited value (stringified integer or null) into a
  // localized "N days" / "system default" phrase.
  function formatRetentionValue(raw: string | null): string {
    if (raw == null) return t("reports.qbMapping.retention.lastChange.valueDefault");
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return raw;
    return t("reports.qbMapping.retention.lastChange.valueDays", { count: n });
  }

  // Render the change summary line: prefer "{{from}} → {{to}} days"
  // when both values share the day unit (i.e. neither is "system
  // default"), otherwise fall back to the bare arrow form so the unit
  // word doesn't double up as in "5 days → system default days".
  function formatChangeSummary(change: RetentionLastChange): string {
    const prevIsDays =
      change.prevValue != null && Number.isInteger(Number(change.prevValue));
    const nextIsDays =
      change.newValue != null && Number.isInteger(Number(change.newValue));
    if (prevIsDays && nextIsDays) {
      const next = Number(change.newValue);
      return t("reports.qbMapping.retention.lastChange.fromToSameUnit", {
        count: next,
        from: change.prevValue,
        to: change.newValue,
      });
    }
    return t("reports.qbMapping.retention.lastChange.fromTo", {
      from: formatRetentionValue(change.prevValue),
      to: formatRetentionValue(change.newValue),
    });
  }

  const trimmed = text.trim();
  const wantsClear = trimmed === "";
  const parsed = wantsClear ? null : Number(trimmed);
  const isValid =
    wantsClear ||
    (parsed != null &&
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= RETENTION_MIN_DAYS &&
      parsed <= RETENTION_MAX_DAYS);
  // Disable Save when nothing actually changed (clearing an unset
  // override, or typing the same number that's already saved).
  const noChange =
    (wantsClear && !hasOverride) ||
    (!wantsClear && hasOverride && parsed === override);

  async function handleSave(): Promise<void> {
    if (!isValid) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`${API_BASE}/api/platform-settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qbBulkActionRetentionDays: wantsClear ? null : parsed,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      // Re-fetch the bulk-actions list endpoint to learn the new
      // effective window (which resolves to the env-var fallback when
      // we cleared the override). We could compute this client-side but
      // the server is the source of truth and a single small request
      // keeps the two in lockstep.
      let effectiveDays = wantsClear
        ? (currentEffectiveDays ?? 90)
        : (parsed as number);
      try {
        const r2 = await fetch(
          `${API_BASE}/api/reports/qb-account-mapping/bulk-actions?limit=1`,
          { credentials: "include" },
        );
        if (r2.ok) {
          const j2: { retentionDays?: number } = await r2.json();
          if (typeof j2.retentionDays === "number") {
            effectiveDays = j2.retentionDays;
          }
        }
      } catch {
        // Falling back to the optimistic value is fine; the parent
        // refreshes the banner on its own next render.
      }
      onSaved(effectiveDays, wantsClear);
      onOpenChange(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="dialog-bulk-actions-retention"
      >
        <DialogHeader>
          <DialogTitle>{t("reports.qbMapping.retention.title")}</DialogTitle>
          <DialogDescription>
            {t("reports.qbMapping.retention.description")}
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p
            className="text-sm text-muted-foreground flex items-center gap-2"
            data-testid="text-retention-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("reports.qbMapping.retention.loading")}
          </p>
        )}
        {loadError && (
          <p
            className="text-sm text-destructive"
            data-testid="text-retention-load-error"
          >
            {t("reports.qbMapping.retention.loadError", { msg: loadError })}
          </p>
        )}
        {!loading && !loadError && (
          <div className="space-y-2 text-sm">
            <Label htmlFor="input-retention-days">
              {t("reports.qbMapping.retention.fieldLabel")}
            </Label>
            <Input
              id="input-retention-days"
              type="number"
              inputMode="numeric"
              min={RETENTION_MIN_DAYS}
              max={RETENTION_MAX_DAYS}
              step={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                currentEffectiveDays != null
                  ? t("reports.qbMapping.retention.placeholderWithDefault", {
                      count: currentEffectiveDays,
                    })
                  : t("reports.qbMapping.retention.placeholder")
              }
              data-testid="input-retention-days"
            />
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-retention-hint"
            >
              {t("reports.qbMapping.retention.hint", {
                min: RETENTION_MIN_DAYS,
                max: RETENTION_MAX_DAYS,
              })}
            </p>
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-retention-current"
            >
              {hasOverride
                ? t("reports.qbMapping.retention.currentOverride", {
                    count: override ?? 0,
                  })
                : currentEffectiveDays != null
                  ? t("reports.qbMapping.retention.currentDefault", {
                      count: currentEffectiveDays,
                    })
                  : t("reports.qbMapping.retention.currentUnknown")}
            </p>
            {!wantsClear && !isValid && (
              <p
                className="text-xs text-destructive"
                data-testid="text-retention-validation"
              >
                {t("reports.qbMapping.retention.outOfRange", {
                  min: RETENTION_MIN_DAYS,
                  max: RETENTION_MAX_DAYS,
                })}
              </p>
            )}
            <div
              className="mt-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5"
              data-testid="text-retention-last-change"
            >
              <p className="font-medium text-foreground">
                {t("reports.qbMapping.retention.lastChange.heading")}
              </p>
              {lastChange == null ? (
                <p data-testid="text-retention-last-change-empty">
                  {t("reports.qbMapping.retention.lastChange.neverCustomized")}
                </p>
              ) : (
                <>
                  <p data-testid="text-retention-last-change-actor">
                    {(() => {
                      const when = new Date(
                        lastChange.changedAt,
                      ).toLocaleString(i18n.language);
                      return lastChange.actorDisplayName
                        ? t("reports.qbMapping.retention.lastChange.byActor", {
                            actor: lastChange.actorDisplayName,
                            when,
                          })
                        : t(
                            "reports.qbMapping.retention.lastChange.byUnknown",
                            { when },
                          );
                    })()}
                  </p>
                  <p data-testid="text-retention-last-change-summary">
                    {formatChangeSummary(lastChange)}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        {saveError && (
          <p
            className="text-sm text-destructive"
            data-testid="text-retention-save-error"
          >
            {saveError}
          </p>
        )}
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            data-testid="button-retention-cancel"
          >
            {t("reports.qbMapping.retention.cancel")}
          </PillButton>
          {hasOverride && !wantsClear && (
            <PillButton
              color="image"
              onClick={() => setText("")}
              disabled={saving || loading}
              data-testid="button-retention-use-default"
            >
              {t("reports.qbMapping.retention.useDefault")}
            </PillButton>
          )}
          <PillButton
            color="blue"
            onClick={handleSave}
            disabled={saving || loading || !isValid || noChange}
            data-testid="button-retention-save"
          >
            <Save className="h-4 w-4 mr-1" />
            {saving
              ? t("reports.qbMapping.retention.saving")
              : wantsClear
                ? t("reports.qbMapping.retention.saveClear")
                : t("reports.qbMapping.retention.save")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ── Bulk-apply dialog ────────────────────────────────────────────

interface BulkApplyDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  vendors: VendorOption[];
  partners: PartnerOption[];
  items: QbMappingItem[] | null;
  onApply: (args: {
    vendorIds: number[];
    partnerIds: number[];
    lineType: string;
    accountName: string;
    accountNumber: string;
  }) => Promise<{ upserted: number; scopes: number }>;
}

function BulkApplyDialog({
  open,
  onOpenChange,
  vendors,
  partners,
  items,
  onApply,
}: BulkApplyDialogProps): ReactElement {
  const { t } = useTranslation();
  // Seed with the first known line-type so the dialog's Apply button can
  // enable as soon as the user fills in an account name. We'll re-sync it
  // whenever the dialog re-opens with a now-known list of items.
  const [lineType, setLineType] = useState<string>("labor_regular");
  const [accountName, setAccountName] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [vendorIds, setVendorIds] = useState<Set<number>>(new Set());
  const [partnerIds, setPartnerIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  // If the seeded default isn't in the loaded items list (e.g. server changed
  // its mappable line-types), switch to whatever the first loaded item is.
  useEffect(() => {
    if (open && items && items.length > 0) {
      if (!items.some((i) => i.lineType === lineType)) {
        setLineType(items[0].lineType);
      }
    }
  }, [open, items, lineType]);

  // Reset transient feedback whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setErr(null);
      setOkMessage(null);
    }
  }, [open]);

  function toggle(set: Set<number>, id: number): Set<number> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  // Cross-product preview: empty axis means "leave that axis NULL", so the
  // count is max(1, vendors) * max(1, partners) — same math as the server.
  const scopeCount =
    Math.max(1, vendorIds.size) * Math.max(1, partnerIds.size);

  const canSubmit =
    !busy &&
    lineType.trim().length > 0 &&
    accountName.trim().length > 0 &&
    scopeCount > 0;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    setOkMessage(null);
    try {
      const result = await onApply({
        vendorIds: Array.from(vendorIds),
        partnerIds: Array.from(partnerIds),
        lineType,
        accountName,
        accountNumber,
      });
      setOkMessage(
        t("reports.qbMapping.bulkApplied", {
          count: result.upserted,
          scopes: result.scopes,
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="dialog-bulk-apply"
      >
        <DialogHeader>
          <DialogTitle>{t("reports.qbMapping.bulkApply")}</DialogTitle>
          <DialogDescription>
            {t("reports.qbMapping.bulkDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-line-type">
                {t("reports.qbMapping.col.lineType")}
              </Label>
              {/*
                Native <select> on purpose: a Radix Select rendered inside a
                Radix Dialog has well-known click-pass-through quirks, and a
                native control is more reliable for this admin form.
              */}
              <select
                id="bulk-line-type"
                data-testid="select-bulk-line-type"
                value={lineType}
                onChange={(e) => setLineType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {(items ?? []).map((it) => (
                  <option key={it.lineType} value={it.lineType}>
                    {it.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-account-name">
                {t("reports.qbMapping.col.accountName")}
              </Label>
              <Input
                id="bulk-account-name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                data-testid="input-bulk-account-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bulk-account-number">
                {t("reports.qbMapping.col.accountNumber")}
              </Label>
              <Input
                id="bulk-account-number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                data-testid="input-bulk-account-number"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BulkPickerColumn
              titleAll={t("reports.qbMapping.bulkAllVendors")}
              titlePicked={t("reports.qbMapping.vendorsPicked", {
                count: vendorIds.size,
              })}
              clearLabel={t("reports.qbMapping.clear")}
              selectAllLabel={t("reports.qbMapping.selectAll")}
              options={vendors}
              picked={vendorIds}
              onToggle={(id) => setVendorIds((s) => toggle(s, id))}
              onClear={() => setVendorIds(new Set())}
              onSelectAll={() => setVendorIds(new Set(vendors.map((v) => v.id)))}
              testIdPrefix="bulk-vendor"
            />
            <BulkPickerColumn
              titleAll={t("reports.qbMapping.bulkAllPartners")}
              titlePicked={t("reports.qbMapping.partnersPicked", {
                count: partnerIds.size,
              })}
              clearLabel={t("reports.qbMapping.clear")}
              selectAllLabel={t("reports.qbMapping.selectAll")}
              options={partners}
              picked={partnerIds}
              onToggle={(id) => setPartnerIds((s) => toggle(s, id))}
              onClear={() => setPartnerIds(new Set())}
              onSelectAll={() =>
                setPartnerIds(new Set(partners.map((p) => p.id)))
              }
              testIdPrefix="bulk-partner"
            />
          </div>
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-bulk-scope-count"
          >
            {t("reports.qbMapping.bulkScopeCount", { count: scopeCount })}
          </p>
          {err && (
            <p
              className="text-sm text-destructive"
              data-testid="text-bulk-error"
            >
              {err}
            </p>
          )}
          {okMessage && (
            <p
              className="text-sm text-emerald-600"
              data-testid="text-bulk-success"
            >
              {okMessage}
            </p>
          )}
        </div>
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid="button-bulk-cancel"
          >
            {t("common.cancel")}
          </PillButton>
          <PillButton
            color="blue"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="button-bulk-submit"
          >
            {busy
              ? t("reports.qbMapping.applying")
              : t("reports.qbMapping.applyButton", { count: scopeCount })}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkPickerColumnProps {
  titleAll: string;
  titlePicked: string;
  clearLabel: string;
  selectAllLabel: string;
  options: { id: number; name: string }[];
  picked: Set<number>;
  onToggle: (id: number) => void;
  onClear: () => void;
  onSelectAll: () => void;
  testIdPrefix: string;
}

function BulkPickerColumn(props: BulkPickerColumnProps): ReactElement {
  const empty = props.picked.size === 0;
  return (
    <div className="border rounded-md">
      <div className="flex items-center justify-between px-3 py-2 border-b text-sm">
        <span data-testid={`text-${props.testIdPrefix}-title`}>
          {empty ? props.titleAll : props.titlePicked}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={props.onSelectAll}
            data-testid={`button-${props.testIdPrefix}-select-all`}
          >
            {props.selectAllLabel}
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={props.onClear}
            data-testid={`button-${props.testIdPrefix}-clear`}
          >
            {props.clearLabel}
          </button>
        </div>
      </div>
      <div className="max-h-60 overflow-y-auto p-2 space-y-1">
        {props.options.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">—</p>
        )}
        {props.options.map((opt) => {
          const id = `${props.testIdPrefix}-${opt.id}`;
          return (
            <label
              key={opt.id}
              htmlFor={id}
              className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded hover:bg-accent"
            >
              <Checkbox
                id={id}
                checked={props.picked.has(opt.id)}
                onCheckedChange={() => props.onToggle(opt.id)}
                data-testid={`checkbox-${props.testIdPrefix}-${opt.id}`}
              />
              <span>{opt.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── page entry ───────────────────────────────────────────────────

export default function ReportsPage(): ReactElement {
  const { user } = useAuth();
  const { t } = useTranslation();
  // Parse the deep-link once on mount; reconciliation links open this
  // page in a new tab, so the URL is final at first render.
  const deepLink = useMemo(() => parseReportDeepLinkFromUrl(), []);

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("reports.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("reports.pageDescription")}
          </p>
        </div>
      </div>

      {user?.role === "vendor" && user.vendorId && (
        <VendorReports vendorId={user.vendorId} deepLink={deepLink} />
      )}
      {user?.role === "partner" && user.partnerId && (
        <PartnerReports partnerId={user.partnerId} deepLink={deepLink} />
      )}
      {user?.role === "admin" && <AdminReports deepLink={deepLink} />}
      {!user && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}
    </div>
  );
}
