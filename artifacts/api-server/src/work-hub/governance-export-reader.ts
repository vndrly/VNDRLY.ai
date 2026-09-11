import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { sql, type SQL } from "drizzle-orm";
import {
  exportRequestSchema,
  serializeCsv,
  serializeExportManifest,
  serializeIcsCalendar,
  type WorkHubExportDataset,
  type WorkHubExportManifest,
} from "@workspace/api-zod";
import { requireWorkHubCapability, WorkHubAccessError, type WorkHubAccess } from "./context-access";

export type WorkHubExportOwner = { type: "vendor" | "partner"; id: number };
export type WorkHubExportField = string | number | boolean | null | Date | WorkHubExportField[] | { [key: string]: WorkHubExportField };
export type WorkHubExportRow = {
  cursorAt: string;
  cursorId: string;
  fields: Record<string, WorkHubExportField>;
};

type ExportRequest = ReturnType<typeof exportRequestSchema.parse>;
type Cursor = { at: string; id: string };
type PageQueryInput = {
  request: ExportRequest;
  owner: WorkHubExportOwner;
  snapshotAt: Date;
  after: Cursor | null;
  limit: number;
};

export class ExportSafetyLimitError extends Error {
  readonly code = "export.scope_too_large";
  constructor(readonly maximumRows: number) {
    super(`Export exceeds the operational safety maximum of ${maximumRows} rows; narrow the export scope. No partial artifact was created.`);
  }
}

export class ExportFieldLimitError extends Error {
  readonly code = "export.field_limit";
  constructor(message = "An export field exceeds the safe serialization boundary") { super(message); }
}

function selectorClause(column: SQL, ids: string[] | undefined): SQL {
  return ids?.length ? sql`${column}::text = ANY(${sql.param(ids)}::text[])` : sql`true`;
}

