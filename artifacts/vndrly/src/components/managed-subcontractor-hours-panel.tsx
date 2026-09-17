import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Mail, CheckCircle2, Clock3 } from "lucide-react";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import { CARD_INNER_TILE_CLASS } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type Company = { id: string; name: string };
type Report = {
  organization: Company;
  approvalPolicy: "contractor" | "subcontractor" | "either" | "dual";
  approved: boolean;
  totals: { scheduledMinutes: number; actualMinutes: number; approvedMinutes: number };
  lines: Array<{ shiftId: string; workerName: string; siteName: string; scheduledMinutes: number; actualMinutes: number | null; exceptions: string[] }>;
  recipients: string[];
};
const hours = (minutes: number) => (minutes / 60).toFixed(2);

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${url}`, { credentials: "include", ...init, headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export default function ManagedSubcontractorHoursPanel({ vendorId, companies, initialCompanyId, start, end, showSettings = false }: { vendorId: number; companies: Company[]; initialCompanyId?: string; start: string; end: string; showSettings?: boolean }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(initialCompanyId ?? companies[0]?.id ?? "");
  const [notice, setNotice] = useState("");
  const [recipients, setRecipients] = useState("");
  const [policy, setPolicy] = useState<Report["approvalPolicy"]>("either");
  const range = useMemo(() => `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, [start, end]);
  const path = `/api/vendors/${vendorId}/managed-subcontractors/${companyId}/hours`;
  const key = ["managed-subcontractor-hours", vendorId, companyId, start, end];
  const report = useQuery({ queryKey: key, enabled: Boolean(companyId), queryFn: async () => {
    const value = await json<Report>(`${path}?${range}`);
    setPolicy(value.approvalPolicy);
    setRecipients(value.recipients.join(", "));
    return value;
  } });
  const command = useMutation({ mutationFn: ({ suffix, method = "POST", body = {} }: { suffix: string; method?: string; body?: unknown }) => json(`${path}${suffix}?${range}`, { method, body: JSON.stringify(body) }), onSuccess: async () => { setNotice("Saved"); await qc.invalidateQueries({ queryKey: key }); } });
  if (!companies.length) return null;
  return <section className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4 space-y-4" data-testid="managed-subcontractor-hours-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Subcontractor hours</h3><p className="text-sm text-muted-foreground">Scheduled, accrued, and approved hours for outside payroll reporting.</p></div>
      {companies.length > 1 && <select aria-label="Subcontractor" className="rounded-full border-2 border-[color:var(--brand-primary)] bg-white px-3 py-2" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>}
    </div>
    {report.isLoading && <p role="status">Loading hours…</p>}
    {report.isError && <p role="alert" className="text-destructive">{report.error.message}</p>}
    {report.data && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={CARD_INNER_TILE_CLASS}><span className="text-xs text-muted-foreground">Scheduled</span><strong className="block text-xl">{hours(report.data.totals.scheduledMinutes)} hrs</strong></div>
        <div className={CARD_INNER_TILE_CLASS}><span className="text-xs text-muted-foreground">Accrued</span><strong className="block text-xl">{hours(report.data.totals.actualMinutes)} hrs</strong></div>
        <div className={CARD_INNER_TILE_CLASS}><span className="text-xs text-muted-foreground">Approved</span><strong className="block text-xl">{hours(report.data.totals.approvedMinutes)} hrs</strong></div>
      </div>
      <div className="space-y-2">{report.data.lines.map((line) => <div key={line.shiftId} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><span><strong>{line.workerName}</strong> · {line.siteName}</span><span>{hours(line.scheduledMinutes)} scheduled · {line.actualMinutes === null ? "Pending" : hours(line.actualMinutes)} accrued {line.exceptions.length ? <Clock3 className="ml-1 inline h-4 w-4 text-amber-600" aria-label="Needs review" /> : null}</span></div>)}</div>
      <div className="flex flex-wrap gap-2">
        <TogglePillButton color="green" disabled={command.isPending || report.data.approved || report.data.lines.some((line) => line.exceptions.length)} onClick={() => command.mutate({ suffix: "/approve" })}><CheckCircle2 className="h-4 w-4" />Approve hours</TogglePillButton>
        <TogglePillButton color="blue" disabled={command.isPending} onClick={() => command.mutate({ suffix: "/email" })}><Mail className="h-4 w-4" />Email Hours Report</TogglePillButton>
        <TogglePillButton color="red" type="button" onClick={() => { window.location.href = `${BASE}${path}/pdf?${range}`; }}><Download className="h-4 w-4" />Download PDF</TogglePillButton>
      </div>
      {showSettings && <div className={`grid gap-3 md:grid-cols-[12rem_1fr_auto] ${CARD_INNER_TILE_CLASS}`}>
        <label className="text-sm">Approval rule
          <Select value={policy} onValueChange={(value) => setPolicy(value as typeof policy)}>
            <SelectTrigger data-testid="select-subcontractor-approval-rule" className="mt-1 w-full rounded-full border-2 border-[color:var(--brand-primary)] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contractor">Contractor</SelectItem>
              <SelectItem value="subcontractor">Subcontractor</SelectItem>
              <SelectItem value="either">Either supervisor</SelectItem>
              <SelectItem value="dual">Both supervisors</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="text-sm">Email recipients<input data-testid="input-subcontractor-email-recipients" className="mt-1 w-full rounded-full border-2 border-[color:var(--brand-primary)] bg-white p-2" value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="payroll@subcontractor.com" /></label>
        <TogglePillButton color="green" className="self-end" disabled={command.isPending} onClick={() => command.mutate({ suffix: "/settings", method: "PATCH", body: { policy, recipients: recipients.split(",").map((value) => value.trim()).filter(Boolean) } })}>Save report rules</TogglePillButton>
      </div>}
    </>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {command.isError && <p role="alert" className="text-sm text-destructive">{command.error.message}</p>}
  </section>;
}
