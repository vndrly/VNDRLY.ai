import { useEffect, useMemo, useState } from "react";
import { FileText, Mail, Sheet } from "lucide-react";

import BlueButton from "@/components/blue-button";
import GreenButton from "@/components/green-button";
import RedButton from "@/components/red-button";
import BrandPillButton from "@/components/brand-pill-button";
import { BrandedSelect } from "@/components/work-hub/chrome";
import { useAuth } from "@/hooks/use-auth";

export type GateReportRange = "current_shift" | "previous_shift" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y";
export type GateReportRecordType = "all" | "check_ins" | "check_outs" | "visitors_on_site" | "employees_on_site" | "vehicles_on_site" | "pending" | "needs_review";
export type GateReportFilters = {
  siteId: number;
  stationId?: string;
  range: GateReportRange;
  recordType: GateReportRecordType;
  search?: string;
};

type Recipient = { userId: number; name: string; role: string; scope: string };

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.code ?? "Report request failed");
  return body as T;
}

export async function queryGateReportRows<T>(reportKind: "history" | "shift_notes", filters: GateReportFilters): Promise<T[]> {
  const result = await jsonRequest<{ rows: T[] }>("/gate-report/query", {
    method: "POST",
    body: JSON.stringify({ reportKind, filters }),
  });
  return result.rows;
}

export function GateReportToolbar({
  reportKind,
  filters,
  disabled = false,
}: {
  reportKind: "history" | "shift_notes";
  filters: GateReportFilters | null;
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const [format, setFormat] = useState<"pdf" | "excel" | "word">("pdf");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [showEmail, setShowEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recipientQuery = useMemo(() => {
    if (!filters) return "";
    const params = new URLSearchParams({
      reportKind,
      siteId: String(filters.siteId),
      range: filters.range,
      recordType: filters.recordType,
      ...(filters.stationId ? { stationId: filters.stationId } : {}),
      ...(filters.search ? { search: filters.search } : {}),
    });
    return `/gate-report/recipients?${params}`;
  }, [filters, reportKind]);

  useEffect(() => {
    setRecipients([]);
    setSelected([]);
    if (!showEmail || !recipientQuery) return;
    void jsonRequest<{ recipients: Recipient[] }>(recipientQuery).then(({ recipients: rows }) => {
      setRecipients(rows);
      const me = rows.find((row) => row.userId === user?.userId);
      if (me) setSelected([me.userId]);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load recipients"));
  }, [recipientQuery, showEmail, user?.userId]);

  const download = async (nextFormat: "pdf" | "excel" | "word") => {
    if (!filters || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/gate-report/export`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportKind, format: nextFormat, filters }),
      });
      if (!response.ok) throw new Error("Unable to export this report");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vndrly-${reportKind === "history" ? "gate-history" : "shift-notes"}.${nextFormat === "excel" ? "xls" : nextFormat === "word" ? "doc" : "pdf"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to export this report");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!filters || !selected.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await jsonRequest("/gate-report/deliver", {
        method: "POST",
        body: JSON.stringify({ reportKind, format, filters, recipientUserIds: selected }),
      });
      setMessage("Secure report links sent.");
      setShowEmail(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to email this report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid={`gate-${reportKind}-report-toolbar`}>
      <div className="grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
        <RedButton disabled={disabled || busy || !filters} onClick={() => void download("pdf")} data-testid="button-gate-export-pdf"><FileText className="mr-1 h-4 w-4" />PDF</RedButton>
        <GreenButton disabled={disabled || busy || !filters} onClick={() => void download("excel")} data-testid="button-gate-export-excel"><Sheet className="mr-1 h-4 w-4" />Excel</GreenButton>
        <BlueButton disabled={disabled || busy || !filters} onClick={() => void download("word")} data-testid="button-gate-export-word"><FileText className="mr-1 h-4 w-4" />Word</BlueButton>
        <BrandPillButton disabled={disabled || busy || !filters} onClick={() => setShowEmail((value) => !value)} data-testid="button-gate-email-report"><Mail className="mr-1 h-4 w-4" />Email</BrandPillButton>
      </div>
      {showEmail && (
        <div className="max-w-2xl space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4 text-gray-800">
          <div className="flex flex-wrap gap-3">
            <BrandedSelect aria-label="Report format" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
              <option value="pdf">PDF</option><option value="excel">Excel</option><option value="word">Word</option>
            </BrandedSelect>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recipients.map((recipient) => (
              <label key={recipient.userId} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <input type="checkbox" checked={selected.includes(recipient.userId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, recipient.userId] : current.filter((id) => id !== recipient.userId))} />
                <span>{recipient.name}{recipient.userId === user?.userId ? " (Me)" : ""} · {recipient.role}</span>
              </label>
            ))}
          </div>
          <BrandPillButton disabled={busy || !selected.length} onClick={() => void send()}>Send secure link</BrandPillButton>
        </div>
      )}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