function directSource(dataset: WorkHubExportDataset, owner: WorkHubExportOwner): { source: SQL; selector: SQL } {
  const ownerClause = (alias: SQL) => sql`${alias}.owner_org_type = ${owner.type} AND ${alias}.owner_org_id = ${owner.id}`;
  switch (dataset) {
    case "channels":
      return {
        source: sql`SELECT c.created_at, ('channel:' || c.id)::text AS id, c.created_at AS event_at, c.id AS selector_id,
          jsonb_build_object('recordType', 'channel', 'channelId', c.id, 'name', c.name, 'visibility', c.visibility, 'status', c.status, 'createdById', c.created_by_id, 'createdAt', c.created_at) AS fields
          FROM work_hub_channels c WHERE ${ownerClause(sql.raw("c"))}
          UNION ALL
          SELECT m.created_at, ('message:' || m.id)::text, m.created_at, c.id,
          jsonb_build_object('recordType', 'message', 'channelId', c.id, 'messageId', m.id, 'authorUserId', m.author_user_id, 'kind', m.kind, 'body', m.body, 'version', m.version, 'editedAt', m.edited_at, 'deletedAt', m.deleted_at, 'createdAt', m.created_at)
          FROM work_hub_messages m JOIN work_hub_channels c ON c.id = m.channel_id WHERE ${ownerClause(sql.raw("c"))}`,
        selector: sql.raw("selector_id"),
      };
    case "notes":
      return {
        source: sql`SELECT n.created_at, n.id::text AS id, n.updated_at AS event_at, n.id AS selector_id,
          jsonb_build_object('noteId', n.id, 'channelId', n.channel_id, 'title', n.title, 'body', n.body, 'version', n.version, 'createdById', n.created_by_id, 'updatedById', n.updated_by_id, 'deletedAt', n.deleted_at, 'createdAt', n.created_at, 'updatedAt', n.updated_at) AS fields
          FROM work_hub_notes n JOIN work_hub_channels c ON c.id = n.channel_id WHERE ${ownerClause(sql.raw("c"))}`,
        selector: sql.raw("selector_id"),
      };
    case "tasks":
      return {
        source: sql`SELECT t.created_at, t.id::text AS id, t.updated_at AS event_at, t.id AS selector_id,
          jsonb_build_object('taskId', t.id, 'channelId', t.channel_id, 'title', t.title, 'description', t.description, 'status', t.status, 'priority', t.priority, 'assigneeUserId', t.assignee_user_id, 'createdById', t.created_by_id, 'dueAt', t.due_at, 'createdAt', t.created_at, 'updatedAt', t.updated_at) AS fields
          FROM work_hub_tasks t WHERE ${ownerClause(sql.raw("t"))}`,
        selector: sql.raw("selector_id"),
      };
    case "forms":
      return {
        source: sql`SELECT s.submitted_at AS created_at, s.id::text AS id, s.submitted_at AS event_at, f.id AS selector_id,
          jsonb_build_object('formId', f.id, 'formName', f.name, 'instanceId', i.id, 'submissionId', s.id, 'version', s.version, 'submittedById', s.submitted_by_id, 'values', s.values, 'submittedAt', s.submitted_at) AS fields
          FROM work_hub_form_submissions s JOIN work_hub_form_instances i ON i.id = s.instance_id JOIN work_hub_form_templates f ON f.id = i.template_id WHERE ${ownerClause(sql.raw("f"))}`,
        selector: sql.raw("selector_id"),
      };
    case "announcements":
      return {
        source: sql`SELECT a.published_at AS created_at, a.id::text AS id, a.published_at AS event_at, a.id AS selector_id,
          jsonb_build_object('announcementId', a.id, 'channelId', a.channel_id, 'title', a.title, 'body', a.body, 'urgency', a.urgency, 'acknowledgementRequired', a.acknowledgement_required, 'version', a.version, 'publishedById', a.published_by_id, 'publishedAt', a.published_at, 'expiresAt', a.expires_at, 'withdrawnAt', a.withdrawn_at) AS fields
          FROM work_hub_announcements a WHERE ${ownerClause(sql.raw("a"))}`,
        selector: sql.raw("selector_id"),
      };
    case "shifts":
    case "calendar":
      return {
        source: sql`SELECT s.created_at, s.id::text AS id, s.starts_at AS event_at, s.id AS selector_id,
          jsonb_build_object('shiftId', s.id, 'channelId', s.channel_id, 'title', s.title, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'timezone', s.timezone, 'open', s.open, 'calendarType', s.calendar_type, 'projectName', s.project_name, 'milestoneStatus', s.milestone_status, 'percentComplete', s.percent_complete, 'createdById', s.created_by_id, 'createdAt', s.created_at, 'updatedAt', s.updated_at) AS fields
          FROM work_hub_shifts s WHERE ${ownerClause(sql.raw("s"))}`,
        selector: sql.raw("selector_id"),
      };
    case "gate_records": {
      const visitOwner = owner.type === "partner"
        ? sql`s.partner_id = ${owner.id}`
        : sql`v.host_type = 'vendor' AND v.host_vendor_id = ${owner.id}`;
      const checkinOwner = owner.type === "partner"
        ? sql`s.partner_id = ${owner.id}`
        : sql`t.vendor_id = ${owner.id} AND p.vendor_id = ${owner.id}`;
      return {
        source: sql`SELECT v.created_at, ('visit:' || v.id)::text AS id, v.check_in_time AS event_at, s.id::text AS selector_id,
          jsonb_build_object('recordId', 'visit:' || v.id, 'recordType', 'visitor', 'name', trim(v.first_name || ' ' || v.last_name), 'company', v.company, 'purpose', v.purpose, 'siteLocationId', s.id, 'siteName', s.name, 'partnerId', s.partner_id, 'checkInTime', v.check_in_time, 'checkOutTime', v.check_out_time, 'admissionStatus', v.admission_status) AS fields
          FROM site_visits v JOIN site_locations s ON s.id = v.site_location_id WHERE ${visitOwner}
          UNION ALL
          SELECT c.created_at, ('checkin:' || c.id)::text, c.check_in_at, s.id::text,
          jsonb_build_object('recordId', 'checkin:' || c.id, 'recordType', 'employee_checkin', 'name', trim(p.first_name || ' ' || p.last_name), 'company', vendor.name, 'siteLocationId', s.id, 'siteName', s.name, 'partnerId', s.partner_id, 'checkInTime', c.check_in_at, 'checkOutTime', c.check_out_at)
          FROM ticket_check_ins c JOIN tickets t ON t.id = c.ticket_id JOIN vendor_people p ON p.id = c.employee_id AND p.vendor_id = t.vendor_id JOIN vendors vendor ON vendor.id = t.vendor_id JOIN site_locations s ON s.id = t.site_location_id WHERE ${checkinOwner}`,
        selector: sql.raw("selector_id"),
      };
    }
    case "meeting_recap":
      return {
        source: sql`SELECT o.created_at, ('occurrence:' || o.id)::text AS id, o.starts_at AS event_at, o.id AS selector_id,
          jsonb_build_object('recordType', 'meeting', 'occurrenceId', o.id, 'title', m.title, 'agenda', m.agenda, 'startsAt', o.starts_at, 'endsAt', o.ends_at, 'status', o.status) AS fields
          FROM work_hub_meeting_occurrences o JOIN work_hub_meetings m ON m.id = o.meeting_id WHERE ${ownerClause(sql.raw("m"))}
          UNION ALL
          SELECT c.created_at, ('chat:' || c.id)::text, c.created_at, c.occurrence_id,
          jsonb_build_object('recordType', 'shared_message', 'occurrenceId', c.occurrence_id, 'messageId', c.id, 'userId', c.user_id, 'body', c.body, 'messageType', c.message_type, 'attachment', c.attachment, 'createdAt', c.created_at)
          FROM work_hub_meeting_chat c JOIN work_hub_meeting_occurrences o ON o.id = c.occurrence_id JOIN work_hub_meetings m ON m.id = o.meeting_id
          WHERE ${ownerClause(sql.raw("m"))} AND c.recipient_user_id IS NULL`,
        selector: sql.raw("selector_id"),
      };
    case "meeting_transcript":
      return {
        source: sql`SELECT a.created_at, ('segment:' || s.id)::text AS id, o.starts_at AS event_at, o.id AS selector_id,
          jsonb_build_object('recordType', 'transcript', 'occurrenceId', o.id, 'segmentId', s.id, 'speakerUserId', s.speaker_user_id, 'startsAtMs', s.starts_at_ms, 'endsAtMs', s.ends_at_ms, 'text', s.text, 'confidence', s.confidence) AS fields
          FROM work_hub_transcript_segments s JOIN work_hub_meeting_artifacts a ON a.id = s.artifact_id JOIN work_hub_meeting_occurrences o ON o.id = a.occurrence_id JOIN work_hub_meetings m ON m.id = o.meeting_id WHERE ${ownerClause(sql.raw("m"))}
          UNION ALL
          SELECT c.created_at, ('chat:' || c.id)::text, c.created_at, c.occurrence_id,
          jsonb_build_object('recordType', 'shared_message', 'occurrenceId', c.occurrence_id, 'messageId', c.id, 'userId', c.user_id, 'body', c.body, 'messageType', c.message_type, 'attachment', c.attachment, 'createdAt', c.created_at)
          FROM work_hub_meeting_chat c JOIN work_hub_meeting_occurrences o ON o.id = c.occurrence_id JOIN work_hub_meetings m ON m.id = o.meeting_id
          WHERE ${ownerClause(sql.raw("m"))} AND c.recipient_user_id IS NULL`,
        selector: sql.raw("selector_id"),
      };
    case "meeting_attendance":
      return {
        source: sql`SELECT a.joined_at AS created_at, a.id::text AS id, o.starts_at AS event_at, o.id AS selector_id,
          jsonb_build_object('occurrenceId', o.id, 'attendanceId', a.id, 'userId', a.user_id, 'joinedAt', a.joined_at, 'leftAt', a.left_at) AS fields
          FROM work_hub_meeting_attendance a JOIN work_hub_meeting_occurrences o ON o.id = a.occurrence_id JOIN work_hub_meetings m ON m.id = o.meeting_id WHERE ${ownerClause(sql.raw("m"))}`,
        selector: sql.raw("selector_id"),
      };
    case "meeting_recording":
      throw new Error("Meeting recordings are separate authorized downloads and are not supported by the general export reader");
  }
}

