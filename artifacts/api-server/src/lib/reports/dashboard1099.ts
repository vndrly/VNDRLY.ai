// Year-end 1099 dashboard. Aggregates NEC + MISC + K rows for a tax
// year and merges with persisted filing-status rows so the UI shows
// each (recipient, form) pair once with its current status.

import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  tax1099FilingsTable,
  tax1099CorrectionAuditLogTable,
  usersTable,
  type Tax1099FilingStatus,
  type Tax1099FilingMethod,
  type Tax1099CorrectionStatus,
} from "@workspace/db";
import { nec1099Rows } from "./nec1099";
import { misc1099Rows } from "./misc1099";
import { k1099Rows, thresholdForYear } from "./k1099";
import { logger } from "../logger";

export type DashboardFormType = "NEC" | "MISC" | "K";

export interface Dashboard1099Row {
  taxYear: number;
  formType: DashboardFormType;
  payerPartnerId: number;
  payerPartnerName: string;
  recipientVendorId: number;
  recipientName: string;
  federalTaxId: string | null;
  totalReportable: string;
  /**
   * Per-month gross amounts (Jan…Dec, length 12) — only populated for the
   * 1099-K form, where Boxes 5a-5l carry the calendar-month breakout.
   * For NEC and MISC this is always 12 zeros so the row shape stays
   * consistent for the UI.
   */
  monthly: string[];
  /**
   * Number of payment transactions (Box 3 on 1099-K). Only meaningful
   * for K rows; 0 on NEC and MISC.
   */
  transactionCount: number;
  /**
   * Index (0-11) of the month in which the K row's running YTD total
   * first reached the IRS reporting threshold for the year. Always
   * `null` for NEC and MISC (which don't have a monthly box-out).
   */
  crossedAtMonthIdx: number | null;
  /** Whether the recipient consented to electronic delivery. */
  eDeliveryConsent: boolean;
  /** Persisted filing-status fields (null if no row yet). */
  filingId: number | null;
  status: Tax1099FilingStatus;
  filingMethod: Tax1099FilingMethod;
  /** "none" for original returns; "g" or "c" once flagged for correction. */
  correctedStatus: Tax1099CorrectionStatus;
  externalReference: string | null;
  filedAt: string | null;
  deliveredAt: string | null;
  deliveryChannel: string | null;
  notes: string | null;
  // SendGrid event-webhook fields. `lastEventType` mirrors SendGrid's
  // event vocabulary ('delivered' | 'open' | 'bounce' | 'dropped' |
  // 'deferred' | 'spamreport' | 'processed' | …) and is null until an
  // event arrives. `openedAt` is the *first* open we saw — re-opens
  // update `lastEventAt` only.
  sendgridMessageId: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  bounceReason: string | null;
  openedAt: string | null;
  /**
   * Most recent `corrected_status` transition recorded for this filing, or
   * `null` when the row is fresh / has never been touched. Drives the
   * "Marked CORR-{G,C} on {date} by {user}" tooltip next to the CORR badge
   * so admins have a defensible audit trail of who flipped the corrected
   * indicator on a tax-significant return.
   */
  lastCorrectionAudit: {
    at: string;
    fromStatus: string;
    toStatus: string;
    actorUserId: number | null;
    actorDisplayName: string | null;
    actorUsername: string | null;
  } | null;
}

export interface Dashboard1099Summary {
  taxYear: number;
  totalRecipients: number;
  byForm: Record<DashboardFormType, number>;
  byStatus: Record<Tax1099FilingStatus, number>;
  totalReportable: string;
  /**
   * IRS 1099-K reporting threshold in effect for `taxYear` (e.g. $600
   * in 2026, $2,500 in 2025, $5,000 in 2024). Sourced from
   * `thresholdForYear` so callers don't have to mirror the schedule.
   */
  kThreshold: number;
}

export interface Dashboard1099Result {
  summary: Dashboard1099Summary;
  rows: Dashboard1099Row[];
}

