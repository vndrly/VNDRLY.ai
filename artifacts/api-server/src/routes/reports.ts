// Phase 4 Reports endpoints. All RBAC-gated; downloads (csv/pdf/iif/zip)
// record one row in report_export_audit_log. JSON previews are NOT audited.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  and,
  eq,
  gt,
  gte,
  lt,
  lte,
  or,
  inArray,
  desc,
  isNull,
  isNotNull,
  sql,
} from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  partnersTable,
  vendorsTable,
  reportExportAuditLogTable,
  qbAccountMappingTable,
  qbAccountMappingAuditLogTable,
  usersTable,
  userOrgMembershipsTable,
  tax1099FilingsTable,
  TAX_1099_FORM_TYPES,
  TAX_1099_FILING_STATUSES,
  TAX_1099_FILING_METHODS,
  TAX_1099_CORRECTION_STATUSES,
  type ReportExportFormat,
  type FirePayeeSnapshot,
  tax1099CorrectionAuditLogTable,
  dashboard1099EmailSettingsTable,
  dashboard1099EmailLogTable,
  dashboard1099DeliveryJobsTable,
  type Dashboard1099DeliveryJob,
  type Dashboard1099DeliveryJobError,
} from "@workspace/db";
import {
  sendAccountingPushDigestEmail,
  sendAccountingReconciliationDigestEmail,
  type EmailLocale,
} from "../lib/sendgrid";
import {
  isReconciliationWarning,
  GetExportsAuditLogResponse,
} from "@workspace/api-zod";
import { sendResponse } from "../lib/typed-response";
import { getSessionFromRequest as getSession, requireAdmin } from "../lib/session";
import { logger } from "../lib/logger";
import { getAppOrigin } from "../lib/appOrigin";
import { resolvePeriod, periodQuerySchema, formatPeriod, type Period } from "../lib/reports/period";
import { agingForVendor, agingForPartner } from "../lib/reports/aging";
import {
  revenueByPartner,
  revenueByWorkType,
  revenueByAfe,
  spendByVendor,
} from "../lib/reports/revenue";
import { salesTaxByState } from "../lib/reports/sales-tax";
import { crewHoursBilledVsCost } from "../lib/reports/crew-cost";
import {
  nec1099Rows,
  NEC_THRESHOLD_USD,
  type Nec1099Row,
} from "../lib/reports/nec1099";
import {
  misc1099Rows,
  MISC_BOX_THRESHOLDS,
  type Misc1099Row,
} from "../lib/reports/misc1099";
import {
  k1099Rows,
  thresholdForYear as kThresholdForYear,
  type K1099Row,
} from "../lib/reports/k1099";
import {
  renderFireFile,
  necRowsToPayees,
  miscRowsToPayees,
  kRowsToPayees,
  bucketFirePayeesByCorrection,
  type FireFormType,
  type FireTransmitterInfo,
  type FireBPayee,
  type FirePayerBlock,
  type FireCorrectionIndicator,
  parseAddress,
} from "../lib/reports/fire";
import {
  build1099Dashboard,
  type Dashboard1099Row,
} from "../lib/reports/dashboard1099";
import {
  dashboard1099MonthlyKCsv,
  dashboard1099MonthlyKPdf,
} from "../lib/reports/dashboard1099-export";
import {
  readFireTransmitterRow,
  effectiveFromRow,
  validateEffective,
  effectiveToFireTransmitter,
  TRANSMITTER_FIELDS,
  type EffectiveTransmitter,
  type TransmitterField,
} from "../lib/reports/transmitter-settings";
import {
  categoryAuditRows,
  type CategoryAuditMismatch,
} from "../lib/reports/categoryAudit";
import { renderCategoryAuditPdf } from "../lib/reports/categoryAuditPdf";
import { toCsv, csvFilename } from "../lib/reports/csv";
import {
  renderReportPdf,
  renderNec1099Pdf,
  renderMisc1099Pdf,
  renderK1099Pdf,
} from "../lib/reports/pdf";
import {
  renderIif,
  type IifInvoice,
  type IifInvoiceLine,
  type IifPartner,
  type IifVendor,
} from "../lib/reports/iif";
import {
  customersCsv,
  vendorsCsv,
  invoicesCsv,
  readmeQbo,
} from "../lib/reports/qbo-csv";
import {
  buildResolver,
  loadAccountMapOverrides,
  defaultAccountForKey,
  expandBulkScopes,
  parseQbMappingCsv,
  classifyCsvImport,
  MAPPABLE_LINE_TYPES,
  fetchQbMappingFormItems,
} from "../lib/reports/qb-mapping";
import {
  oaCustomersCsv,
  oaVendorsCsv,
  oaInvoicesCsv,
  readmeOa,
} from "../lib/reports/oa-csv";
import { buildZip } from "../lib/reports/zip";
import {
  lineDetailRows,
  lineDetailToCsv,
  accountingExportSummary,
} from "../lib/reports/line-detail";
import { recordExport } from "../lib/reports/audit";
import {
  getConnection,
  updateAccessToken,
  markRevoked,
  loadConnectionItemMap,
  upsertConnectionItem,
} from "../lib/accounting/connections";
import {
  pushBundleToQbo,
  reconcileQboInvoices,
  refreshAccessToken,
  loadQboConfig,
  ensureQboItemMap,
  updateQboInvoice,
  type PushWarning,
  type ReconcileExpectation,
} from "../lib/accounting/qbo";
import { LINE_TYPE_AR, LINE_TYPE_TAX_PAYABLE } from "../lib/reports/qb-mapping";
import {
  oaRefreshAccessToken,
  pushBundleToOa,
  reconcileOaInvoices,
  updateOaInvoice,
  type OaReconcileExpectation,
} from "../lib/accounting/oa";
import { recordMappingAudit } from "../lib/reports/qb-mapping-audit";
import { send1099RecipientEmail } from "../lib/sendgrid";
import { sendValidationFailed } from "../lib/validation-error";
import {
  loadCurrentMappingsForCells,
  recordBulkAction,
  snapshotKey,
  undoBulkActionSnapshots,
  type BulkScopeKey,
} from "../lib/reports/qb-mapping-bulk";
import {
  computeBulkActionRetentionExpiry,
  getBulkActionExpiresSoonDays,
  getBulkActionRetentionDays,
  getBulkActionStorageStats,
  runBulkActionCleanup,
} from "../lib/reports/qb-mapping-bulk-cleanup";
import {
  qbAccountMappingBulkActionsTable,
  qbAccountMappingCleanupAuditTable,
  type QbBulkActionSnapshotEntry,
} from "@workspace/db";
import {
  getPushedInvoice,
  loadPushedInvoiceStore,
  touchPushedInvoice,
} from "../lib/accounting/pushedInvoices";

const router: IRouter = Router();

// ──────────────────────────────────────────────────────────────────
// RBAC helpers
// ──────────────────────────────────────────────────────────────────

function rbacVendor(req: Request, res: Response, vendorId: number): boolean {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return false;
  }
  if (s.role === "admin") return true;
  if (s.role === "vendor" && s.vendorId === vendorId) return true;
  res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
  return false;
}

function rbacPartner(req: Request, res: Response, partnerId: number): boolean {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return false;
  }
  if (s.role === "admin") return true;
  if (s.role === "partner" && s.partnerId === partnerId) return true;
  res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
  return false;
}

const FormatJsonCsvPdf = z.enum(["json", "csv", "pdf"]);
type FormatJsonCsvPdf = z.infer<typeof FormatJsonCsvPdf>;
const FormatJsonCsvPdfIifZip = z.enum(["json", "csv", "pdf", "iif", "zip"]);

function parseFormat<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
  fallback: z.infer<T>,
): z.infer<T> {
  const r = schema.safeParse(raw);
  return r.success ? r.data : fallback;
}

function parsePeriodOrError(req: Request, res: Response): Period | null {
  const parsed = periodQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid period", code: "report.invalid_period", details: parsed.error.flatten() });
    return null;
  }
  try {
    return resolvePeriod(parsed.data);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: "server.upstream_error" });
    return null;
  }
}

