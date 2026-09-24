import { createHash, randomBytes, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { pool } from "@workspace/db";
import { sendNotificationAlertEmail } from "../lib/sendgrid";

export type GateReportRange = "current_shift" | "previous_shift" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y";
export type GateReportRecordType = "all" | "check_ins" | "check_outs" | "visitors_on_site" | "employees_on_site" | "vehicles_on_site" | "pending" | "needs_review";
export type GateReportKind = "history" | "shift_notes";
export type GateReportFormat = "pdf" | "excel" | "word";
export type GateReportFilters = {
  siteId: number;
  stationId?: string;
  range: GateReportRange;
  recordType: GateReportRecordType;
  search?: string;
};
export type GateReportScope = { kind: "full_site" } | { kind: "company"; company: string };
export type GateReportRow = Record<string, unknown> & {
  id: string;
  name?: string;
  company?: string | null;
  checkInTime?: string;
};
export type GateReportDelivery = {
  id: string;
  createdByUserId: number;
  recipientUserId: number;
  reportKind: GateReportKind;
  format: GateReportFormat;
  filters: GateReportFilters;
  recipientScope: GateReportScope;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export class GateReportsError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export interface GateReportDependencies {
  resolveAccess(userId: number, filters: GateReportFilters, reportKind: GateReportKind): Promise<GateReportScope | null>;
  createDelivery(input: GateReportDelivery & { deliveryKey: string }): Promise<GateReportDelivery>;
  findDelivery(tokenHash: string): Promise<GateReportDelivery | null>;
  markSent(id: string, at: Date): Promise<void>;
  markOpened(id: string, at: Date): Promise<void>;
  queryRows(filters: GateReportFilters, scope: GateReportScope, reportKind: GateReportKind): Promise<GateReportRow[]>;
  sendLink(input: { recipientUserId: number; url: string; token: string; reportKind: GateReportKind; format: GateReportFormat }): Promise<void>;
  listRecipientCandidates(filters: GateReportFilters, reportKind: GateReportKind): Promise<Array<{ userId: number; name: string; role: string }>>;
  now(): Date;
}

const fail = (status: number, code: string): never => { throw new GateReportsError(status, code); };
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const ranges: GateReportRange[] = ["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"];
const recordTypes: GateReportRecordType[] = ["all", "check_ins", "check_outs", "visitors_on_site", "employees_on_site", "vehicles_on_site", "pending", "needs_review"];

export function parseGateReportFilters(input: Partial<Record<keyof GateReportFilters, unknown>>): GateReportFilters {
  const siteId = Number(input.siteId);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) fail(400, "gate_report.invalid_site");
  const range = String(input.range ?? "current_shift") as GateReportRange;
  if (!ranges.includes(range)) fail(400, "gate_report.invalid_range");
  const recordType = String(input.recordType ?? "all") as GateReportRecordType;
  if (!recordTypes.includes(recordType)) fail(400, "gate_report.invalid_record_type");
  const stationId = typeof input.stationId === "string" && input.stationId.trim() ? input.stationId.trim() : undefined;
  const search = typeof input.search === "string" && input.search.trim() ? input.search.trim().slice(0, 200) : undefined;
  return { siteId, ...(stationId ? { stationId } : {}), range, recordType, ...(search ? { search } : {}) };
}

function scopeCanView(viewer: GateReportScope, report: GateReportScope) {
  if (viewer.kind === "full_site") return true;
  return report.kind === "company" && report.company.toLowerCase() === viewer.company.toLowerCase();
}

export async function deliverGateReports(input: {
  senderUserId: number;
  recipientUserIds: number[];
  reportKind: GateReportKind;
  format: GateReportFormat;
  filters: GateReportFilters;
}, deps: GateReportDependencies = databaseGateReportDependencies) {
  const filters = parseGateReportFilters(input.filters);
  if (!input.recipientUserIds.length || input.recipientUserIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    fail(400, "gate_report.invalid_recipients");
  const recipients = [...new Set(input.recipientUserIds)];
  const senderScope = await deps.resolveAccess(input.senderUserId, filters, input.reportKind);
  if (!senderScope) throw new GateReportsError(403, "gate_report.forbidden");
  if (input.reportKind === "shift_notes" && senderScope.kind !== "full_site")
    fail(403, "gate_report.shift_notes_scope_required");
  if (input.reportKind === "shift_notes") {
    const allowed = new Set((await deps.listRecipientCandidates(filters, input.reportKind)).map(recipient => recipient.userId));
    if (recipients.some(recipientUserId => !allowed.has(recipientUserId))) fail(403, "gate_report.recipient_forbidden");
  }
  const resolvedRecipients = await Promise.all(recipients.map(async (recipientUserId) => ({
    recipientUserId,
    scope: await deps.resolveAccess(recipientUserId, filters, input.reportKind),
  })));
  const eligible: Array<{ recipientUserId: number; scope: GateReportScope }> = [];
  for (const recipient of resolvedRecipients) {
    if (!recipient.scope) throw new GateReportsError(403, "gate_report.recipient_forbidden");
    const recipientScope = recipient.scope;
    if (input.reportKind === "shift_notes" && recipientScope.kind !== "full_site")
      throw new GateReportsError(403, "gate_report.shift_notes_scope_required");
    if (
      senderScope.kind === "company" &&
      recipientScope.kind === "company" &&
      senderScope.company.toLowerCase() !== recipientScope.company.toLowerCase()
    ) fail(403, "gate_report.recipient_forbidden");
    eligible.push({ recipientUserId: recipient.recipientUserId, scope: recipientScope });
  }
  const results: Array<{ id: string; recipientUserId: number; expiresAt: string }> = [];
  for (const { recipientUserId, scope: recipientAccess } of eligible) {
    if (!recipientAccess) fail(403, "gate_report.recipient_forbidden");
    const reportScope = senderScope.kind === "company" ? senderScope : recipientAccess;
    const token = randomBytes(32).toString("base64url");
    const createdAt = deps.now();
    const delivery = await deps.createDelivery({
      id: randomUUID(),
      createdByUserId: input.senderUserId,
      recipientUserId,
      reportKind: input.reportKind,
      format: input.format,
      filters,
      recipientScope: reportScope,
      tokenHash: tokenHash(token),
      deliveryKey: `${input.senderUserId}:${recipientUserId}:${input.reportKind}:${input.format}:${tokenHash(token).slice(0, 16)}`,
      expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60_000),
      revokedAt: null,
    });
    const base = process.env.APP_URL?.replace(/\/$/, "") || "https://vndrly.ai";
    const url = `${base}/gate/history?reportToken=${encodeURIComponent(token)}`;
    await deps.sendLink({ recipientUserId, url, token, reportKind: input.reportKind, format: input.format });
    await deps.markSent(delivery.id, deps.now());
    results.push({ id: delivery.id, recipientUserId, expiresAt: delivery.expiresAt.toISOString() });
  }
  return results;
}

export async function openGateReport(
  input: { token: string; userId: number },
  deps: GateReportDependencies = databaseGateReportDependencies,
) {
  if (!input.token.trim()) fail(404, "gate_report.link_not_found");
  const delivery = await deps.findDelivery(tokenHash(input.token.trim()));
  const now = deps.now();
  if (!delivery || delivery.revokedAt || delivery.expiresAt <= now)
    throw new GateReportsError(410, "gate_report.link_expired");
  if (delivery.recipientUserId !== input.userId) fail(403, "gate_report.wrong_recipient");
  const currentScope = await deps.resolveAccess(input.userId, delivery.filters, delivery.reportKind);
  if (!currentScope || !scopeCanView(currentScope, delivery.recipientScope))
    throw new GateReportsError(403, "gate_report.access_changed");
  if (delivery.reportKind === "shift_notes" && currentScope.kind !== "full_site") fail(403, "gate_report.access_changed");
  const rows = await deps.queryRows(delivery.filters, delivery.recipientScope, delivery.reportKind);
  const rendered = await renderGateReport(delivery.reportKind, delivery.format, rows);
  await deps.markOpened(delivery.id, now);
  return rendered;
}

export async function generateGateReport(input: {
  userId: number;
  reportKind: GateReportKind;
  format: GateReportFormat;
  filters: GateReportFilters;
}, deps: GateReportDependencies = databaseGateReportDependencies) {
  const filters = parseGateReportFilters(input.filters);
  const scope = await deps.resolveAccess(input.userId, filters, input.reportKind);
  if (!scope) throw new GateReportsError(403, "gate_report.forbidden");
  if (input.reportKind === "shift_notes" && scope.kind !== "full_site")
    fail(403, "gate_report.shift_notes_scope_required");
  return renderGateReport(input.reportKind, input.format, await deps.queryRows(filters, scope, input.reportKind));
}

export async function queryGateReport(input: {
  userId: number;
  reportKind: GateReportKind;
  filters: GateReportFilters;
}, deps: GateReportDependencies = databaseGateReportDependencies) {
  const filters = parseGateReportFilters(input.filters);
  const scope = await deps.resolveAccess(input.userId, filters, input.reportKind);
  if (!scope) throw new GateReportsError(403, "gate_report.forbidden");
  if (input.reportKind === "shift_notes" && scope.kind !== "full_site")
    fail(403, "gate_report.shift_notes_scope_required");
  return deps.queryRows(filters, scope, input.reportKind);
}

export async function listGateReportRecipients(
  input: { senderUserId: number; reportKind: GateReportKind; filters: GateReportFilters },
  deps: GateReportDependencies = databaseGateReportDependencies,
) {
  const filters = parseGateReportFilters(input.filters);
  const senderScope = await deps.resolveAccess(input.senderUserId, filters, input.reportKind);
  if (!senderScope) throw new GateReportsError(403, "gate_report.forbidden");
  if (input.reportKind === "shift_notes" && senderScope.kind !== "full_site")
    fail(403, "gate_report.shift_notes_scope_required");
  const candidates = await deps.listRecipientCandidates(filters, input.reportKind);
  const recipients = [];
  for (const candidate of candidates) {
    const scope = await deps.resolveAccess(candidate.userId, filters, input.reportKind);
    if (!scope) continue;
    if (input.reportKind === "shift_notes" && scope.kind !== "full_site") continue;
    if (senderScope.kind === "company" && scope.kind === "company" && senderScope.company.toLowerCase() !== scope.company.toLowerCase()) continue;
    recipients.push({ ...candidate, scope: scope.kind });
  }
  return recipients;
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function renderGateReport(kind: GateReportKind, format: GateReportFormat, rows: GateReportRow[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const title = kind === "history" ? "VNDRLY Gate History" : "VNDRLY Shift Notes";
  if (format === "excel") {
    const cells = (values: unknown[]) => values.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("");
    const body = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table><Row>${cells(columns)}</Row>${rows.map((row) => `<Row>${cells(columns.map((key) => row[key]))}</Row>`).join("")}</Table></Worksheet></Workbook>`;
    return { body: Buffer.from(body), contentType: "application/vnd.ms-excel", filename: "vndrly-gate-report.xls" };
  }
  if (format === "word") {
    const body = `<!doctype html><html><body><h1>${title}</h1><table><thead><tr>${columns.map((key) => `<th>${escapeXml(key)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td>${escapeXml(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
    return { body: Buffer.from(body), contentType: "application/msword", filename: "vndrly-gate-report.doc" };
  }
  const document = new PDFDocument({ margin: 36, size: "LETTER", layout: "landscape" });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.fontSize(18).text(title).moveDown();
  document.fontSize(8);
  for (const row of rows) document.text(columns.map((key) => `${key}: ${String(row[key] ?? "")}`).join("  |  ")).moveDown(0.4);
  document.end();
  return { body: await complete, contentType: "application/pdf", filename: "vndrly-gate-report.pdf" };
}

async function resolveRange(filters: GateReportFilters, now: Date) {
  const duration: Record<Exclude<GateReportRange, "current_shift" | "previous_shift">, number> = {
    "24h": 1, "7d": 7, "14d": 14, "30d": 30, "90d": 90, "1y": 366,
  };
  if (filters.range !== "current_shift" && filters.range !== "previous_shift")
    return { from: new Date(now.getTime() - duration[filters.range] * 86_400_000), to: now };
  const params: unknown[] = [filters.siteId];
  let station = "";
  if (filters.stationId) { params.push(filters.stationId); station = `AND station_id=$${params.length}`; }
  const order = filters.range === "current_shift" ? "ended_at IS NULL DESC, started_at DESC" : "ended_at DESC NULLS LAST";
  const row = (await pool.query(
    `SELECT started_at,coalesce(ended_at,$${params.length + 1}::timestamptz) AS ended_at
     FROM gate_shifts WHERE station_id IN (SELECT id FROM gate_stations WHERE site_id=$1) ${station}
     ${filters.range === "previous_shift" ? "AND ended_at IS NOT NULL" : ""}
     ORDER BY ${order} LIMIT 1`,
    [...params, now],
  )).rows[0];
  return row ? { from: new Date(row.started_at), to: new Date(row.ended_at) } : { from: new Date(now.getTime() - 12 * 60 * 60_000), to: now };
}

async function resolveDatabaseAccess(userId: number, filters: GateReportFilters, reportKind: GateReportKind): Promise<GateReportScope | null> {
  const site = (await pool.query("SELECT partner_id FROM site_locations WHERE id=$1", [filters.siteId])).rows[0];
  if (!site) return null;
  const user = (await pool.query("SELECT role,suspended_at FROM users WHERE id=$1", [userId])).rows[0];
  if (!user || user.suspended_at) return null;
  if (user.role === "admin") return { kind: "full_site" };
  const partner = await pool.query(
    "SELECT 1 FROM user_org_memberships WHERE user_id=$1 AND org_type='partner' AND partner_id=$2 AND role IN ('admin','member','ap') LIMIT 1",
    [userId, site.partner_id],
  );
  if (partner.rowCount) return { kind: "full_site" };
  const managed = (await pool.query(
    `SELECT o.name, bool_or(g.role='gate_supervisor' AND g.site_id=$2 AND g.status='active') AS site_wide
     FROM managed_subcontractor_worker_sponsorships w
     JOIN managed_subcontractor_organizations o ON o.id=w.managed_organization_id
     LEFT JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=w.id
     WHERE w.worker_user_id=$1 AND w.status='active' GROUP BY o.name LIMIT 1`,
    [userId, filters.siteId],
  )).rows[0];
  if (managed) {
    if (reportKind === "shift_notes" && managed.site_wide) return { kind: "full_site" };
    return reportKind === "history" ? { kind: "company", company: managed.name } : null;
  }
  const vendor = (await pool.query(
    `SELECT v.name,m.role FROM user_org_memberships m JOIN vendors v ON v.id=m.vendor_id
     WHERE m.user_id=$1 AND m.org_type='vendor' AND m.role IN ('admin','member','ap')
       AND EXISTS (SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=m.vendor_id AND a.site_location_id=$2)
     LIMIT 1`,
    [userId, filters.siteId],
  )).rows[0];
  return vendor ? { kind: "full_site" } : null;
}

async function queryDatabaseRows(filters: GateReportFilters, scope: GateReportScope, reportKind: GateReportKind) {
  const now = new Date();
  const { from, to } = await resolveRange(filters, now);
  if (reportKind === "shift_notes") {
    const result = await pool.query(
      `SELECT 'handoff:'||h.id AS id,h.outgoing_name AS "outgoingName",h.incoming_name AS "incomingName",
        h.acknowledged_at AS "acknowledgedAt",p.notes,g.name AS "gateName"
       FROM gate_handovers h JOIN gate_preparations p ON p.id=h.preparation_id
       JOIN gate_shifts s ON s.id=p.shift_id JOIN gate_stations g ON g.id=s.station_id
       WHERE g.site_id=$1 AND ($2::uuid IS NULL OR g.id=$2) AND h.acknowledged_at >= $3 AND h.acknowledged_at <= $4
       ORDER BY h.acknowledged_at DESC LIMIT 25000`,
      [filters.siteId, filters.stationId ?? null, from, to],
    );
    return result.rows as GateReportRow[];
  }
  const result = await pool.query(
    `SELECT 'visit:'||v.id AS id,v.id AS "visitId",trim(v.first_name||' '||v.last_name) AS name,v.company,
      v.vehicle_plate AS "vehiclePlate",v.plate_state AS "plateState",v.check_in_time AS "checkInTime",
      v.check_out_time AS "checkOutTime",v.admission_status AS "admissionStatus",
      v.reconciliation_state AS "reconciliationState",'visitor' AS kind
     FROM site_visits v WHERE v.site_location_id=$1 AND v.check_in_time <= $3
       AND (v.check_out_time IS NULL OR v.check_out_time >= $2)
     UNION ALL
     SELECT 'employee:'||c.id,NULL,trim(p.first_name||' '||p.last_name),ven.name,NULL,NULL,c.check_in_at,c.check_out_at,NULL,NULL,'employee'
     FROM ticket_check_ins c JOIN tickets t ON t.id=c.ticket_id JOIN vendor_people p ON p.id=c.employee_id
       JOIN vendors ven ON ven.id=t.vendor_id WHERE t.site_location_id=$1 AND c.check_in_at <= $3
       AND (c.check_out_at IS NULL OR c.check_out_at >= $2)
     ORDER BY "checkInTime" DESC LIMIT 25000`,
    [filters.siteId, from, to],
  );
  const search = filters.search?.toLowerCase();
  return (result.rows as GateReportRow[]).filter((row) => {
    if (scope.kind === "company" && String(row.company ?? "").toLowerCase() !== scope.company.toLowerCase()) return false;
    if (search && !Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(search))) return false;
    const checkOut = row.checkOutTime != null;
    const onSite = !checkOut && row.reconciliationState !== "confirmed_off_site";
    switch (filters.recordType) {
      case "check_ins": return true;
      case "check_outs": return checkOut;
      case "visitors_on_site": return row.kind === "visitor" && onSite;
      case "employees_on_site": return row.kind === "employee" && onSite;
      case "vehicles_on_site": return Boolean(row.vehiclePlate) && onSite;
      case "pending": return row.admissionStatus === "pending";
      case "needs_review": return row.reconciliationState === "needs_review";
      default: return true;
    }
  });
}

export const databaseGateReportDependencies: GateReportDependencies = {
  resolveAccess: resolveDatabaseAccess,
  async createDelivery(input) {
    const row = (await pool.query(
      `INSERT INTO gate_report_deliveries(id,created_by_user_id,recipient_user_id,report_kind,format,filters,recipient_scope,token_hash,delivery_key,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [input.id, input.createdByUserId, input.recipientUserId, input.reportKind, input.format, input.filters, input.recipientScope, input.tokenHash, input.deliveryKey, input.expiresAt],
    )).rows[0];
    return deliveryRow(row);
  },
  async findDelivery(hash) {
    const row = (await pool.query("SELECT * FROM gate_report_deliveries WHERE token_hash=$1", [hash])).rows[0];
    return row ? deliveryRow(row) : null;
  },
  async markSent(id, at) { await pool.query("UPDATE gate_report_deliveries SET sent_at=coalesce(sent_at,$2) WHERE id=$1", [id, at]); },
  async markOpened(id, at) { await pool.query("UPDATE gate_report_deliveries SET opened_at=coalesce(opened_at,$2) WHERE id=$1", [id, at]); },
  queryRows: queryDatabaseRows,
  async sendLink(input) {
    const contact = (await pool.query("SELECT coalesce(email,username) AS email,display_name FROM users WHERE id=$1", [input.recipientUserId])).rows[0];
    if (!contact?.email) fail(400, "gate_report.recipient_email_missing");
    await sendNotificationAlertEmail({
      to: contact.email,
      recipientName: contact.display_name,
      category: "system",
      type: "gate_report_ready",
      title: input.reportKind === "history" ? "Gate History report ready" : "Shift Notes report ready",
      body: `Your ${input.format.toUpperCase()} report is ready. Sign in to VNDRLY to open it; access is checked again when you do.`,
      link: input.url,
      highPriority: false,
    });
  },
  async listRecipientCandidates(filters, reportKind) {
    if (reportKind === "shift_notes") {
      const rows = (await pool.query(
        `SELECT DISTINCT u.id AS user_id,coalesce(u.display_name,u.username) AS name,
          coalesce(vp.vendor_role,m.role) AS role
         FROM users u
         JOIN user_org_memberships m ON m.user_id=u.id AND m.org_type='vendor'
         JOIN vendor_people vp ON vp.user_id=u.id AND vp.vendor_id=m.vendor_id AND vp.deleted_at IS NULL AND vp.is_active=true
         WHERE u.suspended_at IS NULL AND coalesce(u.email,u.username) LIKE '%@%'
           AND EXISTS (SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=m.vendor_id AND a.site_location_id=$1)
           AND vp.vendor_role IN ('admin','office','both','gate_supervisor','gatekeeper')
           AND lower(coalesce(u.email,u.username)) !~ '(^|[.@_-])(e2e|test)([.@_-]|$)'
           AND lower(coalesce(u.display_name,'')) !~ '(^|[^a-z])(e2e|test)([^a-z]|$)'
         ORDER BY name LIMIT 5000`,
        [filters.siteId],
      )).rows;
      return rows.map((row) => ({ userId: Number(row.user_id), name: String(row.name), role: String(row.role ?? "member") }));
    }
    const rows = (await pool.query(
      `SELECT DISTINCT u.id AS user_id,coalesce(u.display_name,u.username) AS name,
        coalesce(vp.vendor_role,m.role,u.role) AS role
       FROM users u
       LEFT JOIN user_org_memberships m ON m.user_id=u.id
       LEFT JOIN vendor_people vp ON vp.user_id=u.id AND vp.deleted_at IS NULL AND vp.is_active=true
       LEFT JOIN site_locations s ON s.id=$1
       WHERE u.suspended_at IS NULL AND coalesce(u.email,u.username) LIKE '%@%'
         AND (u.role='admin'
           OR (m.org_type='partner' AND m.partner_id=s.partner_id)
           OR (m.org_type='vendor' AND EXISTS (
             SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=m.vendor_id AND a.site_location_id=$1
           ))
           OR EXISTS (
             SELECT 1 FROM managed_subcontractor_worker_sponsorships w
             LEFT JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=w.id
             WHERE w.worker_user_id=u.id AND w.status='active' AND (g.site_id=$1 OR g.site_id IS NULL)
           ))
       ORDER BY name LIMIT 5000`,
      [filters.siteId],
    )).rows;
    return rows.map((row) => ({ userId: Number(row.user_id), name: String(row.name), role: String(row.role ?? "member") }));
  },
  now: () => new Date(),
};

function deliveryRow(row: Record<string, unknown>): GateReportDelivery {
  return {
    id: String(row.id),
    createdByUserId: Number(row.created_by_user_id),
    recipientUserId: Number(row.recipient_user_id),
    reportKind: row.report_kind as GateReportKind,
    format: row.format as GateReportFormat,
    filters: row.filters as GateReportFilters,
    recipientScope: row.recipient_scope as GateReportScope,
    tokenHash: String(row.token_hash),
    expiresAt: new Date(row.expires_at as Date | string),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as Date | string) : null,
  };
}

export function createMemoryGateReportDependencies(input: {
  access: Map<number, GateReportScope | null>;
  rows?: GateReportRow[];
  recipients?: Array<{ userId: number; name: string; role: string }>;
}): GateReportDependencies & { sent(): Array<{ recipientUserId: number; url: string; token: string }> } {
  const deliveries = new Map<string, GateReportDelivery>();
  const sent: Array<{ recipientUserId: number; url: string; token: string }> = [];
  return {
    sent: () => [...sent],
    resolveAccess: async (userId) => input.access.get(userId) ?? null,
    async createDelivery(delivery) { deliveries.set(delivery.tokenHash, delivery); return delivery; },
    findDelivery: async (hash) => deliveries.get(hash) ?? null,
    markSent: async () => undefined,
    markOpened: async () => undefined,
    async queryRows(_filters, scope) {
      const rows = input.rows ?? [];
      return scope.kind === "company" ? rows.filter((row) => String(row.company ?? "").toLowerCase() === scope.company.toLowerCase()) : rows;
    },
    async sendLink(message) { sent.push({ recipientUserId: message.recipientUserId, url: message.url, token: message.token }); },
    async listRecipientCandidates() {
      return input.recipients ?? [...input.access.keys()].map((userId) => ({ userId, name: `User ${userId}`, role: "member" }));
    },
    now: () => new Date("2026-09-22T12:00:00.000Z"),
  };
}