function selectorIds(request: ExportRequest): string[] | undefined {
  const selectors = request.scope.selectors;
  const expected = request.dataset === "channels" ? "channelIds"
    : request.dataset === "notes" ? "noteIds"
    : request.dataset === "tasks" ? "taskIds"
    : request.dataset === "forms" ? "formIds"
    : request.dataset === "announcements" ? "announcementIds"
    : request.dataset === "shifts" || request.dataset === "calendar" ? "shiftIds"
    : request.dataset === "gate_records" ? "siteLocationIds"
    : "meetingOccurrenceIds";
  for (const [key, values] of Object.entries(selectors)) {
    if (key !== expected && values !== undefined && values.length > 0) throw new Error(`${key} selector is not valid for ${request.dataset}`);
  }
  switch (request.dataset) {
    case "channels": return selectors.channelIds;
    case "notes": return selectors.noteIds;
    case "tasks": return selectors.taskIds;
    case "forms": return selectors.formIds;
    case "announcements": return selectors.announcementIds;
    case "shifts": case "calendar": return selectors.shiftIds;
    case "gate_records": return selectors.siteLocationIds;
    case "meeting_recap": case "meeting_transcript": case "meeting_attendance": return selectors.meetingOccurrenceIds;
    case "meeting_recording": return undefined;
  }
}