function setDownloadHeaders(
  res: Response,
  filename: string,
  contentType: string,
): void {
  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/"/g, "")}"`,
  );
  res.setHeader("Cache-Control", "no-store");
}

async function sendBufferAndAudit(
  req: Request,
  res: Response,
  args: {
    buffer: Buffer;
    contentType: string;
    filename: string;
    reportKind: string;
    format: ReportExportFormat;
    scope: Record<string, unknown>;
    rowCount: number | null;
  },
): Promise<void> {
  setDownloadHeaders(res, args.filename, args.contentType);
  res.setHeader("Content-Length", args.buffer.byteLength);
  res.send(args.buffer);
  await recordExport({
    req,
    reportKind: args.reportKind,
    format: args.format,
    scope: args.scope,
    rowCount: args.rowCount,
    fileBytes: args.buffer.byteLength,
  });
}

// ──────────────────────────────────────────────────────────────────
// 1099 helpers (used by both vendor and partner endpoints)
// ──────────────────────────────────────────────────────────────────

function parseYear(req: Request): number {
  const raw = Number(req.query.year ?? new Date().getUTCFullYear());
  return Number.isInteger(raw) && raw >= 2000 && raw <= 2100
    ? raw
    : new Date().getUTCFullYear();
}

function misc1099Csv(year: number, rows: Misc1099Row[]): string {
  return toCsv(
    [
      "TaxYear",
      "PayerPartnerId",
      "PayerName",
      "RecipientVendorId",
      "RecipientName",
      "RecipientTIN",
      "RecipientAddress",
      "Box1_Rents",
      "Box2_Royalties",
      "Box3_OtherIncome",
      "Box3_PrizesAwards",
      "Box6_MedicalHealth",
      "Box10_Attorney",
      "TotalReportable",
      "SharedEINWarning",
    ],
    rows.map((r) => [
      year,
      r.payerPartnerId,
      r.payerPartnerName,
      r.vendorId,
      r.vendorName,
      r.federalTaxId ?? "",
      r.vendorAddress ?? "",
      r.box1Rents,
      r.box2Royalties,
      r.box3OtherIncome,
      r.box3PrizesAwards,
      r.box6MedicalHealth,
      r.box10Attorney,
      r.totalReportable,
      r.sharedEinWarning ? "true" : "false",
    ]),
  );
}

function misc1099PdfInputs(
  year: number,
  rows: Misc1099Row[],
): Parameters<typeof renderMisc1099Pdf>[0] {
  return rows.map((r) => ({
    taxYear: year,
    payerName: r.payerPartnerName,
    payerEin: r.payerEin,
    payerAddress: r.payerAddress,
    recipientName: r.vendorName,
    recipientTin: r.federalTaxId,
    recipientAddress: r.vendorAddress,
    box1Rents: r.box1Rents,
    box2Royalties: r.box2Royalties,
    box3OtherIncome: (
      Number(r.box3OtherIncome) + Number(r.box3PrizesAwards)
    ).toFixed(2),
    box6MedicalHealth: r.box6MedicalHealth,
    box10Attorney: r.box10Attorney,
  }));
}

const K1099_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function k1099Csv(year: number, rows: K1099Row[]): string {
  return toCsv(
    [
      "TaxYear",
      "PayerPartnerId",
      "PayerName",
      "RecipientVendorId",
      "RecipientName",
      "RecipientTIN",
      "RecipientAddress",
      "Box1a_Gross",
      "Box3_Transactions",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
      "SharedEINWarning",
      // New column appended at the end so existing column positions stay
      // stable for downstream consumers that index by offset.
      "CrossedThresholdMonth",
    ],
    rows.map((r) => [
      year,
      r.payerPartnerId,
      r.payerPartnerName,
      r.vendorId,
      r.vendorName,
      r.federalTaxId ?? "",
      r.vendorAddress ?? "",
      r.grossAmount,
      r.transactionCount,
      ...r.monthly,
      r.sharedEinWarning ? "true" : "false",
      r.crossedAtMonthIdx != null &&
      r.crossedAtMonthIdx >= 0 &&
      r.crossedAtMonthIdx < 12
        ? K1099_MONTH_LABELS[r.crossedAtMonthIdx]
        : "",
    ]),
  );
}

function k1099PdfInputs(
  year: number,
  rows: K1099Row[],
): Parameters<typeof renderK1099Pdf>[0] {
  return rows.map((r) => ({
    taxYear: year,
    payerName: r.payerPartnerName,
    payerEin: r.payerEin,
    payerAddress: r.payerAddress,
    recipientName: r.vendorName,
    recipientTin: r.federalTaxId,
    recipientAddress: r.vendorAddress,
    grossAmount: r.grossAmount,
    transactionCount: r.transactionCount,
    monthly: r.monthly,
  }));
}

// ──────────────────────────────────────────────────────────────────
// VENDOR REPORTS
// ──────────────────────────────────────────────────────────────────

// GET /reports/vendor/:vendorId/aging
router.get(
  "/reports/vendor/:vendorId/aging",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    const { rows, totals } = await agingForVendor(vendorId);
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");

    if (fmt === "json") {
      res.json({ rows, totals });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["Partner", "Current", "1-15", "16-30", "31-60", "60+", "Total"],
        [
          ...rows.map((r) => [
            r.partnerName ?? `Partner ${r.partnerId}`,
            r.current,
            r.bucket1_15,
            r.bucket16_30,
            r.bucket31_60,
            r.bucket60_plus,
            r.total,
          ]),
          [
            `TOTAL (${rows.length} partners)`,
            totals.current,
            totals.bucket1_15,
            totals.bucket16_30,
            totals.bucket31_60,
            totals.bucket60_plus,
            totals.total,
          ],
        ],
      );
      const buf = Buffer.from(csv, "utf-8");
      await sendBufferAndAudit(req, res, {
        buffer: buf,
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["aging", `vendor-${vendorId}`]),
        reportKind: "vendor.aging",
        format: "csv",
        scope: { vendorId },
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "A/R Aging",
        subtitle: `Vendor ${vendorId}`,
        columns: [
          { header: "Partner", width: 3 },
          { header: "Current", width: 1, align: "right" },
          { header: "1-15", width: 1, align: "right" },
          { header: "16-30", width: 1, align: "right" },
          { header: "31-60", width: 1, align: "right" },
          { header: "60+", width: 1, align: "right" },
          { header: "Total", width: 1.2, align: "right" },
        ],
        rows: rows.map((r) => [
          r.partnerName ?? `Partner ${r.partnerId}`,
          r.current,
          r.bucket1_15,
          r.bucket16_30,
          r.bucket31_60,
          r.bucket60_plus,
          r.total,
        ]),
        totals: [
          "TOTAL",
          totals.current,
          totals.bucket1_15,
          totals.bucket16_30,
          totals.bucket31_60,
          totals.bucket60_plus,
          totals.total,
        ],
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["aging", `vendor-${vendorId}`], "pdf"),
        reportKind: "vendor.aging",
        format: "pdf",
        scope: { vendorId },
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/vendor/:vendorId/revenue-by-partner
router.get(
  "/reports/vendor/:vendorId/revenue-by-partner",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;

    const rows = await revenueByPartner({ vendorId, period });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    const totalsRow: (string | number)[] = [
      `TOTAL (${rows.length} partners)`,
      sumIntColumn(rows, (r) => r.invoiceCount),
      sumColumn(rows, (r) => r.subtotal),
      sumColumn(rows, (r) => r.taxTotal),
      sumColumn(rows, (r) => r.total),
    ];
    const totalsObj = {
      partnerName: `TOTAL (${rows.length})`,
      invoiceCount: sumIntColumn(rows, (r) => r.invoiceCount),
      subtotal: sumColumn(rows, (r) => r.subtotal),
      taxTotal: sumColumn(rows, (r) => r.taxTotal),
      total: sumColumn(rows, (r) => r.total),
    };

    if (fmt === "json") {
      res.json({ rows, totals: totalsObj, period: formatPeriod(period) });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["Partner", "InvoiceCount", "Subtotal", "Tax", "Total"],
        [
          ...rows.map((r) => [
            r.partnerName ?? `Partner ${r.partnerId}`,
            r.invoiceCount,
            r.subtotal,
            r.taxTotal,
            r.total,
          ]),
          totalsRow,
        ],
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "revenue-by-partner",
          `vendor-${vendorId}`,
          period.label.replace(/\s+/g, "_"),
        ]),
        reportKind: "vendor.revenueByPartner",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "Revenue by Partner",
        subtitle: `Vendor ${vendorId}  ·  ${formatPeriod(period)}`,
        periodLabel: period.label,
        columns: [
          { header: "Partner", width: 3 },
          { header: "Invoices", width: 1, align: "right" },
          { header: "Subtotal", width: 1.2, align: "right" },
          { header: "Tax", width: 1.2, align: "right" },
          { header: "Total", width: 1.4, align: "right" },
        ],
        rows: rows.map((r) => [
          r.partnerName ?? `Partner ${r.partnerId}`,
          r.invoiceCount,
          r.subtotal,
          r.taxTotal,
          r.total,
        ]),
        totals: totalsRow,
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["revenue-by-partner", `vendor-${vendorId}`, period.label],
          "pdf",
        ),
        reportKind: "vendor.revenueByPartner",
        format: "pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

/** Sum a numeric column across rows. Source values may be string-typed
 *  numerics from PG; we coerce via Number() and return a fixed-2 string so
 *  the output matches per-row formatting. */
function sumColumn<T>(rows: T[], pick: (r: T) => string | number): string {
  let total = 0;
  for (const r of rows) total += Number(pick(r)) || 0;
  return total.toFixed(2);
}

/** Sum an integer column (e.g. invoice / line counts). */
function sumIntColumn<T>(rows: T[], pick: (r: T) => number): number {
  let total = 0;
  for (const r of rows) total += Number(pick(r)) || 0;
  return total;
}

// Generic helper for "by work type" / "by AFE" — they share shape:
// { lineCount: number, amount: string }. Emits a TOTAL row in CSV/PDF and
// a `totals` object in JSON for client-side rendering.
async function handleByGroup(
  req: Request,
  res: Response,
  args: {
    reportKind: string;
    fetcher: () => Promise<Array<{ lineCount: number; amount: string }>>;
    scope: Record<string, unknown>;
    period: Period;
    headers: string[];
    toRow: (r: { lineCount: number; amount: string }) => (string | number)[];
    title: string;
    subtitle: string;
    pdfCols: { header: string; width: number; align?: "left" | "right" }[];
    filenameBase: string[];
    /** Header label for the leftmost grouping column ("Work type", "AFE"). */
    groupLabel: string;
    /** Row-schema field name for the leftmost grouping column ("workTypeName",
     *  "afe") so the JSON totals object key matches what the UI table renders. */
    groupKey: string;
  },
): Promise<void> {
  const rows = await args.fetcher();
  const totalsRow: (string | number)[] = [
    `TOTAL (${rows.length} ${args.groupLabel})`,
    sumIntColumn(rows, (r) => r.lineCount),
    sumColumn(rows, (r) => r.amount),
  ];
  const totalsObj = {
    [args.groupKey]: `TOTAL (${rows.length} ${args.groupLabel})`,
    lineCount: sumIntColumn(rows, (r) => r.lineCount),
    amount: sumColumn(rows, (r) => r.amount),
  };
  const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
  if (fmt === "json") {
    res.json({ rows, totals: totalsObj, period: formatPeriod(args.period) });
    return;
  }
  if (fmt === "csv") {
    const csv = toCsv(args.headers, [
      ...rows.map((r) => args.toRow(r)),
      totalsRow,
    ]);
    await sendBufferAndAudit(req, res, {
      buffer: Buffer.from(csv, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      filename: csvFilename([...args.filenameBase, args.period.label.replace(/\s+/g, "_")]),
      reportKind: args.reportKind,
      format: "csv",
      scope: args.scope,
      rowCount: rows.length,
    });
    return;
  }
  if (fmt === "pdf") {
    const pdf = await renderReportPdf({
      title: args.title,
      subtitle: args.subtitle,
      periodLabel: args.period.label,
      columns: args.pdfCols,
      rows: rows.map((r) => args.toRow(r)),
      totals: totalsRow,
    });
    await sendBufferAndAudit(req, res, {
      buffer: pdf,
      contentType: "application/pdf",
      filename: csvFilename([...args.filenameBase, args.period.label], "pdf"),
      reportKind: args.reportKind,
      format: "pdf",
      scope: args.scope,
      rowCount: rows.length,
    });
    return;
  }
}

// GET /reports/vendor/:vendorId/revenue-by-work-type
router.get(
  "/reports/vendor/:vendorId/revenue-by-work-type",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    await handleByGroup(req, res, {
      reportKind: "vendor.revenueByWorkType",
      fetcher: () => revenueByWorkType({ vendorId, period }),
      scope,
      period,
      headers: ["WorkType", "LineCount", "Amount"],
      toRow: (r) => {
        const x = r as { workTypeName: string; lineCount: number; amount: string };
        return [x.workTypeName, x.lineCount, x.amount];
      },
      title: "Revenue by Work Type",
      subtitle: `Vendor ${vendorId}  ·  ${formatPeriod(period)}`,
      pdfCols: [
        { header: "Work Type", width: 3 },
        { header: "Lines", width: 1, align: "right" },
        { header: "Amount", width: 1.4, align: "right" },
      ],
      filenameBase: ["revenue-by-work-type", `vendor-${vendorId}`],
      groupLabel: "work types",
      groupKey: "workTypeName",
    });
  },
);

// GET /reports/vendor/:vendorId/revenue-by-afe
router.get(
  "/reports/vendor/:vendorId/revenue-by-afe",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    await handleByGroup(req, res, {
      reportKind: "vendor.revenueByAfe",
      fetcher: () => revenueByAfe({ vendorId, period }),
      scope,
      period,
      headers: ["AFE", "LineCount", "Amount"],
      toRow: (r) => {
        const x = r as { afe: string; lineCount: number; amount: string };
        return [x.afe, x.lineCount, x.amount];
      },
      title: "Revenue by AFE",
      subtitle: `Vendor ${vendorId}  ·  ${formatPeriod(period)}`,
      pdfCols: [
        { header: "AFE", width: 3 },
        { header: "Lines", width: 1, align: "right" },
        { header: "Amount", width: 1.4, align: "right" },
      ],
      filenameBase: ["revenue-by-afe", `vendor-${vendorId}`],
      groupLabel: "AFEs",
      groupKey: "afe",
    });
  },
);

// GET /reports/vendor/:vendorId/sales-tax
router.get(
  "/reports/vendor/:vendorId/sales-tax",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const { rows, totals } = await salesTaxByState({ vendorId, period });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    if (fmt === "json") {
      res.json({ rows, totals, period: formatPeriod(period) });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["State", "TaxableSales", "ExemptSales", "TaxCollected", "EffectiveRate"],
        [
          ...rows.map((r) => [
            r.state,
            r.taxableSales,
            r.exemptSales,
            r.taxCollected,
            r.effectiveRate,
          ]),
          [
            "TOTAL",
            totals.taxableSales,
            totals.exemptSales,
            totals.taxCollected,
            totals.effectiveRate,
          ],
        ],
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["sales-tax", `vendor-${vendorId}`, period.label.replace(/\s+/g, "_")]),
        reportKind: "vendor.salesTax",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "Sales Tax by State",
        subtitle: `Vendor ${vendorId}  ·  ${formatPeriod(period)}`,
        periodLabel: period.label,
        columns: [
          { header: "State", width: 1 },
          { header: "Taxable Sales", width: 1.5, align: "right" },
          { header: "Exempt Sales", width: 1.5, align: "right" },
          { header: "Tax Collected", width: 1.5, align: "right" },
          { header: "Eff. Rate", width: 1, align: "right" },
        ],
        rows: rows.map((r) => [
          r.state,
          r.taxableSales,
          r.exemptSales,
          r.taxCollected,
          r.effectiveRate,
        ]),
        totals: [
          "TOTAL",
          totals.taxableSales,
          totals.exemptSales,
          totals.taxCollected,
          totals.effectiveRate,
        ],
        footer:
          "Source: invoice_lines.tax_state on non-draft, non-cancelled invoices in the period.",
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["sales-tax", `vendor-${vendorId}`, period.label], "pdf"),
        reportKind: "vendor.salesTax",
        format: "pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/vendor/:vendorId/crew-cost
router.get(
  "/reports/vendor/:vendorId/crew-cost",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const { rows, totals } = await crewHoursBilledVsCost({ vendorId, period });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    if (fmt === "json") {
      res.json({ rows, totals, period: formatPeriod(period) });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["Employee", "Hours", "Cost", "Billed", "Margin"],
        [
          ...rows.map((r) => [r.employeeName, r.hours, r.cost, r.billed, r.margin]),
          ["TOTAL", totals.hours, totals.cost, totals.billed, totals.margin],
        ],
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["crew-cost", `vendor-${vendorId}`, period.label.replace(/\s+/g, "_")]),
        reportKind: "vendor.crewCost",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "Crew Hours: Billed vs Cost",
        subtitle: `Vendor ${vendorId}  ·  ${formatPeriod(period)}`,
        periodLabel: period.label,
        columns: [
          { header: "Employee", width: 3 },
          { header: "Hours", width: 1, align: "right" },
          { header: "Cost", width: 1.2, align: "right" },
          { header: "Billed", width: 1.2, align: "right" },
          { header: "Margin", width: 1.2, align: "right" },
        ],
        rows: rows.map((r) => [r.employeeName, r.hours, r.cost, r.billed, r.margin]),
        totals: ["TOTAL", totals.hours, totals.cost, totals.billed, totals.margin],
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["crew-cost", `vendor-${vendorId}`, period.label], "pdf"),
        reportKind: "vendor.crewCost",
        format: "pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/vendor/:vendorId/1099-nec
router.get(
  "/reports/vendor/:vendorId/1099-nec",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const yearRaw = Number(req.query.year ?? new Date().getUTCFullYear());
    const year =
      Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100
        ? yearRaw
        : new Date().getUTCFullYear();
    const rows = await nec1099Rows({ year, vendorId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { vendorId, year, threshold: NEC_THRESHOLD_USD };
    if (fmt === "json") {
      res.json({ rows, year, threshold: NEC_THRESHOLD_USD });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        [
          "TaxYear",
          "PayerPartnerId",
          "PayerName",
          "RecipientVendorId",
          "RecipientName",
          "RecipientTIN",
          "RecipientAddress",
          "Box1_NEC",
          "SharedEINWarning",
        ],
        rows.map((r) => [
          year,
          r.payerPartnerId,
          r.payerPartnerName,
          r.vendorId,
          r.vendorName,
          r.federalTaxId ?? "",
          r.vendorAddress ?? "",
          r.totalPaid,
          r.sharedEinWarning ? "true" : "false",
        ]),
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["1099-nec", `vendor-${vendorId}`, String(year)]),
        reportKind: "vendor.1099nec",
        format: "1099_csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      if (rows.length === 0) {
        res.status(404).json({ error: "No 1099-NEC rows for this period.", code: "report.no_1099_nec_rows" });
        return;
      }
      const pdf = await renderNec1099Pdf(
        rows.map((r) => ({
          taxYear: year,
          payerName: r.payerPartnerName,
          payerEin: r.payerEin,
          payerAddress: r.payerAddress,
          recipientName: r.vendorName,
          recipientTin: r.federalTaxId,
          recipientAddress: r.vendorAddress,
          totalPaid: r.totalPaid,
        })),
      );
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["1099-nec", `vendor-${vendorId}`, String(year)], "pdf"),
        reportKind: "vendor.1099nec",
        format: "1099_pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/vendor/:vendorId/1099-misc
router.get(
  "/reports/vendor/:vendorId/1099-misc",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const year = parseYear(req);
    const rows = await misc1099Rows({ year, vendorId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { vendorId, year, thresholds: MISC_BOX_THRESHOLDS };
    if (fmt === "json") {
      res.json({ rows, year, thresholds: MISC_BOX_THRESHOLDS });
      return;
    }
    if (fmt === "csv") {
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(misc1099Csv(year, rows), "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["1099-misc", `vendor-${vendorId}`, String(year)]),
        reportKind: "vendor.1099misc",
        format: "1099_csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      if (rows.length === 0) {
        res.status(404).json({ error: "No 1099-MISC rows for this period.", code: "report.no_1099_misc_rows" });
        return;
      }
      const pdf = await renderMisc1099Pdf(misc1099PdfInputs(year, rows));
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["1099-misc", `vendor-${vendorId}`, String(year)],
          "pdf",
        ),
        reportKind: "vendor.1099misc",
        format: "1099_pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/vendor/:vendorId/1099-k
router.get(
  "/reports/vendor/:vendorId/1099-k",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const year = parseYear(req);
    const rows = await k1099Rows({ year, vendorId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { vendorId, year, threshold: kThresholdForYear(year) };
    if (fmt === "json") {
      res.json({ rows, year, threshold: kThresholdForYear(year) });
      return;
    }
    if (fmt === "csv") {
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(k1099Csv(year, rows), "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["1099-k", `vendor-${vendorId}`, String(year)]),
        reportKind: "vendor.1099k",
        format: "1099_csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      if (rows.length === 0) {
        res.status(404).json({ error: "No 1099-K rows for this period.", code: "report.no_1099_k_rows" });
        return;
      }
      const pdf = await renderK1099Pdf(k1099PdfInputs(year, rows));
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["1099-k", `vendor-${vendorId}`, String(year)],
          "pdf",
        ),
        reportKind: "vendor.1099k",
        format: "1099_pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/vendor/:vendorId/1099-category-audit
//
// Surfaces every active invoice line whose `income_category` is
// implausible for its `line_type` per the heuristic in
// `lib/reports/categoryAudit.ts`. AP can use this to clean up
// historical mismatches before generating year-end 1099s. The same
// heuristic powers the in-the-moment warning banner on the invoice
// detail page so both audit surfaces stay consistent.
router.get(
  "/reports/vendor/:vendorId/1099-category-audit",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const { rows, summary } = await categoryAuditRows({ vendorId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { vendorId };
    if (fmt === "json") {
      res.json({ rows, summary });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        [
          "InvoiceNumber",
          "InvoiceStatus",
          "Vendor",
          "Partner",
          "LineType",
          "IncomeCategory",
          "SuggestedCategories",
          "Description",
          "Amount",
        ],
        rows.map((r: CategoryAuditMismatch) => [
          r.invoiceNumber,
          r.invoiceStatus,
          r.vendorName,
          r.partnerName,
          r.lineType,
          r.incomeCategory,
          r.suggestedCategories.join("|"),
          r.description,
          r.amount,
        ]),
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "1099-category-audit",
          `vendor-${vendorId}`,
        ]),
        reportKind: "vendor.1099categoryAudit",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    // PDF: paginated landscape table for AP year-end audit work papers.
    const pdf = await renderCategoryAuditPdf(
      { rows, summary },
      { scopeLabel: `Vendor ${vendorId}` },
    );
    await sendBufferAndAudit(req, res, {
      buffer: pdf,
      contentType: "application/pdf",
      filename: csvFilename(
        ["1099-category-audit", `vendor-${vendorId}`],
        "pdf",
      ),
      reportKind: "vendor.1099categoryAudit",
      format: "pdf",
      scope,
      rowCount: rows.length,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// PARTNER REPORTS
// ──────────────────────────────────────────────────────────────────

// GET /reports/partner/:partnerId/aging
router.get(
  "/reports/partner/:partnerId/aging",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const { rows, totals } = await agingForPartner(partnerId);
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    if (fmt === "json") {
      res.json({ rows, totals });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["Vendor", "Current", "1-15", "16-30", "31-60", "60+", "Total"],
        [
          ...rows.map((r) => [
            r.vendorName ?? `Vendor ${r.vendorId}`,
            r.current,
            r.bucket1_15,
            r.bucket16_30,
            r.bucket31_60,
            r.bucket60_plus,
            r.total,
          ]),
          [
            `TOTAL (${rows.length} vendors)`,
            totals.current,
            totals.bucket1_15,
            totals.bucket16_30,
            totals.bucket31_60,
            totals.bucket60_plus,
            totals.total,
          ],
        ],
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["aging", `partner-${partnerId}`]),
        reportKind: "partner.aging",
        format: "csv",
        scope: { partnerId },
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "Open Bills (A/P Aging)",
        subtitle: `Partner ${partnerId}`,
        columns: [
          { header: "Vendor", width: 3 },
          { header: "Current", width: 1, align: "right" },
          { header: "1-15", width: 1, align: "right" },
          { header: "16-30", width: 1, align: "right" },
          { header: "31-60", width: 1, align: "right" },
          { header: "60+", width: 1, align: "right" },
          { header: "Total", width: 1.2, align: "right" },
        ],
        rows: rows.map((r) => [
          r.vendorName ?? `Vendor ${r.vendorId}`,
          r.current,
          r.bucket1_15,
          r.bucket16_30,
          r.bucket31_60,
          r.bucket60_plus,
          r.total,
        ]),
        totals: [
          "TOTAL",
          totals.current,
          totals.bucket1_15,
          totals.bucket16_30,
          totals.bucket31_60,
          totals.bucket60_plus,
          totals.total,
        ],
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["aging", `partner-${partnerId}`], "pdf"),
        reportKind: "partner.aging",
        format: "pdf",
        scope: { partnerId },
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/partner/:partnerId/spend-by-vendor
router.get(
  "/reports/partner/:partnerId/spend-by-vendor",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const rows = await spendByVendor({ partnerId, period });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = {
      partnerId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    const totalsRow: (string | number)[] = [
      `TOTAL (${rows.length} vendors)`,
      sumIntColumn(rows, (r) => r.invoiceCount),
      sumColumn(rows, (r) => r.subtotal),
      sumColumn(rows, (r) => r.taxTotal),
      sumColumn(rows, (r) => r.total),
    ];
    const totalsObj = {
      vendorName: `TOTAL (${rows.length})`,
      invoiceCount: sumIntColumn(rows, (r) => r.invoiceCount),
      subtotal: sumColumn(rows, (r) => r.subtotal),
      taxTotal: sumColumn(rows, (r) => r.taxTotal),
      total: sumColumn(rows, (r) => r.total),
    };
    if (fmt === "json") {
      res.json({ rows, totals: totalsObj, period: formatPeriod(period) });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["Vendor", "InvoiceCount", "Subtotal", "Tax", "Total"],
        [
          ...rows.map((r) => [
            r.vendorName ?? `Vendor ${r.vendorId}`,
            r.invoiceCount,
            r.subtotal,
            r.taxTotal,
            r.total,
          ]),
          totalsRow,
        ],
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "spend-by-vendor",
          `partner-${partnerId}`,
          period.label.replace(/\s+/g, "_"),
        ]),
        reportKind: "partner.spendByVendor",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "Spend by Vendor",
        subtitle: `Partner ${partnerId}  ·  ${formatPeriod(period)}`,
        periodLabel: period.label,
        columns: [
          { header: "Vendor", width: 3 },
          { header: "Invoices", width: 1, align: "right" },
          { header: "Subtotal", width: 1.2, align: "right" },
          { header: "Tax", width: 1.2, align: "right" },
          { header: "Total", width: 1.4, align: "right" },
        ],
        rows: rows.map((r) => [
          r.vendorName ?? `Vendor ${r.vendorId}`,
          r.invoiceCount,
          r.subtotal,
          r.taxTotal,
          r.total,
        ]),
        totals: totalsRow,
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["spend-by-vendor", `partner-${partnerId}`, period.label], "pdf"),
        reportKind: "partner.spendByVendor",
        format: "pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/partner/:partnerId/spend-by-work-type
router.get(
  "/reports/partner/:partnerId/spend-by-work-type",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const scope = {
      partnerId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    await handleByGroup(req, res, {
      reportKind: "partner.spendByWorkType",
      fetcher: () => revenueByWorkType({ partnerId, period }),
      scope,
      period,
      headers: ["WorkType", "LineCount", "Amount"],
      toRow: (r) => {
        const x = r as { workTypeName: string; lineCount: number; amount: string };
        return [x.workTypeName, x.lineCount, x.amount];
      },
      title: "Spend by Work Type",
      subtitle: `Partner ${partnerId}  ·  ${formatPeriod(period)}`,
      pdfCols: [
        { header: "Work Type", width: 3 },
        { header: "Lines", width: 1, align: "right" },
        { header: "Amount", width: 1.4, align: "right" },
      ],
      filenameBase: ["spend-by-work-type", `partner-${partnerId}`],
      groupLabel: "work types",
      groupKey: "workTypeName",
    });
  },
);

// GET /reports/partner/:partnerId/spend-by-afe
router.get(
  "/reports/partner/:partnerId/spend-by-afe",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const scope = {
      partnerId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    await handleByGroup(req, res, {
      reportKind: "partner.spendByAfe",
      fetcher: () => revenueByAfe({ partnerId, period }),
      scope,
      period,
      headers: ["AFE", "LineCount", "Amount"],
      toRow: (r) => {
        const x = r as { afe: string; lineCount: number; amount: string };
        return [x.afe, x.lineCount, x.amount];
      },
      title: "Spend by AFE",
      subtitle: `Partner ${partnerId}  ·  ${formatPeriod(period)}`,
      pdfCols: [
        { header: "AFE", width: 3 },
        { header: "Lines", width: 1, align: "right" },
        { header: "Amount", width: 1.4, align: "right" },
      ],
      filenameBase: ["spend-by-afe", `partner-${partnerId}`],
      groupLabel: "AFEs",
      groupKey: "afe",
    });
  },
);

// GET /reports/partner/:partnerId/sales-tax — what sales tax this partner paid out
router.get(
  "/reports/partner/:partnerId/sales-tax",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const { rows, totals } = await salesTaxByState({ partnerId, period });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = {
      partnerId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    if (fmt === "json") {
      res.json({ rows, totals, period: formatPeriod(period) });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        ["State", "TaxableSpend", "ExemptSpend", "TaxPaid", "EffectiveRate"],
        [
          ...rows.map((r) => [
            r.state,
            r.taxableSales,
            r.exemptSales,
            r.taxCollected,
            r.effectiveRate,
          ]),
          [
            "TOTAL",
            totals.taxableSales,
            totals.exemptSales,
            totals.taxCollected,
            totals.effectiveRate,
          ],
        ],
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "sales-tax",
          `partner-${partnerId}`,
          period.label.replace(/\s+/g, "_"),
        ]),
        reportKind: "partner.salesTax",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const pdf = await renderReportPdf({
        title: "Sales Tax Paid by State",
        subtitle: `Partner ${partnerId}  ·  ${formatPeriod(period)}`,
        periodLabel: period.label,
        columns: [
          { header: "State", width: 1 },
          { header: "Taxable Spend", width: 1.5, align: "right" },
          { header: "Exempt Spend", width: 1.5, align: "right" },
          { header: "Tax Paid", width: 1.5, align: "right" },
          { header: "Eff. Rate", width: 1, align: "right" },
        ],
        rows: rows.map((r) => [
          r.state,
          r.taxableSales,
          r.exemptSales,
          r.taxCollected,
          r.effectiveRate,
        ]),
        totals: [
          "TOTAL",
          totals.taxableSales,
          totals.exemptSales,
          totals.taxCollected,
          totals.effectiveRate,
        ],
      });
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["sales-tax", `partner-${partnerId}`, period.label], "pdf"),
        reportKind: "partner.salesTax",
        format: "pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/partner/:partnerId/accounting-export-summary
router.get(
  "/reports/partner/:partnerId/accounting-export-summary",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const summary = await accountingExportSummary({ partnerId, period });
    res.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
        display: formatPeriod(period),
      },
      ...summary,
    });
  },
);

// GET /reports/partner/:partnerId/line-detail-export?format=csv
router.get(
  "/reports/partner/:partnerId/line-detail-export",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const fmt = parseFormat(z.enum(["json", "csv"]), req.query.format, "csv");
    const rows = await lineDetailRows({ partnerId, period });
    const scope = {
      partnerId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    if (fmt === "json") {
      res.json({ rows, period: formatPeriod(period) });
      return;
    }
    const csv = lineDetailToCsv(rows);
    await sendBufferAndAudit(req, res, {
      buffer: Buffer.from(csv, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      filename: csvFilename([
        "line-detail",
        `partner-${partnerId}`,
        period.label.replace(/\s+/g, "_"),
      ]),
      reportKind: "partner.lineDetail",
      format: "csv",
      scope,
      rowCount: rows.length,
    });
  },
);

// GET /reports/partner/:partnerId/accounting-bundle — ZIP of spend, tax, line detail
router.get(
  "/reports/partner/:partnerId/accounting-bundle",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;

    const [spendRows, { rows: taxRows, totals: taxTotals }, detailRows] =
      await Promise.all([
        spendByVendor({ partnerId, period }),
        salesTaxByState({ partnerId, period }),
        lineDetailRows({ partnerId, period }),
      ]);

    const spendCsv = toCsv(
      ["Vendor", "InvoiceCount", "Subtotal", "Tax", "Total"],
      [
        ...spendRows.map((r) => [
          r.vendorName ?? `Vendor ${r.vendorId}`,
          r.invoiceCount,
          r.subtotal,
          r.taxTotal,
          r.total,
        ]),
        [
          `TOTAL (${spendRows.length} vendors)`,
          sumIntColumn(spendRows, (r) => r.invoiceCount),
          sumColumn(spendRows, (r) => r.subtotal),
          sumColumn(spendRows, (r) => r.taxTotal),
          sumColumn(spendRows, (r) => r.total),
        ],
      ],
    );

    const taxCsv = toCsv(
      ["State", "TaxableSpend", "ExemptSpend", "TaxPaid", "EffectiveRate"],
      [
        ...taxRows.map((r) => [
          r.state,
          r.taxableSales,
          r.exemptSales,
          r.taxCollected,
          r.effectiveRate,
        ]),
        [
          "TOTAL",
          taxTotals.taxableSales,
          taxTotals.exemptSales,
          taxTotals.taxCollected,
          taxTotals.effectiveRate,
        ],
      ],
    );

    const detailCsv = lineDetailToCsv(detailRows);
    const periodLabel = formatPeriod(period);
    const readme =
      `VNDRLY Partner Accounting Bundle\r\n` +
      `Partner ID: ${partnerId}\r\n` +
      `Period: ${periodLabel}\r\n\r\n` +
      `Files:\r\n` +
      `  spend-by-vendor.csv — invoice totals grouped by vendor\r\n` +
      `  sales-tax-by-state.csv — taxable/exempt spend and tax by state\r\n` +
      `  line-detail.csv — one row per billed invoice line\r\n`;

    const zip = await buildZip([
      { name: "spend-by-vendor.csv", content: spendCsv },
      { name: "sales-tax-by-state.csv", content: taxCsv },
      { name: "line-detail.csv", content: detailCsv },
      { name: "README.txt", content: readme },
    ]);

    const scope = {
      partnerId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    await sendBufferAndAudit(req, res, {
      buffer: zip,
      contentType: "application/zip",
      filename: csvFilename(
        ["accounting-bundle", `partner-${partnerId}`, period.label],
        "zip",
      ),
      reportKind: "partner.accountingBundle",
      format: "accounting_bundle_zip",
      scope,
      rowCount: detailRows.length,
    });
  },
);

// GET /reports/partner/:partnerId/1099-worksheet
router.get(
  "/reports/partner/:partnerId/1099-worksheet",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const yearRaw = Number(req.query.year ?? new Date().getUTCFullYear());
    const year =
      Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100
        ? yearRaw
        : new Date().getUTCFullYear();
    const rows = await nec1099Rows({ year, payerPartnerId: partnerId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { partnerId, year, threshold: NEC_THRESHOLD_USD };
    if (fmt === "json") {
      res.json({ rows, year, threshold: NEC_THRESHOLD_USD });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        [
          "TaxYear",
          "PayerPartnerId",
          "RecipientVendorId",
          "RecipientName",
          "RecipientTIN",
          "RecipientAddress",
          "Box1_NEC",
          "SharedEINWarning",
        ],
        rows.map((r) => [
          year,
          r.payerPartnerId,
          r.vendorId,
          r.vendorName,
          r.federalTaxId ?? "",
          r.vendorAddress ?? "",
          r.totalPaid,
          r.sharedEinWarning ? "true" : "false",
        ]),
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["1099-worksheet", `partner-${partnerId}`, String(year)]),
        reportKind: "partner.1099Worksheet",
        format: "1099_csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      if (rows.length === 0) {
        res.status(404).json({ error: "No 1099-NEC rows for this period.", code: "report.no_1099_nec_rows" });
        return;
      }
      const pdf = await renderNec1099Pdf(
        rows.map((r) => ({
          taxYear: year,
          payerName: r.payerPartnerName,
          payerEin: r.payerEin,
          payerAddress: r.payerAddress,
          recipientName: r.vendorName,
          recipientTin: r.federalTaxId,
          recipientAddress: r.vendorAddress,
          totalPaid: r.totalPaid,
        })),
      );
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(["1099-worksheet", `partner-${partnerId}`, String(year)], "pdf"),
        reportKind: "partner.1099Worksheet",
        format: "1099_pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/partner/:partnerId/1099-misc
router.get(
  "/reports/partner/:partnerId/1099-misc",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const year = parseYear(req);
    const rows = await misc1099Rows({ year, payerPartnerId: partnerId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { partnerId, year, thresholds: MISC_BOX_THRESHOLDS };
    if (fmt === "json") {
      res.json({ rows, year, thresholds: MISC_BOX_THRESHOLDS });
      return;
    }
    if (fmt === "csv") {
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(misc1099Csv(year, rows), "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "1099-misc",
          `partner-${partnerId}`,
          String(year),
        ]),
        reportKind: "partner.1099misc",
        format: "1099_csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      if (rows.length === 0) {
        res.status(404).json({ error: "No 1099-MISC rows for this period.", code: "report.no_1099_misc_rows" });
        return;
      }
      const pdf = await renderMisc1099Pdf(misc1099PdfInputs(year, rows));
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["1099-misc", `partner-${partnerId}`, String(year)],
          "pdf",
        ),
        reportKind: "partner.1099misc",
        format: "1099_pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/partner/:partnerId/1099-k
router.get(
  "/reports/partner/:partnerId/1099-k",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const year = parseYear(req);
    const rows = await k1099Rows({ year, payerPartnerId: partnerId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { partnerId, year, threshold: kThresholdForYear(year) };
    if (fmt === "json") {
      res.json({ rows, year, threshold: kThresholdForYear(year) });
      return;
    }
    if (fmt === "csv") {
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(k1099Csv(year, rows), "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "1099-k",
          `partner-${partnerId}`,
          String(year),
        ]),
        reportKind: "partner.1099k",
        format: "1099_csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      if (rows.length === 0) {
        res.status(404).json({ error: "No 1099-K rows for this period.", code: "report.no_1099_k_rows" });
        return;
      }
      const pdf = await renderK1099Pdf(k1099PdfInputs(year, rows));
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["1099-k", `partner-${partnerId}`, String(year)],
          "pdf",
        ),
        reportKind: "partner.1099k",
        format: "1099_pdf",
        scope,
        rowCount: rows.length,
      });
      return;
    }
  },
);

// GET /reports/partner/:partnerId/1099-category-audit
//
// Partner-scoped twin of the vendor 1099 category audit. Surfaces every
// active invoice line (across all of this partner's vendors) whose
// `income_category` is implausible for its `line_type`, so AP at the
// payer organisation can clean up before issuing year-end 1099s.
router.get(
  "/reports/partner/:partnerId/1099-category-audit",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const { rows, summary } = await categoryAuditRows({ partnerId });
    const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
    const scope = { partnerId };
    if (fmt === "json") {
      res.json({ rows, summary });
      return;
    }
    if (fmt === "csv") {
      const csv = toCsv(
        [
          "InvoiceNumber",
          "InvoiceStatus",
          "Vendor",
          "Partner",
          "LineType",
          "IncomeCategory",
          "SuggestedCategories",
          "Description",
          "Amount",
        ],
        rows.map((r: CategoryAuditMismatch) => [
          r.invoiceNumber,
          r.invoiceStatus,
          r.vendorName,
          r.partnerName,
          r.lineType,
          r.incomeCategory,
          r.suggestedCategories.join("|"),
          r.description,
          r.amount,
        ]),
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "1099-category-audit",
          `partner-${partnerId}`,
        ]),
        reportKind: "partner.1099categoryAudit",
        format: "csv",
        scope,
        rowCount: rows.length,
      });
      return;
    }
    const pdf = await renderCategoryAuditPdf(
      { rows, summary },
      { scopeLabel: `Partner ${partnerId}` },
    );
    await sendBufferAndAudit(req, res, {
      buffer: pdf,
      contentType: "application/pdf",
      filename: csvFilename(
        ["1099-category-audit", `partner-${partnerId}`],
        "pdf",
      ),
      reportKind: "partner.1099categoryAudit",
      format: "pdf",
      scope,
      rowCount: rows.length,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// 1099 FIRE export, dashboard, filing-status
// ──────────────────────────────────────────────────────────────────

const BooleanQueryParam = z
  .union([z.boolean(), z.string()])
  .optional()
  .default(false)
  .transform((value) => {
    if (typeof value === "boolean") return value;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    return false;
  });

const FireQuery = z.object({
  formType: z.enum(TAX_1099_FORM_TYPES),
  year: z.coerce.number().int().min(2000).max(2100),
  test: BooleanQueryParam,
});

type TransmitterResolution =
  | { ok: true; transmitter: FireTransmitterInfo; missing: never[] }
  | {
      ok: false;
      transmitter: FireTransmitterInfo;
      missing: TransmitterField[];
    };

/** Resolve transmitter info from the singleton settings row. In
 * test-file mode every blank value falls back to a fixed placeholder
 * so IRS pre-submission test files always build; in real-file mode
 * any blank required field (or a transmitter address that doesn't
 * parse into city/state/zip) yields `ok:false` so the caller can
 * refuse the download with a 400 listing exactly what to fix. The
 * legacy `IRS_FIRE_*` env-var fallback was removed in Task #826 so
 * the DB row is the only source of truth. */
async function resolveTransmitter(opts: {
  test: boolean;
}): Promise<TransmitterResolution> {
  const row = await readFireTransmitterRow();
  const effective = effectiveFromRow(row);

  if (opts.test) {
    // Test-file path — backfill blanks with the historical
    // placeholders so dry-run downloads against IRS's test FIRE
    // system always build, even on a fresh install.
    const padded: EffectiveTransmitter = {
      tcc: effective.tcc || "00000",
      ein: effective.ein || "000000000",
      name: effective.name || "VNDRLY INC",
      address: effective.address,
      contactName: effective.contactName || "Tax Operations",
      contactPhone: effective.contactPhone || "0000000000",
      contactEmail: effective.contactEmail || "tax@vndrly.example",
    };
    return {
      ok: true,
      transmitter: effectiveToFireTransmitter(padded, { test: true }),
      missing: [],
    };
  }

  const validation = validateEffective(effective);
  if (!validation.ok) {
    // Pad blanks with the historical placeholders so the preview UI
    // can echo "we'd send THIS if you forced it" alongside the
    // missing-fields warning. The actual download is still blocked
    // up-stream because we return ok:false.
    const padded: EffectiveTransmitter = {
      tcc: effective.tcc || "00000",
      ein: effective.ein || "000000000",
      name: effective.name || "VNDRLY INC",
      address: effective.address,
      contactName: effective.contactName || "Tax Operations",
      contactPhone: effective.contactPhone || "0000000000",
      contactEmail: effective.contactEmail || "tax@vndrly.example",
    };
    return {
      ok: false,
      transmitter: effectiveToFireTransmitter(padded, { test: false }),
      missing: validation.missing,
    };
  }
  return {
    ok: true,
    transmitter: effectiveToFireTransmitter(effective, { test: false }),
    missing: [],
  };
}

// `snapshotToZeroDollarPayee` and `bucketFirePayeesByCorrection` live
// in `lib/reports/fire.ts` so they can be unit-tested without a DB
// (see fire.test.ts → "two-step C correction (Pub 1220 §F.5)").

/**
 * Capture the wire-level B-record fields for a (partner, vendor, form,
 * year) tuple so we can re-emit them as the zero-dollar back-out B
 * record on a future two-step ("C") correction. Returns null if no
 * matching aggregation row exists (e.g. the underlying payments were
 * deleted before filing).
 */
async function captureOriginalPayeeSnapshot(args: {
  formType: string;
  taxYear: number;
  payerPartnerId: number;
  recipientVendorId: number;
}): Promise<FirePayeeSnapshot | null> {
  if (args.formType === "NEC") {
    const rs = await nec1099Rows({
      year: args.taxYear,
      payerPartnerId: args.payerPartnerId,
    });
    const r = rs.find((x) => x.vendorId === args.recipientVendorId);
    if (!r) return null;
    return necRowsToPayees([r])[0];
  }
  if (args.formType === "MISC") {
    const rs = await misc1099Rows({
      year: args.taxYear,
      payerPartnerId: args.payerPartnerId,
    });
    const r = rs.find((x) => x.vendorId === args.recipientVendorId);
    if (!r) return null;
    return miscRowsToPayees([r])[0];
  }
  if (args.formType === "K") {
    const rs = await k1099Rows({
      year: args.taxYear,
      payerPartnerId: args.payerPartnerId,
    });
    const r = rs.find((x) => x.vendorId === args.recipientVendorId);
    if (!r) return null;
    return kRowsToPayees([r])[0];
  }
  return null;
}

type BuildFirePayloadResult =
  | { ok: true; buffer: Buffer; filename: string; rowCount: number }
  | { ok: false; status: number; error: string; missing?: string[] };

async function buildFirePayload(args: {
  formType: FireFormType;
  year: number;
  payerPartnerId?: number;
  test: boolean;
}): Promise<BuildFirePayloadResult> {
  // Resolve transmitter info up-front so a non-test request with
  // missing fields short-circuits before we touch the rest of the DB.
  const resolved = await resolveTransmitter({ test: args.test });
  if (!resolved.ok) {
    return {
      ok: false,
      status: 400,
      error:
        "Transmitter info is incomplete. Save the missing fields in the IRS FIRE transmitter settings page before generating a real IRS FIRE submission, or pass test=true to download a pre-submission test file.",
      missing: resolved.missing,
    };
  }

  // For the FIRE file the *payer* is the partner. We collect rows for
  // every partner in scope and emit one A/payee group per partner.
  const partners = args.payerPartnerId
    ? await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.id, args.payerPartnerId))
    : await db.select().from(partnersTable);

  const payerBlocks: FirePayerBlock[] = [];
  let totalPayees = 0;
  for (const p of partners) {
    if (!p.federalTaxId) continue; // can't file without payer EIN

    // Aggregate per-form rows. We keep the rows around (not just the
    // payee records) so we can map vendorId → corrected_status for the
    // (vendor, partner, form, year) we're emitting.
    let vendorIds: number[] = [];
    let payees: FireBPayee[] = [];
    if (args.formType === "NEC") {
      const rs = await nec1099Rows({ year: args.year, payerPartnerId: p.id });
      vendorIds = rs.map((r) => r.vendorId);
      payees = necRowsToPayees(rs);
    } else if (args.formType === "MISC") {
      const rs = await misc1099Rows({
        year: args.year,
        payerPartnerId: p.id,
      });
      vendorIds = rs.map((r) => r.vendorId);
      payees = miscRowsToPayees(rs);
    } else if (args.formType === "K") {
      const rs = await k1099Rows({ year: args.year, payerPartnerId: p.id });
      vendorIds = rs.map((r) => r.vendorId);
      payees = kRowsToPayees(rs);
    }
    if (payees.length === 0) continue;

    // Look up the corrected-return indicator each (partner, vendor,
    // form, year) row has been flagged with on the dashboard. A payee
    // whose filing row is "g" or "c" goes into a separate A block with
    // matching position-7 indicator so the IRS doesn't reject the file
    // for mixing originals with corrections under one A record.
    const filings = await db
      .select({
        recipientVendorId: tax1099FilingsTable.recipientVendorId,
        correctedStatus: tax1099FilingsTable.correctedStatus,
        originalPayeeSnapshot: tax1099FilingsTable.originalPayeeSnapshot,
      })
      .from(tax1099FilingsTable)
      .where(
        and(
          eq(tax1099FilingsTable.taxYear, args.year),
          eq(tax1099FilingsTable.formType, args.formType),
          eq(tax1099FilingsTable.payerPartnerId, p.id),
        ),
      );
    const corrByVendor = new Map<number, FireCorrectionIndicator>();
    const snapshotByVendor = new Map<number, FirePayeeSnapshot>();
    for (const f of filings) {
      const cs = (f.correctedStatus ?? "none").toLowerCase();
      if (cs === "g") corrByVendor.set(f.recipientVendorId, "G");
      else if (cs === "c") corrByVendor.set(f.recipientVendorId, "C");
      if (f.originalPayeeSnapshot) {
        snapshotByVendor.set(f.recipientVendorId, f.originalPayeeSnapshot);
      }
    }

    const buckets = bucketFirePayeesByCorrection({
      payees,
      vendorIds,
      corrByVendor,
      snapshotByVendor,
    });

    const addr = parseAddress(p.physicalAddress ?? p.billingAddress);
    const payer = {
      ein: p.federalTaxId,
      name: p.name,
      mailingAddress: addr.street,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      contactPhone: p.businessPhone ?? null,
    };
    for (const ind of [" ", "G", "C"] as FireCorrectionIndicator[]) {
      const bucket = buckets[ind];
      if (bucket.length === 0) continue;
      totalPayees += bucket.length;
      payerBlocks.push({ payer, payees: bucket, correctionIndicator: ind });
    }
  }

  const buffer = renderFireFile({
    transmitter: resolved.transmitter,
    formType: args.formType,
    taxYear: args.year,
    payers: payerBlocks,
  });

  const filename = `irs-fire_${args.formType.toLowerCase()}_${args.year}${args.test ? "_TEST" : ""}.txt`;
  return { ok: true, buffer, filename, rowCount: totalPayees };
}

// Partner-scoped FIRE: filer can only generate for their own partner.
router.get(
  "/reports/partner/:partnerId/1099-fire",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const parsed = FireQuery.safeParse(req.query);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_query", error: "Bad query" });
      return;
    }
    const { formType, year, test } = parsed.data;
    const result = await buildFirePayload({
      formType: formType as FireFormType,
      year,
      payerPartnerId: partnerId,
      test,
    });
    if (!result.ok) {
      res
        .status(result.status)
        .json({ error: result.error, missing: result.missing });
      return;
    }
    if (result.rowCount === 0) {
      res.status(404).json({ error: "No filable rows for this scope.", code: "report.no_filable_rows" });
      return;
    }
    await sendBufferAndAudit(req, res, {
      buffer: result.buffer,
      contentType: "text/plain; charset=ascii",
      filename: result.filename,
      reportKind: `partner.1099fire.${formType.toLowerCase()}`,
      format: "1099_fire_txt",
      scope: { partnerId, year, formType, test },
      rowCount: result.rowCount,
    });
  },
);

// Admin-only system-wide FIRE export across every partner.
router.get(
  "/reports/admin/1099-fire",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = FireQuery.safeParse(req.query);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_query", error: "Bad query" });
      return;
    }
    const { formType, year, test } = parsed.data;
    const result = await buildFirePayload({
      formType: formType as FireFormType,
      year,
      test,
    });
    if (!result.ok) {
      res
        .status(result.status)
        .json({ error: result.error, missing: result.missing });
      return;
    }
    if (result.rowCount === 0) {
      res.status(404).json({ error: "No filable rows across any partner.", code: "report.no_filable_rows_across_partners" });
      return;
    }
    await sendBufferAndAudit(req, res, {
      buffer: result.buffer,
      contentType: "text/plain; charset=ascii",
      filename: `admin_${result.filename}`,
      reportKind: `admin.1099fire.${formType.toLowerCase()}`,
      format: "1099_fire_txt",
      scope: { year, formType, test },
      rowCount: result.rowCount,
    });
  },
);

// ─── Transmitter info preview ───────────────────────────────────
//
// Lets operators see exactly which transmitter values the FIRE
// generator will write into the T record before they download a real
// (non-test) submission. Returns a structured payload listing any
// required fields that are still unset/blank, so the same UI can
// surface a "your IRS FIRE transmitter settings are incomplete"
// warning before the user clicks Download. Read-only — no audit row.

const TransmitterPreviewQuery = z.object({
  test: BooleanQueryParam,
});

interface TransmitterPreviewResponse {
  test: boolean;
  ok: boolean;
  missing: string[];
  transmitter: {
    tcc: string;
    ein: string;
    name: string;
    mailingAddress: string;
    city: string;
    state: string;
    zip: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
  };
}

async function transmitterPreviewPayload(
  test: boolean,
): Promise<TransmitterPreviewResponse> {
  const resolved = await resolveTransmitter({ test });
  const t = resolved.transmitter;
  return {
    test,
    ok: resolved.ok,
    missing: resolved.ok ? [] : resolved.missing,
    transmitter: {
      tcc: t.tcc,
      ein: t.ein,
      name: t.name,
      mailingAddress: t.mailingAddress,
      city: t.city,
      state: t.state,
      zip: t.zip,
      contactName: t.contactName,
      contactPhone: t.contactPhone,
      contactEmail: t.contactEmail,
    },
  };
}

router.get(
  "/reports/admin/1099-fire/transmitter",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = TransmitterPreviewQuery.safeParse(req.query);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_query", error: "Bad query" });
      return;
    }
    res.json(await transmitterPreviewPayload(parsed.data.test));
  },
);

router.get(
  "/reports/partner/:partnerId/1099-fire/transmitter",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const parsed = TransmitterPreviewQuery.safeParse(req.query);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_query", error: "Bad query" });
      return;
    }
    res.json(await transmitterPreviewPayload(parsed.data.test));
  },
);

// GET /reports/partner/:partnerId/1099-dashboard
//
// `format=csv` returns the 1099-K monthly breakout for this partner —
// one row per (payer, recipient) with Jan…Dec gross amounts and the
// transaction count. `format=json` (default) returns the full
// per-recipient dashboard payload used to render the card.
router.get(
  "/reports/partner/:partnerId/1099-dashboard",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    const year = parseYear(req);
    const result = await build1099Dashboard({
      year,
      payerPartnerId: partnerId,
    });
    const fmt = parseFormat(
      z.enum(["json", "csv", "pdf"]),
      req.query.format,
      "json",
    );
    if (fmt === "csv") {
      const kRows = result.rows.filter((r) => r.formType === "K");
      const csv = dashboard1099MonthlyKCsv(kRows);
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename([
          "1099-k-monthly",
          `partner-${partnerId}`,
          String(year),
        ]),
        reportKind: "partner.1099kMonthly",
        format: "1099_csv",
        scope: { partnerId, year },
        rowCount: kRows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const kRows = result.rows.filter((r) => r.formType === "K");
      const payerName = kRows[0]?.payerPartnerName ?? `Partner ${partnerId}`;
      const pdf = await dashboard1099MonthlyKPdf(year, kRows, `Payer: ${payerName}`);
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["1099-k-monthly", `partner-${partnerId}`, String(year)],
          "pdf",
        ),
        reportKind: "partner.1099kMonthly",
        format: "1099_pdf",
        scope: { partnerId, year },
        rowCount: kRows.length,
      });
      return;
    }
    res.json(result);
  },
);

// GET /reports/admin/1099-dashboard
//
// `format=csv` returns the 1099-K monthly breakout across every
// partner (payer, recipient, EIN, total, txn count, Jan…Dec). The
// admin and partner endpoints share the same CSV layout so admins can
// triage anomalies in the same spreadsheet flow as bookkeepers.
router.get(
  "/reports/admin/1099-dashboard",
  requireAdmin,
  async (req, res): Promise<void> => {
    const year = parseYear(req);
    const result = await build1099Dashboard({ year });
    const fmt = parseFormat(
      z.enum(["json", "csv", "pdf"]),
      req.query.format,
      "json",
    );
    if (fmt === "csv") {
      const kRows = result.rows.filter((r) => r.formType === "K");
      const csv = dashboard1099MonthlyKCsv(kRows);
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["1099-k-monthly", "admin", String(year)]),
        reportKind: "admin.1099kMonthly",
        format: "1099_csv",
        scope: { year },
        rowCount: kRows.length,
      });
      return;
    }
    if (fmt === "pdf") {
      const kRows = result.rows.filter((r) => r.formType === "K");
      const pdf = await dashboard1099MonthlyKPdf(year, kRows, "All payers (admin)");
      await sendBufferAndAudit(req, res, {
        buffer: pdf,
        contentType: "application/pdf",
        filename: csvFilename(
          ["1099-k-monthly", "admin", String(year)],
          "pdf",
        ),
        reportKind: "admin.1099kMonthly",
        format: "1099_pdf",
        scope: { year },
        rowCount: kRows.length,
      });
      return;
    }
    res.json(result);
  },
);

// ──────────────────────────────────────────────────────────────────
// 1099 e-delivery — email PDF copy to consenting recipients.
// ──────────────────────────────────────────────────────────────────
//
// IRS Pub 1179 / Reg §31.6051-1(j) require recorded affirmative consent
// before a payee may receive their copy of a 1099 electronically. This
// handler honors that contract: rows where eDeliveryConsent = false are
// skipped and counted, never emailed. Each successful send upserts the
// matching tax_1099_filings row to status='delivered' with deliveryChannel
// = 'email'. Failures (no email on file, SendGrid error) flip the row to
// status='error' with the error in `notes` so the dashboard surfaces them.

const Deliver1099Body = z.object({
  year: z.number().int().min(2000).max(2100),
  formType: z.enum(TAX_1099_FORM_TYPES),
  // Optional whitelist; when omitted we iterate every dashboard row in scope.
  recipientVendorIds: z.array(z.number().int().positive()).optional(),
});

export interface Deliver1099Result {
  attempted: number;
  delivered: number;
  skippedNoConsent: number;
  errors: Array<{
    recipientVendorId: number;
    recipientName: string;
    formType: string;
    message: string;
  }>;
}

async function upsertDeliveryRow(args: {
  taxYear: number;
  formType: string;
  payerPartnerId: number;
  recipientVendorId: number;
  totalReportable: string;
  status: "delivered" | "error";
  deliveredAt: Date | null;
  deliveryChannel: string | null;
  notes: string | null;
  updatedByUserId: number | null;
  existingId: number | null;
  sendgridMessageId?: string | null;
}): Promise<void> {
  // NOTE: This path only handles recipient-copy email delivery, never
  // IRS filing. Snapshotting the original payee block here would be
  // wrong: a row can be "delivered" weeks before it ever reaches the
  // IRS, and any payee-data change between delivery and filing would
  // leave the snapshot reflecting a state we never actually filed.
  // The snapshot is captured exclusively in the filing-status upsert
  // paths below when status transitions to filed/accepted/rejected.
  const now = new Date();
  if (args.existingId) {
    const patch: Record<string, unknown> = {
      status: args.status,
      deliveredAt: args.deliveredAt,
      deliveryChannel: args.deliveryChannel,
      notes: args.notes,
      totalAmount: args.totalReportable,
      updatedAt: now,
      updatedByUserId: args.updatedByUserId,
      sendgridMessageId: args.sendgridMessageId ?? null,
      lastEventType: null,
      lastEventAt: null,
      bounceReason: null,
      openedAt: null,
    };
    await db
      .update(tax1099FilingsTable)
      .set(patch)
      .where(eq(tax1099FilingsTable.id, args.existingId));
    return;
  }
  await db.insert(tax1099FilingsTable).values({
    taxYear: args.taxYear,
    formType: args.formType,
    payerPartnerId: args.payerPartnerId,
    recipientVendorId: args.recipientVendorId,
    totalAmount: args.totalReportable,
    status: args.status,
    filingMethod: "manual",
    deliveredAt: args.deliveredAt,
    deliveryChannel: args.deliveryChannel,
    notes: args.notes,
    updatedByUserId: args.updatedByUserId,
    updatedAt: now,
    sendgridMessageId: args.sendgridMessageId ?? null,
  });
}

async function render1099RowPdf(args: {
  formType: "NEC" | "MISC" | "K";
  year: number;
  necRow?: Nec1099Row;
  miscRow?: Misc1099Row;
  kRow?: K1099Row;
}): Promise<Buffer> {
  if (args.formType === "NEC" && args.necRow) {
    return renderNec1099Pdf([
      {
        taxYear: args.year,
        payerName: args.necRow.payerPartnerName,
        payerEin: args.necRow.payerEin,
        payerAddress: args.necRow.payerAddress,
        recipientName: args.necRow.vendorName,
        recipientTin: args.necRow.federalTaxId,
        recipientAddress: args.necRow.vendorAddress,
        totalPaid: args.necRow.totalPaid,
      },
    ]);
  }
  if (args.formType === "MISC" && args.miscRow) {
    return renderMisc1099Pdf(misc1099PdfInputs(args.year, [args.miscRow]));
  }
  if (args.formType === "K" && args.kRow) {
    return renderK1099Pdf(k1099PdfInputs(args.year, [args.kRow]));
  }
  throw new Error("No source row for PDF render");
}

// ── Background job processing ──────────────────────────────────
//
// The previous implementation looped over every consenting recipient
// inside the HTTP request. For partners with 50+ vendors the browser
// would time out before the loop finished. Now the route enqueues a
// `dashboard_1099_delivery_jobs` row, returns 202 with the job id, and
// `processDeliver1099Job` runs the loop in the background, writing
// progress (attempted/delivered/skippedNoConsent/errors) to the same
// row as it goes. The Dashboard1099Card polls
// `GET /reports/.../1099-deliver/jobs/:id` for live progress.
//
// Recovery: server boot calls `markStuckDeliveryJobsAsFailed` to flip
// any rows still marked `running` to `failed`, since in-process
// workers lose state on restart.

export async function processDeliver1099Job(jobId: number): Promise<void> {
  // Atomic pickup: only the worker that successfully transitions a row
  // from `pending` -> `running` actually processes it. A duplicate
  // dispatch (e.g. boot recovery racing with `setImmediate`) sees zero
  // updated rows here and bails out, so the loop never runs twice.
  const startedAt = new Date();
  const claimed = await db
    .update(dashboard1099DeliveryJobsTable)
    .set({ status: "running", startedAt, updatedAt: startedAt })
    .where(
      and(
        eq(dashboard1099DeliveryJobsTable.id, jobId),
        eq(dashboard1099DeliveryJobsTable.status, "pending"),
      ),
    )
    .returning();
  const job = claimed[0];
  if (!job) {
    // Either the row is gone or it's already past `pending`. Both are
    // no-ops from this worker's perspective.
    return;
  }

  try {
    await runDeliver1099Job(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId }, "1099 delivery job crashed");
    await db
      .update(dashboard1099DeliveryJobsTable)
      .set({
        status: "failed",
        finishedAt: new Date(),
        updatedAt: new Date(),
        lastErrorMessage: message.slice(0, 1900),
      })
      .where(eq(dashboard1099DeliveryJobsTable.id, jobId));
  }
}

async function runDeliver1099Job(
  job: Dashboard1099DeliveryJob,
): Promise<void> {
  const year = job.taxYear;
  const formType = job.formType as "NEC" | "MISC" | "K";
  const payerPartnerId =
    job.scope === "partner" && job.partnerId != null
      ? job.partnerId
      : undefined;
  const recipientWhitelist = job.recipientVendorIds;

  const dashboard = await build1099Dashboard({ year, payerPartnerId });
  let dashRows = dashboard.rows.filter((r) => r.formType === formType);
  if (recipientWhitelist && recipientWhitelist.length > 0) {
    const set = new Set(recipientWhitelist);
    dashRows = dashRows.filter((r) => set.has(r.recipientVendorId));
  }

  // Pre-load the per-form raw rows so each iteration only renders one PDF.
  const necMap = new Map<string, Nec1099Row>();
  const miscMap = new Map<string, Misc1099Row>();
  const kMap = new Map<string, K1099Row>();
  const key = (partnerId: number, vendorId: number): string =>
    `${partnerId}:${vendorId}`;
  if (formType === "NEC") {
    const rs = await nec1099Rows({ year, payerPartnerId });
    for (const r of rs) necMap.set(key(r.payerPartnerId, r.vendorId), r);
  } else if (formType === "MISC") {
    const rs = await misc1099Rows({ year, payerPartnerId });
    for (const r of rs) miscMap.set(key(r.payerPartnerId, r.vendorId), r);
  } else {
    const rs = await k1099Rows({ year, payerPartnerId });
    for (const r of rs) kMap.set(key(r.payerPartnerId, r.vendorId), r);
  }

  // Pull the per-payer 1099 email template overrides up front so we
  // don't refetch the same partner row once per recipient. Falls back
  // to the hardcoded default in send1099RecipientEmail when both
  // fields are null/blank.
  const partnerIds = Array.from(
    new Set(dashRows.map((r) => r.payerPartnerId)),
  );
  const partnerTemplateMap = new Map<
    number,
    { subject: string | null; body: string | null }
  >();
  if (partnerIds.length > 0) {
    const prows = await db
      .select({
        id: partnersTable.id,
        email1099Subject: partnersTable.email1099Subject,
        email1099Body: partnersTable.email1099Body,
      })
      .from(partnersTable)
      .where(inArray(partnersTable.id, partnerIds));
    for (const p of prows)
      partnerTemplateMap.set(p.id, {
        subject: p.email1099Subject,
        body: p.email1099Body,
      });
  }

  // Pull email overrides for every candidate vendor so we don't fan out N
  // queries while iterating.
  const vIds = Array.from(new Set(dashRows.map((r) => r.recipientVendorId)));
  const emailMap = new Map<
    number,
    { contactEmail: string; eDeliveryEmail: string | null }
  >();
  if (vIds.length > 0) {
    const vrows = await db
      .select({
        id: vendorsTable.id,
        contactEmail: vendorsTable.contactEmail,
        eDeliveryEmail: vendorsTable.eDeliveryEmail,
      })
      .from(vendorsTable)
      .where(inArray(vendorsTable.id, vIds));
    for (const v of vrows)
      emailMap.set(v.id, {
        contactEmail: v.contactEmail,
        eDeliveryEmail: v.eDeliveryEmail,
      });
  }

  // Initialise totals + running counters in the job row so the polling
  // client sees "x / N" right away.
  let attempted = 0;
  let delivered = 0;
  let skippedNoConsent = 0;
  const errors: Dashboard1099DeliveryJobError[] = [];
  const totalCount = dashRows.length;
  await db
    .update(dashboard1099DeliveryJobsTable)
    .set({ totalCount, updatedAt: new Date() })
    .where(eq(dashboard1099DeliveryJobsTable.id, job.id));

  const writeProgress = async (): Promise<void> => {
    await db
      .update(dashboard1099DeliveryJobsTable)
      .set({
        attempted,
        delivered,
        skippedNoConsent,
        errorsJson: errors,
        updatedAt: new Date(),
      })
      .where(eq(dashboard1099DeliveryJobsTable.id, job.id));
  };

  const updatedByUserId = job.createdByUserId ?? null;

  for (const row of dashRows) {
    attempted++;
    if (!row.eDeliveryConsent) {
      skippedNoConsent++;
      await writeProgress();
      continue;
    }
    const emailInfo = emailMap.get(row.recipientVendorId);
    const to =
      (emailInfo?.eDeliveryEmail && emailInfo.eDeliveryEmail.trim()) ||
      emailInfo?.contactEmail;
    if (!to) {
      const message = "No email on file for vendor";
      errors.push({
        recipientVendorId: row.recipientVendorId,
        recipientName: row.recipientName,
        formType: row.formType,
        message,
      });
      await upsertDeliveryRow({
        taxYear: row.taxYear,
        formType: row.formType,
        payerPartnerId: row.payerPartnerId,
        recipientVendorId: row.recipientVendorId,
        totalReportable: row.totalReportable,
        status: "error",
        deliveredAt: null,
        deliveryChannel: null,
        notes: message,
        updatedByUserId,
        existingId: row.filingId,
      });
      await writeProgress();
      continue;
    }
    try {
      const k = key(row.payerPartnerId, row.recipientVendorId);
      const pdfBuf = await render1099RowPdf({
        formType: row.formType,
        year,
        necRow: necMap.get(k),
        miscRow: miscMap.get(k),
        kRow: kMap.get(k),
      });
      const tmpl = partnerTemplateMap.get(row.payerPartnerId);
      const sendResult = await send1099RecipientEmail({
        to,
        vendorName: row.recipientName,
        partnerName: row.payerPartnerName,
        taxYear: year,
        formType: row.formType,
        totalReportable: row.totalReportable,
        pdfBuf,
        subjectTemplate: tmpl?.subject ?? null,
        bodyTemplate: tmpl?.body ?? null,
        // Tag the send with the (year, formType, payer, recipient) tuple
        // so the SendGrid event-webhook handler can map an inbound
        // delivered/open/bounce event back to this filing row even when
        // the stored x-message-id lookup misses.
        customArgs: {
          tax1099_year: String(row.taxYear),
          tax1099_form_type: row.formType,
          tax1099_payer_partner_id: String(row.payerPartnerId),
          tax1099_recipient_vendor_id: String(row.recipientVendorId),
        },
      });
      const now = new Date();
      await upsertDeliveryRow({
        taxYear: row.taxYear,
        formType: row.formType,
        payerPartnerId: row.payerPartnerId,
        recipientVendorId: row.recipientVendorId,
        totalReportable: row.totalReportable,
        status: "delivered",
        deliveredAt: now,
        deliveryChannel: "email",
        notes: `Emailed to ${to}`,
        updatedByUserId,
        existingId: row.filingId,
        sendgridMessageId: sendResult.messageId ?? null,
      });
      delivered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          err,
          recipientVendorId: row.recipientVendorId,
          formType: row.formType,
          year,
        },
        "1099 delivery failed",
      );
      errors.push({
        recipientVendorId: row.recipientVendorId,
        recipientName: row.recipientName,
        formType: row.formType,
        message,
      });
      await upsertDeliveryRow({
        taxYear: row.taxYear,
        formType: row.formType,
        payerPartnerId: row.payerPartnerId,
        recipientVendorId: row.recipientVendorId,
        totalReportable: row.totalReportable,
        status: "error",
        deliveredAt: null,
        deliveryChannel: null,
        notes: message.slice(0, 1900),
        updatedByUserId,
        existingId: row.filingId,
      });
    }
    await writeProgress();
  }

  await db
    .update(dashboard1099DeliveryJobsTable)
    .set({
      status: "completed",
      attempted,
      delivered,
      skippedNoConsent,
      errorsJson: errors,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dashboard1099DeliveryJobsTable.id, job.id));
}

/**
 * Server-boot recovery: any `running` or `pending` job at startup time
 * was orphaned by the previous process exiting mid-loop (or before the
 * `setImmediate` dispatch ever fired). Flip both to `failed` so the UI
 * doesn't poll forever on a job nobody is working.
 *
 * The `createdAt < bootTimestamp` guard prevents a startup race: if a
 * fresh enqueue lands while this UPDATE is still in flight, that new
 * row's `createdAt` will be ≥ the timestamp captured by the caller, so
 * it won't be swept into `failed`. The caller (`onListening`) snapshots
 * `new Date()` immediately before invoking this function.
 *
 * We don't try to resume — partially-delivered jobs are idempotent at
 * the filings-row level, but resuming the loop would require de-duping
 * already-emailed recipients, which the current data model doesn't
 * track explicitly.
 */
export async function markStuckDeliveryJobsAsFailed(
  bootTimestamp: Date = new Date(),
): Promise<void> {
  await db
    .update(dashboard1099DeliveryJobsTable)
    .set({
      status: "failed",
      finishedAt: new Date(),
      updatedAt: new Date(),
      lastErrorMessage: "Server restarted while job was queued or running",
    })
    .where(
      and(
        inArray(dashboard1099DeliveryJobsTable.status, [
          "pending",
          "running",
        ]),
        lt(dashboard1099DeliveryJobsTable.createdAt, bootTimestamp),
      ),
    );
}

async function handle1099Deliver(
  req: Request,
  res: Response,
  payerPartnerId: number | undefined,
): Promise<void> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized", code: "auth.not_authenticated" });
    return;
  }
  if (session.role === "vendor") {
    res.status(403).json({ error: "Vendors cannot trigger 1099 delivery.", code: "report.vendor_cannot_trigger_delivery" });
    return;
  }
  const parsed = Deliver1099Body.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_body", error: "Bad body" });
    return;
  }
  const { year, formType, recipientVendorIds } = parsed.data;

  const scope: "admin" | "partner" =
    payerPartnerId === undefined ? "admin" : "partner";

  const [inserted] = await db
    .insert(dashboard1099DeliveryJobsTable)
    .values({
      scope,
      partnerId: payerPartnerId ?? null,
      taxYear: year,
      formType,
      recipientVendorIds: recipientVendorIds ?? null,
      status: "pending",
      totalCount: 0,
      attempted: 0,
      delivered: 0,
      skippedNoConsent: 0,
      errorsJson: [],
      createdByUserId: session.userId ?? null,
    })
    .returning();

  // Kick off the worker without blocking the response. Errors inside
  // `processDeliver1099Job` are caught and recorded on the job row, so
  // a stray rejection here would only happen if the dispatcher itself
  // throws — log and move on.
  setImmediate(() => {
    void processDeliver1099Job(inserted.id).catch((err) => {
      logger.error({ err, jobId: inserted.id }, "1099 delivery dispatch failed");
    });
  });

  res.status(202).json({ jobId: inserted.id, status: "pending" });
}

// Polling endpoint shape — same `errors` payload the synchronous version
// used to return inline, plus job lifecycle fields the UI uses to
// progress-bar and stop polling.
function jobToResponse(job: Dashboard1099DeliveryJob): {
  jobId: number;
  status: string;
  attempted: number;
  delivered: number;
  skippedNoConsent: number;
  totalCount: number;
  errors: Dashboard1099DeliveryJobError[];
  lastErrorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
} {
  return {
    jobId: job.id,
    status: job.status,
    attempted: job.attempted,
    delivered: job.delivered,
    skippedNoConsent: job.skippedNoConsent,
    totalCount: job.totalCount,
    errors: job.errorsJson ?? [],
    lastErrorMessage: job.lastErrorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

async function handle1099DeliverJobStatus(
  req: Request,
  res: Response,
  expectedScope: "admin" | "partner",
  expectedPartnerId: number | undefined,
): Promise<void> {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res
      .status(400)
      .json({ error: "Bad jobId", code: "report.invalid_job_id" });
    return;
  }
  const [job] = await db
    .select()
    .from(dashboard1099DeliveryJobsTable)
    .where(eq(dashboard1099DeliveryJobsTable.id, jobId));
  if (!job) {
    res
      .status(404)
      .json({ error: "Job not found", code: "report.job_not_found" });
    return;
  }
  // Cross-scope leak guard: a partner polling their own scope cannot
  // see admin or other-partner jobs even if they happen to know the id.
  if (job.scope !== expectedScope) {
    res.status(404).json({ error: "Job not found", code: "report.job_not_found" });
    return;
  }
  if (
    expectedScope === "partner" &&
    expectedPartnerId !== undefined &&
    job.partnerId !== expectedPartnerId
  ) {
    res.status(404).json({ error: "Job not found", code: "report.job_not_found" });
    return;
  }
  res.json(jobToResponse(job));
}

// POST /reports/partner/:partnerId/1099-deliver
router.post(
  "/reports/partner/:partnerId/1099-deliver",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    await handle1099Deliver(req, res, partnerId);
  },
);

// GET /reports/partner/:partnerId/1099-deliver/jobs/:jobId
router.get(
  "/reports/partner/:partnerId/1099-deliver/jobs/:jobId",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    await handle1099DeliverJobStatus(req, res, "partner", partnerId);
  },
);

// POST /reports/admin/1099-deliver
router.post(
  "/reports/admin/1099-deliver",
  requireAdmin,
  async (req, res): Promise<void> => {
    await handle1099Deliver(req, res, undefined);
  },
);

// GET /reports/admin/1099-deliver/jobs/:jobId
router.get(
  "/reports/admin/1099-deliver/jobs/:jobId",
  requireAdmin,
  async (req, res): Promise<void> => {
    await handle1099DeliverJobStatus(req, res, "admin", undefined);
  },
);

// ──────────────────────────────────────────────────────────────────
// Scheduled 1099-K monthly breakout email — opt-in settings (Task #806)
// ──────────────────────────────────────────────────────────────────
//
// AP staff opt the admin or per-partner scope into a recurring email
// that attaches the 1099-K monthly breakout PDF/CSV for the prior tax
// year. The actual fan-out is handled by the
// `dashboard-1099-monthly-email` worker; these endpoints are just the
// CRUD surface for the settings row.
//
// RBAC mirrors the dashboard endpoints:
//   - admin scope: admin only
//   - partner scope: admin or partner-self

const Dashboard1099EmailFormatEnum = z.enum(["pdf", "csv"]);

const Dashboard1099EmailSettingsBody = z.object({
  enabled: z.boolean(),
  formats: z.array(Dashboard1099EmailFormatEnum).min(1).max(2),
  recipients: z
    .array(z.string().trim().min(1).max(254))
    .max(100),
  taxYearOverride: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .nullable()
    .optional(),
});

interface Dashboard1099EmailSettingsResponse {
  scope: "admin" | "partner";
  partnerId: number | null;
  enabled: boolean;
  formats: Array<"pdf" | "csv">;
  recipients: string[];
  taxYearOverride: number | null;
  updatedAt: string | null;
  lastSend: {
    sentAt: string;
    cadence: string;
    periodLabel: string;
    taxYear: number;
    recipients: string[];
    formats: Array<"pdf" | "csv">;
    failureMessage: string | null;
  } | null;
}

function emptySettingsResponse(
  scope: "admin" | "partner",
  partnerId: number | null,
): Dashboard1099EmailSettingsResponse {
  return {
    scope,
    partnerId,
    enabled: false,
    formats: ["pdf"],
    recipients: [],
    taxYearOverride: null,
    updatedAt: null,
    lastSend: null,
  };
}

async function loadDashboard1099EmailSettings(
  scope: "admin" | "partner",
  partnerId: number | null,
): Promise<Dashboard1099EmailSettingsResponse> {
  const baseWhere =
    scope === "admin"
      ? eq(dashboard1099EmailSettingsTable.scope, "admin")
      : and(
          eq(dashboard1099EmailSettingsTable.scope, "partner"),
          eq(dashboard1099EmailSettingsTable.partnerId, partnerId!),
        );
  const rows = await db
    .select()
    .from(dashboard1099EmailSettingsTable)
    .where(baseWhere)
    .limit(1);
  const row = rows[0];

  // Look up the most recent send for this scope so the UI can show
  // "last sent on …" without a second round-trip.
  const logWhere =
    scope === "admin"
      ? and(
          eq(dashboard1099EmailLogTable.scope, "admin"),
          isNull(dashboard1099EmailLogTable.partnerId),
        )
      : and(
          eq(dashboard1099EmailLogTable.scope, "partner"),
          eq(dashboard1099EmailLogTable.partnerId, partnerId!),
        );
  const lastRows = await db
    .select()
    .from(dashboard1099EmailLogTable)
    .where(logWhere)
    .orderBy(desc(dashboard1099EmailLogTable.sentAt))
    .limit(1);
  const last = lastRows[0];
  const lastSend = last
    ? {
        sentAt: last.sentAt.toISOString(),
        cadence: last.cadence,
        periodLabel: last.periodLabel,
        taxYear: last.taxYear,
        recipients: last.recipientEmailsCsv
          ? last.recipientEmailsCsv.split(",").filter((s) => s)
          : [],
        formats: (last.formatsCsv
          ? last.formatsCsv.split(",")
          : []
        ).filter((s): s is "pdf" | "csv" => s === "pdf" || s === "csv"),
        failureMessage: last.failureMessage,
      }
    : null;

  if (!row) return { ...emptySettingsResponse(scope, partnerId), lastSend };

  const formats = (
    row.formats ? row.formats.split(",") : []
  ).filter((s): s is "pdf" | "csv" => s === "pdf" || s === "csv");
  const recipients = row.recipientEmails
    ? row.recipientEmails
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s)
    : [];
  return {
    scope,
    partnerId,
    enabled: row.enabled,
    formats: formats.length > 0 ? formats : ["pdf"],
    recipients,
    taxYearOverride: row.taxYearOverride,
    updatedAt: row.updatedAt.toISOString(),
    lastSend,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRecipients(raw: string[]): {
  ok: true;
  emails: string[];
} | {
  ok: false;
  invalid: string;
} {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.trim();
    if (!t) continue;
    if (!EMAIL_PATTERN.test(t)) return { ok: false, invalid: t };
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return { ok: true, emails: out };
}

async function handlePutDashboard1099EmailSettings(
  req: Request,
  res: Response,
  scope: "admin" | "partner",
  partnerId: number | null,
): Promise<void> {
  const session = getSession(req);
  if (!session) {
    res
      .status(401)
      .json({ error: "Unauthorized", code: "auth.not_authenticated" });
    return;
  }
  const parsed = Dashboard1099EmailSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, {
      code: "validation.invalid_body",
      error: "Bad body",
    });
    return;
  }
  const norm = normalizeRecipients(parsed.data.recipients);
  if (!norm.ok) {
    res.status(400).json({
      error: `Invalid email address: ${norm.invalid}`,
      code: "report.dashboard1099_email_invalid_recipient",
      invalid: norm.invalid,
    });
    return;
  }
  if (parsed.data.enabled && norm.emails.length === 0) {
    res.status(400).json({
      error: "Add at least one recipient before enabling the schedule.",
      code: "report.dashboard1099_email_recipients_required",
    });
    return;
  }
  const formats = Array.from(new Set(parsed.data.formats));

  const existingRows = await db
    .select({ id: dashboard1099EmailSettingsTable.id })
    .from(dashboard1099EmailSettingsTable)
    .where(
      scope === "admin"
        ? eq(dashboard1099EmailSettingsTable.scope, "admin")
        : and(
            eq(dashboard1099EmailSettingsTable.scope, "partner"),
            eq(dashboard1099EmailSettingsTable.partnerId, partnerId!),
          ),
    )
    .limit(1);

  const now = new Date();
  const values = {
    enabled: parsed.data.enabled,
    formats: formats.join(","),
    recipientEmails: norm.emails.join("\n"),
    taxYearOverride: parsed.data.taxYearOverride ?? null,
    updatedByUserId: session.userId ?? null,
    updatedAt: now,
  };

  if (existingRows.length > 0) {
    await db
      .update(dashboard1099EmailSettingsTable)
      .set(values)
      .where(eq(dashboard1099EmailSettingsTable.id, existingRows[0]!.id));
  } else {
    await db.insert(dashboard1099EmailSettingsTable).values({
      scope,
      partnerId,
      ...values,
      createdAt: now,
    });
  }
  const out = await loadDashboard1099EmailSettings(scope, partnerId);
  res.json(out);
}

// GET /reports/admin/1099-dashboard/email-settings
router.get(
  "/reports/admin/1099-dashboard/email-settings",
  requireAdmin,
  async (_req, res): Promise<void> => {
    res.json(await loadDashboard1099EmailSettings("admin", null));
  },
);

// PUT /reports/admin/1099-dashboard/email-settings
router.put(
  "/reports/admin/1099-dashboard/email-settings",
  requireAdmin,
  async (req, res): Promise<void> => {
    await handlePutDashboard1099EmailSettings(req, res, "admin", null);
  },
);

// GET /reports/partner/:partnerId/1099-dashboard/email-settings
router.get(
  "/reports/partner/:partnerId/1099-dashboard/email-settings",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res
        .status(400)
        .json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    res.json(await loadDashboard1099EmailSettings("partner", partnerId));
  },
);

// PUT /reports/partner/:partnerId/1099-dashboard/email-settings
router.put(
  "/reports/partner/:partnerId/1099-dashboard/email-settings",
  async (req, res): Promise<void> => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res
        .status(400)
        .json({ error: "Bad partnerId", code: "partner.invalid_id" });
      return;
    }
    if (!rbacPartner(req, res, partnerId)) return;
    await handlePutDashboard1099EmailSettings(
      req,
      res,
      "partner",
      partnerId,
    );
  },
);

// Pub 1220 corrected-return indicators only make sense on a row that has
// already been transmitted to the IRS (or further along the lifecycle).
// Applying G/C to a pending/queued/error row would be a no-op at best
// and a misleading audit trail at worst, so we mirror the UI's
// FILED_STATUSES gate on the server.
const FILED_LIKE_STATUSES = new Set([
  "filed",
  "accepted",
  "rejected",
  "delivered",
]);

// Subset of FILED_LIKE_STATUSES that imply the row was actually
// transmitted to the IRS (not merely "recipient copy delivered").
// Snapshot capture for the Pub 1220 §F.5 two-step ("C") back-out
// record is gated on this stricter set: capturing on plain delivery
// would freeze a snapshot that may not match what we eventually file
// if the payee data changes between delivery and the IRS submission.
const FILED_TO_IRS_STATUSES = new Set(["filed", "accepted", "rejected"]);

// Insert one row into `tax_1099_correction_audit_log` capturing a
// transition of `corrected_status`. Called from POST/PATCH after the
// filing row has been written. Failure must NOT block the caller — the
// dashboard mutation succeeded; we just lose visibility into one
// transition. Mirrors the swallow-and-log pattern used by `recordExport`.
async function recordCorrectionAudit(args: {
  req: Request;
  filingId: number;
  taxYear: number;
  formType: string;
  payerPartnerId: number;
  recipientVendorId: number;
  fromStatus: string;
  toStatus: string;
}): Promise<void> {
  try {
    const session = getSession(args.req);
    const ip =
      (args.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ||
      args.req.socket.remoteAddress ||
      null;
    const ua =
      (args.req.headers["user-agent"] as string | undefined) ?? null;
    await db.insert(tax1099CorrectionAuditLogTable).values({
      filingId: args.filingId,
      taxYear: args.taxYear,
      formType: args.formType,
      payerPartnerId: args.payerPartnerId,
      recipientVendorId: args.recipientVendorId,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
      actorUserId: session?.userId ?? null,
      actorRole: session?.role ?? "anonymous",
      actorIp: ip,
      actorUserAgent: ua,
    });
  } catch (err) {
    logger.error(
      { err, filingId: args.filingId },
      "Failed to record 1099 correction-status audit row",
    );
  }
}

// POST /reports/1099-filing-status — upsert for a (partner, vendor, form, year).
const UpsertFilingBody = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  formType: z.enum(TAX_1099_FORM_TYPES),
  payerPartnerId: z.number().int().positive(),
  recipientVendorId: z.number().int().positive(),
  status: z.enum(TAX_1099_FILING_STATUSES).optional(),
  filingMethod: z.enum(TAX_1099_FILING_METHODS).optional(),
  // Pub 1220 corrected-return indicator. "g" = one-step, "c" = two-step,
  // "none" (default) = original.
  correctedStatus: z.enum(TAX_1099_CORRECTION_STATUSES).optional(),
  externalReference: z.string().max(120).optional().nullable(),
  filedAt: z.string().datetime().optional().nullable(),
  deliveredAt: z.string().datetime().optional().nullable(),
  deliveryChannel: z.string().max(40).optional().nullable(),
  totalReportable: z.string().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

router.post("/reports/1099-filing-status", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized", code: "auth.not_authenticated" });
    return;
  }
  const parsed = UpsertFilingBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_body", error: "Bad body" });
    return;
  }
  const body = parsed.data;
  // Partner users may only modify their own partner's filings.
  if (
    session.role === "partner" &&
    session.partnerId !== body.payerPartnerId
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "vendor") {
    res.status(403).json({ error: "Vendors cannot modify filing status.", code: "report.vendor_cannot_modify_filing" });
    return;
  }

  const existing = await db
    .select()
    .from(tax1099FilingsTable)
    .where(
      and(
        eq(tax1099FilingsTable.taxYear, body.taxYear),
        eq(tax1099FilingsTable.formType, body.formType),
        eq(tax1099FilingsTable.payerPartnerId, body.payerPartnerId),
        eq(tax1099FilingsTable.recipientVendorId, body.recipientVendorId),
      ),
    )
    .limit(1);

  // Guard correctedStatus: only allow G/C when the row's effective status
  // (after this upsert) would be filed-or-later. This mirrors the UI's
  // FILED_STATUSES gate so direct API callers can't mark a still-pending
  // row as corrected.
  const effectiveStatus =
    body.status ?? existing[0]?.status ?? "pending";
  if (
    body.correctedStatus &&
    body.correctedStatus !== "none" &&
    !FILED_LIKE_STATUSES.has(effectiveStatus)
  ) {
    res.status(409).json({
      error: "correctedStatus G/C requires the row to be filed/accepted/rejected/delivered.", code: "report.invalid_corrected_status",
    });
    return;
  }

  const now = new Date();
  // Snapshot the wire-level B-record payee fields the first time the
  // row reaches a filed-like state, so that a future Pub 1220 §F.5
  // two-step ("C") correction can auto-emit the zero-dollar back-out
  // record. We never overwrite an existing snapshot — that would
  // defeat the whole point of capturing the *original* identifiers.
  let snapshot: FirePayeeSnapshot | null | undefined = undefined;
  if (
    FILED_TO_IRS_STATUSES.has(effectiveStatus) &&
    !existing[0]?.originalPayeeSnapshot
  ) {
    snapshot = await captureOriginalPayeeSnapshot({
      formType: body.formType,
      taxYear: body.taxYear,
      payerPartnerId: body.payerPartnerId,
      recipientVendorId: body.recipientVendorId,
    });
  }
  const patch: Record<string, unknown> = {
    status: body.status ?? "pending",
    filingMethod: body.filingMethod ?? "manual",
    correctedStatus: body.correctedStatus ?? "none",
    externalReference: body.externalReference ?? null,
    filedAt: body.filedAt ? new Date(body.filedAt) : null,
    deliveredAt: body.deliveredAt ? new Date(body.deliveredAt) : null,
    deliveryChannel: body.deliveryChannel ?? null,
    totalAmount: body.totalReportable ?? "0",
    notes: body.notes ?? null,
    updatedAt: now,
    updatedByUserId: session.userId ?? null,
  };
  if (snapshot) patch.originalPayeeSnapshot = snapshot;

  if (existing[0]) {
    const [row] = await db
      .update(tax1099FilingsTable)
      .set(patch)
      .where(eq(tax1099FilingsTable.id, existing[0].id))
      .returning();
    const fromCs = (existing[0].correctedStatus ?? "none") as string;
    const toCs = patch.correctedStatus as string;
    if (row && fromCs !== toCs) {
      await recordCorrectionAudit({
        req,
        filingId: row.id,
        taxYear: row.taxYear,
        formType: row.formType,
        payerPartnerId: row.payerPartnerId,
        recipientVendorId: row.recipientVendorId,
        fromStatus: fromCs,
        toStatus: toCs,
      });
    }
    res.json({ row });
    return;
  }
  const [row] = await db
    .insert(tax1099FilingsTable)
    .values({
      taxYear: body.taxYear,
      formType: body.formType,
      payerPartnerId: body.payerPartnerId,
      recipientVendorId: body.recipientVendorId,
      ...patch,
    })
    .returning();
  // First-time insert: only audit when the row was created with a non-default
  // corrected indicator (creating a fresh "none" row is not a transition).
  if (row && patch.correctedStatus !== "none") {
    await recordCorrectionAudit({
      req,
      filingId: row.id,
      taxYear: row.taxYear,
      formType: row.formType,
      payerPartnerId: row.payerPartnerId,
      recipientVendorId: row.recipientVendorId,
      fromStatus: "none",
      toStatus: patch.correctedStatus as string,
    });
  }
  res.status(201).json({ row });
});

// PATCH /reports/1099-filing-status/:id — partial update of a filing row.
const PatchFilingBody = UpsertFilingBody.partial().omit({
  taxYear: true,
  formType: true,
  payerPartnerId: true,
  recipientVendorId: true,
});

router.patch(
  "/reports/1099-filing-status/:id",
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id", code: "validation.invalid_id" });
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Unauthorized", code: "auth.not_authenticated" });
      return;
    }
    const parsed = PatchFilingBody.safeParse(req.body);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_body", error: "Bad body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(tax1099FilingsTable)
      .where(eq(tax1099FilingsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found", code: "common.not_found" });
      return;
    }
    if (
      session.role === "partner" &&
      session.partnerId !== existing.payerPartnerId
    ) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    if (session.role === "vendor") {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const b = parsed.data;
    // Same correctedStatus guard as POST: G/C is only meaningful once
    // the row is in a filed/accepted/rejected/delivered state. Allow
    // the caller to flip it back to "none" from any state.
    const effectiveStatus = b.status ?? existing.status;
    if (
      b.correctedStatus !== undefined &&
      b.correctedStatus !== "none" &&
      !FILED_LIKE_STATUSES.has(effectiveStatus)
    ) {
      res.status(409).json({
        error: "correctedStatus G/C requires the row to be filed/accepted/rejected/delivered.", code: "report.invalid_corrected_status",
      });
      return;
    }
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedByUserId: session.userId ?? null,
    };
    if (b.status !== undefined) patch.status = b.status;
    if (b.filingMethod !== undefined) patch.filingMethod = b.filingMethod;
    if (b.correctedStatus !== undefined)
      patch.correctedStatus = b.correctedStatus;
    if (b.externalReference !== undefined)
      patch.externalReference = b.externalReference;
    if (b.filedAt !== undefined)
      patch.filedAt = b.filedAt ? new Date(b.filedAt) : null;
    if (b.deliveredAt !== undefined)
      patch.deliveredAt = b.deliveredAt ? new Date(b.deliveredAt) : null;
    if (b.deliveryChannel !== undefined)
      patch.deliveryChannel = b.deliveryChannel;
    if (b.totalReportable !== undefined)
      patch.totalAmount = b.totalReportable;
    if (b.notes !== undefined) patch.notes = b.notes;
    // Snapshot the original payee identifiers the first time the row
    // hits a filed-like status. Required for Pub 1220 §F.5 two-step
    // ("C") corrections to auto-emit the zero-dollar back-out record.
    if (
      FILED_TO_IRS_STATUSES.has(effectiveStatus) &&
      !existing.originalPayeeSnapshot
    ) {
      const snapshot = await captureOriginalPayeeSnapshot({
        formType: existing.formType,
        taxYear: existing.taxYear,
        payerPartnerId: existing.payerPartnerId,
        recipientVendorId: existing.recipientVendorId,
      });
      if (snapshot) patch.originalPayeeSnapshot = snapshot;
    }
    const [row] = await db
      .update(tax1099FilingsTable)
      .set(patch)
      .where(eq(tax1099FilingsTable.id, id))
      .returning();
    if (
      row &&
      b.correctedStatus !== undefined &&
      (existing.correctedStatus ?? "none") !== b.correctedStatus
    ) {
      await recordCorrectionAudit({
        req,
        filingId: row.id,
        taxYear: row.taxYear,
        formType: row.formType,
        payerPartnerId: row.payerPartnerId,
        recipientVendorId: row.recipientVendorId,
        fromStatus: (existing.correctedStatus ?? "none") as string,
        toStatus: b.correctedStatus,
      });
    }
    res.json({ row });
  },
);

// ──────────────────────────────────────────────────────────────────
// QB / OA EXPORT BUNDLES
// ──────────────────────────────────────────────────────────────────

interface ExportBundleData {
  invoices: IifInvoice[];
  lines: IifInvoiceLine[];
  partners: IifPartner[];
  vendors: IifVendor[];
  vendorName: string;
  /** Resolver pre-loaded with overrides for this vendor + relevant partners. */
  resolver: import("../lib/reports/qb-mapping").QbAccountResolver;
}

async function gatherExportData(
  vendorId: number,
  period: Period,
): Promise<ExportBundleData> {
  const STATUSES = ["open", "sent", "paid", "overdue"] as const;

  const invs = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.periodEnd,
      dueDate: invoicesTable.dueDate,
      total: invoicesTable.total,
      subtotal: invoicesTable.subtotal,
      taxTotal: invoicesTable.taxTotal,
      memo: invoicesTable.notes,
      partnerId: invoicesTable.partnerId,
      partnerName: partnersTable.name,
      partnerAddress: partnersTable.billingAddress,
      partnerEmail: partnersTable.contactEmail,
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      vendorEmail: vendorsTable.contactEmail,
      vendorAddress: vendorsTable.billingAddress,
      vendorFedTaxId: vendorsTable.federalTaxId,
    })
    .from(invoicesTable)
    .innerJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .innerJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .where(
      and(
        eq(invoicesTable.vendorId, vendorId),
        inArray(invoicesTable.status, [...STATUSES]),
        gte(invoicesTable.periodStart, period.start),
        lt(invoicesTable.periodStart, period.end),
      ),
    );

  if (invs.length === 0) {
    const overrides = await loadAccountMapOverrides({ vendorId });
    return {
      invoices: [],
      lines: [],
      partners: [],
      vendors: [],
      vendorName: `Vendor ${vendorId}`,
      resolver: buildResolver(overrides),
    };
  }

  const invoiceNumbers = invs.map((i) => i.invoiceNumber);
  const linesRaw = await db
    .select({
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoiceLinesTable.description,
      amount: invoiceLinesTable.amount,
      taxAmount: invoiceLinesTable.taxAmount,
      lineType: invoiceLinesTable.lineType,
      // Carries the 1099 box classification through into the IIF/QBO/OA
      // exports so the accountant sees the same value on the rendered
      // invoice and on the imported transaction.
      incomeCategory: invoiceLinesTable.incomeCategory,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .where(inArray(invoicesTable.invoiceNumber, invoiceNumbers));

  // De-dupe partners/vendors by id.
  const partnerMap = new Map<number, IifPartner>();
  const vendorMap = new Map<number, IifVendor>();
  const invoices: IifInvoice[] = invs.map((i) => {
    if (!partnerMap.has(i.partnerId)) {
      partnerMap.set(i.partnerId, {
        name: i.partnerName,
        email: i.partnerEmail,
        address: i.partnerAddress,
      });
    }
    if (!vendorMap.has(i.vendorId)) {
      vendorMap.set(i.vendorId, {
        name: i.vendorName,
        email: i.vendorEmail,
        address: i.vendorAddress,
        federalTaxId: i.vendorFedTaxId,
      });
    }
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      total: i.total,
      subtotal: i.subtotal,
      taxTotal: i.taxTotal,
      memo: i.memo,
      partnerName: i.partnerName,
      vendorName: i.vendorName,
      partnerId: i.partnerId,
      vendorId: i.vendorId,
    };
  });

  const partnerIds = Array.from(partnerMap.keys());
  const overrides = await loadAccountMapOverrides({ vendorId, partnerIds });

  return {
    invoices,
    lines: linesRaw,
    partners: Array.from(partnerMap.values()),
    vendors: Array.from(vendorMap.values()),
    vendorName: invs[0].vendorName,
    resolver: buildResolver(overrides),
  };
}

// GET /reports/vendor/:vendorId/quickbooks-export-preview?format=iif|zip
//
// Returns a JSON spot-check of what the IIF/QBO export will contain,
// without producing any file. Used by the UI to show a confirmation
// dialog before the actual download runs (mirroring the CSV-import
// preview that protects accidental imports). Read-only; not audited
// (only successful downloads end up in the export audit log).
router.get(
  "/reports/vendor/:vendorId/quickbooks-export-preview",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const fmtRaw = (req.query.format as string) || "iif";
    if (fmtRaw !== "iif" && fmtRaw !== "zip") {
      res.status(400).json({ error: "format must be iif or zip", code: "report.invalid_format" });
      return;
    }
    const data = await gatherExportData(vendorId, period);

    // Walk every invoice line + the AR debit + the per-invoice tax credit
    // and bucket the dollars by resolved QB account. Mirrors what
    // renderIif() / invoicesCsv() will write so the preview totals match
    // the file the user is about to download. We also remember which
    // "kind" each account is so the UI can group income vs. AR vs. tax.
    type AccountKind = "income" | "ar" | "tax" | "other";
    interface ContributingInvoice {
      id: number | null;
      invoiceNumber: string;
      amount: number;
    }
    interface AccountTotal {
      name: string;
      number: string;
      qbType: string;
      kind: AccountKind;
      rowCount: number;
      amount: number;
      /** Per-invoice breakdown of which invoices contributed to this
       *  account total. Used by the preview UI to let the accountant
       *  drill from a totals row into a single invoice. */
      invoices: ContributingInvoice[];
    }
    const acctMap = new Map<string, AccountTotal>();
    function bump(
      acct: { name: string; number: string; qbType: string },
      kind: AccountKind,
      amount: number,
      contributor: { id: number | null; invoiceNumber: string },
    ): void {
      if (amount === 0) return;
      const key = `${kind}|${acct.name}`;
      const cur = acctMap.get(key);
      if (cur) {
        cur.rowCount += 1;
        cur.amount += amount;
        cur.invoices.push({
          id: contributor.id,
          invoiceNumber: contributor.invoiceNumber,
          amount,
        });
      } else {
        acctMap.set(key, {
          name: acct.name,
          number: acct.number,
          qbType: acct.qbType,
          kind,
          rowCount: 1,
          amount,
          invoices: [
            {
              id: contributor.id,
              invoiceNumber: contributor.invoiceNumber,
              amount,
            },
          ],
        });
      }
    }

    const linesByInv = new Map<string, IifInvoiceLine[]>();
    for (const l of data.lines) {
      const arr = linesByInv.get(l.invoiceNumber) ?? [];
      arr.push(l);
      linesByInv.set(l.invoiceNumber, arr);
    }

    let totalAmount = 0;
    let totalSubtotal = 0;
    let totalTax = 0;
    let invoicesWithLines = 0;
    for (const inv of data.invoices) {
      const total = Number(inv.total);
      totalAmount += total;
      totalSubtotal += Number(inv.subtotal);
      totalTax += Number(inv.taxTotal);
      // IIF skips zero-amount transactions entirely (QB rejects them);
      // matching that here keeps preview totals identical to the file.
      if (total === 0) continue;
      const scope = {
        vendorId: inv.vendorId ?? null,
        partnerId: inv.partnerId ?? null,
      };
      const contributor = {
        id: inv.id ?? null,
        invoiceNumber: inv.invoiceNumber,
      };
      // AR debit equal to the invoice total.
      bump(data.resolver(LINE_TYPE_AR, scope), "ar", total, contributor);
      // Income credits per line.
      const ls = linesByInv.get(inv.invoiceNumber) ?? [];
      if (ls.length > 0) invoicesWithLines += 1;
      let lineSum = 0;
      let taxSum = 0;
      for (const l of ls) {
        const amt = Number(l.amount);
        taxSum += Number(l.taxAmount);
        if (amt !== 0) {
          lineSum += amt;
          bump(data.resolver(l.lineType, scope), "income", amt, contributor);
        }
      }
      if (taxSum !== 0) {
        bump(
          data.resolver(LINE_TYPE_TAX_PAYABLE, scope),
          "tax",
          taxSum,
          contributor,
        );
      }
      if (fmtRaw === "zip" && ls.length === 0) {
        // QBO CSV fallback: when an invoice has no lines, qbo-csv.ts
        // emits one row for the full invoice total (`inv.total`, gross
        // of tax) charged to the "other" account, with the per-row
        // tax column carrying `inv.taxTotal`. Mirror the same total
        // here. `taxSum` is always 0 in this branch (no lines → no
        // line-level tax), so subtracting it is a no-op kept for
        // symmetry with the IIF branch.
        const otherAmt = Number(inv.total) - taxSum;
        if (otherAmt !== 0) {
          bump(data.resolver("other", scope), "other", otherAmt, contributor);
        }
      } else if (fmtRaw === "iif") {
        // IIF balance check: if line + tax sums don't add up to the total
        // (rounding pennies, missing lines), an extra SPL posts the drift
        // to the "other" account so the txn balances. Mirror that here.
        const drift = +(total - (lineSum + taxSum)).toFixed(2);
        if (drift !== 0) {
          bump(data.resolver("other", scope), "other", drift, contributor);
        }
      }
    }

    const accounts = Array.from(acctMap.values())
      // Stable order: AR first, then income (largest first), then tax,
      // then any "other" fallback (rounding/no-line) at the bottom.
      .sort((a, b) => {
        const order = { ar: 0, income: 1, tax: 2, other: 3 } as const;
        if (order[a.kind] !== order[b.kind]) {
          return order[a.kind] - order[b.kind];
        }
        return Math.abs(b.amount) - Math.abs(a.amount);
      })
      .map((a) => ({
        name: a.name,
        number: a.number,
        qbType: a.qbType,
        kind: a.kind,
        rowCount: a.rowCount,
        amount: a.amount.toFixed(2),
        // De-dupe contributing invoices by number so the UI shows each
        // invoice once even when multiple lines on the same invoice
        // post to the same account. Sum each invoice's contributions
        // so the listed amounts add up to the account total.
        invoices: Array.from(
          a.invoices
            .reduce<Map<string, ContributingInvoice>>((acc, c) => {
              const cur = acc.get(c.invoiceNumber);
              if (cur) {
                cur.amount += c.amount;
              } else {
                acc.set(c.invoiceNumber, { ...c });
              }
              return acc;
            }, new Map())
            .values(),
        )
          .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
          .map((c) => ({
            id: c.id,
            invoiceNumber: c.invoiceNumber,
            amount: c.amount.toFixed(2),
          })),
      }));

    // Sample of the first invoices, sorted by date so the preview shows
    // the chronologically earliest rows (most useful for catching an
    // off-by-one period boundary).
    const SAMPLE_SIZE = 10;
    const sortedInvoices = [...data.invoices].sort(
      (a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime(),
    );
    const sampleInvoices = sortedInvoices.slice(0, SAMPLE_SIZE).map((inv) => ({
      id: inv.id ?? null,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate.toISOString(),
      partnerName: inv.partnerName,
      lineCount: (linesByInv.get(inv.invoiceNumber) ?? []).length,
      subtotal: Number(inv.subtotal).toFixed(2),
      taxTotal: Number(inv.taxTotal).toFixed(2),
      total: Number(inv.total).toFixed(2),
    }));

    res.json({
      format: fmtRaw,
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
        display: formatPeriod(period),
      },
      vendorName: data.vendorName,
      totals: {
        invoices: data.invoices.length,
        invoicesWithLines,
        customers: data.partners.length,
        vendors: data.vendors.length,
        subtotal: totalSubtotal.toFixed(2),
        taxTotal: totalTax.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
      },
      accounts,
      sampleInvoices,
      sampleInvoicesShown: sampleInvoices.length,
      sampleInvoicesTotal: data.invoices.length,
    });
  },
);

// GET /reports/vendor/:vendorId/quickbooks-export-summary
//
// Lightweight running-total endpoint used by the Reports page to show
// "N invoices · $X" inline next to the period selector, so users can
// pick the right range up front without opening the full preview
// dialog. Returns just an aggregate count + summed total via a single
// SQL query — much cheaper than the preview endpoint, which loads
// every invoice line and walks the QB account resolver.
//
// Mirrors the status filter and period bounds of `gatherExportData`
// so the inline counts match what the actual export will contain.
router.get(
  "/reports/vendor/:vendorId/quickbooks-export-summary",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const STATUSES = ["open", "sent", "paid", "overdue"] as const;
    const [row] = await db
      .select({
        invoiceCount: sql<number>`count(*)::int`,
        totalAmount: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)::numeric(14,2)`,
      })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.vendorId, vendorId),
          inArray(invoicesTable.status, [...STATUSES]),
          gte(invoicesTable.periodStart, period.start),
          lt(invoicesTable.periodStart, period.end),
        ),
      );
    res.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
        display: formatPeriod(period),
      },
      invoiceCount: row?.invoiceCount ?? 0,
      totalAmount: row?.totalAmount ?? "0.00",
    });
  },
);

