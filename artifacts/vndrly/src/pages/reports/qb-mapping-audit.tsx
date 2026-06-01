import {
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ALLOWED_LINE_TYPES } from "./csv-import-preview";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VendorOption { id: number; name: string }
interface PartnerOption { id: number; name: string }

// ── QuickBooks account mapping audit log (admin settings) ────────

interface QbMappingAuditValues {
  accountName?: string | null;
  accountNumber?: string | null;
}

interface QbMappingAuditRow {
  id: number;
  action: "insert" | "update" | "delete";
  mappingId: number | null;
  vendorId: number | null;
  partnerId: number | null;
  vendorName: string | null;
  partnerName: string | null;
  lineType: string;
  oldValues: QbMappingAuditValues | null;
  newValues: QbMappingAuditValues | null;
  actorUserId: number | null;
  actorRole: string;
  actorDisplayName: string | null;
  actorUsername: string | null;
  createdAt: string;
}

function formatScope(
  row: QbMappingAuditRow,
  t: (key: string) => string,
): string {
  const parts: string[] = [];
  if (row.vendorId != null) {
    parts.push(row.vendorName ?? `Vendor ${row.vendorId}`);
  }
  if (row.partnerId != null) {
    parts.push(row.partnerName ?? `Partner ${row.partnerId}`);
  }
  return parts.length === 0 ? t("reports.qbMappingAudit.scope.global") : parts.join(" · ");
}

function formatValue(v: QbMappingAuditValues | null): string {
  if (!v || !v.accountName) return "—";
  return v.accountNumber ? `${v.accountName} (${v.accountNumber})` : v.accountName;
}

interface QbMappingAuditActor {
  id: number;
  displayName: string | null;
}

interface QbMappingAuditFilters {
  lineType: string;
  scope: "" | "vendor" | "partner" | "global";
  vendorId: string;
  partnerId: string;
  actorUserId: string;
  startDate: string;
  endDate: string;
}

const EMPTY_QB_AUDIT_FILTERS: QbMappingAuditFilters = {
  lineType: "",
  scope: "",
  vendorId: "",
  partnerId: "",
  actorUserId: "",
  startDate: "",
  endDate: "",
};

const QB_AUDIT_PAGE_SIZE = 50;
const ANY_VALUE = "__any__";

function buildQbAuditQuery(
  filters: QbMappingAuditFilters,
  offset: number,
): string {
  const params = new URLSearchParams();
  params.set("limit", String(QB_AUDIT_PAGE_SIZE));
  params.set("offset", String(offset));
  if (filters.lineType) params.set("lineType", filters.lineType);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.vendorId) params.set("vendorId", filters.vendorId);
  if (filters.partnerId) params.set("partnerId", filters.partnerId);
  if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  return params.toString();
}