export async function build1099Dashboard(args: {
  year: number;
  payerPartnerId?: number;
}): Promise<Dashboard1099Result> {
  const [necRows, miscRows, kRows] = await Promise.all([
    nec1099Rows({ year: args.year, payerPartnerId: args.payerPartnerId }),
    misc1099Rows({ year: args.year, payerPartnerId: args.payerPartnerId }),
    k1099Rows({ year: args.year, payerPartnerId: args.payerPartnerId }),
  ]);

  // Pull e-delivery consent for every vendor that landed in any form.
  const vendorIds = Array.from(
    new Set([
      ...necRows.map((r) => r.vendorId),
      ...miscRows.map((r) => r.vendorId),
      ...kRows.map((r) => r.vendorId),
    ]),
  );

  const consentMap = new Map<number, boolean>();
  if (vendorIds.length > 0) {
    const { vendorsTable } = await import("@workspace/db");
    const vrows = await db
      .select({
        id: vendorsTable.id,
        eDeliveryConsent: vendorsTable.eDeliveryConsent,
      })
      .from(vendorsTable)
      .where(inArray(vendorsTable.id, vendorIds));
    for (const v of vrows) consentMap.set(v.id, v.eDeliveryConsent);
  }

  // Pull persisted filing-status rows for the year (and payer if scoped).
  const filingConds = [eq(tax1099FilingsTable.taxYear, args.year)];
  if (args.payerPartnerId)
    filingConds.push(
      eq(tax1099FilingsTable.payerPartnerId, args.payerPartnerId),
    );
  const filings = await db
    .select()
    .from(tax1099FilingsTable)
    .where(and(...filingConds));

  // Most-recent correction-status audit row per filing. We use a
  // DISTINCT ON to grab the newest event in a single round-trip and
  // LEFT JOIN to `users` so the UI tooltip can render a friendly
  // display name without an extra request. Falls back to an empty
  // map (and therefore `lastCorrectionAudit: null` on each row) if the
  // audit table is unavailable so the dashboard never goes dark.
  const filingIds = filings.map((f) => f.id);
  const auditMap = new Map<
    number,
    {
      at: string;
      fromStatus: string;
      toStatus: string;
      actorUserId: number | null;
      actorDisplayName: string | null;
      actorUsername: string | null;
    }
  >();
  if (filingIds.length > 0) {
    try {
      const auditRows = await db
        .selectDistinctOn([tax1099CorrectionAuditLogTable.filingId], {
          filingId: tax1099CorrectionAuditLogTable.filingId,
          createdAt: tax1099CorrectionAuditLogTable.createdAt,
          fromStatus: tax1099CorrectionAuditLogTable.fromStatus,
          toStatus: tax1099CorrectionAuditLogTable.toStatus,
          actorUserId: tax1099CorrectionAuditLogTable.actorUserId,
          actorDisplayName: usersTable.displayName,
          actorUsername: usersTable.username,
        })
        .from(tax1099CorrectionAuditLogTable)
        .leftJoin(
          usersTable,
          eq(usersTable.id, tax1099CorrectionAuditLogTable.actorUserId),
        )
        .where(inArray(tax1099CorrectionAuditLogTable.filingId, filingIds))
        .orderBy(
          tax1099CorrectionAuditLogTable.filingId,
          desc(tax1099CorrectionAuditLogTable.createdAt),
          desc(tax1099CorrectionAuditLogTable.id),
        );
      for (const a of auditRows) {
        if (a.filingId == null) continue;
        auditMap.set(a.filingId, {
          at: (a.createdAt as Date).toISOString(),
          fromStatus: a.fromStatus,
          toStatus: a.toStatus,
          actorUserId: a.actorUserId ?? null,
          actorDisplayName: a.actorDisplayName ?? null,
          actorUsername: a.actorUsername ?? null,
        });
      }
    } catch (err) {
      // Dashboard must keep rendering even if the audit-log query
      // fails (e.g. transient db error). Log so the failure is
      // observable; rows fall back to lastCorrectionAudit: null.
      logger.error(
        { err, year: args.year, filingCount: filingIds.length },
        "Failed to load tax_1099_correction_audit_log for dashboard",
      );
    }
  }
  const filingKey = (
    formType: string,
    payerPartnerId: number,
    recipientVendorId: number,
  ): string => `${formType}:${payerPartnerId}:${recipientVendorId}`;
  const filingMap = new Map<string, (typeof filings)[number]>();
  for (const f of filings) {
    filingMap.set(
      filingKey(f.formType, f.payerPartnerId, f.recipientVendorId),
      f,
    );
  }

  const result: Dashboard1099Row[] = [];
  const zeroMonths = (): string[] => Array(12).fill("0.00");
  const pushRow = (
    formType: DashboardFormType,
    base: {
      payerPartnerId: number;
      payerPartnerName: string;
      recipientVendorId: number;
      recipientName: string;
      federalTaxId: string | null;
      totalReportable: string;
      monthly?: string[];
      transactionCount?: number;
      crossedAtMonthIdx?: number | null;
    },
  ): void => {
    const f = filingMap.get(
      filingKey(formType, base.payerPartnerId, base.recipientVendorId),
    );
    result.push({
      taxYear: args.year,
      formType,
      payerPartnerId: base.payerPartnerId,
      payerPartnerName: base.payerPartnerName,
      recipientVendorId: base.recipientVendorId,
      recipientName: base.recipientName,
      federalTaxId: base.federalTaxId,
      totalReportable: base.totalReportable,
      monthly: base.monthly ?? zeroMonths(),
      transactionCount: base.transactionCount ?? 0,
      crossedAtMonthIdx: base.crossedAtMonthIdx ?? null,
      eDeliveryConsent: consentMap.get(base.recipientVendorId) ?? false,
      filingId: f?.id ?? null,
      status: (f?.status as Tax1099FilingStatus) ?? "pending",
      filingMethod: (f?.filingMethod as Tax1099FilingMethod) ?? "manual",
      correctedStatus:
        (f?.correctedStatus as Tax1099CorrectionStatus | undefined) ?? "none",
      externalReference: f?.externalReference ?? null,
      filedAt: f?.filedAt?.toISOString() ?? null,
      deliveredAt: f?.deliveredAt?.toISOString() ?? null,
      deliveryChannel: f?.deliveryChannel ?? null,
      notes: f?.notes ?? null,
      sendgridMessageId: f?.sendgridMessageId ?? null,
      lastEventType: f?.lastEventType ?? null,
      lastEventAt: f?.lastEventAt?.toISOString() ?? null,
      bounceReason: f?.bounceReason ?? null,
      openedAt: f?.openedAt?.toISOString() ?? null,
      lastCorrectionAudit: f ? (auditMap.get(f.id) ?? null) : null,
    });
  };

  for (const r of necRows) {
    pushRow("NEC", {
      payerPartnerId: r.payerPartnerId,
      payerPartnerName: r.payerPartnerName,
      recipientVendorId: r.vendorId,
      recipientName: r.vendorName,
      federalTaxId: r.federalTaxId,
      totalReportable: r.totalPaid,
    });
  }
  for (const r of miscRows) {
    pushRow("MISC", {
      payerPartnerId: r.payerPartnerId,
      payerPartnerName: r.payerPartnerName,
      recipientVendorId: r.vendorId,
      recipientName: r.vendorName,
      federalTaxId: r.federalTaxId,
      totalReportable: r.totalReportable,
    });
  }
  for (const r of kRows) {
    pushRow("K", {
      payerPartnerId: r.payerPartnerId,
      payerPartnerName: r.payerPartnerName,
      recipientVendorId: r.vendorId,
      recipientName: r.vendorName,
      federalTaxId: r.federalTaxId,
      totalReportable: r.grossAmount,
      // Defensive copy: k1099Rows returns its own array but we own this
      // one going forward and do not want callers mutating the source.
      monthly: [...r.monthly],
      transactionCount: r.transactionCount,
      crossedAtMonthIdx: r.crossedAtMonthIdx,
    });
  }

  result.sort((a, b) => {
    if (a.formType !== b.formType) return a.formType.localeCompare(b.formType);
    return Number(b.totalReportable) - Number(a.totalReportable);
  });

  return { summary: summarize(args.year, result), rows: result };
}

function summarize(
  year: number,
  rows: Dashboard1099Row[],
): Dashboard1099Summary {
  const byForm: Record<DashboardFormType, number> = { NEC: 0, MISC: 0, K: 0 };
  const byStatus: Record<Tax1099FilingStatus, number> = {
    pending: 0,
    queued: 0,
    filed: 0,
    accepted: 0,
    rejected: 0,
    delivered: 0,
    error: 0,
  };
  let total = 0;
  for (const r of rows) {
    byForm[r.formType]++;
    byStatus[r.status]++;
    total += Number(r.totalReportable);
  }
  return {
    taxYear: year,
    totalRecipients: rows.length,
    byForm,
    byStatus,
    totalReportable: total.toFixed(2),
    kThreshold: thresholdForYear(year),
  };
}
