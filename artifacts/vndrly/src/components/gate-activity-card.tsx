import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { LogIn, LogOut, Clock3, AlertTriangle } from "lucide-react";
import type { ChangeOverSnapshot } from "@workspace/gate-booth";
import { WorkspacePanel } from "./work-hub/workspace-panel";

/** The same collapsible activity card on Dashboard and Gate Map. */
export function GateActivityCard({ snapshot, historyBaseHref, activityWindow, scopeLabel, recordHistoryHref, showAllLogLink = true, contentOnly = false }: {
  snapshot: ChangeOverSnapshot | null; historyBaseHref: string; activityWindow?: "24h"; scopeLabel?: string;
  recordHistoryHref?: (recordId: string) => string; showAllLogLink?: boolean; contentOnly?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const metricRecordType: Record<string, string> = {
    checkIns: "check_ins",
    checkOuts: "check_outs",
    onSiteVisitorRecords: "visitors_on_site",
    onSiteEmployeeRecords: "employees_on_site",
    onSiteVehicles: "vehicles_on_site",
    pendingAdmission: "pending",
  };
    const unavailable = c("Site records unavailable.", "Registros del sitio no disponibles.");
    type RecordRow = ChangeOverSnapshot["outstanding"][number] & { checkOut?: string | null };
    const records = new Map<string, RecordRow>([...(snapshot?.records ?? []), ...(snapshot?.outstanding ?? [])].map(row => [row.id, row]));
    const recordLink = (row: RecordRow, recordType: string, key = row.id, detail?: string) => {
      const recordId = row.id.replace(/^checkin:/, "employee:");
      const pending = recordType === "pending" || snapshot?.metricRecordIds?.pendingAdmission?.includes(row.id);
      const departed = row.checkOut && Date.parse(row.checkOut) <= Date.parse(snapshot?.generatedAt ?? "");
      const status = pending ? c("Awaiting Admission", "Esperando admisión") : departed ? c("Departed", "Salió") : c("On Site", "En el sitio");
      const company = row.company?.replace(/\s*\(fictional\)/gi, "").trim();
      const plate = row.plate?.trim().replace(/\s*[:•·]\s*/, ".");
      const description = [[company, plate].filter(Boolean).join(" "), status].filter(Boolean).join(" · ");
      return <Link key={key} className="gate-metric-record" href={`${recordHistoryHref?.(row.id) ?? historyBaseHref}&recordType=${recordType}&recordId=${encodeURIComponent(recordId)}&view=record`}><strong>{row.name || row.id}</strong><small title={detail ?? description}>{description}</small></Link>;
    };
    const metric = (key: keyof ChangeOverSnapshot["metrics"], Icon: typeof LogIn) => {
      const ids = snapshot?.metricRecordIds?.[key];
      const matching = ids ? ids.map(id => records.get(id)).filter((row): row is RecordRow => Boolean(row)) :
        (snapshot?.outstanding ?? []).filter(row => key === "onSiteVisitorRecords" ? row.kind === "visitor" : key === "onSiteEmployeeRecords" ? row.kind === "employee" : false);
      return <details key={key} className="gate-panel-disclosure" data-testid={`dashboard-metric-${key}`}>
        <summary><Icon aria-hidden="true" /><span className="flex-1">{t(`changeOver.${key}`)}</span><small>{snapshot ? String(snapshot.metrics[key]) : c("Unavailable", "No disponible")}</small></summary>
        <div className="gate-panel-detail"><div className="gate-metric-records">{matching.map(row => recordLink(row, metricRecordType[key]))}</div>
          {!matching.length && <p>{snapshot && snapshot.metrics[key] === 0 ? t("changeOver.none") : unavailable}</p>}
          {showAllLogLink && <Link className="gate-all-shift-notes" href={`${historyBaseHref}&recordType=${metricRecordType[key]}`}>{c("Open Gate Log", "Abrir registro de acceso")}</Link>}
        </div>
      </details>;
    };
    const contents = <>
        {metric("checkIns", LogIn)}{metric("checkOuts", LogOut)}{metric("pendingAdmission", Clock3)}
        <details className="gate-panel-disclosure" data-testid="dashboard-metric-exceptions"><summary><AlertTriangle aria-hidden="true" /><span className="flex-1">{t("changeOver.exceptions")}</span><small>{snapshot?.exceptions.length ?? "—"}</small></summary><div className="gate-panel-detail"><div className="gate-metric-records">{snapshot?.exceptions.map(e => recordLink(records.get(e.sourceId) ?? { id: e.sourceId, name: e.sourceId, kind: "visitor", company: null, plate: null, checkIn: "", notes: null }, "needs_review", `${e.sourceId}:${e.code}`, e.text))}</div>{!snapshot ? <p>{unavailable}</p> : !snapshot.exceptions.length && <p>{t("changeOver.none")}</p>}{showAllLogLink && <Link className="gate-all-shift-notes" href={`${historyBaseHref}&recordType=needs_review`}>{c("Open Gate Log", "Abrir registro de acceso")}</Link>}</div></details>
      </>;
    return contentOnly ? contents : <WorkspacePanel title={c("Gate activity", "Actividad del acceso")} subtitle={snapshot ? `${scopeLabel ? scopeLabel + " · " : ""}${activityWindow === "24h" ? c("Last 24 hours", "Últimas 24 horas") + " · " : ""}${t("changeOver.asOf")} ${new Date(snapshot.generatedAt).toLocaleString()}` : unavailable} icon={LogIn}>{contents}</WorkspacePanel>;
}

/** Activity totals captured when this shift was handed over. */
export function GateShiftActivityStatistics({ snapshot }: { snapshot: ChangeOverSnapshot }) {
  const { t } = useTranslation();
  const totals = [
    ["checkIns", snapshot.metrics.checkIns, LogIn],
    ["checkOuts", snapshot.metrics.checkOuts, LogOut],
    ["pendingAdmission", snapshot.metrics.pendingAdmission, Clock3],
    ["exceptions", snapshot.exceptions.length, AlertTriangle],
  ] as const;
  return <div className="gate-shift-activity-statistics" aria-label="Gate activity">
    {totals.map(([key, value, Icon]) => <div key={key} className="flex items-center gap-2 py-2 border-b border-white/10 last:border-0"><Icon aria-hidden="true" className="h-4 w-4 text-[var(--brand-primary)]" /><span className="flex-1">{t(`changeOver.${key}`)}</span><strong>{value}</strong></div>)}
  </div>;
}
