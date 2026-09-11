import { z } from "zod/v4";

export const WORK_HUB_EXPORT_DATASETS = ["channels", "notes", "tasks", "forms", "announcements", "shifts", "calendar", "gate_records", "meeting_recap", "meeting_transcript", "meeting_attendance", "meeting_recording"] as const;
export const WORK_HUB_EXPORT_FORMATS = ["csv", "pdf", "ics", "zip"] as const;
export const workHubExportDatasetSchema = z.enum(WORK_HUB_EXPORT_DATASETS);
export const workHubExportFormatSchema = z.enum(WORK_HUB_EXPORT_FORMATS);
const EXPORT_FORMATS_BY_DATASET: Record<(typeof WORK_HUB_EXPORT_DATASETS)[number], ReadonlyArray<(typeof WORK_HUB_EXPORT_FORMATS)[number]>> = {
  channels: ["csv", "pdf", "zip"], notes: ["csv", "pdf", "zip"], tasks: ["csv", "pdf", "zip"],
  forms: ["csv", "pdf", "zip"], announcements: ["csv", "pdf", "zip"], shifts: ["csv", "ics"], calendar: ["csv", "ics"],
  gate_records: ["csv"], meeting_recap: ["csv", "pdf"], meeting_transcript: ["csv", "pdf"], meeting_attendance: ["csv", "pdf"],
  meeting_recording: [],
};
export function isWorkHubExportFormatSupported(dataset: WorkHubExportDataset, format: WorkHubExportFormat): boolean {
  return EXPORT_FORMATS_BY_DATASET[dataset].includes(format);
}

const selectorListSchema = z.array(z.string().trim().min(1).max(160)).max(500)
  .refine((values) => new Set(values).size === values.length, "Selector ids must be unique");
const exportSelectorsSchema = z.strictObject({
  channelIds: selectorListSchema.optional(), noteIds: selectorListSchema.optional(), taskIds: selectorListSchema.optional(),
  formIds: selectorListSchema.optional(), announcementIds: selectorListSchema.optional(), shiftIds: selectorListSchema.optional(),
  meetingOccurrenceIds: selectorListSchema.optional(), siteLocationIds: selectorListSchema.optional(),
});
const EXPORT_SELECTOR_KEY_BY_DATASET: Record<(typeof WORK_HUB_EXPORT_DATASETS)[number], keyof z.infer<typeof exportSelectorsSchema>> = {
  channels: "channelIds", notes: "noteIds", tasks: "taskIds", forms: "formIds", announcements: "announcementIds",
  shifts: "shiftIds", calendar: "shiftIds", gate_records: "siteLocationIds", meeting_recap: "meetingOccurrenceIds",
  meeting_transcript: "meetingOccurrenceIds", meeting_attendance: "meetingOccurrenceIds", meeting_recording: "meetingOccurrenceIds",
};
const instantSchema = z.iso.datetime({ offset: true });
export const workHubExportScopeSchema = z.strictObject({ selectors: exportSelectorsSchema, from: instantSchema.optional(), to: instantSchema.optional() })
  .superRefine((scope, context) => {
    if (scope.from && scope.to && Date.parse(scope.from) > Date.parse(scope.to)) context.addIssue({ code: "custom", message: "Export date range is reversed", path: ["to"] });
    if (utf8ByteLength(JSON.stringify(scope)) > 8_192) context.addIssue({ code: "custom", message: "Export scope is too large" });
  });
export const exportRequestSchema = z.strictObject({ dataset: workHubExportDatasetSchema, format: workHubExportFormatSchema, scope: workHubExportScopeSchema })
  .superRefine((request, context) => {
    if (!isWorkHubExportFormatSupported(request.dataset, request.format)) {
      context.addIssue({ code: "custom", message: `${request.format} is not supported for ${request.dataset}`, path: ["format"] });
    }
    const allowedSelector = EXPORT_SELECTOR_KEY_BY_DATASET[request.dataset];
    for (const [key, values] of Object.entries(request.scope.selectors)) {
      if (key !== allowedSelector && values !== undefined && values.length > 0) {
        context.addIssue({ code: "custom", message: `${key} is not valid for ${request.dataset}`, path: ["scope", "selectors", key] });
      }
    }
  });
export type WorkHubExportDataset = z.infer<typeof workHubExportDatasetSchema>;
export type WorkHubExportFormat = z.infer<typeof workHubExportFormatSchema>;
export type WorkHubExportScope = z.infer<typeof workHubExportScopeSchema>;
export const WORK_HUB_EXPORT_ERROR_CODES = ["configuration_unavailable", "invalid_scope", "scope_too_large", "access_changed", "storage_write_failed", "checksum_mismatch", "publication_failed", "lease_expired", "internal_failure"] as const;
export const WORK_HUB_EXPORT_AUDIT_ACTIONS = {
  requested: "export.requested",
  generated: "export.generated",
  failed: "export.failed",
  downloaded: "export.downloaded",
} as const;

export const workHubExportCreateSchema = z.strictObject({
  operationId: z.uuid(),
  owner: z.strictObject({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() }),
  export: exportRequestSchema,
  expiresAt: instantSchema,
});

