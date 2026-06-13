import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  getListPartnersQueryKey,
  getListVendorsQueryKey,
  useListPartners,
  useListVendors,
} from "@workspace/api-client-react";
import SphereBackButton from "@/components/sphere-back-button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_ICON_CLASS,
  CARD_ICON_ROW_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import {
  PngPillButton,
} from "@/components/png-pill-rollover";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BadgePercent,
  CircleDollarSign,
  FileText,
  Printer,
  Receipt,
  Scale,
  ScrollText,
  SlidersHorizontal,
  Download,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type StatementRow = {
  id: number;
  invoiceNumber: string;
  status: "draft" | "open" | "sent" | "paid" | "overdue" | "cancelled";
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  total: string;
  paidAmount: string;
  creditedAmount: string;
  balanceDue: string;
  runningBalance: string;
};

type StatementResponse = {
  party: { id: number; name: string } | null;
  periodStart: string;
  periodEnd: string;
  totals: {
    invoiced: string;
    paid: string;
    credited: string;
    outstanding: string;
  };
  rows: StatementRow[];
};

function statusPillColor(
  status: StatementRow["status"],
): ImagePillColor {
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

function formatMoney(s: string | null | undefined): string {
  if (s == null) return "—";
  const n = Number(s);
  if (Number.isNaN(n)) return String(s);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ninetyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function readQuery(): {
  role: "vendor" | "partner";
  id: number | null;
  counterpartyId: number | null;
  scope: "open" | "all";
  from: string;
  to: string;
} {
  if (typeof window === "undefined")
    return {
      role: "vendor",
      id: null,
      counterpartyId: null,
      scope: "open",
      from: ninetyDaysAgoIso(),
      to: todayIso(),
    };
  const sp = new URLSearchParams(window.location.search);
  const roleParam = sp.get("role");
  const role: "vendor" | "partner" =
    roleParam === "partner" ? "partner" : "vendor";
  const idStr = sp.get("id");
  const id = idStr ? Number(idStr) : null;
  const cpStr = sp.get("counterpartyId");
  const cpId = cpStr ? Number(cpStr) : null;
  const scopeParam = sp.get("scope");
  const scope: "open" | "all" = scopeParam === "all" ? "all" : "open";
  return {
    role,
    id: Number.isFinite(id) ? id : null,
    counterpartyId: Number.isFinite(cpId) ? cpId : null,
    scope,
    from: sp.get("from") ?? ninetyDaysAgoIso(),
    to: sp.get("to") ?? todayIso(),
  };
}

type CounterpartyOption = { id: number; name: string };

export default function StatementPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const isAdmin = user?.role === "admin";
  const initial = useMemo(() => readQuery(), []);
  const { data: vendors } = useListVendors({
    query: { enabled: isAdmin, queryKey: getListVendorsQueryKey() },
  });
  const { data: partners } = useListPartners({
    query: { enabled: isAdmin, queryKey: getListPartnersQueryKey() },
  });

  const defaultRole: "vendor" | "partner" =
    user?.role === "partner" ? "partner" : "vendor";
  const defaultId =
    initial.id ??
    (user?.role === "partner"
      ? user.partnerId
      : user?.role === "vendor"
        ? user.vendorId
        : null);

  const [role, setRole] = useState<"vendor" | "partner">(
    initial.id ? initial.role : defaultRole,
  );
  const [partyId, setPartyId] = useState<number | null>(defaultId);
  const [counterpartyId, setCounterpartyId] = useState<number | null>(
    initial.counterpartyId,
  );
  const [scope, setScope] = useState<"open" | "all">(initial.scope);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const partyOptions = useMemo(() => {
    const list = role === "vendor" ? (vendors ?? []) : (partners ?? []);
    return [...list].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
      }),
    );
  }, [role, vendors, partners]);

  // Keep URL in sync so the page is shareable / printable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams();
    sp.set("role", role);
    if (partyId) sp.set("id", String(partyId));
    if (counterpartyId) sp.set("counterpartyId", String(counterpartyId));
    sp.set("scope", scope);
    sp.set("from", from);
    sp.set("to", to);
    const next = `/statement?${sp.toString()}`;
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [role, partyId, counterpartyId, scope, from, to]);

  // Counterparties available to this party (vendors → partners they
  // invoice; partners → vendors who invoice them). Sourced from the
  // recent invoice list so we don't need a dedicated endpoint.
  const counterpartyKind: "vendor" | "partner" =
    role === "vendor" ? "partner" : "vendor";
  const { data: counterpartyOptions = [] } = useQuery<CounterpartyOption[]>({
    queryKey: ["statement-counterparties", role, partyId, counterpartyKind],
    queryFn: async () => {
      if (!partyId) return [];
      const sp = new URLSearchParams();
      if (role === "vendor") sp.set("vendorId", String(partyId));
      else sp.set("partnerId", String(partyId));
      const [invRes, dirRes] = await Promise.all([
        fetch(`${API_BASE}/api/invoices?${sp.toString()}`, {
          credentials: "include",
        }),
        fetch(
          `${API_BASE}/api/${counterpartyKind === "partner" ? "partners" : "vendors"}`,
          { credentials: "include" },
        ),
      ]);
      const invJson = invRes.ok ? await invRes.json() : { items: [] };
      const items: Array<{ vendorId: number; partnerId: number }> =
        invJson.items ?? invJson ?? [];
      const ids = new Set<number>();
      for (const i of items) {
        ids.add(counterpartyKind === "partner" ? i.partnerId : i.vendorId);
      }
      // Look up display names so the picker shows e.g. "Acme Energy"
      // instead of "#42". Falls back gracefully if the directory call
      // fails (e.g. RBAC) or a name is missing.
      const dir = dirRes.ok
        ? ((await dirRes.json()) as Array<{ id: number; name: string }>)
        : [];
      const nameById = new Map<number, string>();
      for (const d of dir) nameById.set(d.id, d.name);
      return Array.from(ids)
        .sort((a, b) => a - b)
        .map((id) => ({ id, name: nameById.get(id) ?? `#${id}` }));
    },
    enabled: !!partyId,
  });

  const { data, isLoading, isError, error } = useQuery<StatementResponse>({
    queryKey: ["statement", role, partyId, counterpartyId, scope, from, to],
    queryFn: async () => {
      if (!partyId) throw new Error("missing_party");
      const sp = new URLSearchParams();
      sp.set("periodStart", from);
      sp.set("periodEnd", to);
      sp.set("scope", scope);
      if (counterpartyId) sp.set("counterpartyId", String(counterpartyId));
      const path =
        role === "vendor"
          ? `/api/vendors/${partyId}/statement`
          : `/api/partners/${partyId}/statement`;
      const res = await fetch(`${API_BASE}${path}?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "load_failed");
      }
      return res.json();
    },
    enabled: !!partyId,
  });

  const accountingExportHref =
    partyId && from && to
      ? `/reports?card=accountingExport&periodStart=${encodeURIComponent(from)}&periodEnd=${encodeURIComponent(to)}`
      : null;

  return (
    <div className="p-6 space-y-6 print:p-0">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
          <h1 className="text-2xl font-semibold" data-testid="text-statement-title">
            {t("statement.title")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {accountingExportHref && (
            <Link href={accountingExportHref}>
              <PngPillButton
                color="green"
                data-testid="button-export-accounting"
              >
                <Download className="w-3.5 h-3.5" />
                {t("statement.actions.exportAccounting")}
              </PngPillButton>
            </Link>
          )}
          <PngPillButton
            color="blue"

            onClick={() => window.print()}
            data-testid="button-print"
          >
            <Printer className="w-3.5 h-3.5" />
            {t("statement.actions.print")}
          </PngPillButton>
        </div>
      </div>

      <Card className="print:shadow-none print:border-0">
        <CardHeader>
          <CardTitle className="text-base print:hidden flex items-center gap-2">
            <SlidersHorizontal
              className={CARD_TITLE_ICON_CLASS}
              style={iconStyle}
            />
            {t("statement.filters")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 print:hidden">
          {isAdmin && (
            <div>
              <Label>{t("statement.role")}</Label>
              <Select
                value={role}
                onValueChange={(v) => {
                  setRole(v as "vendor" | "partner");
                  setPartyId(null);
                  setCounterpartyId(null);
                }}
              >
                <SelectTrigger data-testid="select-statement-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">
                    {t("statement.roles.vendor")}
                  </SelectItem>
                  <SelectItem value="partner">
                    {t("statement.roles.partner")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <div>
              <Label>
                {role === "vendor"
                  ? t("statement.roles.vendor")
                  : t("statement.roles.partner")}
              </Label>
              <Select
                value={partyId != null ? String(partyId) : ""}
                onValueChange={(v) => {
                  setPartyId(Number(v));
                  setCounterpartyId(null);
                }}
              >
                <SelectTrigger data-testid="select-statement-party">
                  <SelectValue
                    placeholder={
                      role === "vendor"
                        ? t("statement.selectPartyVendor")
                        : t("statement.selectPartyPartner")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {partyOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>{t("statement.from")}</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-statement-from"
            />
          </div>
          <div>
            <Label>{t("statement.to")}</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-statement-to"
            />
          </div>
          <div>
            <Label>
              {role === "vendor"
                ? t("statement.counterparty.partner")
                : t("statement.counterparty.vendor")}
            </Label>
            <Select
              value={counterpartyId ? String(counterpartyId) : "all"}
              onValueChange={(v) =>
                setCounterpartyId(v === "all" ? null : Number(v))
              }
              disabled={!partyId}
            >
              <SelectTrigger data-testid="select-statement-counterparty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("statement.counterparty.all")}
                </SelectItem>
                {counterpartyOptions.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!partyId && (
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            {t("statement.noParty")}
          </CardContent>
        </Card>
      )}

      {isLoading && partyId && (
        <Skeleton className="h-64 w-full" data-testid="skeleton-statement" />
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-destructive">
            {(error as Error)?.message ?? t("statement.loadError")}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScrollText
                  className={CARD_TITLE_ICON_CLASS}
                  style={iconStyle}
                />
                {data.party?.name ?? t("statement.unknownParty")} ·{" "}
                {formatDate(data.periodStart)} –{" "}
                {formatDate(data.periodEnd)}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className={CARD_ICON_ROW_CLASS}>
                  <FileText className={CARD_ICON_CLASS} style={iconStyle} />
                  <div className="text-muted-foreground">
                    {t("statement.totals.invoiced")}
                  </div>
                </div>
                <div className="font-bold text-lg tabular-nums mt-1">
                  {formatMoney(data.totals.invoiced)}
                </div>
              </div>
              <div>
                <div className={CARD_ICON_ROW_CLASS}>
                  <CircleDollarSign
                    className={CARD_ICON_CLASS}
                    style={iconStyle}
                  />
                  <div className="text-muted-foreground">
                    {t("statement.totals.paid")}
                  </div>
                </div>
                <div
                  className={`font-bold text-lg tabular-nums mt-1 ${
                    Number(data.totals.paid) > 0 ? "text-[#15803D]" : ""
                  }`}
                >
                  {formatMoney(data.totals.paid)}
                </div>
              </div>
              <div>
                <div className={CARD_ICON_ROW_CLASS}>
                  <BadgePercent className={CARD_ICON_CLASS} style={iconStyle} />
                  <div className="text-muted-foreground">
                    {t("statement.totals.credited")}
                  </div>
                </div>
                <div
                  className={`font-bold text-lg tabular-nums mt-1 ${
                    Number(data.totals.credited) > 0 ? "text-[#3260CD]" : ""
                  }`}
                >
                  {formatMoney(data.totals.credited)}
                </div>
              </div>
              <div>
                <div className={CARD_ICON_ROW_CLASS}>
                  <Scale className={CARD_ICON_CLASS} style={iconStyle} />
                  <div className="text-muted-foreground">
                    {t("statement.totals.outstanding")}
                  </div>
                </div>
                <div
                  className={`font-bold text-lg tabular-nums mt-1 ${
                    Number(data.totals.outstanding) > 0
                      ? "text-[#DC2626]"
                      : "text-[#15803D]"
                  }`}
                  data-testid="text-statement-outstanding"
                >
                  {formatMoney(data.totals.outstanding)}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
                {t("statement.invoices")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("statement.col.invoice")}</TableHead>
                    <TableHead>{t("statement.col.period")}</TableHead>
                    <TableHead>{t("statement.col.status")}</TableHead>
                    <TableHead className="text-right">
                      {t("statement.col.total")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("statement.col.paid")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("statement.col.balance")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("statement.col.runningBalance")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center p-8 text-muted-foreground"
                      >
                        {t("statement.empty")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((r) => (
                      <TableRow
                        key={r.id}
                        data-testid={`row-statement-${r.id}`}
                      >
                        <TableCell>
                          <Link
                            href={`/invoices/${r.id}`}
                            className="group inline-flex items-center gap-2 font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors"
                            data-testid={`link-invoice-${r.id}`}
                          >
                            <Receipt className="w-4 h-4 text-[var(--brand-primary)] shrink-0" />
                            <span>{r.invoiceNumber}</span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          {formatDate(r.periodStart)} –{" "}
                          {formatDate(r.periodEnd)}
                        </TableCell>
                        <TableCell>
                          <ImagePill color={statusPillColor(r.status)}>
                            {t(`invoices.status.${r.status}`)}
                          </ImagePill>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.total)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.paidAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.balanceDue)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            Number(r.runningBalance) > 0
                              ? "text-[#15803D]"
                              : Number(r.runningBalance) < 0
                                ? "text-[#DC2626]"
                                : ""
                          }`}
                        >
                          {formatMoney(r.runningBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