export function QbAccountMappingAuditCard(): ReactElement {
  const { t } = useTranslation();
  const [rows, setRows] = useState<QbMappingAuditRow[] | null>(null);
  const [actors, setActors] = useState<QbMappingAuditActor[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<QbMappingAuditFilters>(
    EMPTY_QB_AUDIT_FILTERS,
  );

  // Load vendor + partner option lists once so the scope filter dropdowns
  // can show names instead of raw ids.
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/vendors`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: VendorOption[]) => {
        if (active) setVendors(Array.isArray(j) ? j : []);
      })
      .catch(() => {
        /* filter still works as a free-form id, just without names */
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

  // Reload first page whenever filters change. Subsequent pages are
  // appended via the "Load more" button.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setErr(null);
    fetch(
      `${API_BASE}/api/reports/qb-account-mapping/audit?${buildQbAuditQuery(filters, 0)}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(
        (j: {
          rows: QbMappingAuditRow[];
          total: number;
          hasMore: boolean;
          facets?: { actors?: QbMappingAuditActor[] };
        }) => {
          if (!active) return;
          setRows(j.rows);
          setTotal(j.total);
          setHasMore(j.hasMore);
          if (j.facets?.actors) setActors(j.facets.actors);
        },
      )
      .catch((e: Error) => {
        if (active) setErr(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters]);

  const loadMore = (): void => {
    if (loadingMore || !rows) return;
    setLoadingMore(true);
    fetch(
      `${API_BASE}/api/reports/qb-account-mapping/audit?${buildQbAuditQuery(filters, rows.length)}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(
        (j: {
          rows: QbMappingAuditRow[];
          total: number;
          hasMore: boolean;
        }) => {
          setRows((prev) => (prev ? [...prev, ...j.rows] : j.rows));
          setTotal(j.total);
          setHasMore(j.hasMore);
        },
      )
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingMore(false));
  };

  const update = <K extends keyof QbMappingAuditFilters>(
    key: K,
    value: QbMappingAuditFilters[K],
  ): void => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const filtersDirty =
    filters.lineType !== "" ||
    filters.scope !== "" ||
    filters.vendorId !== "" ||
    filters.partnerId !== "" ||
    filters.actorUserId !== "" ||
    filters.startDate !== "" ||
    filters.endDate !== "";

  return (
    <Card data-testid="card-qb-mapping-audit">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{t("reports.qbMappingAudit.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("reports.qbMappingAudit.description")}
            </p>
          </div>
          <a
            href={`${API_BASE}/api/reports/qb-account-mapping/audit?format=csv`}
            className="text-sm underline whitespace-nowrap"
            data-testid="link-qb-mapping-audit-download-csv"
            title={t("reports.qbMappingAudit.downloadCsvHelp")}
          >
            {t("reports.qbMappingAudit.downloadCsv")}
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4"
          data-testid="filters-qb-mapping-audit"
        >
          <div>
            <Label className="text-xs">
              {t("reports.qbMappingAudit.col.lineType")}
            </Label>
            <Select
              value={filters.lineType === "" ? ANY_VALUE : filters.lineType}
              onValueChange={(v) =>
                update("lineType", v === ANY_VALUE ? "" : v)
              }
            >
              <SelectTrigger data-testid="select-qb-mapping-audit-line-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>
                  {t("reports.qbMappingAudit.filter.any")}
                </SelectItem>
                {ALLOWED_LINE_TYPES.map((lt) => (
                  <SelectItem key={lt} value={lt}>
                    {lt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">
              {t("reports.qbMappingAudit.col.scope")}
            </Label>
            <Select
              value={filters.scope === "" ? ANY_VALUE : filters.scope}
              onValueChange={(v) =>
                update(
                  "scope",
                  v === ANY_VALUE
                    ? ""
                    : (v as QbMappingAuditFilters["scope"]),
                )
              }
            >
              <SelectTrigger data-testid="select-qb-mapping-audit-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>
                  {t("reports.qbMappingAudit.filter.any")}
                </SelectItem>
                <SelectItem value="vendor">
                  {t("reports.qbMappingAudit.scope.vendor")}
                </SelectItem>
                <SelectItem value="partner">
                  {t("reports.qbMappingAudit.scope.partner")}
                </SelectItem>
                <SelectItem value="global">
                  {t("reports.qbMappingAudit.scope.global")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("reports.col.vendor")}</Label>
            <Select
              value={filters.vendorId === "" ? ANY_VALUE : filters.vendorId}
              onValueChange={(v) =>
                update("vendorId", v === ANY_VALUE ? "" : v)
              }
            >
              <SelectTrigger data-testid="select-qb-mapping-audit-vendor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>
                  {t("reports.qbMappingAudit.filter.any")}
                </SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("reports.col.partner")}</Label>
            <Select
              value={filters.partnerId === "" ? ANY_VALUE : filters.partnerId}
              onValueChange={(v) =>
                update("partnerId", v === ANY_VALUE ? "" : v)
              }
            >
              <SelectTrigger data-testid="select-qb-mapping-audit-partner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>
                  {t("reports.qbMappingAudit.filter.any")}
                </SelectItem>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">
              {t("reports.qbMappingAudit.col.actor")}
            </Label>
            <Select
              value={
                filters.actorUserId === "" ? ANY_VALUE : filters.actorUserId
              }
              onValueChange={(v) =>
                update("actorUserId", v === ANY_VALUE ? "" : v)
              }
            >
              <SelectTrigger data-testid="select-qb-mapping-audit-actor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>
                  {t("reports.qbMappingAudit.filter.any")}
                </SelectItem>
                {actors.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.displayName ?? `User ${a.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">
              {t("reports.qbMappingAudit.filter.startDate")}
            </Label>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              data-testid="input-qb-mapping-audit-start-date"
            />
          </div>
          <div>
            <Label className="text-xs">
              {t("reports.qbMappingAudit.filter.endDate")}
            </Label>
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              data-testid="input-qb-mapping-audit-end-date"
            />
          </div>
          <div className="flex items-end">
            <PillButton
              type="button"
              color="image"
              disabled={!filtersDirty}
              onClick={() => setFilters(EMPTY_QB_AUDIT_FILTERS)}
              data-testid="button-qb-mapping-audit-reset"
            >
              {t("reports.qbMappingAudit.filter.reset")}
            </PillButton>
          </div>
        </div>

        {err && (
          <p
            className="text-sm text-destructive"
            data-testid="text-qb-mapping-audit-error"
          >
            {err}
          </p>
        )}
        {!err && loading && !rows && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {!err && rows && rows.length === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-qb-mapping-audit-empty"
          >
            {t("reports.qbMappingAudit.empty")}
          </p>
        )}
        {!err && rows && rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.when")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.actor")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.action")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.scope")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.lineType")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.before")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMappingAudit.col.after")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      data-testid={`row-qb-mapping-audit-${r.id}`}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>
                          {r.actorDisplayName ??
                            r.actorUsername ??
                            r.actorRole}
                        </div>
                        <div className="text-muted-foreground">
                          {r.actorRole}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span
                          className={
                            r.action === "delete"
                              ? "text-destructive font-medium"
                              : r.action === "insert"
                                ? "text-emerald-600 font-medium"
                                : "text-amber-600 font-medium"
                          }
                          data-testid={`text-qb-mapping-audit-action-${r.id}`}
                        >
                          {t(`reports.qbMappingAudit.action.${r.action}`)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatScope(r, t)}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {r.lineType}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatValue(r.oldValues)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatValue(r.newValues)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span
                className="text-xs text-muted-foreground"
                data-testid="text-qb-mapping-audit-summary"
              >
                {t("reports.qbMappingAudit.summary", {
                  shown: rows.length,
                  total,
                })}
              </span>
              {hasMore && (
                <PillButton
                  type="button"
                  color="image"
                  disabled={loadingMore}
                  onClick={loadMore}
                  data-testid="button-qb-mapping-audit-load-more"
                >
                  {loadingMore
                    ? t("common.loading")
                    : t("reports.qbMappingAudit.loadMore")}
                </PillButton>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
