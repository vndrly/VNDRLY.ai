import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Receipt } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type InvoiceRow = {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  partnerId: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  total: string;
};

export default function GateBillingInvoiceCard({
  role,
  partners,
}: {
  role?: string;
  partners: { id: number; name: string | null | undefined }[];
}) {
  const [company, setCompany] = useState("all");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (invoiceNumber.trim()) params.set("invoiceNumber", invoiceNumber.trim());
      setLoading(true); setLoadError(false);
      fetch(`${API_BASE}/api/invoices?${params}`, { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Unable to load invoice records");
          return response.json() as Promise<{ items: InvoiceRow[] }>;
        })
        .then((data) => { if (!cancelled) setInvoiceRows(data.items ?? []); })
        .catch(() => { if (!cancelled) { setLoadError(true); setInvoiceRows([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [invoiceNumber]);
  const rows = useMemo(() => invoiceRows
    .filter((row) => company === "all" || String(row.partnerId) === company)
    .slice(0, 8), [company, invoiceRows]);
  const destination = role === "partner" ? "/bills-to-pay" : "/invoices";
  return (
    <Card className="border-2 bg-white" style={{ borderColor: "var(--brand-primary)" }} data-testid="gate-billing-invoice-log">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className={`${CARD_TITLE_ICON_CLASS} text-[var(--brand-primary)]`} />
          Billing &amp; Invoice Log
        </CardTitle>
        <p className="text-sm text-muted-foreground">Review the existing receivable or payable ledger, then open the canonical invoice record to preview, print, download, or send.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <select aria-label="Filter invoices by company" className="h-10 rounded-full border-2 bg-white px-3" style={{ borderColor: "var(--brand-primary)" }} value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="all">All companies</option>
            {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name || `Partner ${partner.id}`}</option>)}
          </select>
          <Input aria-label="Find invoice number" placeholder="Invoice number" className="rounded-full border-2 bg-white" style={{ borderColor: "var(--brand-primary)" }} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading invoice records…</p> : loadError ? <p className="text-sm text-destructive">Invoice records are unavailable.</p> : rows.length ? (
          <div className="space-y-2">
            {rows.map((invoice) => (
              <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3 hover:border-[var(--brand-primary)]">
                <div><p className="font-medium">{invoice.invoiceNumber}</p><p className="text-xs text-muted-foreground">{invoice.periodStart} – {invoice.periodEnd} · {invoice.status}</p></div>
                <span className="font-semibold tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(invoice.total))}</span>
              </Link>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No matching invoice records.</p>}
        <Link href={destination} className="inline-flex rounded-full border-2 bg-white px-4 py-2 text-sm font-semibold" style={{ borderColor: "var(--brand-primary)" }}>
          View all {role === "partner" ? "payables" : "receivables"}
        </Link>
      </CardContent>
    </Card>
  );
}