export const workHubExportStatusSchema = z.strictObject({
  id: z.uuid(),
  dataset: workHubExportDatasetSchema,
  format: workHubExportFormatSchema,
  status: z.enum(["pending", "running", "completed", "failed", "expired"]),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  rowCount: z.number().int().nonnegative().safe().nullable(),
  byteCount: z.number().int().nonnegative().safe().nullable(),
  expiresAt: instantSchema,
  fileName: z.string().trim().min(1).max(255).nullable(),
  errorCode: z.enum(WORK_HUB_EXPORT_ERROR_CODES).nullable(),
});
export type WorkHubExportCreate = z.infer<typeof workHubExportCreateSchema>;
export type WorkHubExportStatus = z.infer<typeof workHubExportStatusSchema>;

export const RETENTION_CLASSES = ["messages", "deleted_messages", "files_voice_notes", "notes_versions", "form_submissions", "meeting_recordings", "transcripts", "attendance", "external_calendar_cache", "audit_logs"] as const;
const retentionDaysSchema = z.number().int().min(1).max(365_000);
export const retentionRulesSchema = z.strictObject(Object.fromEntries(RETENTION_CLASSES.map((key) => [key, retentionDaysSchema])) as Record<(typeof RETENTION_CLASSES)[number], typeof retentionDaysSchema>);
export type WorkHubRetentionRules = z.infer<typeof retentionRulesSchema>;
export function validateOrganizationRetentionRules(organizationRules: unknown, activeMinimumRules: unknown): WorkHubRetentionRules {
  if (activeMinimumRules === undefined || activeMinimumRules === null) throw new Error("An active platform retention minimum is required");
  const minimums = retentionRulesSchema.parse(activeMinimumRules);
  const organization = retentionRulesSchema.parse(organizationRules);
  for (const key of RETENTION_CLASSES) if (organization[key] < minimums[key]) throw new Error(`${key} retention is below the platform minimum`);
  return organization;
}

const retentionPlanClassAggregateSchema = z.strictObject({
  eligibleCount: z.number().int().nonnegative().safe(), eligibleBytes: z.number().int().nonnegative().safe(),
  heldCount: z.number().int().nonnegative().safe(), heldBytes: z.number().int().nonnegative().safe(),
  referenceBlockedCount: z.number().int().nonnegative().safe(), referenceBlockedBytes: z.number().int().nonnegative().safe(),
});
export const retentionPlanClassAggregatesSchema = z.strictObject(Object.fromEntries(
  RETENTION_CLASSES.map((key) => [key, retentionPlanClassAggregateSchema]),
) as Record<(typeof RETENTION_CLASSES)[number], typeof retentionPlanClassAggregateSchema>);
export const RETENTION_PLAN_ERROR_CODES = ["policy_unavailable", "minimum_policy_unavailable", "policy_changed", "minimum_policy_changed", "reference_unresolved", "owner_context_mismatch", "lease_expired", "limit_exceeded", "internal_failure"] as const;
export const retentionPlanErrorCodesSchema = z.array(z.enum(RETENTION_PLAN_ERROR_CODES)).max(16)
  .refine((values) => new Set(values).size === values.length, "Retention plan error codes must be unique");
export type WorkHubRetentionPlanClassAggregates = z.infer<typeof retentionPlanClassAggregatesSchema>;
export type WorkHubRetentionPlanErrorCode = (typeof RETENTION_PLAN_ERROR_CODES)[number];

export const WORK_HUB_OPERATIONAL_METRICS = ["export.duration_ms", "export.row_count", "export.byte_count", "export.completed", "export.failed", "export.expired", "export.retry_count", "retention_plan.duration_ms", "retention_plan.held_count", "retention_plan.reference_blocked_count", "authorization.denied", "owner_context.mismatch"] as const;
export const WORK_HUB_OPERATIONAL_ERROR_CODES = [...new Set([...WORK_HUB_EXPORT_ERROR_CODES, ...RETENTION_PLAN_ERROR_CODES, "access_denied"])] as const;
export const operationalMetricDimensionsSchema = z.strictObject({ dataset: workHubExportDatasetSchema.optional(), format: workHubExportFormatSchema.optional(), phase: z.enum(["request", "generate", "download", "plan"]).optional(), source: z.enum(["web", "ios", "worker"]).optional(), status: z.enum(["pending", "running", "completed", "failed", "expired"]).optional(), errorCode: z.enum(WORK_HUB_OPERATIONAL_ERROR_CODES).optional() });
const operationalMetricSchema = z.strictObject({
  metric: z.enum(WORK_HUB_OPERATIONAL_METRICS),
  dimensions: operationalMetricDimensionsSchema,
  count: z.number().int().nonnegative().safe(), sum: z.number().finite().nonnegative(), max: z.number().finite().nonnegative(),
});
export type WorkHubOperationalMetric = z.infer<typeof operationalMetricSchema>;
export function createOperationalMetric(input: unknown): WorkHubOperationalMetric { return operationalMetricSchema.parse(input); }

