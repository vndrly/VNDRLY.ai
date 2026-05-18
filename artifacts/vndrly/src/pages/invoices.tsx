import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Receipt, CloudCheck, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import SphereBackButton from "@/components/sphere-back-button";
import TogglePill, { type TogglePillColor } from "@/components/toggle-pill";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type InvoicePushedStatus = {
  pushedAt: string;
  externalInvoiceId: string | null;
  externalDocNumber: string | null;
};

type InvoicePushedTo = {
  qbo: InvoicePushedStatus | null;
  oa: InvoicePushedStatus | null;
};

type InvoiceRow = {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  partnerId: number;
  cadence: "per_ticket" | "weekly" | "monthly";
  status: "draft" | "open" | "sent" | "paid" | "overdue" | "cancelled";
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  // True when SUM(non-voided payments) — tracked server-side as
  // invoice.paid_amount — exceeds invoice.total. Surfaced so AP can
  // refund the vendor or void the duplicate payment.
  overpaid: boolean;
  // Exact dollar delta (paidAmount - total, clamped at 0). Already a
  // pre-formatted string with two decimals.
  overpaidAmount: string;
  generatedAt: string;
  pushedTo: InvoicePushedTo;
};

const STATUSES = [
  "all",
  "draft",
  "open",
  "sent",
  "paid",
  "overdue",
  "cancelled",
] as const;

// Mirrors the `pushed=` query param accepted by GET /api/invoices.
// "any" is the no-filter default; the API treats it as a no-op so we
// only forward the param when the admin actually narrows the view.
const PUSHED_FILTERS = ["any", "qbo", "oa", "none"] as const;
type PushedFilter = (typeof PUSHED_FILTERS)[number];

function isPushedFilter(v: string | null | undefined): v is PushedFilter {
  return !!v && (PUSHED_FILTERS as readonly string[]).includes(v);
}

function isStatus(v: string | null | undefined): v is (typeof STATUSES)[number] {
  return !!v && (STATUSES as readonly string[]).includes(v);
}

// Accept only YYYY-MM-DD so the value matches the API's `z.iso.date()`
// schema and the native <input type="date"> control. Anything else is
// treated as "no bound" rather than forwarded as-is.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeIsoDate(v: string | null | undefined): string {
  return v && ISO_DATE_RE.test(v) ? v : "";
}

function formatMoney(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString();
}

