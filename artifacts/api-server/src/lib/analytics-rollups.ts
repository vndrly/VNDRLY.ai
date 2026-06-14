import { sql, type SQL } from "drizzle-orm";
import { db, ticketsTable } from "@workspace/db";
import { agingForPartner, agingForVendor } from "./reports/aging";
import { nec1099Rows, NEC_THRESHOLD_USD } from "./reports/nec1099";

export type KickbackTrendRow = {
  month: string;
  kickbackCount: number;
  ticketCount: number;
  kickbackRate: number;
};

export type PipelineSegment = { count: number; total: number };

export type RevenuePipeline = {
  pendingReview: PipelineSegment;
  awaitingPayment: PipelineSegment;
  approvedUnpaid: PipelineSegment;
};

export const EMPTY_REVENUE_PIPELINE: RevenuePipeline = {
  pendingReview: { count: 0, total: 0 },
  awaitingPayment: { count: 0, total: 0 },
  approvedUnpaid: { count: 0, total: 0 },
};

export async function queryKickbackTrendByMonth(scopeWhere: SQL): Promise<KickbackTrendRow[]> {
  try {
    const kickbackTrendRaw = await db.execute<{
      month: string;
      kickbackCount: number | string;
      ticketCount: number | string;
    }>(sql`
      SELECT to_char(m, 'YYYY-MM') AS month,
             COALESCE(k.kickback_count, 0)::int AS "kickbackCount",
             COALESCE(tc.ticket_count, 0)::int AS "ticketCount"
      FROM generate_series(
        date_trunc('month', now()) - interval '3 months',
        date_trunc('month', now()),
        interval '1 month'
      ) m
      LEFT JOIN (
        SELECT date_trunc('month', h.created_at) AS month,
               count(*)::int AS kickback_count
        FROM ticket_status_history h
        INNER JOIN tickets t ON t.id = h.ticket_id
        WHERE h.to_status = 'kicked_back'
          AND ${scopeWhere}
        GROUP BY 1
      ) k ON k.month = m
      LEFT JOIN (
        SELECT date_trunc('month', t.created_at) AS month,
               count(*)::int AS ticket_count
        FROM tickets t
        WHERE ${scopeWhere}
        GROUP BY 1
      ) tc ON tc.month = m
      ORDER BY m
    `);

    return kickbackTrendRaw.rows.map((row) => {
      const kickbackCount = Number(row.kickbackCount) || 0;
      const ticketCount = Number(row.ticketCount) || 0;
      return {
        month: row.month,
        kickbackCount,
        ticketCount,
        kickbackRate: ticketCount > 0 ? Math.round((kickbackCount / ticketCount) * 100) : 0,
      };
    });
  } catch (err) {
    console.error("[analytics] kickback trend query failed:", err);
    return [];
  }
}

export async function queryRevenuePipeline(scopeWhere: SQL): Promise<RevenuePipeline> {
  const [row] = await db
    .select({
      pendingReviewCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} IN ('pending_review', 'submitted'))::int`,
      pendingReviewTotal: sql<string>`COALESCE(SUM(sub.line_total) FILTER (WHERE ${ticketsTable.status} IN ('pending_review', 'submitted')), 0)::numeric(12,2)`,
      awaitingPaymentCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'awaiting_payment')::int`,
      awaitingPaymentTotal: sql<string>`COALESCE(SUM(sub.line_total) FILTER (WHERE ${ticketsTable.status} = 'awaiting_payment'), 0)::numeric(12,2)`,
      approvedUnpaidCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      approvedUnpaidTotal: sql<string>`COALESCE(SUM(sub.line_total) FILTER (WHERE ${ticketsTable.status} = 'approved'), 0)::numeric(12,2)`,
    })
    .from(ticketsTable)
    .leftJoin(
      sql`(SELECT ticket_id, SUM(quantity * unit_price) as line_total FROM ticket_line_items GROUP BY ticket_id) sub`,
      sql`sub.ticket_id = ${ticketsTable.id}`,
    )
    .where(scopeWhere);

  if (!row) return EMPTY_REVENUE_PIPELINE;

  return {
    pendingReview: {
      count: row.pendingReviewCount,
      total: parseFloat(row.pendingReviewTotal),
    },
    awaitingPayment: {
      count: row.awaitingPaymentCount,
      total: parseFloat(row.awaitingPaymentTotal),
    },
    approvedUnpaid: {
      count: row.approvedUnpaidCount,
      total: parseFloat(row.approvedUnpaidTotal),
    },
  };
}