// GET /reports/vendor/:vendorId/accounting-export-summary
router.get(
  "/reports/vendor/:vendorId/accounting-export-summary",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const summary = await accountingExportSummary({ vendorId, period });
    res.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
        display: formatPeriod(period),
      },
      ...summary,
    });
  },
);

// GET /reports/vendor/:vendorId/line-detail-export?format=csv
router.get(
  "/reports/vendor/:vendorId/line-detail-export",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const fmt = parseFormat(z.enum(["json", "csv"]), req.query.format, "csv");
    const rows = await lineDetailRows({ vendorId, period });
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    if (fmt === "json") {
      res.json({ rows, period: formatPeriod(period) });
      return;
    }
    const csv = lineDetailToCsv(rows);
    await sendBufferAndAudit(req, res, {
      buffer: Buffer.from(csv, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      filename: csvFilename([
        "line-detail",
        `vendor-${vendorId}`,
        period.label.replace(/\s+/g, "_"),
      ]),
      reportKind: "vendor.lineDetail",
      format: "csv",
      scope,
      rowCount: rows.length,
    });
  },
);

// GET /reports/vendor/:vendorId/quickbooks-export?format=iif|zip
router.get(
  "/reports/vendor/:vendorId/quickbooks-export",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const fmt = (req.query.format as string) || "iif";
    const data = await gatherExportData(vendorId, period);
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    if (fmt === "iif") {
      const iif = renderIif({ ...data, resolver: data.resolver });
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(iif, "utf-8"),
        contentType: "application/octet-stream",
        filename: csvFilename(["quickbooks", `vendor-${vendorId}`, period.label], "iif"),
        reportKind: "vendor.quickbooksExport",
        format: "iif",
        scope,
        rowCount: data.invoices.length,
      });
      return;
    }
    if (fmt === "zip") {
      const zip = await buildZip([
        { name: "customers.csv", content: customersCsv(data.partners) },
        { name: "vendors.csv", content: vendorsCsv(data.vendors) },
        { name: "invoices.csv", content: invoicesCsv(data.invoices, data.lines, data.resolver) },
        { name: "README.txt", content: readmeQbo(formatPeriod(period), data.vendorName) },
      ]);
      await sendBufferAndAudit(req, res, {
        buffer: zip,
        contentType: "application/zip",
        filename: csvFilename(["quickbooks", `vendor-${vendorId}`, period.label], "zip"),
        reportKind: "vendor.quickbooksExport",
        format: "qbo_zip",
        scope,
        rowCount: data.invoices.length,
      });
      return;
    }
    res.status(400).json({ error: "format must be iif or zip", code: "report.invalid_format" });
  },
);

