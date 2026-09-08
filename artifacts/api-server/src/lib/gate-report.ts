import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { SessionPayload } from "./session";

export type GateReportCategory = "routine_vendor_work" | "visitor" | "partner_admin" | "vendor_admin" | "unclassified";
export interface GateReportFilters {
  from: string;
  to: string;
  siteLocationId: number | null;
  partnerId: number | null;
  company: string;
  purpose: string;
  category: GateReportCategory | "all";
  recordKind: "all" | "visitor" | "employee_checkin";
}
export interface GateReportRow {
  id: string;
  kind: "visitor" | "employee_checkin";
  category: GateReportCategory;
  name: string;
  company: string | null;
  purpose: string | null;
  siteLocationId: number;
  siteName: string;
  partnerId: number;
  checkInTime: string;
  checkOutTime: string | null;
  admissionStatus: string | null;
  identityKey: string | null;
  currentOnsite: boolean;
  incomplete: string[];
}
type RawRow = Omit<GateReportRow, "currentOnsite" | "incomplete">;
export class GateReportError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const DAY = 86_400_000;
const MAX_ROWS = 25_000;
const TTL = 10 * 60_000;
const snapshots = new Map<string, {
  owner: string; expiresAt: number; generatedAt: string; filters: GateReportFilters;
  rows: GateReportRow[]; totals: ReturnType<typeof summarizeGateRows>; bytes: number;
}>();

export function __resetGateReportSnapshotsForTests() { snapshots.clear(); }