export function computeKickbackRate(kickedBack: number, total: number): number {
  return total > 0 ? Math.round((kickedBack / total) * 100) : 0;
}

export type SpendByAfeRow = {
  afe: string;
  ticketCount: number;
  total: number;
};

/** Ticket spend grouped by resolved AFE (assignment → site fallback). */
export async function querySpendByAfe(partnerSiteIds: number[]): Promise<SpendByAfeRow[]> {
  if (partnerSiteIds.length === 0) return [];
  try {
    const spendByAfeRaw = await db.execute<{
      afe: string;
      ticket_count: number | string;
      total: string;
    }>(sql`
      SELECT
        COALESCE(NULLIF(TRIM(swa.afe), ''), NULLIF(TRIM(sl.afe), ''), '(Unassigned)') AS afe,
        COUNT(DISTINCT t.id)::int AS ticket_count,
        COALESCE(SUM(li.quantity * li.unit_price), 0)::numeric(12,2) AS total
      FROM tickets t
      INNER JOIN site_locations sl ON sl.id = t.site_location_id
      LEFT JOIN site_work_assignments swa
        ON swa.site_location_id = t.site_location_id
       AND swa.vendor_id = t.vendor_id
       AND swa.work_type_id = t.work_type_id
      LEFT JOIN ticket_line_items li ON li.ticket_id = t.id
      WHERE t.site_location_id IN (${sql.join(
        partnerSiteIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 15
    `);

    return spendByAfeRaw.rows.map((row) => ({
      afe: row.afe,
      ticketCount: Number(row.ticket_count) || 0,
      total: parseFloat(row.total),
    }));
  } catch (err) {
    console.error("[analytics] spend by AFE query failed:", err);
    return [];
  }
}

/** Vendor-scoped ticket revenue grouped by resolved AFE. */
export async function querySpendByAfeForVendor(vendorId: number): Promise<SpendByAfeRow[]> {
  try {
    const spendByAfeRaw = await db.execute<{
      afe: string;
      ticket_count: number | string;
      total: string;
    }>(sql`
      SELECT
        COALESCE(NULLIF(TRIM(swa.afe), ''), NULLIF(TRIM(sl.afe), ''), '(Unassigned)') AS afe,
        COUNT(DISTINCT t.id)::int AS ticket_count,
        COALESCE(SUM(li.quantity * li.unit_price), 0)::numeric(12,2) AS total
      FROM tickets t
      INNER JOIN site_locations sl ON sl.id = t.site_location_id
      LEFT JOIN site_work_assignments swa
        ON swa.site_location_id = t.site_location_id
       AND swa.vendor_id = t.vendor_id
       AND swa.work_type_id = t.work_type_id
      LEFT JOIN ticket_line_items li ON li.ticket_id = t.id
      WHERE t.vendor_id = ${vendorId}
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 15
    `);

    return spendByAfeRaw.rows.map((row) => ({
      afe: row.afe,
      ticketCount: Number(row.ticket_count) || 0,
      total: parseFloat(row.total),
    }));
  } catch (err) {
    console.error("[analytics] vendor spend by AFE query failed:", err);
    return [];
  }
}

export type InvoiceAgingTotals = {
  current: number;
  bucket1_15: number;
  bucket16_30: number;
  bucket31_60: number;
  bucket60_plus: number;
  total: number;
};

export type InvoiceAgingVendorRow = {
  vendorId: number;
  vendorName: string | null;
  total: number;
};

export type PartnerInvoiceAging = {
  totals: InvoiceAgingTotals;
  topVendors: InvoiceAgingVendorRow[];
  vendorCount: number;
};

const EMPTY_INVOICE_AGING_TOTALS: InvoiceAgingTotals = {
  current: 0,
  bucket1_15: 0,
  bucket16_30: 0,
  bucket31_60: 0,
  bucket60_plus: 0,
  total: 0,
};