// GET /reports/vendor/:vendorId/openaccountant-export
router.get(
  "/reports/vendor/:vendorId/openaccountant-export",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const period = parsePeriodOrError(req, res);
    if (!period) return;
    const data = await gatherExportData(vendorId, period);
    const zip = await buildZip([
      { name: "customers.csv", content: oaCustomersCsv(data.partners) },
      { name: "vendors.csv", content: oaVendorsCsv(data.vendors) },
      { name: "invoices.csv", content: oaInvoicesCsv(data.invoices, data.lines) },
      { name: "README.txt", content: readmeOa(formatPeriod(period), data.vendorName) },
    ]);
    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };
    await sendBufferAndAudit(req, res, {
      buffer: zip,
      contentType: "application/zip",
      filename: csvFilename(["openaccountant", `vendor-${vendorId}`, period.label], "zip"),
      reportKind: "vendor.openaccountantExport",
      format: "oa_zip",
      scope,
      rowCount: data.invoices.length,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// LIVE API PUSHES (QBO / OpenAccountant)
// ──────────────────────────────────────────────────────────────────

/** Decrypt a QBO connection's access token, refreshing it first if it
 *  is within 60s of expiry. Returns null if the connection is missing
 *  or the refresh fails (caller should 4xx). */
async function getFreshQboAccessToken(
  vendorId: number,
): Promise<
  | { accessToken: string; realmId: string; connectionId: number }
  | { error: string; status: number }
> {
  const conn = await getConnection(vendorId, "qbo");
  if (!conn) {
    return {
      error: "Vendor is not connected to QuickBooks Online.",
      status: 412,
    };
  }
  if (conn.status !== "active") {
    return {
      error: `QuickBooks connection is ${conn.status}; reconnect to continue.`,
      status: 412,
    };
  }
  if (!conn.realmId) {
    return { error: "QuickBooks connection is missing realmId.", status: 500 };
  }
  if (!conn.accessToken) {
    return {
      error: "QuickBooks access token could not be decrypted.",
      status: 500,
    };
  }
  const expiresSoon =
    conn.accessTokenExpiresAt &&
    conn.accessTokenExpiresAt.getTime() - Date.now() < 60_000;
  if (expiresSoon && conn.refreshToken) {
    try {
      const fresh = await refreshAccessToken(conn.refreshToken);
      await updateAccessToken(
        conn.id,
        fresh.accessToken,
        new Date(Date.now() + fresh.expiresInSec * 1000),
        fresh.refreshToken,
      );
      return {
        accessToken: fresh.accessToken,
        realmId: conn.realmId,
        connectionId: conn.id,
      };
    } catch (err) {
      logger.error({ err, vendorId }, "QBO token refresh failed");
      await markRevoked(conn.id);
      return {
        error: "QuickBooks refresh token rejected. Please reconnect.",
        status: 412,
      };
    }
  }
  return {
    accessToken: conn.accessToken,
    realmId: conn.realmId,
    connectionId: conn.id,
  };
}

/** Look up vendor admin email recipients for the accounting failure digest.
 *  Joins user_org_memberships → users to find every admin for the vendor
 *  with a non-null email, dedup'd by email and tagged with each user's
 *  preferred locale (defaults to "en"). */
async function loadVendorAdminEmailRecipients(
  vendorId: number,
): Promise<Array<{ email: string; locale: EmailLocale }>> {
  const rows = await db
    .select({
      email: usersTable.email,
      preferredLanguage: usersTable.preferredLanguage,
    })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .where(
      and(
        eq(userOrgMembershipsTable.vendorId, vendorId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.role, "admin"),
        isNotNull(usersTable.email),
      ),
    );
  const seen = new Set<string>();
  const out: Array<{ email: string; locale: EmailLocale }> = [];
  for (const r of rows) {
    const e = (r.email ?? "").trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    const locale: EmailLocale =
      r.preferredLanguage === "es" ? "es" : "en";
    out.push({ email: e, locale });
  }
  return out;
}

/** Build the deep link the email CTA should send admins to. The Reports page
 *  reads `?auditId=<n>` and auto-opens the matching "Sync details" dialog.
 *  Falls back to the dev origin when there is no canonical app URL. */
function buildAuditDetailUrl(auditLogId: number): string {
  return `${getAppOrigin()}/reports?auditId=${auditLogId}`;
}

/** Build the secondary deep link the failure-digest email uses for its
 *  "Show only syncs with warnings" CTA. The Reports page accepts
 *  `?onlyWarnings=1` as a synonym for its internal `warnings=1` flag and
 *  pre-toggles the audit log card's "Only show syncs with warnings"
 *  switch on mount, so admins land on the filtered triage view in one
 *  click instead of having to flip the switch themselves after opening
 *  the per-row deep link. */
function buildAuditWarningsUrl(): string {
  return `${getAppOrigin()}/reports?onlyWarnings=1`;
}

/** Fire-and-forget the accounting push failure digest email. Honours the
 *  vendor's `accountingFailureNotificationsEnabled` setting and silently
 *  no-ops when there are no per-row failure warnings or no admin
 *  recipients. Reconciliation-only outcomes (everything posted, but
 *  totals/per-state tax drifted) are routed to
 *  `maybeSendReconciliationDigest` instead so they can be opted into
 *  separately. Failures are logged and never propagated — the push
 *  response must not depend on email delivery. */
export async function maybeSendAccountingDigest(args: {
  vendorId: number;
  provider: "QuickBooks" | "OpenAccountant";
  periodLabel: string;
  auditLogId: number | null;
  warnings: PushWarning[];
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
}): Promise<void> {
  try {
    if (args.auditLogId === null) return;
    // Only fire when at least one warning is a real per-row push
    // failure. Reconciliation-only pushes are handled by
    // `maybeSendReconciliationDigest` and gated by a separate
    // vendor-level toggle. We still pass the full warning list to the
    // email body so admins see the reconciliation context inline when
    // both types are present in the same push.
    const failureWarnings = args.warnings.filter(
      (w) => !isReconciliationWarning(w),
    );
    if (failureWarnings.length === 0) return;
    const [vendor] = await db
      .select({
        name: vendorsTable.name,
        accountingFailureNotificationsEnabled:
          vendorsTable.accountingFailureNotificationsEnabled,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, args.vendorId))
      .limit(1);
    if (!vendor || !vendor.accountingFailureNotificationsEnabled) return;
    const recipients = await loadVendorAdminEmailRecipients(args.vendorId);
    if (recipients.length === 0) {
      logger.info(
        { vendorId: args.vendorId, auditLogId: args.auditLogId },
        "Skipping accounting failure digest — no admin recipients",
      );
      return;
    }
    // Idempotency claim: atomically stamp the audit row's
    // `accounting_digest_emailed_at` only if it's still NULL. If the row
    // is already stamped (e.g. a duplicate fire-and-forget invocation, or
    // the route handler being retried by the platform) the UPDATE
    // returns 0 rows and we silently skip — no second email is sent for
    // the same audit row.
    const claimed = await db
      .update(reportExportAuditLogTable)
      .set({ accountingDigestEmailedAt: new Date() })
      .where(
        and(
          eq(reportExportAuditLogTable.id, args.auditLogId),
          isNull(reportExportAuditLogTable.accountingDigestEmailedAt),
        ),
      )
      .returning({ id: reportExportAuditLogTable.id });
    if (claimed.length === 0) {
      logger.info(
        { vendorId: args.vendorId, auditLogId: args.auditLogId },
        "Skipping accounting failure digest — already emailed",
      );
      return;
    }
    // Bucket counts use only failure warnings — the email leads with
    // "rows that need attention" so reconciliation-only items
    // shouldn't inflate the count.
    const counts = { customer: 0, vendor: 0, invoice: 0 };
    for (const w of failureWarnings) counts[w.kind] += 1;
    // Reconciliation call-out: when the same push surfaced both per-row
    // failures and silent reconciliation drift, the failure digest now
    // includes a dedicated section so admins notice the drift instead
    // of having it lump silently into the warning list. The dedicated
    // reconciliation-only digest does NOT fire in this case (gated by
    // `failureWarnings.length > 0` in `maybeSendReconciliationDigest`),
    // so the call-out here is the only signal admins get for it.
    const reconciliationOnlyWarnings = args.warnings.filter((w) =>
      isReconciliationWarning(w),
    );
    const reconciliation =
      reconciliationOnlyWarnings.length > 0
        ? {
            countsByBucket: bucketReconciliationWarnings(
              reconciliationOnlyWarnings,
            ),
            warnings: reconciliationOnlyWarnings,
          }
        : undefined;
    try {
      await sendAccountingPushDigestEmail({
        recipients,
        vendorName: vendor.name,
        provider: args.provider,
        periodLabel: args.periodLabel,
        auditDetailUrl: buildAuditDetailUrl(args.auditLogId),
        auditWarningsUrl: buildAuditWarningsUrl(),
        countsByKind: counts,
        customersCreated: args.customersCreated,
        vendorsCreated: args.vendorsCreated,
        invoicesCreated: args.invoicesCreated,
        warnings: failureWarnings,
        reconciliation,
      });
    } catch (sendErr) {
      // Roll back the claim so the digest can be retried on the next
      // push attempt — otherwise a transient SendGrid outage would
      // permanently silence emails for this audit row.
      await db
        .update(reportExportAuditLogTable)
        .set({ accountingDigestEmailedAt: null })
        .where(eq(reportExportAuditLogTable.id, args.auditLogId));
      throw sendErr;
    }
    logger.info(
      {
        vendorId: args.vendorId,
        auditLogId: args.auditLogId,
        provider: args.provider,
        warnings: args.warnings.length,
        failureWarnings: failureWarnings.length,
        recipients: recipients.length,
      },
      "Sent accounting push failure digest",
    );
  } catch (err) {
    // Email delivery must not block the API response.
    logger.error(
      { err, vendorId: args.vendorId, auditLogId: args.auditLogId },
      "Failed to send accounting failure digest email",
    );
  }
}

/** Bucket reconciliation-only warnings the way the email summarizes them.
 *  Per-state aggregate mismatches are tagged with `(state:XX)`; the
 *  fail-soft "couldn't read invoices back" path uses `(reconciliation)`;
 *  everything else is a per-invoice total/tax mismatch. */
function bucketReconciliationWarnings(warnings: PushWarning[]): {
  perInvoice: number;
  perState: number;
  fetchSkipped: number;
} {
  const counts = { perInvoice: 0, perState: 0, fetchSkipped: 0 };
  for (const w of warnings) {
    if (w.identifier === "(reconciliation)") counts.fetchSkipped += 1;
    else if (w.identifier.startsWith("(state:")) counts.perState += 1;
    else counts.perInvoice += 1;
  }
  return counts;
}

/** Fire-and-forget the accounting reconciliation-drift digest email.
 *  Fires only when the push posted every row successfully (no per-row
 *  failure warnings) but the post-push reconciler emitted at least one
 *  warning — the silent drift case the failure digest never covered.
 *  Honours the vendor's `accountingReconciliationNotificationsEnabled`
 *  setting (default false / opt-in) and uses its own idempotency column
 *  so it can't double-fire and so a later retry that surfaces real
 *  failures still sends the failure digest. */
async function maybeSendReconciliationDigest(args: {
  vendorId: number;
  provider: "QuickBooks" | "OpenAccountant";
  periodLabel: string;
  auditLogId: number | null;
  warnings: PushWarning[];
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
}): Promise<void> {
  try {
    if (args.auditLogId === null) return;
    const failureWarnings = args.warnings.filter(
      (w) => !isReconciliationWarning(w),
    );
    const reconciliationWarnings = args.warnings.filter((w) =>
      isReconciliationWarning(w),
    );
    // Only fire when the push was failure-free and at least one
    // reconciliation warning is present. If failures are also present,
    // the failure digest already emailed and includes the
    // reconciliation context inline.
    if (failureWarnings.length > 0) return;
    if (reconciliationWarnings.length === 0) return;

    const [vendor] = await db
      .select({
        name: vendorsTable.name,
        accountingReconciliationNotificationsEnabled:
          vendorsTable.accountingReconciliationNotificationsEnabled,
        accountingReconciliationDigestCadence:
          vendorsTable.accountingReconciliationDigestCadence,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, args.vendorId))
      .limit(1);
    if (!vendor || !vendor.accountingReconciliationNotificationsEnabled) return;
    // Task #368 — vendors who have switched to "weekly_recap" cadence
    // should NOT receive an email per push; the
    // `reconciliation-weekly-recap` worker aggregates the past 7 days
    // and sends one summary email per vendor instead. Leave the per-push
    // path active for the "per_push" cadence so existing behavior is
    // preserved.
    if (vendor.accountingReconciliationDigestCadence === "weekly_recap") {
      return;
    }
    const recipients = await loadVendorAdminEmailRecipients(args.vendorId);
    if (recipients.length === 0) {
      logger.info(
        { vendorId: args.vendorId, auditLogId: args.auditLogId },
        "Skipping accounting reconciliation digest — no admin recipients",
      );
      return;
    }
    // Separate idempotency claim from the failure digest. A push that
    // first fires reconciliation-only and later, on retry, surfaces
    // real per-row failures will still get the failure digest because
    // the two columns are independent.
    const claimed = await db
      .update(reportExportAuditLogTable)
      .set({ accountingReconciliationDigestEmailedAt: new Date() })
      .where(
        and(
          eq(reportExportAuditLogTable.id, args.auditLogId),
          isNull(
            reportExportAuditLogTable.accountingReconciliationDigestEmailedAt,
          ),
        ),
      )
      .returning({ id: reportExportAuditLogTable.id });
    if (claimed.length === 0) {
      logger.info(
        { vendorId: args.vendorId, auditLogId: args.auditLogId },
        "Skipping accounting reconciliation digest — already emailed",
      );
      return;
    }
    try {
      await sendAccountingReconciliationDigestEmail({
        recipients,
        vendorName: vendor.name,
        provider: args.provider,
        periodLabel: args.periodLabel,
        auditDetailUrl: buildAuditDetailUrl(args.auditLogId),
        countsByBucket: bucketReconciliationWarnings(reconciliationWarnings),
        customersCreated: args.customersCreated,
        vendorsCreated: args.vendorsCreated,
        invoicesCreated: args.invoicesCreated,
        warnings: reconciliationWarnings,
      });
    } catch (sendErr) {
      await db
        .update(reportExportAuditLogTable)
        .set({ accountingReconciliationDigestEmailedAt: null })
        .where(eq(reportExportAuditLogTable.id, args.auditLogId));
      throw sendErr;
    }
    logger.info(
      {
        vendorId: args.vendorId,
        auditLogId: args.auditLogId,
        provider: args.provider,
        reconciliationWarnings: reconciliationWarnings.length,
        recipients: recipients.length,
      },
      "Sent accounting reconciliation drift digest",
    );
  } catch (err) {
    logger.error(
      { err, vendorId: args.vendorId, auditLogId: args.auditLogId },
      "Failed to send accounting reconciliation digest email",
    );
  }
}

/** Optional body for both push endpoints. When `retryFromAuditId` is set,
 *  the route filters the freshly-gathered bundle down to only the rows that
 *  warned in the referenced audit row, so failed pushes can be re-tried
 *  without re-creating already-synced customers/vendors/invoices. */
const PushBody = z
  .object({ retryFromAuditId: z.number().int().positive().optional() })
  .strict();

interface RetryFilter {
  customers: Set<string>;
  vendors: Set<string>;
  invoices: Set<string>;
  /** Period from the original audit row. We pin retries to this period so
   *  the caller can't accidentally retry a Q1 push against Q2 data and end
   *  up either no-op'ing or pushing the wrong rows. */
  period: Period;
}

/** Load the previous audit row (must match the same vendor + push kind),
 *  parse its stored warnings, and return Sets of identifiers per kind plus
 *  the original push period.
 *
 *  Reconciliation warnings (identifiers `(reconciliation)` and
 *  `(state:XX)`) are added to these sets too but are harmless: they
 *  never match a real DocNumber / partner / vendor name, so
 *  `applyRetryFilter` filters them out as no-ops. */
async function loadRetryFilter(args: {
  auditId: number;
  vendorId: number;
  reportKind: "vendor.quickbooksPush" | "vendor.openaccountantPush";
}): Promise<RetryFilter | { error: string; status: number }> {
  const [row] = await db
    .select()
    .from(reportExportAuditLogTable)
    .where(eq(reportExportAuditLogTable.id, args.auditId))
    .limit(1);
  if (!row) return { error: "Previous push not found.", status: 404 };
  if (row.reportKind !== args.reportKind) {
    return { error: "Audit row is from a different sync type.", status: 400 };
  }
  const scope = row.scope as {
    vendorId?: number;
    periodStart?: string;
    periodEnd?: string;
  };
  if (scope.vendorId !== args.vendorId) {
    return { error: "Audit row is for a different vendor.", status: 403 };
  }
  if (!scope.periodStart || !scope.periodEnd) {
    return { error: "Previous push has no recorded period.", status: 400 };
  }
  const start = new Date(scope.periodStart);
  const end = new Date(scope.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "Previous push period is invalid.", status: 400 };
  }
  const detail = (row.detailJson ?? {}) as { warnings?: unknown };
  const raw = Array.isArray(detail.warnings) ? detail.warnings : [];
  const filter: RetryFilter = {
    customers: new Set(),
    vendors: new Set(),
    invoices: new Set(),
    period: {
      start,
      end,
      label: formatPeriod({ start, end, label: "" }),
    },
  };
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const ww = w as { kind?: string; identifier?: string };
    if (typeof ww.identifier !== "string") continue;
    if (ww.kind === "customer") filter.customers.add(ww.identifier);
    else if (ww.kind === "vendor") filter.vendors.add(ww.identifier);
    else if (ww.kind === "invoice") filter.invoices.add(ww.identifier);
  }
  return filter;
}