async function requireCurrentReportMembership(session: SessionPayload) {
  const membership = session.role === "admin" ? sql`u.role = 'admin'` : sql`EXISTS (
    SELECT 1 FROM user_org_memberships m WHERE m.user_id = u.id
      AND m.org_type = ${session.role} AND m.role IN ('admin', 'member', 'ap')
      AND ${session.role === "partner" ? sql`m.partner_id = ${session.partnerId}` : sql`m.vendor_id = ${session.vendorId}`}
      AND ${session.activeMembershipId == null ? sql`true` : sql`m.id = ${session.activeMembershipId}`}
  )`;
  const result = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = ${session.userId}
    AND u.suspended_at IS NULL AND (${membership})
    AND ${session.sv == null ? sql`true` : sql`u.session_version = ${session.sv}`}
  ) AS gate_report_session_access`);
  if (result.rows[0]?.gate_report_session_access !== true) throw new GateReportError(403, "gate_report.forbidden", "Your current account no longer has report access");
}

async function snapshotStillAuthorized(session: SessionPayload, rows: GateReportRow[]) {
  if (rows.length === 0) return true;
  const visitIds = rows.filter(row => row.kind === "visitor").map(row => Number(row.id.slice(6)));
  const checkinIds = rows.filter(row => row.kind === "employee_checkin").map(row => Number(row.id.slice(8)));
  const visitScope = session.role === "partner" ? sql`s.partner_id = ${session.partnerId}` : session.role === "vendor" ? sql`v.host_type = 'vendor' AND v.host_vendor_id = ${session.vendorId}` : sql`true`;
  const employeeScope = session.role === "partner" ? sql`s.partner_id = ${session.partnerId}` : session.role === "vendor" ? sql`t.vendor_id = ${session.vendorId} AND p.vendor_id = ${session.vendorId}` : sql`true`;
  const result = await db.execute(sql`WITH gate_report_snapshot_access AS (
    SELECT 'visit:' || v.id AS id FROM site_visits v JOIN site_locations s ON s.id = v.site_location_id
      WHERE v.id = ANY(${sql.param(visitIds)}::int[]) AND (${visitScope})
    UNION ALL
    SELECT 'checkin:' || c.id FROM ticket_check_ins c JOIN tickets t ON t.id = c.ticket_id
      JOIN vendor_people p ON p.id = c.employee_id AND p.vendor_id = t.vendor_id
      JOIN site_locations s ON s.id = t.site_location_id
      WHERE c.id = ANY(${sql.param(checkinIds)}::int[]) AND (${employeeScope})
  ) SELECT id FROM gate_report_snapshot_access`);
  const allowed = new Set(result.rows.map(row => row.id));
  return rows.every(row => allowed.has(row.id));
}

export function gateReportOwner(session: SessionPayload): string {
  const scoped = session.role === "admin" ||
    (session.role === "partner" && Number.isSafeInteger(session.partnerId) && Number(session.partnerId) > 0) ||
    (session.role === "vendor" && Number.isSafeInteger(session.vendorId) && Number(session.vendorId) > 0);
  if (!session.userId || !scoped) throw new GateReportError(403, "gate_report.forbidden", "An active office company is required");
  return JSON.stringify([session.userId, session.role, session.partnerId, session.vendorId, session.activeMembershipId, session.sv]);
}

export function parseGateReportFilters(input: Record<string, unknown>, now = new Date()): GateReportFilters {
  const date = (value: unknown, fallback: Date) => {
    if (value == null || value === "") return fallback;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new GateReportError(400, "gate_report.invalid_range", "Dates require an explicit timezone");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new GateReportError(400, "gate_report.invalid_range", "Invalid date range");
    return parsed;
  };
  const from = date(input.from, new Date(now.getTime() - 7 * DAY));
  const to = date(input.to, now);
  if (from >= to || to.getTime() - from.getTime() > 31 * DAY) throw new GateReportError(400, "gate_report.invalid_range", "Choose a date range of at most 31 days");
  const id = (value: unknown) => {
    if (value == null || value === "" || value === "all") return null;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) throw new GateReportError(400, "gate_report.invalid_id", "Invalid site or partner");
    return number;
  };
  const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 200) : "";
  const category = input.category ?? "all";
  if (!["all", "routine_vendor_work", "visitor", "partner_admin", "vendor_admin", "unclassified"].includes(String(category))) throw new GateReportError(400, "gate_report.invalid_category", "Invalid category");
  const recordKind = input.recordKind ?? "all";
  if (!["all", "visitor", "employee_checkin"].includes(String(recordKind))) throw new GateReportError(400, "gate_report.invalid_source", "Invalid record source");
  return { from: from.toISOString(), to: to.toISOString(), siteLocationId: id(input.siteLocationId), partnerId: id(input.partnerId), company: text(input.company), purpose: text(input.purpose), category: category as GateReportFilters["category"], recordKind: recordKind as GateReportFilters["recordKind"] };
}

export function summarizeGateRows(rows: GateReportRow[]) {
  return {
    entries: rows.length,
    visitorEntries: rows.filter(row => row.kind === "visitor").length,
    employeeCheckins: rows.filter(row => row.kind === "employee_checkin").length,
    currentOnsiteEntries: rows.filter(row => row.currentOnsite).length,
    uniqueRecordedIdentities: new Set(rows.flatMap(row => row.identityKey ? [row.identityKey] : [])).size,
    unidentifiedEntries: rows.filter(row => !row.identityKey).length,
    incompleteEntries: rows.filter(row => row.incomplete.length > 0).length,
    unclassifiedEntries: rows.filter(row => row.category === "unclassified").length,
    pendingAdmissionEntries: rows.filter(row => row.admissionStatus === "pending").length,
  };
}

export function prepareGateRows(rows: RawRow[], snapshotAt: Date): GateReportRow[] {
  return rows.map(row => {
    const incomplete: string[] = [];
    if (!row.identityKey) incomplete.push("identity_unrecorded");
    if (!row.name.trim()) incomplete.push("name_unrecorded");
    if (row.category === "unclassified") incomplete.push("category_unrecorded");
    if (row.kind === "visitor" && !row.purpose?.trim()) incomplete.push("purpose_unrecorded");
    if (row.checkOutTime && new Date(row.checkOutTime) < new Date(row.checkInTime)) incomplete.push("invalid_time_order");
    return { ...row, incomplete, currentOnsite: !row.checkOutTime && row.admissionStatus !== "pending" && new Date(row.checkInTime) <= snapshotAt };
  });
}

// Both branches are authorized before UNION. Only explicit staff categories
// establish a visitor role; missing/unknown stored values remain unclassified.
export function buildGateReportQuery(session: SessionPayload, filters: GateReportFilters, snapshotAt: Date) {
  gateReportOwner(session);
  const visitScope = session.role === "partner" ? sql`s.partner_id = ${session.partnerId}` : session.role === "vendor" ? sql`v.host_type = 'vendor' AND v.host_vendor_id = ${session.vendorId}` : sql`true`;
  const employeeScope = session.role === "partner" ? sql`s.partner_id = ${session.partnerId}` : session.role === "vendor" ? sql`t.vendor_id = ${session.vendorId} AND p.vendor_id = ${session.vendorId}` : sql`true`;
  const from = new Date(filters.from);
  const to = new Date(filters.to);
  return sql`
    WITH entries AS (
      SELECT 'visit:' || v.id AS id, 'visitor' AS kind,
        CASE WHEN v.entry_category IN ('visitor', 'routine_vendor_work', 'partner_admin', 'vendor_admin') THEN v.entry_category ELSE 'unclassified' END AS category,
        trim(v.first_name || ' ' || v.last_name) AS name, v.company, v.purpose,
        s.id AS "siteLocationId", s.name AS "siteName", s.partner_id AS "partnerId",
        v.check_in_time AS "checkInTime",
        CASE WHEN v.check_out_time <= ${snapshotAt} THEN v.check_out_time ELSE NULL END AS "checkOutTime",
        v.admission_status AS "admissionStatus",
        CASE WHEN v.guest_session_id IS NOT NULL THEN 'guest-session:' || v.guest_session_id ELSE NULL END AS "identityKey"
      FROM site_visits v JOIN site_locations s ON s.id = v.site_location_id
      WHERE (${visitScope}) AND v.created_at <= ${snapshotAt} AND v.check_in_time <= ${snapshotAt}
        AND v.check_in_time < ${to} AND (v.check_out_time IS NULL OR v.check_out_time > ${from})
      UNION ALL
      SELECT 'checkin:' || c.id, 'employee_checkin', 'routine_vendor_work',
        trim(p.first_name || ' ' || p.last_name), vendor.name, NULL,
        s.id, s.name, s.partner_id, c.check_in_at,
        CASE WHEN c.check_out_at <= ${snapshotAt} THEN c.check_out_at ELSE NULL END,
        NULL, 'employee:' || c.employee_id
      FROM ticket_check_ins c JOIN tickets t ON t.id = c.ticket_id
        JOIN vendor_people p ON p.id = c.employee_id AND p.vendor_id = t.vendor_id
        JOIN vendors vendor ON vendor.id = t.vendor_id JOIN site_locations s ON s.id = t.site_location_id
      WHERE (${employeeScope}) AND c.created_at <= ${snapshotAt} AND c.check_in_at <= ${snapshotAt}
        AND c.check_in_at < ${to} AND (c.check_out_at IS NULL OR c.check_out_at > ${from})
    )
    SELECT * FROM entries WHERE
      ${filters.siteLocationId == null ? sql`true` : sql`"siteLocationId" = ${filters.siteLocationId}`}
      AND ${filters.partnerId == null ? sql`true` : sql`"partnerId" = ${filters.partnerId}`}
      AND position(lower(${filters.company}) in lower(coalesce(company, ''))) > 0
      AND position(lower(${filters.purpose}) in lower(coalesce(purpose, ''))) > 0
      AND ${filters.category === "all" ? sql`true` : sql`category = ${filters.category}`}
      AND ${filters.recordKind === "all" ? sql`true` : sql`kind = ${filters.recordKind}`}
    ORDER BY "checkInTime" DESC, id DESC LIMIT ${MAX_ROWS + 1}`;
}

export async function getGateReport(session: SessionPayload, input: Record<string, unknown>, now = new Date()) {
  const owner = gateReportOwner(session);
  for (const [id, snapshot] of snapshots) if (snapshot.expiresAt <= now.getTime()) snapshots.delete(id);
  const offset = input.offset == null ? 0 : Number(input.offset);
  const limit = input.limit == null ? 250 : Number(input.limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new GateReportError(400, "gate_report.invalid_page", "Invalid report page");
  let snapshotId = typeof input.snapshotId === "string" ? input.snapshotId : "";
  let snapshot = snapshotId ? snapshots.get(snapshotId) : undefined;
  if (snapshotId && (!snapshot || snapshot.owner !== owner)) throw new GateReportError(410, "gate_report.expired", "Report expired or unavailable; run the report again");
  await requireCurrentReportMembership(session);
  if (snapshot && !(await snapshotStillAuthorized(session, snapshot.rows))) {
    snapshots.delete(snapshotId);
    throw new GateReportError(403, "gate_report.access_changed", "Report access changed; run the report again");
  }
  if (!snapshot) {
    if (offset !== 0) throw new GateReportError(400, "gate_report.snapshot_required", "Start with the first report page");
    const filters = parseGateReportFilters(input, now);
    const result = await db.execute(buildGateReportQuery(session, filters, now));
    if (result.rows.length > MAX_ROWS) throw new GateReportError(413, "gate_report.too_large", "Report exceeds 25,000 entries; narrow the date or site filters. No partial report was returned");
    const rows = prepareGateRows(result.rows.map(row => ({ ...row, checkInTime: new Date(row.checkInTime as string).toISOString(), checkOutTime: row.checkOutTime ? new Date(row.checkOutTime as string).toISOString() : null })) as RawRow[], now);
    snapshotId = randomUUID();
    snapshot = { owner, expiresAt: now.getTime() + TTL, generatedAt: now.toISOString(), filters, rows, totals: summarizeGateRows(rows), bytes: Buffer.byteLength(JSON.stringify(rows)) };
    const owned = [...snapshots].filter(([, value]) => value.owner === owner);
    const victims = owned.slice(0, Math.max(0, owned.length - 1));
    const currentBytes = [...snapshots.values()].reduce((sum, value) => sum + value.bytes, 0);
    const removedBytes = victims.reduce((sum, [, value]) => sum + value.bytes, 0);
    if (snapshots.size - victims.length >= 32 || currentBytes - removedBytes + snapshot.bytes > 32 * 1024 * 1024) {
      throw new GateReportError(503, "gate_report.capacity", "Report snapshot capacity is busy; retry after existing reports expire or use a narrower range");
    }
    for (const [id] of victims) snapshots.delete(id);
    snapshots.set(snapshotId, snapshot);
  }
  const page = snapshot.rows.slice(offset, offset + limit);
  return {
    snapshotId, generatedAt: snapshot.generatedAt, expiresAt: new Date(snapshot.expiresAt).toISOString(), filters: snapshot.filters,
    totals: snapshot.totals, offset, nextOffset: offset + page.length < snapshot.rows.length ? offset + page.length : null,
    rows: page.map(({ identityKey, ...row }) => ({ ...row, identityRecorded: identityKey !== null })),
    coverage: { visitorRoleClassification: "explicit_staff_entry_only", partnerAdminClassification: "explicit_staff_entry_only", vendorAdminClassification: "explicit_staff_entry_only", unclassifiedEntries: snapshot.totals.unclassifiedEntries, securityScreening: "not_recorded", identityBasis: "employee_id_or_guest_session_id" },
  };
}
