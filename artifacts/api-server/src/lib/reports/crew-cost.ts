// Crew Hours Billed vs Cost.
//
// Source of truth:
//   billed   ← invoice_lines where line_type IN (labor_regular, labor_overtime).
//             quantity = hours, amount = billed.
//   cost     ← ticket_check_ins.hourly_rate_at_time × hours from the originating
//             check-in. Using the snapshot rate (not the current vendor_people
//             rate) avoids retroactively re-pricing past labor when an
//             employee gets a raise.
//
// Crews not yet linked to a vendor_people row (e.g. invoice lines from
// `manual` source with no employee link) are aggregated under "Unassigned crew"
// so the vendor still sees the labor revenue in the report.

import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
// vendor_people stores name in first_name + last_name; concat below.
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  ticketCheckInsTable,
  vendorPeopleTable,
} from "@workspace/db";
import type { Period } from "./period";

const REVENUE_STATUSES = ["open", "sent", "paid", "overdue"] as const;
const LABOR_LINE_TYPES = ["labor_regular", "labor_overtime"] as const;

export interface CrewCostRow {
  employeeId: number | null;
  employeeName: string;
  hours: string;
  cost: string;
  billed: string;
  margin: string;
}

export async function crewHoursBilledVsCost(args: {
  vendorId: number;
  period: Period;
}): Promise<{ rows: CrewCostRow[]; totals: CrewCostRow }> {
  // Resolve employee + snapshot rate via invoice_lines.sourceId →
  // ticket_check_ins (only for sourceType in (check_in_labor, check_in_overtime)).
  // Other source types (manual, ticket_line_item, mileage_auto) have no
  // employee link and bucket into "Unassigned crew".
  //
  // We compute cost row-wise in SQL using the snapshot rate × quantity so the
  // aggregation respects per-check-in rate changes.
  const rows = await db
    .select({
      employeeId: ticketCheckInsTable.employeeId,
      employeeName: sql<
        string | null
      >`TRIM(COALESCE(${vendorPeopleTable.firstName}, '') || ' ' || COALESCE(${vendorPeopleTable.lastName}, ''))`,
      hours: sql<string>`COALESCE(SUM(${invoiceLinesTable.quantity}::numeric), 0)::numeric(14,4)`,
      billed: sql<string>`COALESCE(SUM(${invoiceLinesTable.amount}::numeric), 0)::numeric(14,2)`,
      cost: sql<string>`COALESCE(SUM(${invoiceLinesTable.quantity}::numeric * COALESCE(${ticketCheckInsTable.hourlyRateAtTime}::numeric, 0)), 0)::numeric(14,2)`,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .leftJoin(
      ticketCheckInsTable,
      and(
        inArray(invoiceLinesTable.sourceType, [
          "check_in_labor",
          "check_in_overtime",
        ]),
        eq(ticketCheckInsTable.id, invoiceLinesTable.sourceId),
      ),
    )
    .leftJoin(
      vendorPeopleTable,
      eq(vendorPeopleTable.id, ticketCheckInsTable.employeeId),
    )
    .where(
      and(
        eq(invoicesTable.vendorId, args.vendorId),
        inArray(invoicesTable.status, [...REVENUE_STATUSES]),
        inArray(invoiceLinesTable.lineType, [...LABOR_LINE_TYPES]),
        gte(invoicesTable.periodStart, args.period.start),
        lt(invoicesTable.periodStart, args.period.end),
      ),
    )
    .groupBy(
      ticketCheckInsTable.employeeId,
      vendorPeopleTable.firstName,
      vendorPeopleTable.lastName,
    );

  const enriched: CrewCostRow[] = rows.map((r) => {
    const hours = Number(r.hours);
    const billed = Number(r.billed);
    const cost = Number(r.cost);
    return {
      employeeId: r.employeeId ?? null,
      employeeName: r.employeeName ?? "Unassigned crew",
      hours: hours.toFixed(2),
      cost: cost.toFixed(2),
      billed: billed.toFixed(2),
      margin: (billed - cost).toFixed(2),
    };
  });

  enriched.sort((a, b) => Number(b.billed) - Number(a.billed));

  const totals: CrewCostRow = enriched.reduce(
    (acc, r) => ({
      employeeId: null,
      employeeName: "TOTAL",
      hours: (Number(acc.hours) + Number(r.hours)).toFixed(2),
      cost: (Number(acc.cost) + Number(r.cost)).toFixed(2),
      billed: (Number(acc.billed) + Number(r.billed)).toFixed(2),
      margin: (Number(acc.margin) + Number(r.margin)).toFixed(2),
    }),
    {
      employeeId: null,
      employeeName: "TOTAL",
      hours: "0.00",
      cost: "0.00",
      billed: "0.00",
      margin: "0.00",
    } as CrewCostRow,
  );

  return { rows: enriched, totals };
}