/** Narrow an export bundle to only the rows whose identifiers appeared in
 *  the previous push's warnings. Lines are kept for any retried invoice. */
function applyRetryFilter<
  B extends {
    invoices: Array<{ invoiceNumber: string; partnerName: string }>;
    lines: Array<{ invoiceNumber: string }>;
    partners: Array<{ name: string }>;
    vendors: Array<{ name: string }>;
  },
>(data: B, filter: RetryFilter): B {
  // If an invoice is being retried but its customer hasn't been created yet
  // (because it warned previously too), include the partner so the QBO push
  // can re-create it before the invoice posts.
  const partnersForInvoices = new Set<string>(filter.customers);
  for (const inv of data.invoices) {
    if (filter.invoices.has(inv.invoiceNumber)) {
      partnersForInvoices.add(inv.partnerName);
    }
  }
  const invoices = data.invoices.filter((i) =>
    filter.invoices.has(i.invoiceNumber),
  );
  const keepInvNos = new Set(invoices.map((i) => i.invoiceNumber));
  return {
    ...data,
    invoices,
    lines: data.lines.filter((l) => keepInvNos.has(l.invoiceNumber)),
    partners: data.partners.filter((p) => partnersForInvoices.has(p.name)),
    vendors: data.vendors.filter((v) => filter.vendors.has(v.name)),
  };
}

// POST /reports/vendor/:vendorId/quickbooks-push
//   body (optional): { retryFromAuditId?: number }
router.post(
  "/reports/vendor/:vendorId/quickbooks-push",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const requestedPeriod = parsePeriodOrError(req, res);
    if (!requestedPeriod) return;
    let period: Period = requestedPeriod;
    const body = PushBody.safeParse(req.body ?? {});
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }

    let env: "production" | "sandbox" = "production";
    try {
      env = loadQboConfig().environment;
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message,
        code: "qbo.not_configured",
      });
      return;
    }

    const tokenResult = await getFreshQboAccessToken(vendorId);
    if ("error" in tokenResult) {
      res.status(tokenResult.status).json({ error: tokenResult.error, code: "accounting.token_error" });
      return;
    }

    let data = await gatherExportData(vendorId, period);
    if (data.invoices.length === 0) {
      res.status(404).json({ error: "No invoices found for this period.", code: "report.no_invoices" });
      return;
    }

    let retriedFromAuditId: number | null = null;
    if (body.data.retryFromAuditId !== undefined) {
      const f = await loadRetryFilter({
        auditId: body.data.retryFromAuditId,
        vendorId,
        reportKind: "vendor.quickbooksPush",
      });
      if ("error" in f) {
        res.status(f.status).json({ error: f.error, code: "report.filing_failed" });
        return;
      }
      // Pin the retry to the original push's period so the caller can't
      // retry against a different period and get spurious / partial results.
      period = f.period;
      data = await gatherExportData(vendorId, period);
      data = applyRetryFilter(data, f);
      retriedFromAuditId = body.data.retryFromAuditId;
      if (
        data.invoices.length === 0 &&
        data.partners.length === 0 &&
        data.vendors.length === 0
      ) {
        res
          .status(404)
          .json({ error: "No previously-failed rows found to retry.", code: "report.no_failed_rows" });
        return;
      }
    }

    // Resolve a real QBO Item Id for every line type we know how to map,
    // creating Account+Item rows in the connected QBO company on first
    // use. Cached per (connection, line_type) so subsequent pushes avoid
    // the round-trips. Without this step `pushBundleToQbo` would fall
    // back to the placeholder ItemRef `"1"` and fault on most companies.
    let itemMap: Record<string, string> = {};
    let defaultItemId: string | undefined;
    let itemMapWarnings: Array<{ lineType: string; message: string }> = [];
    try {
      const cached = await loadConnectionItemMap(tokenResult.connectionId);
      const desired = MAPPABLE_LINE_TYPES
        // AR and Sales Tax Payable aren't Items in QBO — they're Accounts
        // posted to via the invoice itself, so skip them here.
        .filter((m) => m.key !== LINE_TYPE_AR && m.key !== LINE_TYPE_TAX_PAYABLE)
        .map((m) => ({
          lineType: m.key,
          account: data.resolver(m.key, { vendorId }),
        }));
      const ensured = await ensureQboItemMap(
        {
          existing: cached,
          desired,
          onResolve: async (entry) => {
            await upsertConnectionItem({
              connectionId: tokenResult.connectionId,
              lineType: entry.lineType,
              qboItemId: entry.qboItemId,
              qboAccountId: entry.qboAccountId,
              qboAccountName: entry.qboAccountName,
            });
          },
        },
        {
          accessToken: tokenResult.accessToken,
          realmId: tokenResult.realmId,
          environment: env,
        },
      );
      itemMap = ensured.itemMap;
      itemMapWarnings = ensured.warnings;
      defaultItemId = itemMap.other;
    } catch (err) {
      logger.error({ err, vendorId }, "QBO item map resolution failed");
      res.status(502).json({ error: (err as Error).message, code: "server.upstream_error" });
      return;
    }

    const pushedInvoiceStore = await loadPushedInvoiceStore(vendorId, "qbo");
    let pushResult;
    try {
      pushResult = await pushBundleToQbo(data, {
        accessToken: tokenResult.accessToken,
        realmId: tokenResult.realmId,
        environment: env,
        itemMap,
        defaultItemId,
        pushedInvoiceStore,
      });
    } catch (err) {
      logger.error({ err, vendorId }, "QBO push failed");
      res.status(502).json({ error: (err as Error).message, code: "server.upstream_error" });
      return;
    }

    // Surface item-map setup problems alongside per-row push warnings so
    // operators see, in one place, why an Item couldn't be ensured.
    for (const w of itemMapWarnings) {
      pushResult.warnings.push({
        kind: "invoice",
        identifier: `item:${w.lineType}`,
        message: `Could not prepare QBO Product/Service for line type "${w.lineType}": ${w.message}`,
      });
    }

    // Reconcile what we just posted against what QBO actually stored.
    // Catches silent drift if a future code change reintroduces a
    // discrepancy between line tax and TxnTaxDetail (e.g. AST
    // recomputation, rounding, or a tax-code mismatch). The reconciler
    // is fail-soft — if it can't reach QBO it surfaces a single
    // warning rather than failing the push.
    //
    // We use `invoicesPushed` (an explicit success signal from
    // pushBundleToQbo) rather than "invoices without a warning". An
    // invoice can be both created AND warned about in the same push
    // (e.g. tax was non-zero but couldn't be posted because sales tax
    // is disabled in QBO) — those should still be reconciled.
    const pushedSet = new Set(pushResult.invoicesPushed);
    const succeededInvoices = data.invoices.filter((i) =>
      pushedSet.has(i.invoiceNumber),
    );
    if (succeededInvoices.length > 0) {
      const reconciliationWarnings = await reconcilePush({
        invoices: succeededInvoices,
        vendorId,
        period,
        accessToken: tokenResult.accessToken,
        realmId: tokenResult.realmId,
        environment: env,
      });
      pushResult.warnings.push(...reconciliationWarnings);
    }

    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      environment: env,
      customersCreated: pushResult.customersCreated,
      vendorsCreated: pushResult.vendorsCreated,
      invoicesCreated: pushResult.invoicesCreated,
      customersAlreadyExisted: pushResult.customersAlreadyExisted,
      vendorsAlreadyExisted: pushResult.vendorsAlreadyExisted,
      invoicesAlreadyUpToDate: pushResult.invoicesAlreadyUpToDate,
      warningCount: pushResult.warnings.length,
      ...(retriedFromAuditId !== null ? { retriedFromAuditId } : {}),
    };
    const auditLogId = await recordExport({
      req,
      reportKind: "vendor.quickbooksPush",
      format: "qbo_api_push",
      scope,
      rowCount: pushResult.invoicesCreated,
      fileBytes: 0,
      detailJson:
        pushResult.warnings.length > 0
          ? { warnings: pushResult.warnings }
          : null,
    });

    void maybeSendAccountingDigest({
      vendorId,
      provider: "QuickBooks",
      periodLabel: formatPeriod(period),
      auditLogId,
      warnings: pushResult.warnings,
      customersCreated: pushResult.customersCreated,
      vendorsCreated: pushResult.vendorsCreated,
      invoicesCreated: pushResult.invoicesCreated,
    });
    void maybeSendReconciliationDigest({
      vendorId,
      provider: "QuickBooks",
      periodLabel: formatPeriod(period),
      auditLogId,
      warnings: pushResult.warnings,
      customersCreated: pushResult.customersCreated,
      vendorsCreated: pushResult.vendorsCreated,
      invoicesCreated: pushResult.invoicesCreated,
    });

    res.json({
      ok: true,
      period: formatPeriod(period),
      auditLogId,
      retriedFromAuditId,
      ...pushResult,
    });
  },
);

// POST /reports/vendor/:vendorId/quickbooks/prepare-items
//   Resolves a QBO Item (and supporting Income Account) for every
//   MAPPABLE_LINE_TYPES entry, persisting the cache so the next invoice
//   push doesn't pay the cold-start penalty per line type. Idempotent —
//   subsequent calls re-use the cache when the desired account still
//   matches. Returns a per-line-type report so the admin sees, in one
//   place, whether each Item was already there, was just created, or
//   failed to resolve (and why).
router.post(
  "/reports/vendor/:vendorId/quickbooks/prepare-items",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res
        .status(400)
        .json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    let env: "production" | "sandbox" = "production";
    try {
      env = loadQboConfig().environment;
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message,
        code: "qbo.not_configured",
      });
      return;
    }

    const tokenResult = await getFreshQboAccessToken(vendorId);
    if ("error" in tokenResult) {
      res.status(tokenResult.status).json({
        error: tokenResult.error,
        code: "accounting.token_error",
      });
      return;
    }

    // Resolve mapping overrides for this vendor with no partner scope so
    // the prepared Items reflect the same chart-of-accounts choices the
    // first invoice push would have used. Per-partner overrides still
    // apply at push time and will lazily extend the cache then; this
    // action just covers the vendor-default set up front.
    const overrides = await loadAccountMapOverrides({ vendorId });
    const resolver = buildResolver(overrides);

    const desired = MAPPABLE_LINE_TYPES
      // AR and Sales Tax Payable aren't Products/Services in QBO — they
      // post to Accounts via the Invoice itself, so skip them here.
      .filter(
        (m) => m.key !== LINE_TYPE_AR && m.key !== LINE_TYPE_TAX_PAYABLE,
      )
      .map((m) => ({
        lineType: m.key,
        label: m.label,
        account: resolver(m.key, { vendorId }),
      }));

    let ensured;
    try {
      const cached = await loadConnectionItemMap(tokenResult.connectionId);
      ensured = await ensureQboItemMap(
        {
          existing: cached,
          desired: desired.map((d) => ({
            lineType: d.lineType,
            account: d.account,
          })),
          onResolve: async (entry) => {
            await upsertConnectionItem({
              connectionId: tokenResult.connectionId,
              lineType: entry.lineType,
              qboItemId: entry.qboItemId,
              qboAccountId: entry.qboAccountId,
              qboAccountName: entry.qboAccountName,
            });
          },
        },
        {
          accessToken: tokenResult.accessToken,
          realmId: tokenResult.realmId,
          environment: env,
        },
      );
    } catch (err) {
      logger.error(
        { err, vendorId },
        "QBO prepare-items: item map resolution failed",
      );
      res.status(502).json({
        error: (err as Error).message,
        code: "server.upstream_error",
      });
      return;
    }

    // Pair each ensure entry with the human-readable label + chosen
    // account so the UI can render a meaningful row without a follow-up
    // mapping fetch.
    const labels = new Map(desired.map((d) => [d.lineType, d.label] as const));
    const accountByLineType = new Map(
      desired.map((d) => [d.lineType, d.account] as const),
    );
    const items = ensured.entries.map((e) => {
      const account = accountByLineType.get(e.lineType);
      return {
        lineType: e.lineType,
        label: labels.get(e.lineType) ?? e.lineType,
        accountName: account?.name ?? null,
        accountNumber: account?.number ?? null,
        status: e.status,
        qboItemId: e.qboItemId ?? null,
        qboAccountId: e.qboAccountId ?? null,
        message: e.message ?? null,
      };
    });

    const counts = {
      existing: items.filter((i) => i.status === "existing").length,
      created: items.filter((i) => i.status === "created").length,
      failed: items.filter((i) => i.status === "failed").length,
    };

    res.json({
      ok: true,
      environment: env,
      counts,
      items,
    });
  },
);

// ── QBO Item-Map admin views ────────────────────────────────────────
//
// Read-only inspection of the per-(connection, line_type) cache that
// powers `pushBundleToQbo`. Surfaces the resolved Item / Account ids
// next to the desired-account from `qb_account_mapping` so admins can
// verify the wiring before pushing real invoices, and re-resolve the
// cache on demand without doing a full push.

interface ItemMapRow {
  lineType: string;
  label: string;
  desiredAccountName: string;
  desiredAccountNumber: string;
  qboItemId: string | null;
  qboAccountId: string | null;
  qboAccountName: string | null;
  updatedAt: string | null;
  /** True when the cached account name no longer matches the current
   *  desired account from `qb_account_mapping`. The next push will
   *  re-resolve this row through `ensureQboItemMap`. */
  stale: boolean;
}

async function buildItemMapRows(vendorId: number, connectionId: number): Promise<ItemMapRow[]> {
  const overrides = await loadAccountMapOverrides({ vendorId });
  const resolver = buildResolver(overrides);
  const cached = await loadConnectionItemMap(connectionId);
  const out: ItemMapRow[] = [];
  for (const m of MAPPABLE_LINE_TYPES) {
    // AR / Sales Tax Payable are Accounts, not Products/Services, so
    // they don't live in the cache. Skip them so the table only shows
    // rows that actually have an Item to point at.
    if (m.key === LINE_TYPE_AR || m.key === LINE_TYPE_TAX_PAYABLE) continue;
    const desired = resolver(m.key, { vendorId });
    const row = cached[m.key];
    const stale =
      !!row &&
      row.qboAccountName != null &&
      row.qboAccountName !== desired.name;
    out.push({
      lineType: m.key,
      label: m.label,
      desiredAccountName: desired.name,
      desiredAccountNumber: desired.number,
      qboItemId: row?.qboItemId ?? null,
      qboAccountId: row?.qboAccountId ?? null,
      qboAccountName: row?.qboAccountName ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      stale,
    });
  }
  return out;
}

// GET /reports/vendor/:vendorId/quickbooks/item-map
router.get(
  "/reports/vendor/:vendorId/quickbooks/item-map",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    const conn = await getConnection(vendorId, "qbo");
    if (!conn) {
      res.status(412).json({
        error: "Vendor is not connected to QuickBooks Online.",
        code: "qbo.not_connected",
      });
      return;
    }
    const rows = await buildItemMapRows(vendorId, conn.id);
    res.json({ rows });
  },
);

// POST /reports/vendor/:vendorId/quickbooks/item-map/refresh
//
// Re-runs `ensureQboItemMap` for every mappable line type so an admin
// can repair stale rows (e.g. after editing `qb_account_mapping`)
// without scheduling a full invoice push. Mirrors the cache-population
// path inside the QBO push handler.
router.post(
  "/reports/vendor/:vendorId/quickbooks/item-map/refresh",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    let env: "production" | "sandbox" = "production";
    try {
      env = loadQboConfig().environment;
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message,
        code: "qbo.not_configured",
      });
      return;
    }

    const tokenResult = await getFreshQboAccessToken(vendorId);
    if ("error" in tokenResult) {
      res.status(tokenResult.status).json({
        error: tokenResult.error,
        code: "accounting.token_error",
      });
      return;
    }

    const overrides = await loadAccountMapOverrides({ vendorId });
    const resolver = buildResolver(overrides);
    const cached = await loadConnectionItemMap(tokenResult.connectionId);
    const desired = MAPPABLE_LINE_TYPES
      .filter((m) => m.key !== LINE_TYPE_AR && m.key !== LINE_TYPE_TAX_PAYABLE)
      .map((m) => ({
        lineType: m.key,
        account: resolver(m.key, { vendorId }),
      }));

    let warnings: Array<{ lineType: string; message: string }> = [];
    try {
      const ensured = await ensureQboItemMap(
        {
          existing: cached,
          desired,
          onResolve: async (entry) => {
            await upsertConnectionItem({
              connectionId: tokenResult.connectionId,
              lineType: entry.lineType,
              qboItemId: entry.qboItemId,
              qboAccountId: entry.qboAccountId,
              qboAccountName: entry.qboAccountName,
            });
          },
        },
        {
          accessToken: tokenResult.accessToken,
          realmId: tokenResult.realmId,
          environment: env,
        },
      );
      warnings = ensured.warnings;
    } catch (err) {
      logger.error({ err, vendorId }, "QBO item-map refresh failed");
      res.status(502).json({
        error: (err as Error).message,
        code: "server.upstream_error",
      });
      return;
    }

    const rows = await buildItemMapRows(vendorId, tokenResult.connectionId);
    res.json({ rows, warnings });
  },
);

/** Build per-invoice + aggregate per-state expectations from VNDRLY's
 *  data and call the QBO reconciler. We rely on invoice_lines.taxState
 *  for the breakdown so the per-state aggregate matches the
 *  Sales-Tax-by-State report exactly (same grouping column). */
async function reconcilePush(args: {
  invoices: Array<{
    invoiceNumber: string;
    total: string;
    taxTotal: string;
  }>;
  vendorId: number;
  period: Period;
  accessToken: string;
  realmId: string;
  environment: "production" | "sandbox";
}): Promise<PushWarning[]> {
  try {
    const invoiceNumbers = args.invoices.map((i) => i.invoiceNumber);
    const linesWithState = await db
      .select({
        invoiceNumber: invoicesTable.invoiceNumber,
        taxState: invoiceLinesTable.taxState,
        taxAmount: invoiceLinesTable.taxAmount,
      })
      .from(invoiceLinesTable)
      .innerJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLinesTable.invoiceId),
      )
      .where(inArray(invoicesTable.invoiceNumber, invoiceNumbers));

    const breakdownByInvoice = new Map<string, Record<string, number>>();
    for (const l of linesWithState) {
      const state = l.taxState ?? "(unassigned)";
      const tax = Number(l.taxAmount ?? 0);
      if (tax === 0) continue;
      const m = breakdownByInvoice.get(l.invoiceNumber) ?? {};
      m[state] = (m[state] ?? 0) + tax;
      breakdownByInvoice.set(l.invoiceNumber, m);
    }

    const expectations: ReconcileExpectation[] = args.invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      expectedTotal: Number(i.total),
      expectedTax: Number(i.taxTotal),
      expectedTaxByState: breakdownByInvoice.get(i.invoiceNumber),
    }));

    // Aggregate expected per-state from the same source the
    // Sales-Tax-by-State report uses. Restrict to the invoices we just
    // pushed (not the entire period) so a partial / retry push still
    // reconciles cleanly.
    const expectedByState: Record<string, number> = {};
    for (const breakdown of breakdownByInvoice.values()) {
      for (const [state, tax] of Object.entries(breakdown)) {
        expectedByState[state] = (expectedByState[state] ?? 0) + tax;
      }
    }

    return await reconcileQboInvoices(expectations, {
      accessToken: args.accessToken,
      realmId: args.realmId,
      environment: args.environment,
      expectedTaxByState: expectedByState,
    });
  } catch (err) {
    logger.error({ err, vendorId: args.vendorId }, "QBO reconciliation failed");
    return [
      {
        kind: "invoice",
        identifier: "(reconciliation)",
        message: `reconciliation skipped: ${(err as Error).message}`,
      },
    ];
  }
}

/** Build per-invoice + aggregate per-state expectations from VNDRLY's
 *  data and call the OA reconciler. Mirrors `reconcilePush` for QBO so
 *  silent drift between the Sales-Tax-by-State report and what OA stored
 *  surfaces as warnings on the export-history record. */
async function reconcileOaPush(args: {
  invoices: Array<{
    invoiceNumber: string;
    total: string;
    taxTotal: string;
  }>;
  vendorId: number;
  apiKey: string;
  baseUrl: string | undefined;
}): Promise<PushWarning[]> {
  try {
    const invoiceNumbers = args.invoices.map((i) => i.invoiceNumber);
    const linesWithState = await db
      .select({
        invoiceNumber: invoicesTable.invoiceNumber,
        taxState: invoiceLinesTable.taxState,
        taxAmount: invoiceLinesTable.taxAmount,
      })
      .from(invoiceLinesTable)
      .innerJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLinesTable.invoiceId),
      )
      .where(inArray(invoicesTable.invoiceNumber, invoiceNumbers));

    const breakdownByInvoice = new Map<string, Record<string, number>>();
    for (const l of linesWithState) {
      const state = l.taxState ?? "(unassigned)";
      const tax = Number(l.taxAmount ?? 0);
      if (tax === 0) continue;
      const m = breakdownByInvoice.get(l.invoiceNumber) ?? {};
      m[state] = (m[state] ?? 0) + tax;
      breakdownByInvoice.set(l.invoiceNumber, m);
    }

    const expectations: OaReconcileExpectation[] = args.invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      expectedTotal: Number(i.total),
      expectedTax: Number(i.taxTotal),
      expectedTaxByState: breakdownByInvoice.get(i.invoiceNumber),
    }));

    // Aggregate expected per-state from the same source the
    // Sales-Tax-by-State report uses. Restrict to the invoices we just
    // pushed (not the entire period) so a partial / retry push still
    // reconciles cleanly.
    const expectedByState: Record<string, number> = {};
    for (const breakdown of breakdownByInvoice.values()) {
      for (const [state, tax] of Object.entries(breakdown)) {
        expectedByState[state] = (expectedByState[state] ?? 0) + tax;
      }
    }

    return await reconcileOaInvoices(expectations, {
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      expectedTaxByState: expectedByState,
    });
  } catch (err) {
    logger.error({ err, vendorId: args.vendorId }, "OA reconciliation failed");
    return [
      {
        kind: "invoice",
        identifier: "(reconciliation)",
        message: `reconciliation skipped: ${(err as Error).message}`,
      },
    ];
  }
}

/** Decrypt an OA connection's access token, refreshing it first if it
 *  was issued via OAuth and is within 60s of expiry. API-key
 *  connections (no refresh_token, no expiry) are returned as-is. */
async function getFreshOaAccessToken(
  vendorId: number,
): Promise<
  | { accessToken: string; baseUrl: string | null }
  | { error: string; status: number }
> {
  const conn = await getConnection(vendorId, "oa");
  if (!conn) {
    return {
      error: "Vendor is not connected to OpenAccountant.",
      status: 412,
    };
  }
  if (conn.status !== "active") {
    return {
      error: `OpenAccountant connection is ${conn.status}; reconnect to continue.`,
      status: 412,
    };
  }
  if (!conn.accessToken) {
    return {
      error: "OpenAccountant access token could not be decrypted.",
      status: 500,
    };
  }
  const expiresSoon =
    conn.accessTokenExpiresAt &&
    conn.accessTokenExpiresAt.getTime() - Date.now() < 60_000;
  if (expiresSoon && conn.refreshToken) {
    try {
      const fresh = await oaRefreshAccessToken(conn.refreshToken);
      await updateAccessToken(
        conn.id,
        fresh.accessToken,
        new Date(Date.now() + fresh.expiresInSec * 1000),
        // Some OAuth servers rotate refresh tokens, others don't —
        // only persist a new one when OA gives us one.
        fresh.refreshToken ?? undefined,
      );
      return {
        accessToken: fresh.accessToken,
        baseUrl: conn.apiBaseUrl ?? null,
      };
    } catch (err) {
      logger.error({ err, vendorId }, "OA token refresh failed");
      await markRevoked(conn.id);
      return {
        error: "OpenAccountant refresh token rejected. Please reconnect.",
        status: 412,
      };
    }
  }
  return { accessToken: conn.accessToken, baseUrl: conn.apiBaseUrl ?? null };
}