function statusPillColor(
  status: InvoiceRow["status"],
): TogglePillColor {
  switch (status) {
    case "paid":
      return "green";
    case "sent":
    case "open":
      return "blue";
    case "overdue":
      return "red";
    case "cancelled":
      return "amber";
    case "draft":
    default:
      return "blue";
  }
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

const PUSHED_PROVIDER_META = {
  qbo: {
    label: "QuickBooks",
    short: "QBO",
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100",
  },
  oa: {
    label: "OpenAccountant",
    short: "OA",
    badgeClass:
      "bg-sky-100 text-sky-800 border-sky-300 hover:bg-sky-100",
  },
} as const;

function PushedBadges({
  pushedTo,
  invoiceId,
}: {
  pushedTo: InvoicePushedTo;
  invoiceId: number;
}) {
  const { t } = useTranslation();
  const entries = (["qbo", "oa"] as const)
    .map((p) => ({ provider: p, status: pushedTo[p] }))
    .filter((e): e is { provider: "qbo" | "oa"; status: InvoicePushedStatus } =>
      e.status !== null,
    );
  if (entries.length === 0) {
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid={`pushed-none-${invoiceId}`}
      >
        {t("invoices.pushed.none")}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(({ provider, status }) => {
        const meta = PUSHED_PROVIDER_META[provider];
        return (
          <HoverCard key={provider} openDelay={120} closeDelay={80}>
            <HoverCardTrigger asChild>
              <Badge
                variant="outline"
                className={`gap-1 cursor-help ${meta.badgeClass}`}
                data-testid={`pushed-badge-${provider}-${invoiceId}`}
              >
                <CloudCheck className="h-3 w-3" />
                {meta.short}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent
              align="start"
              className="w-72 text-sm"
              data-testid={`pushed-popover-${provider}-${invoiceId}`}
            >
              <div className="font-medium mb-2">
                {t("invoices.pushed.title", { provider: meta.label })}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">
                  {t("invoices.pushed.when")}
                </dt>
                <dd className="tabular-nums">
                  {formatDateTime(status.pushedAt)}
                </dd>
                <dt className="text-muted-foreground">
                  {t("invoices.pushed.docNumber")}
                </dt>
                <dd className="font-mono text-xs break-all">
                  {status.externalDocNumber ?? "—"}
                </dd>
                <dt className="text-muted-foreground">
                  {t("invoices.pushed.remoteId")}
                </dt>
                <dd className="font-mono text-xs break-all">
                  {status.externalInvoiceId ?? "—"}
                </dd>
              </dl>
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}

export default function InvoicesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();

  // Hydrate filter state from the URL on first paint so a bookmarked or
  // shared `/invoices?status=…&pushed=…&invoiceNumber=…` link lands on
  // the same view the sender saw. Unknown values fall back to the "no
  // filter" defaults. The `invoiceNumber` filter is also how the
  // reconciliation drift warnings on the reports page deep-link into a
  // pre-narrowed list when the exact invoice id can't be resolved —
  // we trim and cap it to the API's 64-char limit so a stray paste
  // doesn't blow past server validation.
  const initial = useMemo(() => {
    const params = new URLSearchParams(search);
    const s = params.get("status");
    const p = params.get("pushed");
    const n = params.get("invoiceNumber");
    const o = params.get("overpaid");
    const ps = params.get("periodStart");
    const pe = params.get("periodEnd");
    return {
      status: isStatus(s) ? s : ("all" as const),
      pushed: isPushedFilter(p) ? p : ("any" as PushedFilter),
      invoiceNumber: n ? n.trim().slice(0, 64) : "",
      overpaid: o === "true" || o === "1",
      periodStart: normalizeIsoDate(ps),
      periodEnd: normalizeIsoDate(pe),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [status, setStatus] = useState<string>(initial.status);
  const [pushed, setPushed] = useState<PushedFilter>(initial.pushed);
  const [invoiceNumber, setInvoiceNumber] = useState<string>(
    initial.invoiceNumber,
  );
  const [overpaidOnly, setOverpaidOnly] = useState<boolean>(initial.overpaid);
  const [periodStart, setPeriodStart] = useState<string>(initial.periodStart);
  const [periodEnd, setPeriodEnd] = useState<string>(initial.periodEnd);

  // Sync external URL changes (back/forward navigation, link clicks) into
  // local state. Local state is the source of truth for the request.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const s = params.get("status");
    const p = params.get("pushed");
    const n = params.get("invoiceNumber");
    const o = params.get("overpaid");
    const ps = params.get("periodStart");
    const pe = params.get("periodEnd");
    const nextStatus = isStatus(s) ? s : "all";
    const nextPushed = isPushedFilter(p) ? p : "any";
    const nextInvoiceNumber = n ? n.trim().slice(0, 64) : "";
    const nextOverpaid = o === "true" || o === "1";
    const nextPeriodStart = normalizeIsoDate(ps);
    const nextPeriodEnd = normalizeIsoDate(pe);
    if (nextStatus !== status) setStatus(nextStatus);
    if (nextPushed !== pushed) setPushed(nextPushed);
    if (nextInvoiceNumber !== invoiceNumber)
      setInvoiceNumber(nextInvoiceNumber);
    if (nextOverpaid !== overpaidOnly) setOverpaidOnly(nextOverpaid);
    if (nextPeriodStart !== periodStart) setPeriodStart(nextPeriodStart);
    if (nextPeriodEnd !== periodEnd) setPeriodEnd(nextPeriodEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Push filter selections back into the URL so admins can share or
  // bookmark a narrowed view. We omit defaults to keep the URL tidy and
  // use replaceState so flipping filters doesn't pollute the back stack.
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (status === "all") params.delete("status");
    else params.set("status", status);
    if (pushed === "any") params.delete("pushed");
    else params.set("pushed", pushed);
    if (!invoiceNumber) params.delete("invoiceNumber");
    else params.set("invoiceNumber", invoiceNumber);
    if (overpaidOnly) params.set("overpaid", "true");
    else params.delete("overpaid");
    if (periodStart) params.set("periodStart", periodStart);
    else params.delete("periodStart");
    if (periodEnd) params.set("periodEnd", periodEnd);
    else params.delete("periodEnd");
    const qs = params.toString();
    const target = `/invoices${qs ? `?${qs}` : ""}`;
    const current = `/invoices${search ? `?${search}` : ""}`;
    if (target !== current) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pushed, invoiceNumber, overpaidOnly, periodStart, periodEnd]);

  const { data, isLoading } = useQuery<{ items: InvoiceRow[] }>({
    queryKey: [
      "invoices",
      "list",
      status,
      pushed,
      invoiceNumber,
      overpaidOnly,
      periodStart,
      periodEnd,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (pushed !== "any") params.set("pushed", pushed);
      if (invoiceNumber) params.set("invoiceNumber", invoiceNumber);
      if (overpaidOnly) params.set("overpaid", "true");
      if (periodStart) params.set("periodStart", periodStart);
      if (periodEnd) params.set("periodEnd", periodEnd);
      const res = await fetch(`${API_BASE}/api/invoices?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load invoices");
      return res.json();
    },
  });

  // "N not synced" badge. We always force `pushed=none` here regardless of
  // the user's current Sync filter selection so the badge answers the
  // standing question "is there anything left to push?" — including when
  // the admin is currently viewing a different bucket (e.g. "Synced to
  // QuickBooks"). Other active filters (status, invoiceNumber,
  // overpaidOnly) are honoured so the count matches the rest of the page
  // scope. Sits under the same `["invoices", "list"]` queryKey prefix so
  // existing post-mutation invalidations (sync, void, payment, etc.)
  // refresh it without any new wiring.
  const { data: notSyncedData } = useQuery<{ count: number }>({
    queryKey: [
      "invoices",
      "list",
      "sync-counts",
      status,
      invoiceNumber,
      overpaidOnly,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      params.set("pushed", "none");
      if (invoiceNumber) params.set("invoiceNumber", invoiceNumber);
      if (overpaidOnly) params.set("overpaid", "true");
      params.set("countOnly", "1");
      const res = await fetch(
        `${API_BASE}/api/invoices?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load not-synced count");
      return res.json();
    },
  });
  const notSyncedCount = notSyncedData?.count ?? 0;

  const rows = useMemo(() => data?.items ?? [], [data]);
  const overpaidCount = useMemo(
    () => rows.filter((r) => r.overpaid).length,
    [rows],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="group inline-flex items-center"
            aria-label={t("common.back", { defaultValue: "Back" })}
            data-testid="button-back"
          >
            <SphereBackButton size={40} />
          </Link>
          <h1 className="text-2xl font-semibold">{t("invoices.title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("invoices.filterStatus")}
          </span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              className="w-40"
              data-testid="select-invoice-status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`invoices.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("invoices.filterPushed")}
          </span>
          <Select
            value={pushed}
            onValueChange={(v) =>
              setPushed(isPushedFilter(v) ? v : "any")
            }
          >
            <SelectTrigger
              className="w-44"
              data-testid="select-invoice-pushed"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PUSHED_FILTERS.map((p) => (
                <SelectItem
                  key={p}
                  value={p}
                  data-testid={`option-pushed-${p}`}
                >
                  {t(`invoices.pushedFilter.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("invoices.filterPeriod")}
          </span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(normalizeIsoDate(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid="input-period-start"
            aria-label={t("invoices.filterPeriodStart")}
            max={periodEnd || undefined}
          />
          <span className="text-sm text-muted-foreground">–</span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(normalizeIsoDate(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid="input-period-end"
            aria-label={t("invoices.filterPeriodEnd")}
            min={periodStart || undefined}
          />
          {(periodStart || periodEnd) && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline focus:underline focus:outline-none"
              onClick={() => {
                setPeriodStart("");
                setPeriodEnd("");
              }}
              data-testid="button-clear-period"
            >
              {t("common.clear")}
            </button>
          )}
          {notSyncedCount > 0 && (
            <button
              type="button"
              onClick={() => setPushed("none")}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-full"
              data-testid="badge-not-synced-count"
              aria-label={t("invoices.notSyncedBadge.aria", {
                count: notSyncedCount,
              })}
              title={t("invoices.notSyncedBadge.tooltip")}
            >
              <Badge
                variant="outline"
                className="gap-1 cursor-pointer bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200"
              >
                <CloudCheck className="h-3 w-3" aria-hidden />
                {t("invoices.notSyncedBadge.label", {
                  count: notSyncedCount,
                })}
              </Badge>
            </button>
          )}
          <label
            className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900"
            data-testid="filter-overpaid-only"
          >
            <Switch
              checked={overpaidOnly}
              onCheckedChange={setOverpaidOnly}
              data-testid="switch-overpaid-only"
              aria-label={t("invoices.overpaid.filterLabel")}
            />
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span>{t("invoices.overpaid.filterLabel")}</span>
          </label>
        </div>
      </div>

      {overpaidCount > 0 && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2"
          data-testid="overpaid-summary-banner"
          role="status"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <div className="font-medium">
              {t("invoices.overpaid.summaryTitle", { count: overpaidCount })}
            </div>
            <div className="text-amber-800">
              {t("invoices.overpaid.summaryHelper")}
            </div>
          </div>
        </div>
      )}

      {invoiceNumber && (
        <div
          className="flex items-center gap-2"
          data-testid="filter-chip-invoice-number"
        >
          <Badge variant="outline" className="font-mono">
            {t("invoices.filterInvoiceNumber", { number: invoiceNumber })}
          </Badge>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline focus:underline focus:outline-none"
            onClick={() => setInvoiceNumber("")}
            data-testid="button-clear-invoice-number"
          >
            {t("common.clear")}
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.col.invoiceNumber")}</TableHead>
                <TableHead>{t("invoices.col.cadence")}</TableHead>
                <TableHead>{t("invoices.col.period")}</TableHead>
                <TableHead>{t("invoices.col.status")}</TableHead>
                <TableHead className="text-right">
                  {t("invoices.col.subtotal")}
                </TableHead>
                <TableHead className="text-right">
                  {t("invoices.col.tax")}
                </TableHead>
                <TableHead className="text-right">
                  {t("invoices.col.total")}
                </TableHead>
                <TableHead>{t("invoices.col.due")}</TableHead>
                <TableHead>{t("invoices.col.synced")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center text-muted-foreground py-8"
                    data-testid="empty-invoices"
                  >
                    {t("invoices.empty", {
                      defaultValue:
                        user?.role === "vendor"
                          ? "No invoices yet. Approve tickets to generate them."
                          : "No invoices match the current filter.",
                    })}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid={`row-invoice-${row.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/invoices/${row.id}`}
                          className="group inline-flex items-center gap-2 font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors"
                          data-testid={`link-invoice-${row.id}`}
                        >
                          <Receipt className="w-4 h-4 text-[var(--brand-primary)] shrink-0" />
                          <span>{row.invoiceNumber}</span>
                        </Link>
                        {row.overpaid && (
                          <HoverCard openDelay={120} closeDelay={80}>
                            <HoverCardTrigger asChild>
                              <Link
                                href={`/invoices/${row.id}`}
                                data-testid={`badge-overpaid-${row.id}`}
                                aria-label={t("invoices.overpaid.badge")}
                              >
                                <Badge
                                  variant="outline"
                                  className="gap-1 cursor-help bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  {t("invoices.overpaid.badge")}
                                </Badge>
                              </Link>
                            </HoverCardTrigger>
                            <HoverCardContent
                              align="start"
                              className="w-72 text-sm"
                              data-testid={`overpaid-popover-${row.id}`}
                            >
                              <div className="font-medium mb-2">
                                {t("invoices.overpaid.popoverTitle")}
                              </div>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                <dt className="text-muted-foreground">
                                  {t("invoices.overpaid.invoiceTotal")}
                                </dt>
                                <dd className="tabular-nums text-right">
                                  {formatMoney(row.total)}
                                </dd>
                                <dt className="text-muted-foreground">
                                  {t("invoices.overpaid.paidAmount")}
                                </dt>
                                <dd className="tabular-nums text-right">
                                  {formatMoney(row.paidAmount)}
                                </dd>
                                <dt className="text-muted-foreground font-medium">
                                  {t("invoices.overpaid.delta")}
                                </dt>
                                <dd className="tabular-nums text-right font-semibold text-amber-700">
                                  {formatMoney(row.overpaidAmount)}
                                </dd>
                              </dl>
                              <div className="mt-2 text-xs text-muted-foreground">
                                {t("invoices.overpaid.popoverHelper")}
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t(`invoices.cadence.${row.cadence}`)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                    </TableCell>
                    <TableCell>
                      <TogglePill
                        color={statusPillColor(row.status)}
                        rest={row.status === "draft"}
                      >
                        {t(`invoices.status.${row.status}`)}
                      </TogglePill>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.subtotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.taxTotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(row.total)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.dueDate)}
                    </TableCell>
                    <TableCell>
                      <PushedBadges
                        pushedTo={row.pushedTo}
                        invoiceId={row.id}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
