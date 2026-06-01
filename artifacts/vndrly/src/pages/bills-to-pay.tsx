import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { Link } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type InvoiceListItem = {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  partnerId: number;
  status: "draft" | "open" | "sent" | "paid" | "overdue" | "cancelled";
  total: string;
  paidAmount: string;
  creditedAmount: string;
  balanceDue?: string; // computed server-side when present
  dueDate: string | null;
  periodStart: string;
  periodEnd: string;
};

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

function computeBalance(inv: InvoiceListItem): number {
  if (inv.balanceDue != null) return Number(inv.balanceDue);
  return Number(inv.total) - Number(inv.paidAmount) - Number(inv.creditedAmount);
}

export default function BillsToPayPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Filter state. Persisted in URL-less local state since this is a
  // partner-facing inbox; users typically arrive once and triage.
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "overdue">(
    "all",
  );
  const [ageFilter, setAgeFilter] = useState<"all" | "current" | "1+" | "15+" | "30+">(
    "all",
  );

  const [openPay, setOpenPay] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState<string>("ach");
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [payNotes, setPayNotes] = useState("");

  const isPartner = user?.role === "partner";

  // Look up vendor display names so the filter dropdown + table show
  // human-readable names instead of raw numeric ids.
  const { data: vendors = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["vendors-for-bills"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/vendors`, {
        credentials: "include",
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const vendorNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of vendors) m.set(v.id, v.name);
    return m;
  }, [vendors]);
  const vendorLabel = (vid: number): string =>
    vendorNameById.get(vid) ?? `#${vid}`;

  const { data, isLoading } = useQuery<InvoiceListItem[]>({
    queryKey: ["bills-to-pay", user?.partnerId, user?.role],
    queryFn: async () => {
      const params = new URLSearchParams();
      // Backend always returns sent+overdue; we filter UI-side so the
      // filter dropdowns can flip between them without refetching.
      params.set("status", "sent,overdue");
      if (isPartner && user?.partnerId)
        params.set("partnerId", String(user.partnerId));
      const res = await fetch(
        `${API_BASE}/api/invoices?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("load_failed");
      const json = await res.json();
      const items: InvoiceListItem[] = json.items ?? json ?? [];
      return items.filter((i) => computeBalance(i) > 0);
    },
    enabled: !!user,
  });

  // Distinct vendor IDs for the vendor filter dropdown. Vendors get
  // their humanized name from the existing /api/vendors list if present;
  // we keep it lightweight by just using the id label for now.
  const vendorOptions = useMemo(() => {
    const ids = new Set<number>();
    for (const i of data ?? []) ids.add(i.vendorId);
    return Array.from(ids).sort((a, b) => a - b);
  }, [data]);

  const filteredItems = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = data ?? [];
    return items.filter((i) => {
      if (vendorFilter !== "all" && String(i.vendorId) !== vendorFilter)
        return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (ageFilter !== "all") {
        const due = i.dueDate ? new Date(i.dueDate) : null;
        if (!due) return ageFilter === "current";
        // Calendar-day diff (UTC) to match the server-side aging worker
        // (see invoice-aging-worker.ts). Avoids time-of-day/DST drift.
        const dueDay = Date.UTC(
          due.getUTCFullYear(),
          due.getUTCMonth(),
          due.getUTCDate(),
        );
        const todayDay = Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        );
        const daysPast = Math.floor(
          (todayDay - dueDay) / (24 * 60 * 60 * 1000),
        );
        if (ageFilter === "current" && daysPast > 0) return false;
        if (ageFilter === "1+" && daysPast < 1) return false;
        if (ageFilter === "15+" && daysPast < 15) return false;
        if (ageFilter === "30+" && daysPast < 30) return false;
      }
      return true;
    });
  }, [data, vendorFilter, statusFilter, ageFilter]);

  const recordPayment = useMutation({
    mutationFn: async (invoiceId: number) => {
      const res = await fetch(
        `${API_BASE}/api/invoices/${invoiceId}/payments`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: payMethod,
            amount: payAmount,
            paidAt: payDate,
            referenceNumber: payRef || undefined,
            notes: payNotes || undefined,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "payment_failed");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills-to-pay"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setOpenPay(null);
      setPayAmount("");
      setPayRef("");
      setPayNotes("");
      setPayMethod("ach");
      toast({ title: t("invoices.toast.paymentRecorded") });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(err, t, t("invoices.toast.paymentFailed")),
        variant: "destructive",
      }),
  });

  const summary = useMemo(() => {
    let total = 0;
    let overdue = 0;
    for (const i of filteredItems) {
      const bal = computeBalance(i);
      total += bal;
      if (i.status === "overdue") overdue += bal;
    }
    return { total, overdue, count: filteredItems.length };
  }, [filteredItems]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
        <h1 className="text-2xl font-semibold" data-testid="text-bills-title">
          {t("billsToPay.title")}
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase text-muted-foreground">
              {t("billsToPay.summary.openBills")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {summary.count}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase text-muted-foreground">
              {t("billsToPay.summary.totalDue")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatMoney(String(summary.total))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase text-muted-foreground">
              {t("billsToPay.summary.overdue")}
            </CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold tabular-nums ${
              summary.overdue > 0 ? "text-destructive" : ""
            }`}
          >
            {formatMoney(String(summary.overdue))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("billsToPay.list.title")}
          </CardTitle>
          <div className="flex flex-wrap gap-3 pt-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("billsToPay.filters.vendor")}
              </Label>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger
                  className="w-44"
                  data-testid="select-filter-vendor"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("billsToPay.filters.allVendors")}
                  </SelectItem>
                  {vendorOptions.map((vid) => (
                    <SelectItem key={vid} value={String(vid)}>
                      {vendorLabel(vid)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("billsToPay.filters.status")}
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as typeof statusFilter)
                }
              >
                <SelectTrigger
                  className="w-40"
                  data-testid="select-filter-status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("billsToPay.filters.allStatus")}
                  </SelectItem>
                  <SelectItem value="sent">
                    {t("invoices.status.sent")}
                  </SelectItem>
                  <SelectItem value="overdue">
                    {t("invoices.status.overdue")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("billsToPay.filters.age")}
              </Label>
              <Select
                value={ageFilter}
                onValueChange={(v) => setAgeFilter(v as typeof ageFilter)}
              >
                <SelectTrigger
                  className="w-44"
                  data-testid="select-filter-age"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("billsToPay.filters.anyAge")}
                  </SelectItem>
                  <SelectItem value="current">
                    {t("billsToPay.filters.current")}
                  </SelectItem>
                  <SelectItem value="1+">
                    {t("billsToPay.filters.age1")}
                  </SelectItem>
                  <SelectItem value="15+">
                    {t("billsToPay.filters.age15")}
                  </SelectItem>
                  <SelectItem value="30+">
                    {t("billsToPay.filters.age30")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredItems.length === 0 ? (
            <div
              className="p-12 text-center text-muted-foreground"
              data-testid="text-empty"
            >
              {t("billsToPay.empty")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billsToPay.col.invoice")}</TableHead>
                  <TableHead>{t("billsToPay.col.due")}</TableHead>
                  <TableHead>{t("billsToPay.col.status")}</TableHead>
                  <TableHead className="text-right">
                    {t("billsToPay.col.total")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("billsToPay.col.balance")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("billsToPay.col.action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((inv) => {
                  const bal = computeBalance(inv);
                  return (
                    <TableRow
                      key={inv.id}
                      data-testid={`row-bill-${inv.id}`}
                    >
                      <TableCell>
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="text-amber-600 hover:underline font-medium"
                        >
                          {inv.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(inv.dueDate)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            inv.status === "overdue"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {t(`invoices.status.${inv.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(inv.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-amber-600">
                        {formatMoney(String(bal))}
                      </TableCell>
                      <TableCell className="text-right">
                        <PillButton
                          color="green"
                          onClick={() => {
                            setPayAmount(String(bal.toFixed(2)));
                            setOpenPay(inv.id);
                          }}
                          data-testid={`button-mark-paid-${inv.id}`}
                        >
                          {t("billsToPay.markPaid")}
                        </PillButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={openPay !== null}
        onOpenChange={(o) => {
          if (!o) setOpenPay(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("billsToPay.markPaidTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("billsToPay.markPaidHelper")}
            </p>
            <div>
              <Label htmlFor="bp-method">
                {t("invoices.payment.method")}
              </Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger id="bp-method" data-testid="select-bp-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ach">
                    {t("invoices.method.ach")}
                  </SelectItem>
                  <SelectItem value="check">
                    {t("invoices.method.check")}
                  </SelectItem>
                  <SelectItem value="wire">
                    {t("invoices.method.wire")}
                  </SelectItem>
                  <SelectItem value="other">
                    {t("invoices.method.other")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="bp-amount">
                {t("invoices.payment.amount")}
              </Label>
              <Input
                id="bp-amount"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                inputMode="decimal"
                data-testid="input-bp-amount"
              />
            </div>
            <div>
              <Label htmlFor="bp-date">{t("invoices.payment.date")}</Label>
              <Input
                id="bp-date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                data-testid="input-bp-date"
              />
            </div>
            <div>
              <Label htmlFor="bp-ref">
                {t("invoices.payment.reference")}
              </Label>
              <Input
                id="bp-ref"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                data-testid="input-bp-ref"
              />
            </div>
            <div>
              <Label htmlFor="bp-notes">
                {t("invoices.payment.notes")}
              </Label>
              <Textarea
                id="bp-notes"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
                data-testid="input-bp-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <PillButton color="red" onClick={() => setOpenPay(null)}>
              {t("common.cancel")}
            </PillButton>
            <PillButton
              color="blue"
              onClick={() =>
                openPay !== null && recordPayment.mutate(openPay)
              }
              disabled={recordPayment.isPending}
              data-testid="button-bp-confirm"
            >
              {t("invoices.payment.confirm")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