export async function queryPartnerInvoiceAging(partnerId: number): Promise<PartnerInvoiceAging> {
  try {
    const { rows, totals } = await agingForPartner(partnerId);
    return {
      totals: {
        current: parseFloat(totals.current),
        bucket1_15: parseFloat(totals.bucket1_15),
        bucket16_30: parseFloat(totals.bucket16_30),
        bucket31_60: parseFloat(totals.bucket31_60),
        bucket60_plus: parseFloat(totals.bucket60_plus),
        total: parseFloat(totals.total),
      },
      topVendors: rows.slice(0, 5).map((row) => ({
        vendorId: row.vendorId!,
        vendorName: row.vendorName ?? null,
        total: parseFloat(row.total),
      })),
      vendorCount: rows.length,
    };
  } catch (err) {
    console.error("[analytics] invoice aging query failed:", err);
    return {
      totals: EMPTY_INVOICE_AGING_TOTALS,
      topVendors: [],
      vendorCount: 0,
    };
  }
}

export type Nec1099ExposureVendor = {
  vendorId: number;
  vendorName: string;
  totalPaid: number;
  sharedEinWarning: boolean;
};

export type PartnerNec1099Exposure = {
  year: number;
  threshold: number;
  vendorCount: number;
  totalPaid: number;
  vendors: Nec1099ExposureVendor[];
};

export async function queryPartnerNec1099Exposure(partnerId: number): Promise<PartnerNec1099Exposure> {
  const year = new Date().getUTCFullYear();
  try {
    const rows = await nec1099Rows({ year, payerPartnerId: partnerId });
    return {
      year,
      threshold: NEC_THRESHOLD_USD,
      vendorCount: rows.length,
      totalPaid: rows.reduce((sum, row) => sum + parseFloat(row.totalPaid), 0),
      vendors: rows.slice(0, 10).map((row) => ({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        totalPaid: parseFloat(row.totalPaid),
        sharedEinWarning: row.sharedEinWarning,
      })),
    };
  } catch (err) {
    console.error("[analytics] 1099-NEC exposure query failed:", err);
    return {
      year,
      threshold: NEC_THRESHOLD_USD,
      vendorCount: 0,
      totalPaid: 0,
      vendors: [],
    };
  }
}

export type InvoiceAgingPartnerRow = {
  partnerId: number;
  partnerName: string | null;
  total: number;
};

export type VendorInvoiceAging = {
  totals: InvoiceAgingTotals;
  topPartners: InvoiceAgingPartnerRow[];
  partnerCount: number;
};

export async function queryVendorInvoiceAging(vendorId: number): Promise<VendorInvoiceAging> {
  try {
    const { rows, totals } = await agingForVendor(vendorId);
    return {
      totals: {
        current: parseFloat(totals.current),
        bucket1_15: parseFloat(totals.bucket1_15),
        bucket16_30: parseFloat(totals.bucket16_30),
        bucket31_60: parseFloat(totals.bucket31_60),
        bucket60_plus: parseFloat(totals.bucket60_plus),
        total: parseFloat(totals.total),
      },
      topPartners: rows.slice(0, 5).map((row) => ({
        partnerId: row.partnerId!,
        partnerName: row.partnerName ?? null,
        total: parseFloat(row.total),
      })),
      partnerCount: rows.length,
    };
  } catch (err) {
    console.error("[analytics] vendor invoice aging query failed:", err);
    return {
      totals: EMPTY_INVOICE_AGING_TOTALS,
      topPartners: [],
      partnerCount: 0,
    };
  }
}

export type Nec1099ExposurePartner = {
  partnerId: number;
  partnerName: string;
  totalPaid: number;
};

export type VendorNec1099Exposure = {
  year: number;
  threshold: number;
  partnerCount: number;
  totalPaid: number;
  partners: Nec1099ExposurePartner[];
};

export async function queryVendorNec1099Exposure(vendorId: number): Promise<VendorNec1099Exposure> {
  const year = new Date().getUTCFullYear();
  try {
    const rows = await nec1099Rows({ year, vendorId });
    return {
      year,
      threshold: NEC_THRESHOLD_USD,
      partnerCount: rows.length,
      totalPaid: rows.reduce((sum, row) => sum + parseFloat(row.totalPaid), 0),
      partners: rows.slice(0, 10).map((row) => ({
        partnerId: row.payerPartnerId,
        partnerName: row.payerPartnerName,
        totalPaid: parseFloat(row.totalPaid),
      })),
    };
  } catch (err) {
    console.error("[analytics] vendor 1099-NEC exposure query failed:", err);
    return {
      year,
      threshold: NEC_THRESHOLD_USD,
      partnerCount: 0,
      totalPaid: 0,
      partners: [],
    };
  }
}