// POST /reports/vendor/:vendorId/openaccountant-push
//   body (optional): { retryFromAuditId?: number }
router.post(
  "/reports/vendor/:vendorId/openaccountant-push",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const requestedPeriod = parsePeriodOrError(req, res);
    if (!requestedPeriod) return;
    let period: Period = requestedPeriod;
    const body = PushBody.safeParse(req.body ?? {});
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }

    const tokenResult = await getFreshOaAccessToken(vendorId);
    if ("error" in tokenResult) {
      res.status(tokenResult.status).json({ error: tokenResult.error, code: "accounting.token_error" });
      return;
    }

    let data = await gatherExportData(vendorId, period);
    if (data.invoices.length === 0) {
      res.status(404).json({ error: "No invoices found for this period.", code: "report.no_invoices" });
      return;
    }

    let retriedFromAuditId: number | null = null;
    if (body.data.retryFromAuditId !== undefined) {
      const f = await loadRetryFilter({
        auditId: body.data.retryFromAuditId,
        vendorId,
        reportKind: "vendor.openaccountantPush",
      });
      if ("error" in f) {
        res.status(f.status).json({ error: f.error, code: "report.filing_failed" });
        return;
      }
      // Pin the retry to the original push's period so the caller can't
      // retry against a different period and get spurious / partial results.
      period = f.period;
      data = await gatherExportData(vendorId, period);
      data = applyRetryFilter(data, f);
      retriedFromAuditId = body.data.retryFromAuditId;
      if (
        data.invoices.length === 0 &&
        data.partners.length === 0 &&
        data.vendors.length === 0
      ) {
        res
          .status(404)
          .json({ error: "No previously-failed rows found to retry.", code: "report.no_failed_rows" });
        return;
      }
    }

    const pushedInvoiceStore = await loadPushedInvoiceStore(vendorId, "oa");
    let pushResult;
    try {
      pushResult = await pushBundleToOa(data, {
        apiKey: tokenResult.accessToken,
        baseUrl: tokenResult.baseUrl ?? undefined,
        pushedInvoiceStore,
      });
    } catch (err) {
      logger.error({ err, vendorId }, "OA push failed");
      res.status(502).json({ error: (err as Error).message, code: "server.upstream_error" });
      return;
    }

    // Reconcile what we just posted against what OA actually stored —
    // mirrors the QBO reconciliation step. The reconciler is fail-soft:
    // if it can't reach OA it surfaces a single warning rather than
    // failing the push.
    //
    // We use `invoicesPushed` (an explicit success signal from
    // pushBundleToOa) rather than "invoices without a warning". An
    // invoice can be both created AND warned about in the same push —
    // those should still be reconciled.
    const oaPushedSet = new Set(pushResult.invoicesPushed);
    const oaSucceededInvoices = data.invoices.filter((i) =>
      oaPushedSet.has(i.invoiceNumber),
    );
    if (oaSucceededInvoices.length > 0) {
      const reconciliationWarnings = await reconcileOaPush({
        invoices: oaSucceededInvoices,
        vendorId,
        apiKey: tokenResult.accessToken,
        baseUrl: tokenResult.baseUrl ?? undefined,
      });
      pushResult.warnings.push(...reconciliationWarnings);
    }

    const scope = {
      vendorId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      customersCreated: pushResult.customersCreated,
      vendorsCreated: pushResult.vendorsCreated,
      invoicesCreated: pushResult.invoicesCreated,
      customersAlreadyExisted: pushResult.customersAlreadyExisted,
      vendorsAlreadyExisted: pushResult.vendorsAlreadyExisted,
      invoicesAlreadyUpToDate: pushResult.invoicesAlreadyUpToDate,
      warningCount: pushResult.warnings.length,
      ...(retriedFromAuditId !== null ? { retriedFromAuditId } : {}),
    };
    const auditLogId = await recordExport({
      req,
      reportKind: "vendor.openaccountantPush",
      format: "oa_api_push",
      scope,
      rowCount: pushResult.invoicesCreated,
      fileBytes: 0,
      detailJson:
        pushResult.warnings.length > 0
          ? { warnings: pushResult.warnings }
          : null,
    });

    void maybeSendAccountingDigest({
      vendorId,
      provider: "OpenAccountant",
      periodLabel: formatPeriod(period),
      auditLogId,
      warnings: pushResult.warnings,
      customersCreated: pushResult.customersCreated,
      vendorsCreated: pushResult.vendorsCreated,
      invoicesCreated: pushResult.invoicesCreated,
    });
    void maybeSendReconciliationDigest({
      vendorId,
      provider: "OpenAccountant",
      periodLabel: formatPeriod(period),
      auditLogId,
      warnings: pushResult.warnings,
      customersCreated: pushResult.customersCreated,
      vendorsCreated: pushResult.vendorsCreated,
      invoicesCreated: pushResult.invoicesCreated,
    });

    res.json({
      ok: true,
      period: formatPeriod(period),
      auditLogId,
      retriedFromAuditId,
      ...pushResult,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// PER-INVOICE RE-SYNC
// ──────────────────────────────────────────────────────────────────
//
// Bulk push happens once per period. For one-off corrections (an
// invoice was edited, a tax line was added, the wrong customer was
// originally selected, etc.) admins need a per-invoice action that
// updates the existing remote invoice in place without re-pushing the
// whole period. These two routes power that action.

/** Load exactly one invoice + its lines + partner + vendor in the same
 *  shape as `gatherExportData`. Returns null when the invoice is not
 *  found or does not belong to the requested vendor. */
async function gatherSingleInvoiceForExport(
  vendorId: number,
  invoiceId: number,
): Promise<ExportBundleData | null> {
  const rows = await db
    .select({
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.periodEnd,
      dueDate: invoicesTable.dueDate,
      total: invoicesTable.total,
      subtotal: invoicesTable.subtotal,
      taxTotal: invoicesTable.taxTotal,
      memo: invoicesTable.notes,
      partnerId: invoicesTable.partnerId,
      partnerName: partnersTable.name,
      partnerAddress: partnersTable.billingAddress,
      partnerEmail: partnersTable.contactEmail,
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      vendorEmail: vendorsTable.contactEmail,
      vendorAddress: vendorsTable.billingAddress,
      vendorFedTaxId: vendorsTable.federalTaxId,
    })
    .from(invoicesTable)
    .innerJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .innerJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .where(
      and(
        eq(invoicesTable.id, invoiceId),
        eq(invoicesTable.vendorId, vendorId),
      ),
    )
    .limit(1);
  const i = rows[0];
  if (!i) return null;

  const lines = await db
    .select({
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoiceLinesTable.description,
      amount: invoiceLinesTable.amount,
      taxAmount: invoiceLinesTable.taxAmount,
      lineType: invoiceLinesTable.lineType,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .where(eq(invoicesTable.id, invoiceId));

  const overrides = await loadAccountMapOverrides({
    vendorId,
    partnerIds: [i.partnerId],
  });

  return {
    invoices: [
      {
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        total: i.total,
        subtotal: i.subtotal,
        taxTotal: i.taxTotal,
        memo: i.memo,
        partnerName: i.partnerName,
        vendorName: i.vendorName,
        partnerId: i.partnerId,
        vendorId: i.vendorId,
      },
    ],
    lines,
    partners: [
      {
        name: i.partnerName,
        email: i.partnerEmail,
        address: i.partnerAddress,
      },
    ],
    vendors: [
      {
        name: i.vendorName,
        email: i.vendorEmail,
        address: i.vendorAddress,
        federalTaxId: i.vendorFedTaxId,
      },
    ],
    vendorName: i.vendorName,
    resolver: buildResolver(overrides),
  };
}

// POST /reports/vendor/:vendorId/invoices/:invoiceId/qbo-resync
//   Body: none. Re-pushes the freshly-rebuilt invoice body to the
//   already-mapped QBO invoice via sparse update. Requires the invoice
//   to have been pushed previously (so we have an external_invoice_id).
router.post(
  "/reports/vendor/:vendorId/invoices/:invoiceId/qbo-resync",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isInteger(vendorId) || !Number.isInteger(invoiceId)) {
      res.status(400).json({ error: "Bad vendorId or invoiceId", code: "report.invalid_vendor_id_or_invoice_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    let env: "production" | "sandbox" = "production";
    try {
      env = loadQboConfig().environment;
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message,
        code: "qbo.not_configured",
      });
      return;
    }

    const data = await gatherSingleInvoiceForExport(vendorId, invoiceId);
    if (!data) {
      res.status(404).json({ error: "Invoice not found for this vendor.", code: "invoice.not_found_for_vendor" });
      return;
    }
    const inv = data.invoices[0]!;

    const mapping = await getPushedInvoice(vendorId, "qbo", inv.invoiceNumber);
    if (!mapping?.externalInvoiceId) {
      res.status(412).json({
        error:
          "This invoice has not been pushed to QuickBooks yet. Run the QuickBooks push for this period first.",
        code: "qbo.not_pushed",
      });
      return;
    }

    const tokenResult = await getFreshQboAccessToken(vendorId);
    if ("error" in tokenResult) {
      res.status(tokenResult.status).json({ error: tokenResult.error, code: "accounting.token_error" });
      return;
    }

    // Re-resolve the item map for the line types this single invoice
    // uses. Re-syncs use the same Item references the original push
    // did, so we go through the same ensureQboItemMap path.
    let itemMap: Record<string, string> = {};
    let defaultItemId: string | undefined;
    try {
      const cached = await loadConnectionItemMap(tokenResult.connectionId);
      const desired = MAPPABLE_LINE_TYPES
        .filter((m) => m.key !== LINE_TYPE_AR && m.key !== LINE_TYPE_TAX_PAYABLE)
        .map((m) => ({
          lineType: m.key,
          account: data.resolver(m.key, { vendorId }),
        }));
      const ensured = await ensureQboItemMap(
        {
          existing: cached,
          desired,
          onResolve: async (entry) => {
            await upsertConnectionItem({
              connectionId: tokenResult.connectionId,
              lineType: entry.lineType,
              qboItemId: entry.qboItemId,
              qboAccountId: entry.qboAccountId,
              qboAccountName: entry.qboAccountName,
            });
          },
        },
        {
          accessToken: tokenResult.accessToken,
          realmId: tokenResult.realmId,
          environment: env,
        },
      );
      itemMap = ensured.itemMap;
      defaultItemId = itemMap.other;
    } catch (err) {
      logger.error(
        { err, vendorId, invoiceId },
        "QBO item map resolution failed during re-sync",
      );
      res.status(502).json({ error: (err as Error).message, code: "server.upstream_error" });
      return;
    }

    let result;
    try {
      result = await updateQboInvoice({
        accessToken: tokenResult.accessToken,
        realmId: tokenResult.realmId,
        externalInvoiceId: mapping.externalInvoiceId,
        bundle: data,
        itemMap,
        defaultItemId,
        environment: env,
      });
    } catch (err) {
      logger.error({ err, vendorId, invoiceId }, "QBO invoice re-sync failed");
      res.status(502).json({ error: (err as Error).message, code: "server.upstream_error" });
      return;
    }

    if (result.status === "missing") {
      // The remote invoice has been deleted in QBO. Surface a 409 so
      // the UI can prompt the operator to do a fresh bulk push.
      await recordExport({
        req,
        reportKind: "vendor.quickbooksPush",
        format: "qbo_api_resync",
        scope: {
          vendorId,
          invoiceId,
          invoiceNumber: inv.invoiceNumber,
          externalInvoiceId: mapping.externalInvoiceId,
          outcome: "missing",
        },
        rowCount: 0,
        fileBytes: 0,
        detailJson: { message: result.message },
      });
      res.status(409).json({
        error: result.message,
        code: "qbo.invoice_missing",
      });
      return;
    }

    await touchPushedInvoice(vendorId, "qbo", {
      invoiceNumber: inv.invoiceNumber,
      externalInvoiceId: result.externalInvoiceId,
      externalDocNumber: result.externalDocNumber ?? mapping.externalDocNumber,
    });

    const warnings = result.warning
      ? [{ kind: "invoice", identifier: inv.invoiceNumber, message: result.warning }]
      : [];
    const auditLogId = await recordExport({
      req,
      reportKind: "vendor.quickbooksPush",
      format: "qbo_api_resync",
      scope: {
        vendorId,
        invoiceId,
        invoiceNumber: inv.invoiceNumber,
        externalInvoiceId: result.externalInvoiceId,
        externalDocNumber: result.externalDocNumber,
        outcome: "updated",
        warningCount: warnings.length,
      },
      rowCount: 1,
      fileBytes: 0,
      detailJson: warnings.length > 0 ? { warnings } : null,
    });

    res.json({
      ok: true,
      provider: "qbo",
      auditLogId,
      invoiceNumber: inv.invoiceNumber,
      externalInvoiceId: result.externalInvoiceId,
      externalDocNumber: result.externalDocNumber,
      warnings,
    });
  },
);

// POST /reports/vendor/:vendorId/invoices/:invoiceId/oa-resync
router.post(
  "/reports/vendor/:vendorId/invoices/:invoiceId/oa-resync",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    const invoiceId = Number(req.params.invoiceId);
    if (!Number.isInteger(vendorId) || !Number.isInteger(invoiceId)) {
      res.status(400).json({ error: "Bad vendorId or invoiceId", code: "report.invalid_vendor_id_or_invoice_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;

    const data = await gatherSingleInvoiceForExport(vendorId, invoiceId);
    if (!data) {
      res.status(404).json({ error: "Invoice not found for this vendor.", code: "invoice.not_found_for_vendor" });
      return;
    }
    const inv = data.invoices[0]!;

    const mapping = await getPushedInvoice(vendorId, "oa", inv.invoiceNumber);
    if (!mapping?.externalInvoiceId) {
      res.status(412).json({
        error:
          "This invoice has not been pushed to OpenAccountant yet. Run the OpenAccountant push for this period first.",
        code: "oa.not_pushed",
      });
      return;
    }

    const tokenResult = await getFreshOaAccessToken(vendorId);
    if ("error" in tokenResult) {
      res.status(tokenResult.status).json({ error: tokenResult.error, code: "accounting.token_error" });
      return;
    }

    let result;
    try {
      result = await updateOaInvoice({
        apiKey: tokenResult.accessToken,
        baseUrl: tokenResult.baseUrl ?? undefined,
        externalInvoiceId: mapping.externalInvoiceId,
        bundle: data,
      });
    } catch (err) {
      logger.error({ err, vendorId, invoiceId }, "OA invoice re-sync failed");
      res.status(502).json({ error: (err as Error).message, code: "server.upstream_error" });
      return;
    }

    if (result.status === "missing") {
      await recordExport({
        req,
        reportKind: "vendor.openaccountantPush",
        format: "oa_api_resync",
        scope: {
          vendorId,
          invoiceId,
          invoiceNumber: inv.invoiceNumber,
          externalInvoiceId: mapping.externalInvoiceId,
          outcome: "missing",
        },
        rowCount: 0,
        fileBytes: 0,
        detailJson: { message: result.message },
      });
      res.status(409).json({
        error: result.message,
        code: "oa.invoice_missing",
      });
      return;
    }

    await touchPushedInvoice(vendorId, "oa", {
      invoiceNumber: inv.invoiceNumber,
      externalInvoiceId: result.externalInvoiceId,
      externalDocNumber: result.externalDocNumber ?? mapping.externalDocNumber,
    });

    const auditLogId = await recordExport({
      req,
      reportKind: "vendor.openaccountantPush",
      format: "oa_api_resync",
      scope: {
        vendorId,
        invoiceId,
        invoiceNumber: inv.invoiceNumber,
        externalInvoiceId: result.externalInvoiceId,
        externalDocNumber: result.externalDocNumber,
        outcome: "updated",
      },
      rowCount: 1,
      fileBytes: 0,
      detailJson: null,
    });

    res.json({
      ok: true,
      provider: "oa",
      auditLogId,
      invoiceNumber: inv.invoiceNumber,
      externalInvoiceId: result.externalInvoiceId,
      externalDocNumber: result.externalDocNumber,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// ADMIN
// ──────────────────────────────────────────────────────────────────

// GET /reports/admin/sales-tax — cross-org rollup, admin only
router.get("/reports/admin/sales-tax", requireAdmin, async (req, res): Promise<void> => {
  const period = parsePeriodOrError(req, res);
  if (!period) return;
  const { rows, totals } = await salesTaxByState({ period });
  const fmt = parseFormat(FormatJsonCsvPdf, req.query.format, "json");
  const scope = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
  };
  if (fmt === "json") {
    res.json({ rows, totals, period: formatPeriod(period) });
    return;
  }
  if (fmt === "csv") {
    const csv = toCsv(
      ["State", "TaxableSales", "ExemptSales", "TaxCollected", "EffectiveRate"],
      [
        ...rows.map((r) => [
          r.state,
          r.taxableSales,
          r.exemptSales,
          r.taxCollected,
          r.effectiveRate,
        ]),
        [
          "TOTAL",
          totals.taxableSales,
          totals.exemptSales,
          totals.taxCollected,
          totals.effectiveRate,
        ],
      ],
    );
    await sendBufferAndAudit(req, res, {
      buffer: Buffer.from(csv, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      filename: csvFilename(["sales-tax", "admin", period.label.replace(/\s+/g, "_")]),
      reportKind: "admin.salesTax",
      format: "csv",
      scope,
      rowCount: rows.length,
    });
    return;
  }
  if (fmt === "pdf") {
    const pdf = await renderReportPdf({
      title: "Sales Tax by State (All Vendors)",
      subtitle: `Admin rollup  ·  ${formatPeriod(period)}`,
      periodLabel: period.label,
      columns: [
        { header: "State", width: 1 },
        { header: "Taxable Sales", width: 1.5, align: "right" },
        { header: "Exempt Sales", width: 1.5, align: "right" },
        { header: "Tax Collected", width: 1.5, align: "right" },
        { header: "Eff. Rate", width: 1, align: "right" },
      ],
      rows: rows.map((r) => [
        r.state,
        r.taxableSales,
        r.exemptSales,
        r.taxCollected,
        r.effectiveRate,
      ]),
      totals: [
        "TOTAL",
        totals.taxableSales,
        totals.exemptSales,
        totals.taxCollected,
        totals.effectiveRate,
      ],
    });
    await sendBufferAndAudit(req, res, {
      buffer: pdf,
      contentType: "application/pdf",
      filename: csvFilename(["sales-tax", "admin", period.label], "pdf"),
      reportKind: "admin.salesTax",
      format: "pdf",
      scope,
      rowCount: rows.length,
    });
    return;
  }
});

// ──────────────────────────────────────────────────────────────────
// QB ACCOUNT MAPPING — overrides the built-in COA defaults per vendor,
// partner, or vendor+partner. Admins manage any scope; vendor admins can
// manage their own vendor scope only (see vendor-scoped routes below).
// ──────────────────────────────────────────────────────────────────

const MAPPABLE_KEYS = new Set(MAPPABLE_LINE_TYPES.map((m) => m.key));

const QbMappingScopeQuery = z.object({
  vendorId: z.coerce.number().int().optional(),
  partnerId: z.coerce.number().int().optional(),
});

const VendorQbMappingPartnerQuery = z.object({
  partnerId: z.coerce.number().int().optional(),
});

// GET /reports/vendor/:vendorId/qb-account-mapping?partnerId=
router.get(
  "/reports/vendor/:vendorId/qb-account-mapping",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const q = VendorQbMappingPartnerQuery.safeParse(req.query);
    if (!q.success) {
      sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
      return;
    }
    const partnerId = q.data.partnerId ?? null;
    const payload = await fetchQbMappingFormItems({ vendorId, partnerId });
    res.json(payload);
  },
);

const VendorQbMappingUpsertBody = z.object({
  partnerId: z.number().int().nullable().optional(),
  lineType: z.string().min(1),
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(50).nullable().optional(),
});

// PUT /reports/vendor/:vendorId/qb-account-mapping
router.put(
  "/reports/vendor/:vendorId/qb-account-mapping",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const body = VendorQbMappingUpsertBody.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }
    if (!MAPPABLE_KEYS.has(body.data.lineType)) {
      res.status(400).json({ error: "Unknown lineType", code: "report.unknown_line_type" });
      return;
    }
    const partnerId = body.data.partnerId ?? null;
    const accountNumber = body.data.accountNumber?.trim() || null;
    const accountName = body.data.accountName.trim();

    const existing = await db
      .select()
      .from(qbAccountMappingTable)
      .where(
        and(
          eq(qbAccountMappingTable.vendorId, vendorId),
          partnerId == null
            ? isNull(qbAccountMappingTable.partnerId)
            : eq(qbAccountMappingTable.partnerId, partnerId),
          eq(qbAccountMappingTable.lineType, body.data.lineType),
        ),
      );
    if (existing.length > 0) {
      const prev = existing[0];
      const [updated] = await db
        .update(qbAccountMappingTable)
        .set({ accountName, accountNumber })
        .where(eq(qbAccountMappingTable.id, prev.id))
        .returning();
      if (
        prev.accountName !== accountName ||
        (prev.accountNumber ?? null) !== accountNumber
      ) {
        await recordMappingAudit({
          req,
          action: "update",
          mappingId: updated.id,
          vendorId,
          partnerId,
          lineType: body.data.lineType,
          oldValues: {
            accountName: prev.accountName,
            accountNumber: prev.accountNumber ?? null,
          },
          newValues: { accountName, accountNumber },
        });
      }
      res.json({ override: updated });
      return;
    }
    const [created] = await db
      .insert(qbAccountMappingTable)
      .values({
        vendorId,
        partnerId,
        lineType: body.data.lineType,
        accountName,
        accountNumber,
      })
      .returning();
    await recordMappingAudit({
      req,
      action: "insert",
      mappingId: created.id,
      vendorId,
      partnerId,
      lineType: body.data.lineType,
      oldValues: null,
      newValues: { accountName, accountNumber },
    });
    res.json({ override: created });
  },
);

// DELETE /reports/vendor/:vendorId/qb-account-mapping/:id
router.delete(
  "/reports/vendor/:vendorId/qb-account-mapping/:id",
  async (req, res): Promise<void> => {
    const vendorId = Number(req.params.vendorId);
    const id = Number(req.params.id);
    if (!Number.isInteger(vendorId) || !Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id", code: "validation.invalid_id" });
      return;
    }
    if (!rbacVendor(req, res, vendorId)) return;
    const result = await db
      .delete(qbAccountMappingTable)
      .where(
        and(
          eq(qbAccountMappingTable.id, id),
          eq(qbAccountMappingTable.vendorId, vendorId),
        ),
      )
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Not found", code: "common.not_found" });
      return;
    }
    const removed = result[0];
    await recordMappingAudit({
      req,
      action: "delete",
      mappingId: removed.id,
      vendorId: removed.vendorId ?? null,
      partnerId: removed.partnerId ?? null,
      lineType: removed.lineType,
      oldValues: {
        accountName: removed.accountName,
        accountNumber: removed.accountNumber ?? null,
      },
      newValues: null,
    });
    res.json({ ok: true });
  },
);

// GET /reports/qb-account-mapping?vendorId=&partnerId=
// Returns one row per known line type, merging the override (if any) over
// the built-in default. The UI uses this directly to render the form.
router.get(
  "/reports/qb-account-mapping",
  requireAdmin,
  async (req, res): Promise<void> => {
    const q = QbMappingScopeQuery.safeParse(req.query);
    if (!q.success) {
      sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
      return;
    }
    const vendorId = q.data.vendorId ?? null;
    const partnerId = q.data.partnerId ?? null;
    const payload = await fetchQbMappingFormItems({ vendorId, partnerId });
    res.json(payload);
  },
);

const QbMappingUpsertBody = z.object({
  vendorId: z.number().int().nullable().optional(),
  partnerId: z.number().int().nullable().optional(),
  lineType: z.string().min(1),
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(50).nullable().optional(),
});

// PUT /reports/qb-account-mapping — upsert a single override row.
router.put(
  "/reports/qb-account-mapping",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = QbMappingUpsertBody.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }
    if (!MAPPABLE_KEYS.has(body.data.lineType)) {
      res.status(400).json({ error: "Unknown lineType", code: "report.unknown_line_type" });
      return;
    }
    const vendorId = body.data.vendorId ?? null;
    const partnerId = body.data.partnerId ?? null;
    const accountNumber = body.data.accountNumber?.trim() || null;
    const accountName = body.data.accountName.trim();

    // Drizzle's onConflictDoUpdate doesn't play nicely with a partial-unique
    // index over nullable columns (it gets indexed via NULLS-NOT-DISTINCT on
    // newer PG, but we want to stay portable). Do an explicit lookup.
    const existing = await db
      .select()
      .from(qbAccountMappingTable)
      .where(
        and(
          vendorId == null
            ? isNull(qbAccountMappingTable.vendorId)
            : eq(qbAccountMappingTable.vendorId, vendorId),
          partnerId == null
            ? isNull(qbAccountMappingTable.partnerId)
            : eq(qbAccountMappingTable.partnerId, partnerId),
          eq(qbAccountMappingTable.lineType, body.data.lineType),
        ),
      );
    if (existing.length > 0) {
      const prev = existing[0];
      const [updated] = await db
        .update(qbAccountMappingTable)
        .set({ accountName, accountNumber })
        .where(eq(qbAccountMappingTable.id, prev.id))
        .returning();
      // Skip the audit row if nothing actually changed: re-saving an
      // unchanged form shouldn't pollute the log.
      if (
        prev.accountName !== accountName ||
        (prev.accountNumber ?? null) !== accountNumber
      ) {
        await recordMappingAudit({
          req,
          action: "update",
          mappingId: updated.id,
          vendorId,
          partnerId,
          lineType: body.data.lineType,
          oldValues: {
            accountName: prev.accountName,
            accountNumber: prev.accountNumber ?? null,
          },
          newValues: { accountName, accountNumber },
        });
      }
      res.json({ override: updated });
      return;
    }
    const [created] = await db
      .insert(qbAccountMappingTable)
      .values({
        vendorId,
        partnerId,
        lineType: body.data.lineType,
        accountName,
        accountNumber,
      })
      .returning();
    await recordMappingAudit({
      req,
      action: "insert",
      mappingId: created.id,
      vendorId,
      partnerId,
      lineType: body.data.lineType,
      oldValues: null,
      newValues: { accountName, accountNumber },
    });
    res.json({ override: created });
  },
);

// DELETE /reports/qb-account-mapping/:id — clear one override and revert to default.
router.delete(
  "/reports/qb-account-mapping/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id", code: "validation.invalid_id" });
      return;
    }
    const result = await db
      .delete(qbAccountMappingTable)
      .where(eq(qbAccountMappingTable.id, id))
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Not found", code: "common.not_found" });
      return;
    }
    const removed = result[0];
    await recordMappingAudit({
      req,
      action: "delete",
      mappingId: removed.id,
      vendorId: removed.vendorId ?? null,
      partnerId: removed.partnerId ?? null,
      lineType: removed.lineType,
      oldValues: {
        accountName: removed.accountName,
        accountNumber: removed.accountNumber ?? null,
      },
      newValues: null,
    });
    res.json({ ok: true });
  },
);

// GET /reports/qb-account-mapping/audit — admin-only history of recent
// create / update / delete actions on mapping rows. Surfaced in
// Reports → Settings beside the mapping editor so finance can review who
// rerouted an account when an export looks wrong. Includes the actor's
// display name and partner / vendor names so the UI doesn't have to
// fan out follow-up requests.
//
// Filters (all optional, applied server-side so admins can drill down past
// the most recent 50 entries without scrolling): line type, vendor id,
// partner id, scope (vendor / partner / global), actor user id, and a
// date range. `limit`/`offset` paginate the result; the response carries
// `total` and `hasMore` so the UI can render a "Load more" button.
// `facets.actors` returns every distinct (id, displayName) pair that
// appears anywhere in the unfiltered audit log so the actor filter can
// offer a populated select even on the first render.
//
// `?format=csv` returns the FULL filtered audit log (no `limit` cap) as a
// CSV download for offline / compliance review (SOX, internal audit,
// sharing with partner ops). The download itself is recorded in
// `report_export_audit_log` via `sendBufferAndAudit` so we know who
// exported the audit log. The same filter set above applies to the CSV
// export so admins can scope the download.
const QbAuditQuerySchema = z.object({
  lineType: z.string().min(1).max(64).optional(),
  vendorId: z.coerce.number().int().positive().optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  scope: z.enum(["vendor", "partner", "global"]).optional(),
  startDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "invalid startDate")
    .optional(),
  endDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "invalid endDate")
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  format: z.enum(["json", "csv"]).optional(),
});

router.get(
  "/reports/qb-account-mapping/audit",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = QbAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid filter",
        code: "validation.invalid_input",
        details: parsed.error.flatten(),
      });
      return;
    }
    const q = parsed.data;
    const wantsCsv = q.format === "csv";
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;

    const conds = [] as ReturnType<typeof eq>[];
    if (q.lineType) {
      conds.push(eq(qbAccountMappingAuditLogTable.lineType, q.lineType));
    }
    if (q.vendorId != null) {
      conds.push(eq(qbAccountMappingAuditLogTable.vendorId, q.vendorId));
    }
    if (q.partnerId != null) {
      conds.push(eq(qbAccountMappingAuditLogTable.partnerId, q.partnerId));
    }
    if (q.actorUserId != null) {
      conds.push(eq(qbAccountMappingAuditLogTable.actorUserId, q.actorUserId));
    }
    if (q.scope === "vendor") {
      conds.push(
        isNotNull(qbAccountMappingAuditLogTable.vendorId) as ReturnType<
          typeof eq
        >,
      );
      conds.push(
        isNull(qbAccountMappingAuditLogTable.partnerId) as ReturnType<
          typeof eq
        >,
      );
    } else if (q.scope === "partner") {
      conds.push(
        isNotNull(qbAccountMappingAuditLogTable.partnerId) as ReturnType<
          typeof eq
        >,
      );
      conds.push(
        isNull(qbAccountMappingAuditLogTable.vendorId) as ReturnType<typeof eq>,
      );
    } else if (q.scope === "global") {
      conds.push(
        isNull(qbAccountMappingAuditLogTable.vendorId) as ReturnType<typeof eq>,
      );
      conds.push(
        isNull(qbAccountMappingAuditLogTable.partnerId) as ReturnType<
          typeof eq
        >,
      );
    }
    if (q.startDate) {
      conds.push(
        gte(
          qbAccountMappingAuditLogTable.createdAt,
          new Date(q.startDate),
        ) as ReturnType<typeof eq>,
      );
    }
    if (q.endDate) {
      // Inclusive end-of-day so admins can pass a YYYY-MM-DD value.
      const end = new Date(q.endDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.endDate)) {
        end.setUTCHours(23, 59, 59, 999);
      }
      conds.push(
        lte(
          qbAccountMappingAuditLogTable.createdAt,
          end,
        ) as ReturnType<typeof eq>,
      );
    }
    const whereExpr = conds.length === 0 ? undefined : and(...conds);

    const rowsQ = db
      .select({
        id: qbAccountMappingAuditLogTable.id,
        action: qbAccountMappingAuditLogTable.action,
        mappingId: qbAccountMappingAuditLogTable.mappingId,
        vendorId: qbAccountMappingAuditLogTable.vendorId,
        partnerId: qbAccountMappingAuditLogTable.partnerId,
        lineType: qbAccountMappingAuditLogTable.lineType,
        oldValues: qbAccountMappingAuditLogTable.oldValues,
        newValues: qbAccountMappingAuditLogTable.newValues,
        actorUserId: qbAccountMappingAuditLogTable.actorUserId,
        actorRole: qbAccountMappingAuditLogTable.actorRole,
        createdAt: qbAccountMappingAuditLogTable.createdAt,
        actorDisplayName: usersTable.displayName,
        actorUsername: usersTable.username,
        vendorName: vendorsTable.name,
        partnerName: partnersTable.name,
      })
      .from(qbAccountMappingAuditLogTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, qbAccountMappingAuditLogTable.actorUserId),
      )
      .leftJoin(
        vendorsTable,
        eq(vendorsTable.id, qbAccountMappingAuditLogTable.vendorId),
      )
      .leftJoin(
        partnersTable,
        eq(partnersTable.id, qbAccountMappingAuditLogTable.partnerId),
      );
    const orderedRowsQ = (whereExpr ? rowsQ.where(whereExpr) : rowsQ).orderBy(
      desc(qbAccountMappingAuditLogTable.createdAt),
      desc(qbAccountMappingAuditLogTable.id),
    );
    const rows = wantsCsv
      ? await orderedRowsQ
      : await orderedRowsQ.limit(limit).offset(offset);

    if (wantsCsv) {
      // Self-describing CSV: ISO timestamps so spreadsheets can sort
      // without locale guessing, vendor / partner identified by both id
      // and name (name may be blank if the row was hard-deleted), and
      // old/new account fields split into separate name + number cells
      // so the file works as both a human review and a machine diff.
      const csv = toCsv(
        [
          "when",
          "actor_display_name",
          "actor_username",
          "actor_role",
          "action",
          "vendor_id",
          "vendor_name",
          "partner_id",
          "partner_name",
          "line_type",
          "old_account_name",
          "old_account_number",
          "new_account_name",
          "new_account_number",
        ],
        rows.map((r) => {
          const oldVals = (r.oldValues ?? {}) as {
            accountName?: string | null;
            accountNumber?: string | null;
          };
          const newVals = (r.newValues ?? {}) as {
            accountName?: string | null;
            accountNumber?: string | null;
          };
          return [
            r.createdAt instanceof Date
              ? r.createdAt.toISOString()
              : String(r.createdAt ?? ""),
            r.actorDisplayName ?? "",
            r.actorUsername ?? "",
            r.actorRole,
            r.action,
            r.vendorId ?? "",
            r.vendorName ?? "",
            r.partnerId ?? "",
            r.partnerName ?? "",
            r.lineType,
            oldVals.accountName ?? "",
            oldVals.accountNumber ?? "",
            newVals.accountName ?? "",
            newVals.accountNumber ?? "",
          ];
        }),
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["qb-account-mapping", "audit"]),
        reportKind: "admin.qbMapping.audit",
        format: "csv",
        scope: {},
        rowCount: rows.length,
      });
      return;
    }

    const countQ = db
      .select({ value: sql<number>`count(*)::int` })
      .from(qbAccountMappingAuditLogTable);
    const countRows = await (whereExpr ? countQ.where(whereExpr) : countQ);
    const total = Number(countRows[0]?.value ?? 0);

    // Distinct actor list across the unfiltered audit log so the UI can
    // populate the actor filter on first render. Cheap because the audit
    // table stays small relative to the operational tables.
    const actorRows = await db
      .select({
        actorUserId: qbAccountMappingAuditLogTable.actorUserId,
        actorDisplayName: usersTable.displayName,
        actorUsername: usersTable.username,
      })
      .from(qbAccountMappingAuditLogTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, qbAccountMappingAuditLogTable.actorUserId),
      );
    const seenActors = new Set<number>();
    const actors: { id: number; displayName: string | null }[] = [];
    for (const a of actorRows) {
      if (a.actorUserId == null) continue;
      if (seenActors.has(a.actorUserId)) continue;
      seenActors.add(a.actorUserId);
      actors.push({
        id: a.actorUserId,
        displayName: a.actorDisplayName ?? a.actorUsername ?? null,
      });
    }

    res.json({
      rows,
      total,
      hasMore: offset + rows.length < total,
      facets: { actors },
    });
  },
);

