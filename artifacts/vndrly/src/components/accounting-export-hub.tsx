import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CARD_ICON_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PngPillButton } from "@/components/png-pill-rollover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Archive,
  Clock,
  Download,
  FileSpreadsheet,
  Package,
  Receipt,
  Wrench,
} from "lucide-react";
import { useBrand } from "@/hooks/use-brand";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

function periodFromDeepLink(
  periodStart: string,
  periodEnd: string,
): PeriodSelection {
  return {
    preset: "custom",
    customStart: periodStart,
    customEnd: periodEnd,
  };
}

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

function triggerDownload(href: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatMoney(s: string | number): string {
  const n = Number(s);
  if (Number.isNaN(n)) return String(s);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatHours(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export interface AccountingExportDeepLink {
  cardId: string;
  periodStart: string;
  periodEnd: string;
}

interface AccountingExportSummary {
  invoiceCount: number;
  lineCount: number;
  totalAmount: string;
  laborHours: string;
  laborAmount: string;
  partsAmount: string;
  taxTotal: string;
}

export interface AccountingExportHubProps {
  role: "vendor" | "partner";
  orgId: number;
  deepLink?: AccountingExportDeepLink | null;
}

export function AccountingExportHub({
  role,
  orgId,
  deepLink,
}: AccountingExportHubProps): ReactElement {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const cardRef = useRef<HTMLDivElement>(null);

  const initialPeriod = useMemo(() => {
    if (
      deepLink?.cardId === "accountingExport" &&
      deepLink.periodStart &&
      deepLink.periodEnd
    ) {
      return periodFromDeepLink(deepLink.periodStart, deepLink.periodEnd);
    }
    return defaultPeriod();
  }, [deepLink]);

  const [period, setPeriod] = useState<PeriodSelection>(initialPeriod);
  const base =
    role === "vendor"
      ? `/api/reports/vendor/${orgId}`
      : `/api/reports/partner/${orgId}`;

  const canDownload =
    period.preset !== "custom" ||
    Boolean(period.customStart && period.customEnd);
  const params = useMemo(() => periodParams(period), [period]);
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);

  const [summary, setSummary] = useState<AccountingExportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (deepLink?.cardId === "accountingExport") {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [deepLink]);

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
      const url = buildUrl(`${base}/accounting-export-summary`, params);
      fetch(url, { credentials: "include", signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? `HTTP ${r.status}`);
          }
          return (await r.json()) as AccountingExportSummary;
        })
        .then((j) => {
          if (cancelled) return;
          setSummary(j);
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
  }, [base, canDownload, params, paramsKey]);

  const download = (path: string): void => {
    if (!canDownload) return;
    triggerDownload(buildUrl(path, params));
  };

  return (
    <Card ref={cardRef} data-testid="card-accounting-export-hub">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive
            className={CARD_TITLE_ICON_CLASS}
            style={iconStyle}
          />
          {t("reports.accountingExport.title")}
        </CardTitle>
        <CardDescription>
          {role === "vendor"
            ? t("reports.accountingExport.descriptionVendor")
            : t("reports.accountingExport.descriptionPartner")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={period.preset}
            onValueChange={(v) =>
              setPeriod({ ...period, preset: v as PeriodPreset })
            }
          >
            <SelectTrigger
              className="w-44"
              data-testid="select-accounting-export-period"
            >
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
          {period.preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={period.customStart}
                onChange={(e) =>
                  setPeriod({ ...period, customStart: e.target.value })
                }
                className="w-40"
                data-testid="input-accounting-export-start"
                aria-label={t("reports.preset.from")}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={period.customEnd}
                onChange={(e) =>
                  setPeriod({ ...period, customEnd: e.target.value })
                }
                className="w-40"
                data-testid="input-accounting-export-end"
                aria-label={t("reports.preset.to")}
              />
            </div>
          )}
        </div>

        {summaryLoading && (
          <Skeleton className="h-16 w-full" data-testid="skeleton-accounting-summary" />
        )}
        {summaryError && (
          <p className="text-sm text-destructive" data-testid="text-accounting-summary-error">
            {t("reports.accountingExport.summaryError")}
          </p>
        )}
        {summary && !summaryLoading && (
          <div
            className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm"
            data-testid="accounting-export-summary-chips"
          >
            <SummaryChip
              icon={Receipt}
              label={t("reports.accountingExport.chip.invoices")}
              value={String(summary.invoiceCount)}
              iconStyle={iconStyle}
            />
            <SummaryChip
              icon={Clock}
              label={t("reports.accountingExport.chip.hours")}
              value={formatHours(summary.laborHours)}
              iconStyle={iconStyle}
            />
            <SummaryChip
              icon={Wrench}
              label={t("reports.accountingExport.chip.parts")}
              value={formatMoney(summary.partsAmount)}
              iconStyle={iconStyle}
            />
            <SummaryChip
              icon={FileSpreadsheet}
              label={t("reports.accountingExport.chip.tax")}
              value={formatMoney(summary.taxTotal)}
              iconStyle={iconStyle}
            />
            <SummaryChip
              icon={Receipt}
              label={t("reports.accountingExport.chip.total")}
              value={formatMoney(summary.totalAmount)}
              iconStyle={iconStyle}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <PngPillButton
            color="blue"
            disabled={!canDownload}
            onClick={() => download(`${base}/line-detail-export?format=csv`)}
            data-testid="button-download-line-detail"
          >
            <Download className="h-4 w-4 mr-1.5" />
            {t("reports.accountingExport.downloadLineDetail")}
          </PngPillButton>

          {role === "vendor" && (
            <>
              <PngPillButton
                color="green"
                disabled={!canDownload}
                onClick={() => {
                  if (!canDownload) return;
                  download(`${base}/quickbooks-export?format=zip`);
                }}
                data-testid="button-download-qbo-zip"
              >
                <Download className="h-4 w-4 mr-1.5" />
                {t("reports.accountingExport.downloadQboZip")}
              </PngPillButton>
              <PngPillButton
                color="green"
                disabled={!canDownload}
                onClick={() => {
                  if (!canDownload) return;
                  download(`${base}/quickbooks-export?format=iif`);
                }}
                data-testid="button-download-qbo-iif"
              >
                <Download className="h-4 w-4 mr-1.5" />
                {t("reports.accountingExport.downloadQboIif")}
              </PngPillButton>
              <PngPillButton
                color="amber"
                disabled={!canDownload}
                onClick={() => download(`${base}/openaccountant-export`)}
                data-testid="button-download-oa-zip"
              >
                <Download className="h-4 w-4 mr-1.5" />
                {t("reports.accountingExport.downloadOaZip")}
              </PngPillButton>
            </>
          )}

          {role === "partner" && (
            <PngPillButton
              color="green"
              disabled={!canDownload}
              onClick={() => download(`${base}/accounting-bundle`)}
              data-testid="button-download-accounting-bundle"
            >
              <Package className="h-4 w-4 mr-1.5" />
              {t("reports.accountingExport.downloadBundle")}
            </PngPillButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryChip(props: {
  icon: typeof Receipt;
  label: string;
  value: string;
  iconStyle: { color: string };
}): ReactElement {
  const Icon = props.icon;
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className={CARD_ICON_CLASS} style={props.iconStyle} />
        <span>{props.label}</span>
      </div>
      <div className="font-semibold tabular-nums mt-0.5">{props.value}</div>
    </div>
  );
}