export function buildWorkHubExportPageQuery(input: PageQueryInput): SQL {
  const request = exportRequestSchema.parse(input.request);
  if (!Number.isSafeInteger(input.owner.id) || input.owner.id <= 0) throw new Error("A valid export owner is required");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_001) throw new Error("Invalid export page limit");
  const { source, selector } = directSource(request.dataset, input.owner);
  const from = request.scope.from ? new Date(request.scope.from) : null;
  const to = request.scope.to ? new Date(request.scope.to) : null;
  const after = input.after;
  return sql`WITH export_source AS (${source})
    SELECT created_at AS "cursorAt", id AS "cursorId", fields
    FROM export_source
    WHERE created_at <= ${input.snapshotAt}
      AND ${from ? sql`event_at >= ${from}` : sql`true`}
      AND ${to ? sql`event_at <= ${to}` : sql`true`}
      AND ${selectorClause(selector, selectorIds(request))}
      AND ${after ? sql`(created_at, id) > (${new Date(after.at)}, ${after.id})` : sql`true`}
    ORDER BY created_at, id
    LIMIT ${input.limit}`;
}

function parseRow(value: unknown): WorkHubExportRow {
  if (!value || typeof value !== "object") throw new Error("Export reader returned an invalid row");
  const raw = value as Record<string, unknown>;
  const at = raw.cursorAt instanceof Date ? raw.cursorAt.toISOString() : typeof raw.cursorAt === "string" ? new Date(raw.cursorAt).toISOString() : "";
  if (!at || typeof raw.cursorId !== "string" || !raw.fields || typeof raw.fields !== "object" || Array.isArray(raw.fields)) throw new Error("Export reader returned an invalid row");
  return { cursorAt: at, cursorId: raw.cursorId, fields: raw.fields as Record<string, WorkHubExportField> };
}

export async function readCompleteWorkHubExport(input: {
  execute: (query: SQL, request: { after: Cursor | null; limit: number }) => Promise<unknown[]>;
  request: ExportRequest;
  owner: WorkHubExportOwner;
  access: WorkHubAccess;
  snapshotAt: Date;
  pageSize?: number;
  maximumRows?: number;
}): Promise<WorkHubExportRow[]> {
  const request = exportRequestSchema.parse(input.request);
  if (input.access.owner.type !== input.owner.type || input.access.owner.id !== input.owner.id) throw new WorkHubAccessError("not_found");
  requireWorkHubCapability(input.access, "policy.manage");
  const pageSize = input.pageSize ?? 500;
  const maximumRows = input.maximumRows ?? 25_000;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) throw new Error("Invalid export page size");
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 1) throw new Error("Invalid export safety maximum");
  const rows: WorkHubExportRow[] = [];
  let after: Cursor | null = null;
  while (true) {
    const limit = Math.min(pageSize, maximumRows - rows.length + 1);
    const rawPage: unknown[] = await input.execute(buildWorkHubExportPageQuery({ request, owner: input.owner, snapshotAt: input.snapshotAt, after, limit }), { after, limit });
    const page: WorkHubExportRow[] = rawPage.map(parseRow);
    if (page.length === 0) return rows;
    for (const item of page) {
      if (after && (item.cursorAt < after.at || (item.cursorAt === after.at && item.cursorId <= after.id))) throw new Error("Export reader returned an unstable keyset page");
      rows.push(item);
      after = { at: item.cursorAt, id: item.cursorId };
      if (rows.length > maximumRows) throw new ExportSafetyLimitError(maximumRows);
    }
    if (page.length < limit) return rows;
  }
}

function normalizeExportField(value: WorkHubExportField, depth: number): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && !Number.isFinite(value)) throw new ExportFieldLimitError("Export fields must contain finite numbers");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 32) throw new ExportFieldLimitError("Export field nesting is too deep");
  if (Array.isArray(value)) return value.map((item) => normalizeExportField(item, depth + 1));
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeExportField(value[key]!, depth + 1)]));
}

function stableValue(value: WorkHubExportField | undefined): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  const encoded = JSON.stringify(normalizeExportField(value, 0));
  if (Buffer.byteLength(encoded) > 1_000_000) throw new ExportFieldLimitError("An export field exceeds the serialization limit");
  return encoded;
}

function artifactTable(input: { requester: { display: string }; generatedAt: string; rows: WorkHubExportRow[] }) {
  const columns = [...new Set(input.rows.flatMap((row) => Object.keys(row.fields)))].sort();
  return [
    ["VNDRLY Work Hub export"],
    ["Requested by", input.requester.display],
    ["Generated at", input.generatedAt],
    [],
    columns,
    ...input.rows.map((row) => columns.map((column) => stableValue(row.fields[column]))),
  ];
}