// POST /reports/qb-account-mapping/bulk — apply one or more line-type
// overrides to a cross-product of selected vendors × partners. Either
// axis may be null/empty to mean "leave that axis unscoped" (the
// row's vendor_id / partner_id will be NULL). Used by the Settings UI's
// "Bulk apply" dialog and by CSV import.
const QbBulkItem = z.object({
  lineType: z.string().min(1),
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(50).nullable().optional(),
});
const QbBulkBody = z.object({
  vendorIds: z.array(z.number().int().positive()).nullable().optional(),
  partnerIds: z.array(z.number().int().positive()).nullable().optional(),
  items: z.array(QbBulkItem).min(1).max(50),
});

router.post(
  "/reports/qb-account-mapping/bulk",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = QbBulkBody.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }
    for (const it of body.data.items) {
      if (!MAPPABLE_KEYS.has(it.lineType)) {
        res.status(400).json({ error: `Unknown lineType: ${it.lineType}`, code: "report.unknown_line_type" });
        return;
      }
    }
    const scopes = expandBulkScopes({
      vendorIds: body.data.vendorIds ?? undefined,
      partnerIds: body.data.partnerIds ?? undefined,
    });
    if (scopes.length === 0) {
      res.status(400).json({ error: "No scopes to write", code: "report.no_scopes" });
      return;
    }
    // Cap the total rows we'll touch in one request so a runaway client
    // can't lock the table.
    const totalWrites = scopes.length * body.data.items.length;
    if (totalWrites > 5000) {
      res.status(400).json({
        error: `Bulk write would touch ${totalWrites} rows; limit is 5000.`,
        code: "report.bulk_write_too_large",
      });
      return;
    }
    let upserted = 0;
    const snapshots: QbBulkActionSnapshotEntry[] = [];
    await db.transaction(async (tx) => {
      // Snapshot every (scope, line_type) cell up-front so we can offer an
      // "Undo" that restores the prior state (or strips rows we created).
      const cells: BulkScopeKey[] = [];
      for (const scope of scopes) {
        for (const it of body.data.items) {
          cells.push({
            vendorId: scope.vendorId,
            partnerId: scope.partnerId,
            lineType: it.lineType,
          });
        }
      }
      const before = await loadCurrentMappingsForCells(tx, cells);
      for (const scope of scopes) {
        for (const it of body.data.items) {
          const accountNumber = it.accountNumber?.trim() || null;
          const accountName = it.accountName.trim();
          const cell: BulkScopeKey = {
            vendorId: scope.vendorId,
            partnerId: scope.partnerId,
            lineType: it.lineType,
          };
          const prev = before.get(snapshotKey(cell)) ?? null;
          if (prev) {
            await tx
              .update(qbAccountMappingTable)
              .set({ accountName, accountNumber })
              .where(eq(qbAccountMappingTable.id, prev.id));
          } else {
            await tx.insert(qbAccountMappingTable).values({
              vendorId: scope.vendorId,
              partnerId: scope.partnerId,
              lineType: it.lineType,
              accountName,
              accountNumber,
            });
          }
          snapshots.push({
            vendorId: scope.vendorId,
            partnerId: scope.partnerId,
            lineType: it.lineType,
            previous: prev
              ? {
                  accountName: prev.accountName,
                  accountNumber: prev.accountNumber,
                }
              : null,
            applied: { accountName, accountNumber },
          });
          upserted++;
        }
      }
    });
    const summary = `Bulk apply: ${scopes.length} scope(s) × ${body.data.items.length} line type(s) = ${upserted} cell(s)`;
    let actionId: number | null = null;
    try {
      actionId = await recordBulkAction({
        req,
        kind: "bulk_apply",
        summary,
        snapshots,
      });
    } catch (err) {
      // The write succeeded but we couldn't persist the snapshot. The user
      // already has the new values applied; we surface the issue but don't
      // hide the success — they can still manage it via the per-row UI.
      logger.error({ err }, "Bulk apply succeeded but snapshot recording failed");
    }
    res.json({
      upserted,
      scopes: scopes.length,
      items: body.data.items.length,
      actionId,
    });
  },
);

// GET /reports/qb-account-mapping/csv — export every override row as CSV
// for offline editing, joined with vendor/partner names so the file is
// human-readable. Re-import with POST /reports/qb-account-mapping/csv.
router.get(
  "/reports/qb-account-mapping/csv",
  requireAdmin,
  async (req, res): Promise<void> => {
    const rows = await db.select().from(qbAccountMappingTable);
    // Resolve vendor / partner names in two cheap lookups so the CSV is
    // useful for humans (the IDs alone are opaque). We tolerate missing
    // names — orphaned rows still appear, just without a label.
    const vendorIds = Array.from(
      new Set(
        rows.map((r) => r.vendorId).filter((v): v is number => v != null),
      ),
    );
    const partnerIds = Array.from(
      new Set(
        rows.map((r) => r.partnerId).filter((v): v is number => v != null),
      ),
    );
    const vendorNames = new Map<number, string>();
    if (vendorIds.length > 0) {
      const vs = await db
        .select({ id: vendorsTable.id, name: vendorsTable.name })
        .from(vendorsTable)
        .where(inArray(vendorsTable.id, vendorIds));
      for (const v of vs) vendorNames.set(v.id, v.name);
    }
    const partnerNames = new Map<number, string>();
    if (partnerIds.length > 0) {
      const ps = await db
        .select({ id: partnersTable.id, name: partnersTable.name })
        .from(partnersTable)
        .where(inArray(partnersTable.id, partnerIds));
      for (const p of ps) partnerNames.set(p.id, p.name);
    }
    const lineTypeLabels = new Map(
      MAPPABLE_LINE_TYPES.map((m) => [m.key, m.label] as const),
    );
    // Stable sort: global rows first, then by vendor id, then partner id, then line_type.
    const sorted = [...rows].sort((a, b) => {
      const av = a.vendorId ?? -1;
      const bv = b.vendorId ?? -1;
      if (av !== bv) return av - bv;
      const ap = a.partnerId ?? -1;
      const bp = b.partnerId ?? -1;
      if (ap !== bp) return ap - bp;
      return a.lineType.localeCompare(b.lineType);
    });
    const csv = toCsv(
      [
        "vendor_id",
        "vendor_name",
        "partner_id",
        "partner_name",
        "line_type",
        "line_type_label",
        "account_name",
        "account_number",
      ],
      sorted.map((r) => [
        r.vendorId ?? "",
        r.vendorId == null ? "" : vendorNames.get(r.vendorId) ?? "",
        r.partnerId ?? "",
        r.partnerId == null ? "" : partnerNames.get(r.partnerId) ?? "",
        r.lineType,
        lineTypeLabels.get(r.lineType) ?? "",
        r.accountName,
        r.accountNumber ?? "",
      ]),
    );
    await sendBufferAndAudit(req, res, {
      buffer: Buffer.from(csv, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      filename: csvFilename(["qb-account-mapping"]),
      reportKind: "admin.qbMapping",
      format: "csv",
      scope: {},
      rowCount: sorted.length,
    });
  },
);

// POST /reports/qb-account-mapping/csv — import a previously-exported (or
// hand-edited) mapping CSV. Body: { csv: string, dryRun?: boolean }.
//
// When `dryRun` is truthy, parses + classifies the rows against the
// existing table and returns a preview ({ inserts, updates, unchanged,
// errors }) without writing anything. The UI uses this to render an
// "Apply N rows?" confirmation before any DB write happens.
//
// When `dryRun` is omitted or false, returns the number of rows upserted
// plus per-row validation errors. Successful rows are applied even when
// other rows fail, but the whole batch is wrapped in a transaction so a
// runtime DB error rolls everything back.
const QbCsvImportBody = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().optional(),
});

router.post(
  "/reports/qb-account-mapping/csv",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = QbCsvImportBody.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }
    const parsed = parseQbMappingCsv(body.data.csv, MAPPABLE_KEYS);
    // Dry-run path — never writes. Returns even when there are no valid
    // rows so the UI can show parse errors inline in the preview dialog.
    if (body.data.dryRun) {
      const existingRows = await db.select().from(qbAccountMappingTable);
      const preview = classifyCsvImport(
        parsed,
        existingRows.map((r) => ({
          vendorId: r.vendorId,
          partnerId: r.partnerId,
          lineType: r.lineType,
          accountName: r.accountName,
          accountNumber: r.accountNumber,
        })),
      );
      // Resolve vendor / partner names for any scope that appears in the
      // preview so the dialog can show "Acme · Foo Partner" instead of
      // raw ids. Cheap two-IN queries; tolerate missing names.
      const allRows = [
        ...preview.inserts,
        ...preview.updates,
        ...preview.unchanged,
      ];
      const vendorIds = Array.from(
        new Set(
          allRows
            .map((r) => r.vendorId)
            .filter((v): v is number => v != null),
        ),
      );
      const partnerIds = Array.from(
        new Set(
          allRows
            .map((r) => r.partnerId)
            .filter((v): v is number => v != null),
        ),
      );
      const vendorNames: Record<number, string> = {};
      if (vendorIds.length > 0) {
        const vs = await db
          .select({ id: vendorsTable.id, name: vendorsTable.name })
          .from(vendorsTable)
          .where(inArray(vendorsTable.id, vendorIds));
        for (const v of vs) vendorNames[v.id] = v.name;
      }
      const partnerNames: Record<number, string> = {};
      if (partnerIds.length > 0) {
        const ps = await db
          .select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, partnerIds));
        for (const p of ps) partnerNames[p.id] = p.name;
      }
      res.json({
        dryRun: true,
        inserts: preview.inserts,
        updates: preview.updates,
        unchanged: preview.unchanged,
        errors: preview.errors,
        vendorNames,
        partnerNames,
      });
      return;
    }
    if (parsed.rows.length === 0) {
      res.status(400).json({
        error: "No valid rows found", code: "report.no_valid_rows",
        upserted: 0,
        errors: parsed.errors,
      });
      return;
    }
    let upserted = 0;
    const snapshots: QbBulkActionSnapshotEntry[] = [];
    await db.transaction(async (tx) => {
      const cells: BulkScopeKey[] = parsed.rows.map((r) => ({
        vendorId: r.vendorId,
        partnerId: r.partnerId,
        lineType: r.lineType,
      }));
      const before = await loadCurrentMappingsForCells(tx, cells);
      for (const row of parsed.rows) {
        const cell: BulkScopeKey = {
          vendorId: row.vendorId,
          partnerId: row.partnerId,
          lineType: row.lineType,
        };
        const prev = before.get(snapshotKey(cell)) ?? null;
        if (prev) {
          await tx
            .update(qbAccountMappingTable)
            .set({
              accountName: row.accountName,
              accountNumber: row.accountNumber,
            })
            .where(eq(qbAccountMappingTable.id, prev.id));
        } else {
          await tx.insert(qbAccountMappingTable).values({
            vendorId: row.vendorId,
            partnerId: row.partnerId,
            lineType: row.lineType,
            accountName: row.accountName,
            accountNumber: row.accountNumber,
          });
        }
        snapshots.push({
          vendorId: row.vendorId,
          partnerId: row.partnerId,
          lineType: row.lineType,
          previous: prev
            ? {
                accountName: prev.accountName,
                accountNumber: prev.accountNumber,
              }
            : null,
          applied: {
            accountName: row.accountName,
            accountNumber: row.accountNumber,
          },
        });
        upserted++;
      }
    });
    let actionId: number | null = null;
    if (snapshots.length > 0) {
      const summary = `CSV import: ${upserted} row(s) upserted`;
      try {
        actionId = await recordBulkAction({
          req,
          kind: "csv_import",
          summary,
          snapshots,
        });
      } catch (err) {
        logger.error(
          { err },
          "CSV import succeeded but snapshot recording failed",
        );
      }
    }
    res.json({
      upserted,
      errors: parsed.errors,
      actionId,
    });
  },
);

// GET /reports/qb-account-mapping/bulk-actions — list recent bulk-apply
// and CSV-import actions so the UI can offer "Undo" even after a page
// reload. Returns the actions in reverse-chronological order. The History
// dialog renders the full list; the card banner just uses the first
// non-undone row.
//
// Per-row `hasNewerOverlap` / `overlappingActionIds` are computed from
// the loaded snapshots so the UI can warn an admin that undoing an older
// change will replay snapshot values for cells a newer action has
// already rewritten. Computed in-memory across the requested window
// (capped at 100 rows) to avoid extra queries.
router.get(
  "/reports/qb-account-mapping/bulk-actions",
  requireAdmin,
  async (req, res): Promise<void> => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    // Source the retention window from the shared (DB-aware) helper that
    // the cleanup worker also uses — admin-set `platform_settings`
    // override, then env var, then code default — so the UI's
    // "Undo available for N days" copy can't drift from what actually
    // gets pruned. `expiresSoonDays` shares the same env-var pattern,
    // is bounded by the resolved retentionDays, and is surfaced so the
    // UI can render the "expires soon" badge threshold consistently
    // with the worker that emails warnings.
    const retentionDays = await getBulkActionRetentionDays();
    const expiresSoonDays = getBulkActionExpiresSoonDays(retentionDays);
    const now = new Date();
    const rows = await db
      .select({
        id: qbAccountMappingBulkActionsTable.id,
        kind: qbAccountMappingBulkActionsTable.kind,
        summary: qbAccountMappingBulkActionsTable.summary,
        snapshots: qbAccountMappingBulkActionsTable.snapshots,
        actorUserId: qbAccountMappingBulkActionsTable.actorUserId,
        actorRole: qbAccountMappingBulkActionsTable.actorRole,
        actorDisplayName: usersTable.displayName,
        actorUsername: usersTable.username,
        createdAt: qbAccountMappingBulkActionsTable.createdAt,
        undoneAt: qbAccountMappingBulkActionsTable.undoneAt,
        undoneByUserId: qbAccountMappingBulkActionsTable.undoneByUserId,
      })
      .from(qbAccountMappingBulkActionsTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, qbAccountMappingBulkActionsTable.actorUserId),
      )
      .orderBy(desc(qbAccountMappingBulkActionsTable.createdAt))
      .limit(limit);

    // Pre-compute scope-key sets for overlap detection. Rows are in
    // reverse-chronological order, so a "newer" action sits at a
    // smaller index than an "older" one.
    const scopeKeysByRow = rows.map((r) =>
      Array.isArray(r.snapshots)
        ? new Set(r.snapshots.map((s) => snapshotKey(s)))
        : new Set<string>(),
    );

    // Resolve display names for the undoneBy actors in a single extra
    // round-trip (the main join only covers actorUserId).
    const undoneByIds = Array.from(
      new Set(
        rows
          .map((r) => r.undoneByUserId)
          .filter((v): v is number => v != null),
      ),
    );
    const undoneByLookup = new Map<
      number,
      { displayName: string; username: string }
    >();
    if (undoneByIds.length > 0) {
      const undoUsers = await db
        .select({
          id: usersTable.id,
          displayName: usersTable.displayName,
          username: usersTable.username,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, undoneByIds));
      for (const u of undoUsers) {
        undoneByLookup.set(u.id, {
          displayName: u.displayName,
          username: u.username,
        });
      }
    }

    // Trim the snapshot blob down to a count for list rows so the
    // response stays small; the UI doesn't need every cell.
    const lite = rows.map((r, idx) => {
      const myKeys = scopeKeysByRow[idx];
      const overlappingActionIds: number[] = [];
      // Distinct (vendor, partner) ids touched by this action's
      // snapshot, plus a flag for the "applies to all vendors/partners"
      // sentinel (snapshot row with `vendorId: null` / `partnerId:
      // null`). Surfaced so the History dialog's "Show in mapping
      // table" jump can pre-narrow the mapping card's vendor/partner
      // dropdowns to just the entities that the action actually
      // touched, without the UI having to re-fetch the full snapshot.
      const affectedVendorIdSet = new Set<number>();
      const affectedPartnerIdSet = new Set<number>();
      let affectedIncludesGlobalVendor = false;
      let affectedIncludesGlobalPartner = false;
      if (Array.isArray(r.snapshots)) {
        for (const s of r.snapshots) {
          if (s.vendorId == null) affectedIncludesGlobalVendor = true;
          else affectedVendorIdSet.add(s.vendorId);
          if (s.partnerId == null) affectedIncludesGlobalPartner = true;
          else affectedPartnerIdSet.add(s.partnerId);
        }
      }
      // Only non-undone actions can be undone; overlap warnings only
      // matter for those. Walk newer (smaller index) non-undone rows
      // and collect any whose keys intersect.
      if (r.undoneAt == null && myKeys.size > 0) {
        for (let j = 0; j < idx; j++) {
          if (rows[j].undoneAt != null) continue;
          const otherKeys = scopeKeysByRow[j];
          if (otherKeys.size === 0) continue;
          let hit = false;
          for (const k of otherKeys) {
            if (myKeys.has(k)) {
              hit = true;
              break;
            }
          }
          if (hit) overlappingActionIds.push(rows[j].id);
        }
      }
      const undoneBy = r.undoneByUserId != null
        ? undoneByLookup.get(r.undoneByUserId) ?? null
        : null;
      // Compute the retention deadline for this row so the UI can
      // render "Undo available for N more day(s)" copy and hide the
      // Undo button entirely on rows past the window. We deliberately
      // ignore the cleanup worker's `minRetained` floor here: that
      // floor protects rows from physical deletion but the snapshot is
      // still considered stale for undo purposes, and surfacing
      // "expired" consistently with retentionDays is what the task
      // calls for.
      const { expiresAt, isExpired, expiresSoon } =
        computeBulkActionRetentionExpiry(
          r.createdAt,
          retentionDays,
          now,
          expiresSoonDays,
        );
      return {
        id: r.id,
        kind: r.kind,
        summary: r.summary,
        snapshotCount: Array.isArray(r.snapshots) ? r.snapshots.length : 0,
        actorUserId: r.actorUserId,
        actorRole: r.actorRole,
        actorDisplayName: r.actorDisplayName,
        actorUsername: r.actorUsername,
        createdAt: r.createdAt,
        undoneAt: r.undoneAt,
        undoneByUserId: r.undoneByUserId,
        undoneByDisplayName: undoneBy?.displayName ?? null,
        undoneByUsername: undoneBy?.username ?? null,
        hasNewerOverlap: overlappingActionIds.length > 0,
        overlappingActionIds,
        expiresAt,
        isExpired,
        expiresSoon,
        // Sort the affected-id arrays for stable client-side dedup and
        // diff-friendly snapshot tests.
        affectedVendorIds: Array.from(affectedVendorIdSet).sort(
          (a, b) => a - b,
        ),
        affectedPartnerIds: Array.from(affectedPartnerIdSet).sort(
          (a, b) => a - b,
        ),
        affectedIncludesGlobalVendor,
        affectedIncludesGlobalPartner,
      };
    });
    res.json({ rows: lite, retentionDays, expiresSoonDays });
  },
);

// GET /reports/qb-account-mapping/bulk-actions/cleanup-audit — admin-only
// list of every cleanup run. Each row records who ran the cleanup, when,
// how many rows it removed, and the resolved retention policy at the
// time of the run. Both on-demand admin runs and the scheduled
// background sweep (Task #809) are recorded — system sweeps surface as
// `actorUserId = null` + `actorRole = "system"` and are rendered as
// "System (scheduled)" by the UI. Dry-run preview calls are NOT
// recorded — see the `qb_account_mapping_cleanup_audit` schema notes.
//
// Returned in reverse-chronological order so the UI can show "most
// recent runs first" without re-sorting client-side. `limit` is capped
// at 100 to mirror the bulk-actions list endpoint above; the UI shows
// the most recent ~10 inline inside BulkActionsHistoryDialog.
//
// `?format=csv` returns the FULL audit log (all rows, no `limit` cap)
// as a CSV download for offline / compliance review. Cleanup runs are
// rare and only ever triggered by humans, so even a long-lived
// deployment should comfortably fit the entire history into a single
// file. Columns mirror the on-screen dialog plus the policy fields the
// table doesn't render inline (`protectedRecent`, `cutoff`).
//
// IMPORTANT: this route MUST be declared before the `:id` route below,
// otherwise Express matches `/cleanup-audit` against `:id` first and
// returns a 400 from the integer-id guard.
router.get(
  "/reports/qb-account-mapping/bulk-actions/cleanup-audit",
  requireAdmin,
  async (req, res): Promise<void> => {
    const wantsCsv = String(req.query.format ?? "").toLowerCase() === "csv";
    // Default to 20, treat NaN/<=0 as the default rather than collapsing
    // to the lower bound, then clamp valid integers into [1, 100]. The
    // CSV path ignores `limit` entirely and ships every row so admins
    // get the full audit trail in one file.
    const limitRaw = Number(req.query.limit ?? 20);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.max(Math.floor(limitRaw), 1), 100)
        : 20;
    const baseQuery = db
      .select({
        id: qbAccountMappingCleanupAuditTable.id,
        actorUserId: qbAccountMappingCleanupAuditTable.actorUserId,
        actorRole: qbAccountMappingCleanupAuditTable.actorRole,
        actorDisplayName: usersTable.displayName,
        actorUsername: usersTable.username,
        deletedCount: qbAccountMappingCleanupAuditTable.deletedCount,
        protectedRecent: qbAccountMappingCleanupAuditTable.protectedRecent,
        retentionDays: qbAccountMappingCleanupAuditTable.retentionDays,
        minRetained: qbAccountMappingCleanupAuditTable.minRetained,
        cutoff: qbAccountMappingCleanupAuditTable.cutoff,
        createdAt: qbAccountMappingCleanupAuditTable.createdAt,
      })
      .from(qbAccountMappingCleanupAuditTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, qbAccountMappingCleanupAuditTable.actorUserId),
      )
      .orderBy(desc(qbAccountMappingCleanupAuditTable.createdAt));
    const rows = wantsCsv ? await baseQuery : await baseQuery.limit(limit);

    if (wantsCsv) {
      // Self-describing CSV: ISO timestamps so spreadsheets can sort
      // without locale guessing, and the actor's display name + username
      // split across two columns so a reviewer can distinguish two
      // admins who happen to share a friendly name. `who_*` cells are
      // intentionally blank when the actor's user record was deleted
      // (FK is `set null`); the `role` cell still tells the auditor it
      // was an admin run.
      const csv = toCsv(
        [
          "when",
          "who_display_name",
          "who_username",
          "role",
          "deleted_count",
          "retention_days",
          "min_retained",
          "protected_recent",
          "cutoff",
        ],
        rows.map((r) => [
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt ?? ""),
          r.actorDisplayName ?? "",
          r.actorUsername ?? "",
          r.actorRole,
          r.deletedCount,
          r.retentionDays,
          r.minRetained,
          r.protectedRecent,
          r.cutoff instanceof Date
            ? r.cutoff.toISOString()
            : String(r.cutoff ?? ""),
        ]),
      );
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(csv, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(["qb-bulk-action", "cleanup-audit"]),
        reportKind: "admin.qbMapping.cleanupAudit",
        format: "csv",
        scope: {},
        rowCount: rows.length,
      });
      return;
    }

    res.json({ rows });
  },
);

// GET /reports/qb-account-mapping/bulk-actions/:id — return a single
// bulk action with its full per-cell snapshot, sliced by `?offset` /
// `?limit` so a 5,000-cell CSV import doesn't ship 5,000 rows over the
// wire on a single request. Vendor and partner names are resolved for
// the slice (using a single batched lookup each) so the UI can show
// human-readable labels without a second round-trip.
//
// `?q=` is a case-insensitive substring filter applied across vendor
// name, partner name, line type, and previous/applied account
// name+number. Filtering runs over the FULL snapshot before
// pagination so a 5,000-cell import can be searched without paging
// through 25 pages by hand. `snapshotCount` reflects the post-filter
// total so the UI's range/page math stays correct.
//
// `?lineType=`, `?vendorId=`, and `?partnerId=` apply exact-match
// scope filters on top of `?q=`. They're cheap (id / string equality
// over the in-memory snapshot) and let an accountant pull only the
// cells they care about — e.g. all "labor_regular" rows for one
// vendor — without exporting the full CSV and filtering in Excel.
// `vendorId=_all` / `partnerId=_all` matches snapshot rows whose
// scope was the "all vendors" / "all partners" sentinel (vendorId or
// partnerId was null). All filters compose with one another and with
// `?q=` and `?format=csv`.
//
// `?format=csv` returns the FULL snapshot (all cells, no pagination)
// as a CSV download for offline auditing. Vendor/partner cells scoped
// to "all" render explicitly as "All vendors" / "All partners" so the
// file is self-describing.
router.get(
  "/reports/qb-account-mapping/bulk-actions/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Bad id", code: "validation.invalid_id" });
      return;
    }
    const wantsCsv = String(req.query.format ?? "").toLowerCase() === "csv";
    const offsetRaw = Number(req.query.offset ?? 0);
    const limitRaw = Number(req.query.limit ?? 200);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0
      ? Math.floor(offsetRaw)
      : 0;
    // Cap the per-request slice so a misconfigured client can't pull a
    // 5,000-row payload in one shot. 500 is comfortably above the 200
    // page size the UI uses by default.
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 500)
      : 200;
    const qRaw = typeof req.query.q === "string" ? req.query.q : "";
    // Cap the search term to a sane length so a pathological request
    // can't ship a multi-MB regex-style payload. 200 chars is well
    // beyond any meaningful vendor/partner/account name combination.
    const q = qRaw.trim().slice(0, 200).toLowerCase();

    // Exact-match scope filters. `lineType` is the raw enum key (e.g.
    // "labor_regular"); we compare snapshot.lineType verbatim. The
    // vendor/partner filters accept either a positive integer id (match
    // that specific vendor/partner) or the literal "_all" sentinel
    // (match snapshot rows whose scope was the "all vendors" / "all
    // partners" null-id sentinel). Anything else (negative numbers,
    // garbage strings) is treated as "no filter" so a malformed query
    // string degrades to the unfiltered behavior rather than 400-ing.
    const lineTypeRaw =
      typeof req.query.lineType === "string" ? req.query.lineType.trim() : "";
    const lineTypeFilter = lineTypeRaw.length > 0 ? lineTypeRaw.slice(0, 64) : null;

    function parseScopeFilter(
      raw: unknown,
    ): { active: false } | { active: true; id: number | null } {
      if (typeof raw !== "string" || raw.length === 0) return { active: false };
      if (raw === "_all") return { active: true, id: null };
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) return { active: true, id: n };
      return { active: false };
    }
    const vendorFilter = parseScopeFilter(req.query.vendorId);
    const partnerFilter = parseScopeFilter(req.query.partnerId);

    const [action] = await db
      .select({
        id: qbAccountMappingBulkActionsTable.id,
        kind: qbAccountMappingBulkActionsTable.kind,
        summary: qbAccountMappingBulkActionsTable.summary,
        snapshots: qbAccountMappingBulkActionsTable.snapshots,
        actorUserId: qbAccountMappingBulkActionsTable.actorUserId,
        actorRole: qbAccountMappingBulkActionsTable.actorRole,
        actorDisplayName: usersTable.displayName,
        actorUsername: usersTable.username,
        createdAt: qbAccountMappingBulkActionsTable.createdAt,
        undoneAt: qbAccountMappingBulkActionsTable.undoneAt,
        undoneByUserId: qbAccountMappingBulkActionsTable.undoneByUserId,
      })
      .from(qbAccountMappingBulkActionsTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, qbAccountMappingBulkActionsTable.actorUserId),
      )
      .where(eq(qbAccountMappingBulkActionsTable.id, id));

    if (!action) {
      res.status(404).json({ error: "Bulk action not found", code: "report.bulk_action_not_found" });
      return;
    }

    const allSnapshots: QbBulkActionSnapshotEntry[] = Array.isArray(
      action.snapshots,
    )
      ? action.snapshots
      : [];

    // Apply the cheap exact-match scope filters first (line type,
    // vendor id, partner id). They run in-memory over the FULL
    // snapshot before pagination so `snapshotCount` reflects the true
    // post-filter total — otherwise "Page 1 of N" would describe rows
    // the user can never reach. These filters compose with `?q=`
    // below, which is why we narrow the working set up front.
    let scoped: QbBulkActionSnapshotEntry[] = allSnapshots;
    if (lineTypeFilter != null) {
      scoped = scoped.filter((s) => s.lineType === lineTypeFilter);
    }
    if (vendorFilter.active) {
      scoped = scoped.filter((s) => s.vendorId === vendorFilter.id);
    }
    if (partnerFilter.active) {
      scoped = scoped.filter((s) => s.partnerId === partnerFilter.id);
    }

    // When `?q=` is set we have to filter across the FULL (already
    // scope-filtered) snapshot, not just the page slice — otherwise
    // the search would only ever match rows the client already had
    // locally. To match against vendor and partner names we therefore
    // resolve names for every distinct vendor/partner id in the
    // working set, not just the slice's. The unfiltered code path
    // below still scopes the lookup to the slice for efficiency.
    const wantsFilter = q.length > 0;
    const filterScope = wantsFilter ? scoped : null;

    let filteredSnapshots: QbBulkActionSnapshotEntry[] = scoped;
    const vendorNames = new Map<number, string>();
    const partnerNames = new Map<number, string>();

    if (filterScope) {
      const allVendorIds = Array.from(
        new Set(
          filterScope
            .map((s) => s.vendorId)
            .filter((v): v is number => v != null),
        ),
      );
      const allPartnerIds = Array.from(
        new Set(
          filterScope
            .map((s) => s.partnerId)
            .filter((v): v is number => v != null),
        ),
      );
      if (allVendorIds.length > 0) {
        const rows = await db
          .select({ id: vendorsTable.id, name: vendorsTable.name })
          .from(vendorsTable)
          .where(inArray(vendorsTable.id, allVendorIds));
        for (const r of rows) vendorNames.set(r.id, r.name);
      }
      if (allPartnerIds.length > 0) {
        const rows = await db
          .select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, allPartnerIds));
        for (const r of rows) partnerNames.set(r.id, r.name);
      }

      filteredSnapshots = scoped.filter((s) => {
        const vendorLabel = s.vendorId == null
          ? "all vendors"
          : (vendorNames.get(s.vendorId) ?? "").toLowerCase();
        const partnerLabel = s.partnerId == null
          ? "all partners"
          : (partnerNames.get(s.partnerId) ?? "").toLowerCase();
        const haystack = [
          vendorLabel,
          partnerLabel,
          s.lineType.toLowerCase(),
          (s.previous?.accountName ?? "").toLowerCase(),
          (s.previous?.accountNumber ?? "").toLowerCase(),
          s.applied.accountName.toLowerCase(),
          (s.applied.accountNumber ?? "").toLowerCase(),
        ];
        for (const h of haystack) {
          if (h.includes(q)) return true;
        }
        return false;
      });
    }

    // `snapshotCount` is the count the UI uses to drive pagination, so
    // it must reflect the filtered total — otherwise "Page 1 of N" and
    // the range copy would describe rows the user can never reach.
    const snapshotCount = filteredSnapshots.length;

    // CSV export ships every cell so admins can audit a 5,000-cell import
    // without paging; the JSON variant keeps the existing offset/limit
    // contract for the in-app paginated table.
    const slice = wantsCsv
      ? filteredSnapshots
      : filteredSnapshots.slice(offset, offset + limit);

    // Resolve vendor + partner names for whatever rows we're about to
    // render. A null id in a snapshot means "applies to all vendors" /
    // "applies to all partners" and is rendered specially by both the UI
    // and the CSV — no lookup needed. When a filter was applied above we
    // already have names cached from the full-snapshot lookup; otherwise
    // we batch-fetch only the slice's ids to keep the response cheap.
    if (!wantsFilter) {
      const vendorIds = Array.from(
        new Set(
          slice
            .map((s) => s.vendorId)
            .filter((v): v is number => v != null),
        ),
      );
      const partnerIds = Array.from(
        new Set(
          slice
            .map((s) => s.partnerId)
            .filter((v): v is number => v != null),
        ),
      );
      if (vendorIds.length > 0) {
        const rows = await db
          .select({ id: vendorsTable.id, name: vendorsTable.name })
          .from(vendorsTable)
          .where(inArray(vendorsTable.id, vendorIds));
        for (const r of rows) vendorNames.set(r.id, r.name);
      }
      if (partnerIds.length > 0) {
        const rows = await db
          .select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, partnerIds));
        for (const r of rows) partnerNames.set(r.id, r.name);
      }
    }

    // CSV download path: write every cell out as a self-describing row.
    // The "all vendors" / "all partners" sentinels are inlined as text
    // so the CSV alone makes sense to an accountant who never sees the
    // dialog. Deleted vendors/partners fall back to their stable id so
    // the audit trail isn't silently dropped.
    if (wantsCsv) {
      // When any filter (free-text search or scope filter) is active, the
      // CSV is a partial view of the snapshot rather than the full audit
      // trail. Mark it as such in both the filename and as a leading
      // header comment so an accountant who receives the file alone can
      // tell it isn't the complete export.
      const isFiltered =
        wantsFilter ||
        lineTypeFilter != null ||
        vendorFilter.active ||
        partnerFilter.active;
      const filenameParts = ["qb-bulk-action", String(action.id)];
      if (isFiltered) filenameParts.push("filtered");
      const csv = toCsv(
        [
          "vendor",
          "partner",
          "line_type",
          "previous_account_name",
          "previous_account_number",
          "applied_account_name",
          "applied_account_number",
        ],
        slice.map((s) => [
          s.vendorId == null
            ? "All vendors"
            : vendorNames.get(s.vendorId) ?? `Vendor #${s.vendorId} (deleted)`,
          s.partnerId == null
            ? "All partners"
            : partnerNames.get(s.partnerId) ??
              `Partner #${s.partnerId} (deleted)`,
          s.lineType,
          s.previous?.accountName ?? "",
          s.previous?.accountNumber ?? "",
          s.applied.accountName,
          s.applied.accountNumber ?? "",
        ]),
      );
      // Prepend a `#`-prefixed banner line when the export is filtered so
      // recipients viewing the raw file (Excel will still surface it as
      // the first row) can see this is a partial slice. Most CSV import
      // wizards either skip `#` lines or let the user mark a header row
      // manually, so this stays out of the way of automated import flows
      // while remaining visible during a human review.
      const body = isFiltered
        ? `# Filtered export — ${snapshotCount} of ${allSnapshots.length} cell(s) shown\r\n${csv}`
        : csv;
      await sendBufferAndAudit(req, res, {
        buffer: Buffer.from(body, "utf-8"),
        contentType: "text/csv; charset=utf-8",
        filename: csvFilename(filenameParts),
        reportKind: "admin.qbMapping.bulkActionDetails",
        format: "csv",
        scope: { bulkActionId: action.id, kind: action.kind },
        rowCount: snapshotCount,
      });
      return;
    }

    // Resolve the undoneBy actor name in a single extra select.
    let undoneByDisplayName: string | null = null;
    let undoneByUsername: string | null = null;
    if (action.undoneByUserId != null) {
      const [u] = await db
        .select({
          displayName: usersTable.displayName,
          username: usersTable.username,
        })
        .from(usersTable)
        .where(eq(usersTable.id, action.undoneByUserId));
      undoneByDisplayName = u?.displayName ?? null;
      undoneByUsername = u?.username ?? null;
    }

    const cells = slice.map((s) => ({
      vendorId: s.vendorId,
      vendorName: s.vendorId == null ? null : vendorNames.get(s.vendorId) ?? null,
      partnerId: s.partnerId,
      partnerName:
        s.partnerId == null ? null : partnerNames.get(s.partnerId) ?? null,
      lineType: s.lineType,
      previous: s.previous,
      applied: s.applied,
    }));

    res.json({
      id: action.id,
      kind: action.kind,
      summary: action.summary,
      actorUserId: action.actorUserId,
      actorRole: action.actorRole,
      actorDisplayName: action.actorDisplayName,
      actorUsername: action.actorUsername,
      createdAt: action.createdAt,
      undoneAt: action.undoneAt,
      undoneByUserId: action.undoneByUserId,
      undoneByDisplayName,
      undoneByUsername,
      snapshotCount,
      offset,
      limit,
      cells,
    });
  },
);

