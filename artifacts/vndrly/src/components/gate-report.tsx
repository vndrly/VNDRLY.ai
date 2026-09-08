import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Loader2, Printer, Search } from "lucide-react";
import { useListSiteLocations } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import { loadGateReport, type GateReportResult } from "@/lib/gate-report-api";
import { printGateReport } from "@/lib/gate-report-print";

function localDate(offset: number) {
  const date = new Date(); date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export default function GateReport() {
  const { user } = useAuth();
  return <ScopedGateReport key={`${user?.userId}:${user?.role}:${user?.partnerId}:${user?.vendorId}`} />;
}
function ScopedGateReport() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: sites = [] } = useListSiteLocations();
  const [from, setFrom] = useState(() => localDate(-6));
  const [to, setTo] = useState(() => localDate(0));
  const [site, setSite] = useState("all");
  const [partner, setPartner] = useState("all");
  const [company, setCompany] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState("all");
  const [recordKind, setRecordKind] = useState("all");
  const [report, setReport] = useState<GateReportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const partners = [...new Map(sites.filter(row => row.partnerId).map(row => [row.partnerId, { id: row.partnerId, name: row.partnerName }])).values()];
  const fmt = (value: string | null) => value ? new Date(value).toLocaleString() : t("gateReport.open");
  const label = (key: string) => t(`gateReport.${key}`);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setReport(null); setPage(0);
    try {
      const start = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 31 * 86_400_000) throw new Error(label("rangeError"));
      const data = await loadGateReport({ from: start.toISOString(), to: end.toISOString(), siteLocationId: site, partnerId: partner, company, purpose, category, recordKind }, request.signal);
      if (!request.signal.aborted) setReport(data);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : label("error"));
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <section className="space-y-4" data-testid="gate-report">
    <form onSubmit={run} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
      <div><Label htmlFor="gate-report-from">{label("from")}</Label><Input id="gate-report-from" type="date" required value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div><Label htmlFor="gate-report-to">{label("to")}</Label><Input id="gate-report-to" type="date" required value={to} onChange={e => setTo(e.target.value)} /></div>
      <div><Label htmlFor="gate-report-partner">{label("partner")}</Label><select id="gate-report-partner" className="h-10 w-full rounded-md border bg-background px-2" value={partner} onChange={e => { setPartner(e.target.value); setSite("all"); }}><option value="all">{label("allAccessiblePartners")}</option>{partners.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></div>
      <div><Label htmlFor="gate-report-site">{label("site")}</Label><select id="gate-report-site" className="h-10 w-full rounded-md border bg-background px-2" value={site} onChange={e => setSite(e.target.value)}><option value="all">{label("allSites")}</option>{sites.filter(row => partner === "all" || String(row.partnerId) === partner).map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></div>
      <div><Label htmlFor="gate-report-company">{label("company")}</Label><Input id="gate-report-company" value={company} onChange={e => setCompany(e.target.value)} /></div>
      <div><Label htmlFor="gate-report-source">{label("record")}</Label><select id="gate-report-source" className="h-10 w-full rounded-md border bg-background px-2" value={recordKind} onChange={e => setRecordKind(e.target.value)}>{["all", "visitor", "employee_checkin"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div>
      <div><Label htmlFor="gate-report-purpose">{label("purpose")}</Label><Input id="gate-report-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} /></div>
      <div><Label htmlFor="gate-report-category">{label("category")}</Label><select id="gate-report-category" className="h-10 w-full rounded-md border bg-background px-2" value={category} onChange={e => setCategory(e.target.value)}>{["all", "routine_vendor_work", "visitor", "unclassified", "partner_admin", "vendor_admin"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div>
      <div className="flex items-end gap-2"><TogglePillButton color="blue" type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{label("run")}</TogglePillButton><TogglePillButton color="blue" type="button" disabled={!report || busy} title={label("print")} aria-label={label("print")} onClick={() => { const element = document.getElementById("gate-report-print"); if (element) printGateReport(element, label("title")); }}><Printer className="h-4 w-4" /></TogglePillButton></div>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {busy && <p role="status">{label("loading")}</p>}
    {report && <div id="gate-report-print" className="space-y-4">
      <div><h2 className="text-xl font-semibold">{label("title")}</h2><p className="text-sm">{user?.role} · {fmt(report.filters.from)} - {fmt(report.filters.to)} · {label("snapshot")}: {fmt(report.generatedAt)}</p><p className="text-sm">{label("site")}: {report.filters.siteLocationId ? sites.find(row => row.id === report.filters.siteLocationId)?.name || report.filters.siteLocationId : label("allSites")} · {label("partner")}: {report.filters.partnerId ?? label("allAccessiblePartners")} · {label("company")}: {report.filters.company || label("all")} · {label("purpose")}: {report.filters.purpose || label("all")} · {label("category")}: {label(report.filters.category)}</p></div>
      <p className="text-sm">{label("record")}: {label(report.filters.recordKind)}</p>
      <dl className="grid grid-cols-2 gap-3 border-y py-3 sm:grid-cols-4">{(["entries", "visitorEntries", "employeeCheckins", "currentOnsiteEntries", "uniqueRecordedIdentities", "unidentifiedEntries", "incompleteEntries", "pendingAdmissionEntries"] as const).map(key => <div key={key}><dt className="text-sm text-muted-foreground">{label(key)}</dt><dd className="text-xl font-semibold">{report.totals[key]}</dd></div>)}</dl>
      <p className="text-sm text-muted-foreground">{label("coverage")}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm border-collapse"><thead><tr>{["record", "name", "company", "site", "category", "purpose", "entered", "exited", "quality"].map(key => <th className="border-b px-2 py-2 text-left" key={key}>{label(key)}</th>)}</tr></thead><tbody>{report.rows.map((row, index) => <tr key={row.id} className={index >= page * 50 && index < (page + 1) * 50 ? "" : "hidden print:table-row"}><td className="border-b p-2">{label(row.kind)}</td><td className="border-b p-2">{row.name || label("unknown")}</td><td className="border-b p-2">{row.company || label("unknown")}</td><td className="border-b p-2">{row.siteName}</td><td className="border-b p-2">{label(row.category)}</td><td className="border-b p-2 break-words">{row.purpose || label("unknown")}</td><td className="border-b p-2">{fmt(row.checkInTime)}</td><td className="border-b p-2">{fmt(row.checkOutTime)}</td><td className="border-b p-2">{row.incomplete.length ? row.incomplete.map(label).join(", ") : label("complete")}</td></tr>)}</tbody></table></div>
      {!report.rows.length && <p>{label("empty")}</p>}
      <div className="flex items-center justify-end gap-3 print:hidden"><button type="button" title={label("previous")} aria-label={label("previous")} disabled={page === 0} onClick={() => setPage(value => value - 1)} className="h-9 w-9 disabled:opacity-40"><ChevronLeft /></button><span>{page + 1} / {Math.max(1, Math.ceil(report.rows.length / 50))}</span><button type="button" title={label("next")} aria-label={label("next")} disabled={(page + 1) * 50 >= report.rows.length} onClick={() => setPage(value => value + 1)} className="h-9 w-9 disabled:opacity-40"><ChevronRight /></button></div>
    </div>}
    <style>{`@media print { body * { visibility: hidden; } #gate-report-print, #gate-report-print * { visibility: visible; } #gate-report-print { position: absolute; left: 0; top: 0; width: 100%; color: black; background: white; } #gate-report-print .overflow-x-auto { overflow: visible; } #gate-report-print table { table-layout: fixed; font-size: 8pt; } #gate-report-print td, #gate-report-print th { overflow-wrap: anywhere; } #gate-report-print thead { display: table-header-group; } #gate-report-print tr { break-inside: avoid; } @page { size: landscape; margin: 12mm; } }`}</style>
  </section>;
}
