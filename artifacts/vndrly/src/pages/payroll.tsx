import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download, Calculator } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type Employee = { id: number; firstName: string; lastName: string };
type Draft = { fingerprint: string; exportable: boolean; grossPay: string; issues: string[]; rows: Array<{ sessionId: number; employeeId: number; employeeName: string; start: string; end: string; regularHours: string; overtimeHours: string; hourlyWage: string; grossPay: string }> };
async function request(path: string, body?: unknown) {
  const response = await fetch(`${BASE}/api${path}`, { credentials: "include", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error ?? i18n.t("payrollDraft.requestFailed")); }
  return response;
}
export default function PayrollPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const membership = user?.availableMemberships.find((m) => m.id === user.activeMembershipId);
  const allowed = user?.role === "admin" || (user?.role === "vendor" && (membership?.role === "admin" || user.vendorRole === "office" || user.vendorRole === "both"));
  const [selectedVendor, setSelectedVendor] = useState("");
  const vendorId = user?.role === "admin" ? Number(selectedVendor) : user?.vendorId;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [weekStartsOn, setWeekStartsOn] = useState("1");
  const [daily, setDaily] = useState("");
  const [weekly, setWeekly] = useState("40");
  const [multiplier, setMultiplier] = useState("1.5");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewInput, setPreviewInput] = useState("");
  const vendors = useQuery({ queryKey: ["payroll-vendors"], enabled: allowed && user?.role === "admin", queryFn: async () => (await request("/vendors")).json() as Promise<Array<{ id: number; name: string }>> });
  const employees = useQuery({ queryKey: ["payroll-employees", vendorId], enabled: Boolean(allowed && vendorId), queryFn: async () => (await request(`/payroll/vendors/${vendorId}/employees`)).json() as Promise<{ employees: Employee[] }> });
  const payload = { from, to, timeZone, weekStartsOn: Number(weekStartsOn), dailyOvertimeHours: daily === "" ? null : Number(daily), weeklyOvertimeHours: Number(weekly), overtimeMultiplier: multiplier, rates: (employees.data?.employees ?? []).filter((e) => rates[`${vendorId}:${e.id}`]?.trim()).map((e) => ({ employeeId: e.id, hourlyWage: rates[`${vendorId}:${e.id}`] })), confirmed };
  const currentInput = JSON.stringify({ vendorId, ...payload });
  const stale = previewInput !== currentInput;
  async function preview() {
    setBusy(true); setError(""); setReviewed(false); setDraft(null);
    try { const response = await request(`/payroll/vendors/${vendorId}/preview`, payload); setDraft(await response.json()); setPreviewInput(currentInput); }
    catch (e) { setError(e instanceof Error ? e.message : t("payrollDraft.previewFailed")); }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    if (!draft || stale || !reviewed) return;
    setBusy(true); setError("");
    try {
      const response = await request(`/payroll/vendors/${vendorId}/export`, { ...payload, fingerprint: draft.fingerprint });
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `gross-pay-${vendorId}-${from}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : t("payrollDraft.exportFailed")); setReviewed(false); }
    finally { setBusy(false); }
  }
  if (!allowed) return <div className="p-6">{t("payrollDraft.denied")}</div>;
  return <main className="p-6 space-y-6 max-w-6xl mx-auto">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{t("payrollDraft.title")}</h1><Link href="/reports" className="underline">{t("payrollDraft.reports")}</Link></div>
    <p className="text-sm text-muted-foreground">{t("payrollDraft.description")}</p>
    {user?.role === "admin" && <label className="block">{t("payrollDraft.vendor")}<select className="block border rounded p-2 max-w-full" value={selectedVendor} onChange={(e) => { setSelectedVendor(e.target.value); setDraft(null); setConfirmed(false); }}><option value="">{t("payrollDraft.selectVendor")}</option>{vendors.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onChange={() => setConfirmed(false)}>
      <label>{t("payrollDraft.from")}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>{t("payrollDraft.to")}<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label>{t("payrollDraft.timeZone")}<Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} /></label>
      <label>{t("payrollDraft.weekStarts")}<select className="block w-full border rounded p-2" value={weekStartsOn} onChange={(e) => setWeekStartsOn(e.target.value)}>{[t("payrollDraft.sunday"), t("payrollDraft.monday"), t("payrollDraft.tuesday"), t("payrollDraft.wednesday"), t("payrollDraft.thursday"), t("payrollDraft.friday"), t("payrollDraft.saturday")].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>
      <label>{t("payrollDraft.daily")}<Input type="number" min="1" max="24" step="1" value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
      <label>{t("payrollDraft.weekly")}<Input type="number" min="1" max="168" step="1" value={weekly} onChange={(e) => setWeekly(e.target.value)} /></label>
      <label>{t("payrollDraft.multiplier")}<Input type="number" min="1" max="9.99" step="0.01" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></label>
    </div>
    <section className="space-y-3"><h2 className="text-lg font-semibold">{t("payrollDraft.wages")}</h2>
      {employees.isLoading && <p>{t("payrollDraft.loading")}</p>}{employees.isError && <p role="alert">{t("payrollDraft.loadFailed")}</p>}
      <div className="grid sm:grid-cols-2 gap-3">{employees.data?.employees.map((person) => <label key={person.id}>{person.firstName} {person.lastName} (#{person.id})<Input aria-label={t("payrollDraft.wageFor", { name: `${person.firstName} ${person.lastName}` })} type="number" min="0" step="0.01" value={rates[`${vendorId}:${person.id}`] ?? ""} onChange={(e) => { setRates({ ...rates, [`${vendorId}:${person.id}`]: e.target.value }); setConfirmed(false); }} /></label>)}</div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t("payrollDraft.confirm")}</label>
      <button title={t("payrollDraft.calculateTitle")} className="inline-flex items-center gap-2 border rounded px-3 py-2 disabled:opacity-50" disabled={busy || !confirmed || !vendorId || !from || !to || employees.isLoading} onClick={preview}><Calculator size={18} />{t("payrollDraft.calculate")}</button>
    </section>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {draft && <section className="space-y-3"><h2 className="text-lg font-semibold">{t("payrollDraft.gross", { amount: draft.grossPay })}</h2>{stale && <p role="alert">{t("payrollDraft.stale")}</p>}
      {draft.issues.length > 0 && <ul className="list-disc pl-5 text-red-700">{draft.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[t("payrollDraft.employee"), t("payrollDraft.session"), t("payrollDraft.start"), t("payrollDraft.end"), t("payrollDraft.regular"), t("payrollDraft.ot"), t("payrollDraft.wage"), t("payrollDraft.grossUsd")].map((h) => <th className="text-left p-2 whitespace-nowrap" key={h}>{h}</th>)}</tr></thead><tbody>{draft.rows.map((row) => <tr className="border-t" key={`${row.sessionId}:${row.start}`}><td className="p-2">{row.employeeName}</td><td>#{row.sessionId}</td><td className="p-2 whitespace-nowrap">{row.start}</td><td className="p-2 whitespace-nowrap">{row.end}</td><td>{row.regularHours}</td><td>{row.overtimeHours}</td><td>{row.hourlyWage}</td><td>{row.grossPay}</td></tr>)}</tbody></table></div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed && !stale} disabled={stale || !draft.exportable} onChange={(e) => setReviewed(e.target.checked)} />{t("payrollDraft.review")}</label>
      <button title={t("payrollDraft.download")} className="inline-flex items-center gap-2 border rounded px-3 py-2 disabled:opacity-50" onClick={exportCsv} disabled={busy || stale || !draft.exportable || !reviewed}><Download size={18} />{t("payrollDraft.csv")}</button>
    </section>}
    <section className="border-t pt-4 text-sm space-y-2"><h2 className="font-semibold">{t("payrollDraft.connections")}</h2><p>{t("payrollDraft.qbo")}</p><p>{t("payrollDraft.oa")}</p><p>{t("payrollDraft.transient")}</p></section>
  </main>;
}