async function renderPdf(lines: string[][], generatedAt: string): Promise<Buffer> {
  const document = new PDFDocument({ autoFirstPage: false, compress: false, info: { Title: "VNDRLY Work Hub export", CreationDate: new Date(generatedAt), ModDate: new Date(generatedAt) } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => { document.once("end", () => resolve(Buffer.concat(chunks))); document.once("error", reject); });
  document.addPage({ size: "LETTER", margins: { top: 42, bottom: 42, left: 42, right: 42 } });
  for (const line of lines) {
    if (document.y > 730) document.addPage({ size: "LETTER", margins: { top: 42, bottom: 42, left: 42, right: 42 } });
    document.font("Helvetica").fontSize(8).text(line.map(normalizePdfText).join(" | "), { width: 528 });
  }
  document.end();
  return complete;
}

function safeName(dataset: WorkHubExportDataset, format: string): string { return `vndrly-work-hub-${dataset.replaceAll("_", "-")}.${format}`; }
function normalizePdfText(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/ +/g, " ").trim(); }
function escapeIcsProperty(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\\n").replaceAll("\r", "\\n").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

export async function buildWorkHubExportArtifact(input: {
  jobId: string;
  request: ExportRequest;
  requester: { id: string; display: string };
  generatedAt: string;
  snapshotAt: string;
  rows: WorkHubExportRow[];
}): Promise<{ bytes: Buffer; contentType: string; fileName: string; sha256: string; manifest: WorkHubExportManifest }> {
  const request = exportRequestSchema.parse(input.request);
  const table = artifactTable(input);
  let bytes: Buffer;
  let contentType: string;
  if (request.format === "csv") {
    bytes = Buffer.from(serializeCsv(table), "utf8");
    contentType = "text/csv; charset=utf-8";
  } else if (request.format === "pdf") {
    bytes = await renderPdf(table.map((line) => line.map(String)), input.generatedAt);
    contentType = "application/pdf";
  } else if (request.format === "ics") {
    const events = input.rows.map((row) => ({
      uid: row.cursorId,
      start: String(row.fields.startsAt ?? ""),
      end: String(row.fields.endsAt ?? ""),
      summary: String(row.fields.title ?? ""),
      description: row.fields.description == null ? undefined : String(row.fields.description),
    }));
    const ics = serializeIcsCalendar({ productId: "-//VNDRLY//Work Hub Export//EN", events });
    const generated = new Date(input.generatedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    bytes = Buffer.from(ics.replace("CALSCALE:GREGORIAN\r\n", `CALSCALE:GREGORIAN\r\nX-VNDRLY-REQUESTER:${escapeIcsProperty(input.requester.display)}\r\nX-VNDRLY-GENERATED-AT:${generated}\r\n`), "utf8");
    contentType = "text/calendar; charset=utf-8";
  } else {
    const csv = Buffer.from(serializeCsv(table), "utf8");
    const payloadSha = createHash("sha256").update(csv).digest("hex");
    const csvFileName = safeName(request.dataset, "csv");
    const payloadManifest = JSON.parse(serializeExportManifest({ version: 1, jobId: input.jobId, dataset: request.dataset, format: "csv", requester: input.requester, generatedAt: input.generatedAt, snapshotAt: input.snapshotAt, rowCount: input.rows.length, byteCount: csv.length, sha256: payloadSha }));
    const embeddedManifest = `${JSON.stringify({
      version: 1,
      container: { dataset: request.dataset, format: "zip", requester: input.requester, generatedAt: input.generatedAt, snapshotAt: input.snapshotAt, rowCount: input.rows.length },
      payload: payloadManifest,
      entries: [{ fileName: csvFileName, byteCount: csv.length, sha256: payloadSha, contentType: "text/csv; charset=utf-8" }],
    })}\n`;
    const zip = new JSZip();
    const date = new Date(input.generatedAt);
    zip.file(csvFileName, csv, { date });
    zip.file("manifest.json", embeddedManifest, { date });
    bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
    contentType = "application/zip";
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.parse(serializeExportManifest({ version: 1, jobId: input.jobId, dataset: request.dataset, format: request.format, requester: input.requester, generatedAt: input.generatedAt, snapshotAt: input.snapshotAt, rowCount: input.rows.length, byteCount: bytes.length, sha256 })) as WorkHubExportManifest;
  return { bytes, contentType, fileName: safeName(request.dataset, request.format), sha256, manifest };
}