const operationalMetricOwnerSchema = z.strictObject({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive().max(2_147_483_647) });
const operationalMetricEventSchema = z.strictObject({
  owner: operationalMetricOwnerSchema,
  metric: z.enum(WORK_HUB_OPERATIONAL_METRICS),
  dimensions: operationalMetricDimensionsSchema,
  value: z.number().finite().nonnegative().safe(),
  observedAt: instantSchema,
});
export type WorkHubOperationalMetricEvent = z.infer<typeof operationalMetricEventSchema>;
export function createOperationalMetricEvent(input: unknown): WorkHubOperationalMetricEvent { return operationalMetricEventSchema.parse(input); }

export const operationalMetricReadQuerySchema = z.strictObject({ from: instantSchema, to: instantSchema }).superRefine((query, context) => {
  const from = Date.parse(query.from), to = Date.parse(query.to);
  const isUtcHourAligned = (value: number) => {
    const date = new Date(value);
    return date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  };
  if (!isUtcHourAligned(from)) context.addIssue({ code: "custom", message: "Metric range start must be UTC-hour aligned", path: ["from"] });
  if (!isUtcHourAligned(to)) context.addIssue({ code: "custom", message: "Metric range end must be UTC-hour aligned", path: ["to"] });
  if (to <= from) context.addIssue({ code: "custom", message: "Metric range end must be after start", path: ["to"] });
  if (to - from > 31 * 24 * 60 * 60_000) context.addIssue({ code: "custom", message: "Metric range cannot exceed 31 days", path: ["to"] });
});
const operationalMetricBucketSchema = z.strictObject({
  metric: z.enum(WORK_HUB_OPERATIONAL_METRICS), intervalStart: instantSchema,
  dimensions: operationalMetricDimensionsSchema,
  count: z.number().int().nonnegative().safe(), sum: z.number().finite().nonnegative(), max: z.number().finite().nonnegative(),
});
export const operationalMetricReadoutSchema = z.strictObject({ from: instantSchema, to: instantSchema, buckets: z.array(operationalMetricBucketSchema).max(10_000) });
export type WorkHubOperationalMetricReadQuery = z.infer<typeof operationalMetricReadQuerySchema>;
export type WorkHubOperationalMetricReadout = z.infer<typeof operationalMetricReadoutSchema>;

function protectCsvCell(value: string): string { return /^\s*[=+\-@]/.test(value) ? `'${value}` : value; }
export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>): string {
  return rows.map((row) => row.map((raw) => {
    const value = protectCsvCell(raw === null ? "" : String(raw));
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(",")).join("\r\n") + "\r\n";
}

const icsEventSchema = z.strictObject({ uid: z.string().trim().min(1).max(255), start: instantSchema, end: instantSchema, summary: z.string().max(2_000), description: z.string().max(20_000).optional() })
  .superRefine((event, context) => {
    if (Date.parse(event.end) <= Date.parse(event.start)) context.addIssue({ code: "custom", message: "ICS event end must be after start", path: ["end"] });
  });
const icsCalendarSchema = z.strictObject({ productId: z.string().trim().min(1).max(255), events: z.array(icsEventSchema).max(10_000) });
function escapeIcsText(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\\n").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;"); }
function formatIcsInstant(value: string): string { return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
function foldIcsLine(line: string): string[] {
  const output: string[] = []; let current = "";
  for (const character of line) {
    if (utf8ByteLength(current + character) > 75) { output.push(current); current = ` ${character}`; }
    else current += character;
  }
  output.push(current); return output;
}
export function serializeIcsCalendar(input: unknown): string {
  const calendar = icsCalendarSchema.parse(input);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${escapeIcsText(calendar.productId)}`, "CALSCALE:GREGORIAN", ...calendar.events.flatMap((event) => ["BEGIN:VEVENT", `UID:${escapeIcsText(event.uid)}`, `DTSTART:${formatIcsInstant(event.start)}`, `DTEND:${formatIcsInstant(event.end)}`, `SUMMARY:${escapeIcsText(event.summary)}`, ...(event.description === undefined ? [] : [`DESCRIPTION:${escapeIcsText(event.description)}`]), "END:VEVENT"]), "END:VCALENDAR"];
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

const exportManifestSchema = z.strictObject({ version: z.literal(1), jobId: z.uuid(), dataset: workHubExportDatasetSchema, format: workHubExportFormatSchema, requester: z.strictObject({ id: z.string().trim().min(1).max(160), display: z.string().trim().min(1).max(200) }), generatedAt: instantSchema, snapshotAt: instantSchema, rowCount: z.number().int().nonnegative().safe(), byteCount: z.number().int().nonnegative().safe(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .superRefine((manifest, context) => {
    if (!isWorkHubExportFormatSupported(manifest.dataset, manifest.format)) {
      context.addIssue({ code: "custom", message: `${manifest.format} is not supported for ${manifest.dataset}`, path: ["format"] });
    }
  });
export type WorkHubExportManifest = z.infer<typeof exportManifestSchema>;
export function serializeExportManifest(input: unknown): string { return `${JSON.stringify(exportManifestSchema.parse(input))}\n`; }