// GET /reports/qb-account-mapping/bulk-actions/:id/downloads — list
// every "Download CSV" event recorded for a single bulk action so an
// admin can answer "which accountant got a copy of this CSV import"
// during a compliance review. Each row in
// `report_export_audit_log` written by the CSV download branch above
// uses `reportKind = 'admin.qbMapping.bulkActionDetails'` and a
// `scope.bulkActionId = <id>`, which is exactly what we filter on
// here. The downloader's display name and username are joined in so
// the UI can render a human-readable "Downloaded by …" line without a
// second round-trip. Cap the result set at a sane limit — this is a
// per-bulk-action audit trail and 200 entries is already far past
// "interesting".
router.get(
  "/reports/qb-account-mapping/bulk-actions/:id/downloads",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Bad id", code: "validation.invalid_id" });
      return;
    }
    const rows = await db
      .select({
        id: reportExportAuditLogTable.id,
        downloadedAt: reportExportAuditLogTable.createdAt,
        downloadedByUserId: reportExportAuditLogTable.downloadedByUserId,
        userRole: reportExportAuditLogTable.userRole,
        downloadedByDisplayName: usersTable.displayName,
        downloadedByUsername: usersTable.username,
      })
      .from(reportExportAuditLogTable)
      .leftJoin(
        usersTable,
        eq(reportExportAuditLogTable.downloadedByUserId, usersTable.id),
      )
      .where(
        and(
          eq(reportExportAuditLogTable.reportKind, "admin.qbMapping.bulkActionDetails"),
          sql`${reportExportAuditLogTable.scope}->>'bulkActionId' = ${String(id)}`,
        ),
      )
      .orderBy(desc(reportExportAuditLogTable.createdAt))
      .limit(200);

    res.json({
      bulkActionId: id,
      downloadCount: rows.length,
      downloads: rows.map((r) => ({
        id: r.id,
        downloadedAt: r.downloadedAt,
        downloadedByUserId: r.downloadedByUserId,
        downloadedByDisplayName: r.downloadedByDisplayName,
        downloadedByUsername: r.downloadedByUsername,
        userRole: r.userRole,
      })),
    });
  },
);

// POST /reports/qb-account-mapping/bulk-actions/:id/undo — revert the
// snapshot of the named bulk action. Idempotent: a second undo against an
// already-undone action returns 409 so the UI can surface "already
// undone".
router.post(
  "/reports/qb-account-mapping/bulk-actions/:id/undo",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Bad id", code: "validation.invalid_id" });
      return;
    }
    const session = getSession(req);
    const undoneByUserId = session?.userId ?? null;
    const result = await db.transaction(async (tx) => {
      const [action] = await tx
        .select()
        .from(qbAccountMappingBulkActionsTable)
        .where(eq(qbAccountMappingBulkActionsTable.id, id));
      if (!action) {
        return { kind: "not_found" as const };
      }
      if (action.undoneAt) {
        return { kind: "already_undone" as const };
      }
      const counts = await undoBulkActionSnapshots(tx, action.snapshots);
      await tx
        .update(qbAccountMappingBulkActionsTable)
        .set({ undoneAt: new Date(), undoneByUserId })
        .where(eq(qbAccountMappingBulkActionsTable.id, id));
      return { kind: "ok" as const, counts };
    });
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Bulk action not found", code: "report.bulk_action_not_found" });
      return;
    }
    if (result.kind === "already_undone") {
      res
        .status(409)
        .json({ error: "Bulk action has already been undone", code: "report.bulk_action_already_undone" });
      return;
    }
    res.json({
      ok: true,
      restored: result.counts.restored,
      removed: result.counts.removed,
    });
  },
);

// GET /reports/qb-account-mapping/bulk-actions/storage — admin-only
// snapshot of how much database space the bulk-action history is
// currently using. Surfaced on the QuickBooks mapping reports card so
// admins can decide whether running the on-demand cleanup is worthwhile
// *before* opening the cleanup preview dialog. Returns the total row
// count and total snapshot bytes (sum of `pg_column_size(snapshots)`),
// split by whether each row is still inside or past the active retention
// window — admins reviewing the figure care about the past-retention
// subset specifically because that's the only part the next sweep will
// reclaim.
//
// Cheap to compute (a single grouped scan of a table whose growth is
// gated by admin activity) so it doesn't get its own caching layer; the
// UI re-fetches when the cleanup dialog closes so the displayed total
// matches the just-pruned reality.
router.get(
  "/reports/qb-account-mapping/bulk-actions/storage",
  requireAdmin,
  async (_req, res): Promise<void> => {
    try {
      const stats = await getBulkActionStorageStats();
      res.json({
        totalCount: stats.totalCount,
        totalBytes: stats.totalBytes,
        withinRetentionCount: stats.withinRetentionCount,
        withinRetentionBytes: stats.withinRetentionBytes,
        pastRetentionCount: stats.pastRetentionCount,
        pastRetentionBytes: stats.pastRetentionBytes,
        retentionDays: stats.retentionDays,
        cutoff: stats.cutoff.toISOString(),
      });
    } catch (err) {
      logger.error({ err }, "QB bulk-action storage stats failed");
      res
        .status(500)
        .json({
          error: "Storage stats failed",
          code: "report.storage_stats_failed",
        });
    }
  },
);

// POST /reports/qb-account-mapping/bulk-actions/cleanup — admin-only "run
// the retention sweep right now" hook. The retention worker normally
// fires once at server startup and then every 24h; this endpoint lets an
// admin reclaim space immediately after, e.g., a 5,000-cell CSV import
// they no longer need.
//
// `dryRun=true` (query param OR body field) returns the count of rows
// that *would* be deleted under the current policy without touching the
// table, so the UI can show a confirmation count first. The retention
// policy itself is owned by env vars and the worker — admins don't get
// to override `retentionDays`/`minRetained` from the UI, otherwise the
// "preview vs. apply" guarantee wouldn't hold (a sneakier value on the
// apply call could delete more than the preview promised).
router.post(
  "/reports/qb-account-mapping/bulk-actions/cleanup",
  requireAdmin,
  async (req, res): Promise<void> => {
    const flag = req.query.dryRun ?? (req.body as { dryRun?: unknown } | null)?.dryRun;
    const dryRun = flag === true || flag === "true" || flag === "1";
    const session = getSession(req);
    const start = Date.now();
    try {
      // For real (non-preview) admin runs, atomically combine the cleanup
      // delete and the audit-row insert in a single transaction so that
      // either both commit or both roll back. This guarantees that every
      // destructive cleanup leaves a durable audit trail — if the audit
      // insert fails (e.g., schema drift, transient DB error) the delete
      // is rolled back too, and the request returns 500 to the admin.
      // Dry-run preview calls don't mutate state and so don't get an
      // audit row.
      const result = dryRun
        ? await runBulkActionCleanup({ dryRun: true })
        : await db.transaction(async (tx) => {
            const r = await runBulkActionCleanup({
              dryRun: false,
              executor: tx,
            });
            await tx.insert(qbAccountMappingCleanupAuditTable).values({
              actorUserId: session?.userId ?? null,
              actorRole: session?.role ?? "admin",
              deletedCount: r.deleted,
              protectedRecent: r.protectedRecent,
              retentionDays: r.retentionDays,
              minRetained: r.minRetained,
              cutoff: r.cutoff,
            });
            return r;
          });
      logger.info(
        {
          trigger: "admin",
          dryRun,
          actorUserId: session?.userId ?? null,
          ms: Date.now() - start,
          deleted: result.deleted,
          bytesFreed: result.bytesFreed,
          protectedRecent: result.protectedRecent,
          retentionDays: result.retentionDays,
          minRetained: result.minRetained,
          cutoff: result.cutoff.toISOString(),
        },
        dryRun
          ? "QB bulk-action cleanup preview (admin)"
          : "QB bulk-action cleanup complete (admin)",
      );
      res.json({
        ok: true,
        dryRun: result.dryRun,
        deleted: result.deleted,
        bytesFreed: result.bytesFreed,
        protectedRecent: result.protectedRecent,
        retentionDays: result.retentionDays,
        minRetained: result.minRetained,
        cutoff: result.cutoff.toISOString(),
      });
    } catch (err) {
      logger.error(
        { err, dryRun, actorUserId: session?.userId ?? null },
        "QB bulk-action cleanup (admin) failed",
      );
      res.status(500).json({ error: "Cleanup failed", code: "report.cleanup_failed" });
    }
  },
);

// GET /reports/exports/audit — admin-only audit log of every export.
// `detailJson` is included on each row so the UI can show a "details" link
// without a second round-trip.
//
// Every row that is part of a retry chain — whether as the original failed
// sync, an intermediate hop, or the most recent retry — is annotated with
// `retryChain: number[]`, the ordered list of audit ids in the entire chain
// (oldest → newest, inclusive of self). The same chain is attached to every
// member so admins can navigate the chain from either end: opening the root
// shows where it eventually went, and opening a retry shows where it came
// from. Ancestors and descendants that fall outside the requested window are
// pulled in via `chainRows` so the UI can render the full chain (and any
// "Retried by #N" badges that point to out-of-window descendants) without a
// second round-trip per hop.
//
// `retryChain` is omitted entirely (rather than set to [self.id]) for rows
// that are not part of any retry chain — this keeps the wire format compact
// and lets the UI treat the field as a presence flag.
//
// Pagination & filtering:
//   `page`       — 1-based page index (default 1)
//   `pageSize`   — rows per page (default 100, max 500)
//   `from`/`to`  — ISO-8601 timestamps; filter on createdAt (inclusive `from`,
//                  exclusive `to` — matches the half-open convention used by
//                  reporting periods elsewhere in this file)
//   `anchorId`   — id of an audit row the caller wants to jump to. Server
//                  computes the page that contains it and returns that page
//                  instead of `page`. Filters (from/to) still apply: if the
//                  anchor row is filtered out we fall back to page 1 and tell
//                  the client via `anchorOutsideFilter: true`.
//   `hasWarnings=true` — restricts visible rows to those whose
//                  `detailJson.warnings` JSON array is non-empty (accounting
//                  pushes that surfaced per-row failures admins still need
//                  to triage). Filtered-out in-window rows that participate
//                  in a retry chain are still returned in `chainRows`
//                  (alongside out-of-window ancestors/descendants) so a
//                  failed root row in the table still shows a "Retried by
//                  #N" badge for its successful (no-warnings) retry that
//                  the filter would otherwise hide. The `totalWithWarnings`
//                  count is always computed over the unfiltered current
//                  page so the "N have warnings" badge in the card header
//                  stays meaningful regardless of whether the filter is on.
//   `legacyLimit`/`limit` — kept for older clients; if `pageSize` is not set
//                  but `limit` is, we use `limit` as page size. Page is then
//                  always 1.
//
// Response: { rows, chainRows, page, pageSize, totalRows, totalWithWarnings,
//             anchorId?, anchorOutsideFilter?: boolean }
router.get(
  "/reports/exports/audit",
  requireAdmin,
  async (req, res): Promise<void> => {
    const querySchema = z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(500).optional(),
      // Legacy: older callers (and pre-pagination tests) pass `limit`.
      limit: z.coerce.number().int().positive().max(500).optional(),
      anchorId: z.coerce.number().int().positive().optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      // `hasWarnings=true` filters the visible rows on the current page.
      // The badge count (`totalWithWarnings`) is always over the unfiltered
      // page so the header summary stays meaningful when the filter is on.
      hasWarnings: z
        .union([z.literal("true"), z.literal("false")])
        .optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid query", code: "validation.invalid_query",
        details: parsed.error.flatten(),
      });
      return;
    }
    const q = parsed.data;
    const pageSize = q.pageSize ?? q.limit ?? 100;
    const hasWarnings = q.hasWarnings === "true";
    const fromDate = q.from ? new Date(q.from) : null;
    const toDate = q.to ? new Date(q.to) : null;

    const filterConditions = [] as ReturnType<typeof gte>[];
    if (fromDate) {
      filterConditions.push(gte(reportExportAuditLogTable.createdAt, fromDate));
    }
    if (toDate) {
      filterConditions.push(lt(reportExportAuditLogTable.createdAt, toDate));
    }
    const whereClause =
      filterConditions.length === 0
        ? undefined
        : filterConditions.length === 1
          ? filterConditions[0]
          : and(...filterConditions);

    // Total rows under the active filter — needed so the UI can render
    // "Page X of Y" and disable Next on the last page.
    const [{ value: totalRows }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(reportExportAuditLogTable)
      .where(whereClause ?? sql`true`);

    // Resolve which page to actually return.
    let page = q.page ?? 1;
    let anchorOutsideFilter = false;
    if (q.anchorId !== undefined) {
      // Look up the anchor row under the active filter so we can count rows
      // that come before it (= newer, since we order DESC). The page is
      // floor(newerCount / pageSize) + 1.
      const anchorWhere =
        whereClause === undefined
          ? eq(reportExportAuditLogTable.id, q.anchorId)
          : and(whereClause, eq(reportExportAuditLogTable.id, q.anchorId));
      const [anchor] = await db
        .select({ id: reportExportAuditLogTable.id })
        .from(reportExportAuditLogTable)
        .where(anchorWhere)
        .limit(1);
      if (!anchor) {
        anchorOutsideFilter = true;
        page = 1;
      } else {
        // Count rows that come strictly before the anchor in the desc sort
        // order. Tie-break by id so pages remain stable even when two rows
        // share a createdAt down to the microsecond (rare but possible under
        // load). We use a SQL row-tuple comparison against a subquery that
        // re-reads the anchor's (created_at, id) to avoid the JS Date round-
        // trip — Postgres timestamps have microsecond precision but JS Date
        // truncates to milliseconds, which would otherwise pull the anchor
        // row itself into the "newer" set and shift the page by one.
        const newerPred = sql`(${reportExportAuditLogTable.createdAt}, ${reportExportAuditLogTable.id}) > (SELECT created_at, id FROM ${reportExportAuditLogTable} WHERE id = ${anchor.id})`;
        const newerWhere =
          whereClause === undefined
            ? newerPred
            : and(whereClause, newerPred);
        const [{ value: newerCount }] = await db
          .select({ value: sql<number>`count(*)::int` })
          .from(reportExportAuditLogTable)
          .where(newerWhere ?? sql`true`);
        page = Math.floor(Number(newerCount) / pageSize) + 1;
      }
    }
    const offset = (page - 1) * pageSize;

    const rows = await db
      .select()
      .from(reportExportAuditLogTable)
      .where(whereClause ?? sql`true`)
      .orderBy(
        desc(reportExportAuditLogTable.createdAt),
        desc(reportExportAuditLogTable.id),
      )
      .limit(pageSize)
      .offset(offset);

    const hasAnyWarnings = (
      d: Record<string, unknown> | null,
    ): boolean => {
      const w = d?.warnings;
      return Array.isArray(w) && w.length > 0;
    };
    const totalWithWarnings = rows.reduce(
      (acc, r) => acc + (hasAnyWarnings(r.detailJson) ? 1 : 0),
      0,
    );
    const visibleRows = hasWarnings
      ? rows.filter((r) => hasAnyWarnings(r.detailJson))
      : rows;

    type AuditRowT = (typeof rows)[number];
    type AuditRowOut = AuditRowT & { retryChain?: number[] };

    // Bound the chain expansion so a corrupted/cyclic graph can never spin the
    // request indefinitely. The current product surface already caps display
    // at ~5 retries; 50 levels in either direction is generous headroom.
    const MAX_CHAIN_DEPTH = 50;

    // `known` is the full unfiltered window so chain neighbours that happen
    // to be filtered out (e.g. the original failed sync had no warnings, or
    // the successful retry has none either) can still be resolved without a
    // DB round-trip. `extras` accumulates ancestors and descendants pulled in
    // from outside the window during expansion.
    const known = new Map<number, AuditRowT>();
    for (const r of rows) known.set(r.id, r);
    const extras = new Map<number, AuditRowT>();

    const parentIdOf = (r: AuditRowT): number | null => {
      const scope = r.scope as Record<string, unknown> | null;
      const v = scope?.retriedFromAuditId;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };

    const has = (id: number): boolean => known.has(id) || extras.has(id);
    const get = (id: number): AuditRowT | undefined =>
      known.get(id) ?? extras.get(id);

    // BFS the retry graph in BOTH directions starting from the in-window rows.
    // Going up (parents) lets older roots show up as chain entries; going
    // down (children) lets newer retries surface as "Retried by #N" badges on
    // the original even when those retries are filtered out or pushed past
    // the window. We expand level-by-level so each level costs at most two
    // queries (one for missing parents, one for any children) regardless of
    // how wide the chain branches.
    let frontier: number[] = [...known.keys()];
    for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.length > 0; depth++) {
      const newlyDiscovered: number[] = [];

      // Parents of the frontier that we don't already have.
      const missingParentIds = new Set<number>();
      for (const id of frontier) {
        const r = get(id);
        if (!r) continue;
        const p = parentIdOf(r);
        if (p !== null && !has(p)) missingParentIds.add(p);
      }
      if (missingParentIds.size > 0) {
        const parents = await db
          .select()
          .from(reportExportAuditLogTable)
          .where(inArray(reportExportAuditLogTable.id, [...missingParentIds]));
        for (const p of parents) {
          if (has(p.id)) continue;
          extras.set(p.id, p);
          newlyDiscovered.push(p.id);
        }
      }

      // Children of the frontier that we don't already have. The audit table
      // stores `retriedFromAuditId` inside the `scope` jsonb blob, so we
      // extract it as int and use a normal IN comparison. The `~ '^[0-9]+$'`
      // regex guard runs before the cast so any historical row with a
      // malformed (non-numeric) value can't raise an `invalid input syntax
      // for type integer` error and 500 the audit endpoint. Drizzle's
      // `inArray` accepts a SQL expression as the column reference.
      const childRows = await db
        .select()
        .from(reportExportAuditLogTable)
        .where(
          and(
            sql`${reportExportAuditLogTable.scope}->>'retriedFromAuditId' ~ '^[0-9]+$'`,
            inArray(
              sql<number>`(${reportExportAuditLogTable.scope}->>'retriedFromAuditId')::int`,
              frontier,
            ),
          ),
        );
      for (const c of childRows) {
        if (has(c.id)) continue;
        extras.set(c.id, c);
        newlyDiscovered.push(c.id);
      }

      frontier = newlyDiscovered;
    }

    // Compute connected components of the retry graph across every row we
    // know about (in-window + extras). Two rows are in the same chain if
    // they're linked by a `retriedFromAuditId` edge (treated as undirected).
    // Each member of a component is then annotated with the same
    // `retryChain` — the full ordered list of ids in that component, sorted
    // by createdAt asc — so admins can navigate the chain from either end.
    const adj = new Map<number, Set<number>>();
    const ensureAdj = (id: number): Set<number> => {
      let s = adj.get(id);
      if (!s) {
        s = new Set();
        adj.set(id, s);
      }
      return s;
    };
    const allKnown: AuditRowT[] = [...known.values(), ...extras.values()];
    for (const r of allKnown) {
      ensureAdj(r.id);
      const p = parentIdOf(r);
      if (p !== null && has(p)) {
        ensureAdj(p).add(r.id);
        ensureAdj(r.id).add(p);
      }
    }

    const componentOf = new Map<number, number[]>();
    const visited = new Set<number>();
    for (const r of allKnown) {
      if (visited.has(r.id)) continue;
      const comp: number[] = [];
      const queue: number[] = [r.id];
      visited.add(r.id);
      while (queue.length > 0) {
        const id = queue.shift() as number;
        comp.push(id);
        for (const nb of adj.get(id) ?? []) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          queue.push(nb);
        }
      }
      comp.sort((a, b) => {
        const ar = get(a);
        const br = get(b);
        if (!ar || !br) return a - b;
        return ar.createdAt.getTime() - br.createdAt.getTime();
      });
      for (const id of comp) componentOf.set(id, comp);
    }

    const annotate = (r: AuditRowT): AuditRowOut => {
      const chain = componentOf.get(r.id);
      // Normalise the two digest-emailed-at columns to `null` when the
      // underlying row didn't surface them. Production rows always carry
      // them (they're real columns on `report_export_audit_log`), but
      // historic / mocked / partial-projection rows can leave them
      // `undefined`, and the OpenAPI-generated zod response schema rejects
      // `undefined` where it expects `Date | null`.
      const base: AuditRowT = {
        ...r,
        accountingDigestEmailedAt: r.accountingDigestEmailedAt ?? null,
        accountingReconciliationDigestEmailedAt:
          r.accountingReconciliationDigestEmailedAt ?? null,
      };
      return chain && chain.length > 1
        ? { ...base, retryChain: chain }
        : base;
    };

    // chainRows ships every chain member that isn't part of the visible
    // page so the UI can render full chain metadata and forward
    // "Retried by #N" badges. Three buckets feed it:
    //   1. Out-of-window ancestors and descendants (already in `extras`).
    //   2. In-window rows the warnings filter hid — e.g. the successful
    //      retry of a failed sync. Without these the root row in the table
    //      would never learn it had been retried, defeating the whole point
    //      of the bidirectional chain navigation.
    //   3. In-window rows on a different page — same reasoning as (2):
    //      pagination shouldn't break the bidirectional chain badges.
    // Singleton components (rows that aren't part of any chain) are filtered
    // out so the wire format stays compact — `componentOf` has entries for
    // every known row including singletons, so the `length > 1` test is what
    // keeps non-chain rows out of the response.
    const visibleIds = new Set(visibleRows.map((r) => r.id));
    const chainExtras: AuditRowT[] = [...extras.values()];
    for (const r of rows) {
      if (visibleIds.has(r.id)) continue;
      const comp = componentOf.get(r.id);
      if (comp && comp.length > 1) chainExtras.push(r);
    }

    const responseBody: {
      rows: AuditRowOut[];
      chainRows: AuditRowOut[];
      page: number;
      pageSize: number;
      totalRows: number;
      totalWithWarnings: number;
      anchorId?: number;
      anchorOutsideFilter?: boolean;
    } = {
      rows: visibleRows.map(annotate),
      chainRows: chainExtras.map(annotate),
      page,
      pageSize,
      totalRows: Number(totalRows) || 0,
      totalWithWarnings,
    };
    if (q.anchorId !== undefined) responseBody.anchorId = q.anchorId;
    if (anchorOutsideFilter) responseBody.anchorOutsideFilter = true;

    // Validate against the OpenAPI-generated zod schema (`Loose<>` widens
    // db-row primitives so the audit row's `userRole`/`format` plain
    // strings line up with the schema's narrower types). This turns any
    // future drift between the route response and the front-end's
    // generated client into a compile-time error.
    sendResponse(res, GetExportsAuditLogResponse, responseBody);
  },
);

// GET /reports/exports/audit/csv — admin-only CSV export of the audit log
// matching the active filters (from / to / hasWarnings). Capped at
// AUDIT_CSV_MAX_ROWS so a runaway export can't pull megabytes out of the
// audit table; when the cap is hit we set `X-Audit-Export-Capped: true` so
// the UI can surface a notice to the admin. The download itself is recorded
// as another audit row (kind = "audit.exportAuditLog") so the action is
// itself auditable.
const AUDIT_CSV_MAX_ROWS = 50000;
router.get(
  "/reports/exports/audit/csv",
  requireAdmin,
  async (req, res): Promise<void> => {
    const querySchema = z.object({
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      hasWarnings: z
        .union([z.literal("true"), z.literal("false")])
        .optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid query", code: "validation.invalid_query",
        details: parsed.error.flatten(),
      });
      return;
    }
    const q = parsed.data;
    const hasWarnings = q.hasWarnings === "true";
    const fromDate = q.from ? new Date(q.from) : null;
    const toDate = q.to ? new Date(q.to) : null;

    const filterConditions = [] as ReturnType<typeof gte>[];
    if (fromDate) {
      filterConditions.push(gte(reportExportAuditLogTable.createdAt, fromDate));
    }
    if (toDate) {
      filterConditions.push(lt(reportExportAuditLogTable.createdAt, toDate));
    }
    // Warnings filter has to be applied in SQL (not after the LIMIT) so the
    // 50k cap counts only rows that match the active filter. Otherwise a
    // sparse-warnings dataset would silently drop matching rows older than
    // the first 50k unfiltered rows.
    if (hasWarnings) {
      filterConditions.push(
        sql`jsonb_typeof(${reportExportAuditLogTable.detailJson}->'warnings') = 'array' AND jsonb_array_length(${reportExportAuditLogTable.detailJson}->'warnings') > 0`,
      );
    }
    const whereClause =
      filterConditions.length === 0
        ? undefined
        : filterConditions.length === 1
          ? filterConditions[0]
          : and(...filterConditions);

    // Fetch one extra so we can detect when the cap was hit. Joining the
    // users table lets the "user" column include a friendly display name
    // alongside the role + id (matching what admins see in the table).
    const fetched = await db
      .select({
        id: reportExportAuditLogTable.id,
        reportKind: reportExportAuditLogTable.reportKind,
        format: reportExportAuditLogTable.format,
        scope: reportExportAuditLogTable.scope,
        userRole: reportExportAuditLogTable.userRole,
        downloadedByUserId: reportExportAuditLogTable.downloadedByUserId,
        userDisplayName: usersTable.displayName,
        userUsername: usersTable.username,
        createdAt: reportExportAuditLogTable.createdAt,
      })
      .from(reportExportAuditLogTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, reportExportAuditLogTable.downloadedByUserId),
      )
      .where(whereClause ?? sql`true`)
      .orderBy(
        desc(reportExportAuditLogTable.createdAt),
        desc(reportExportAuditLogTable.id),
      )
      .limit(AUDIT_CSV_MAX_ROWS + 1);

    const capped = fetched.length > AUDIT_CSV_MAX_ROWS;
    const rows = capped ? fetched.slice(0, AUDIT_CSV_MAX_ROWS) : fetched;

    // Build a "retried by" lookup: for each row in the result set, list any
    // descendant rows whose `scope.retriedFromAuditId` points at it. We
    // restrict the lookup to ids in the result set so the column reflects
    // direct retries of the visible rows; out-of-set descendants are not
    // included to keep the export focused on the active filter window.
    const ids = rows.map((r) => r.id);
    const retriedByMap = new Map<number, number[]>();
    if (ids.length > 0) {
      const childRows = await db
        .select({
          id: reportExportAuditLogTable.id,
          parentId: sql<number>`(${reportExportAuditLogTable.scope}->>'retriedFromAuditId')::int`,
        })
        .from(reportExportAuditLogTable)
        .where(
          and(
            sql`${reportExportAuditLogTable.scope}->>'retriedFromAuditId' ~ '^[0-9]+$'`,
            inArray(
              sql<number>`(${reportExportAuditLogTable.scope}->>'retriedFromAuditId')::int`,
              ids,
            ),
          ),
        );
      for (const c of childRows) {
        const arr = retriedByMap.get(c.parentId);
        if (arr) arr.push(c.id);
        else retriedByMap.set(c.parentId, [c.id]);
      }
      for (const arr of retriedByMap.values()) arr.sort((a, b) => a - b);
    }

    const userCell = (r: (typeof rows)[number]): string => {
      const name = r.userDisplayName ?? r.userUsername ?? null;
      const idPart = r.downloadedByUserId
        ? ` (#${r.downloadedByUserId})`
        : "";
      return name
        ? `${name} [${r.userRole}]${idPart}`
        : `${r.userRole}${idPart}`;
    };

    const csv = toCsv(
      [
        "Id",
        "Timestamp",
        "Kind",
        "Format",
        "User",
        "Scope",
        "RetryOf",
        "RetriedBy",
      ],
      rows.map((r) => {
        const retriedFrom =
          typeof (r.scope as Record<string, unknown>).retriedFromAuditId ===
          "number"
            ? ((r.scope as Record<string, unknown>)
                .retriedFromAuditId as number)
            : "";
        const retriedBy = retriedByMap.get(r.id) ?? [];
        return [
          r.id,
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt ?? ""),
          r.reportKind,
          r.format,
          userCell(r),
          JSON.stringify(r.scope ?? {}),
          retriedFrom,
          retriedBy.join(" "),
        ];
      }),
    );
    const buf = Buffer.from(csv, "utf-8");
    setDownloadHeaders(
      res,
      csvFilename(["audit-log"]),
      "text/csv; charset=utf-8",
    );
    res.setHeader("Content-Length", buf.byteLength);
    if (capped) res.setHeader("X-Audit-Export-Capped", "true");
    res.setHeader("X-Audit-Export-Cap", String(AUDIT_CSV_MAX_ROWS));
    res.send(buf);
    await recordExport({
      req,
      reportKind: "audit.exportAuditLog",
      format: "csv",
      scope: {
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
        hasWarnings,
        capped,
        cap: AUDIT_CSV_MAX_ROWS,
      },
      rowCount: rows.length,
      fileBytes: buf.byteLength,
    });
  },
);

// Catch errors so a stack trace doesn't leak.
router.use((err: Error, _req: Request, res: Response, next: (e?: Error) => void) => {
  if (res.headersSent) return next(err);
  logger.error({ err }, "Reports route error");
  res.status(500).json({ error: "Internal error", code: "server.internal_error" });
});

export default router;
