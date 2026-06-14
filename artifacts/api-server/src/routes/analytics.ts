import { Router, type IRouter } from "express";
import { sql, eq, and, inArray } from "drizzle-orm";
import { getSessionFromRequest } from "../lib/session";
import {
  queryKickbackTrendByMonth,
  queryRevenuePipeline,
  computeKickbackRate,
  querySpendByAfe,
  queryPartnerInvoiceAging,
  queryPartnerNec1099Exposure,
  queryVendorInvoiceAging,
  queryVendorNec1099Exposure,
  querySpendByAfeForVendor,
} from "../lib/analytics-rollups";
import { aggregateSpendByLineType } from "@workspace/db/line-types";
import {
  db,
  ticketsTable,
  ticketLineItemsTable,
  siteLocationsTable,
  vendorsTable,
  fieldEmployeesTable,
  workTypesTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/analytics/vendor/:vendorId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const vendorId = parseInt(req.params.vendorId);
  if (isNaN(vendorId)) {
    res.status(400).json({ error: "Invalid vendor ID" });
    return;
  }

  // Enforce tenant scope: vendors can only see their own analytics; admins see any.
  if (session.role === "vendor") {
    if ((session.vendorId ?? null) !== vendorId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const statusBreakdown = await db
    .select({
      status: ticketsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.vendorId, vendorId))
    .groupBy(ticketsTable.status);

  const revenueByType = await db
    .select({
      type: ticketLineItemsTable.type,
      total: sql<string>`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0)::numeric(12,2)`,
    })
    .from(ticketLineItemsTable)
    .innerJoin(ticketsTable, eq(ticketLineItemsTable.ticketId, ticketsTable.id))
    .where(eq(ticketsTable.vendorId, vendorId))
    .groupBy(ticketLineItemsTable.type);

  const revenueByMonth = await db.execute<{ month: string; total: string }>(sql`
    SELECT to_char(m, 'YYYY-MM') AS month,
           COALESCE(SUM(li.quantity * li.unit_price), 0)::numeric(12,2) AS total
    FROM generate_series(
      date_trunc('month', now()) - interval '3 months',
      date_trunc('month', now()),
      interval '1 month'
    ) m
    LEFT JOIN tickets t ON date_trunc('month', t.created_at) = m AND t.vendor_id = ${vendorId}
    LEFT JOIN ticket_line_items li ON li.ticket_id = t.id
    GROUP BY m
    ORDER BY m
  `);

  const revenueByYear = await db.execute<{ year: string; total: string }>(sql`
    SELECT to_char(y, 'YYYY') AS year,
           COALESCE(SUM(li.quantity * li.unit_price), 0)::numeric(12,2) AS total
    FROM generate_series(
      date_trunc('year', now()) - interval '3 years',
      date_trunc('year', now()),
      interval '1 year'
    ) y
    LEFT JOIN tickets t ON date_trunc('year', t.created_at) = y AND t.vendor_id = ${vendorId}
    LEFT JOIN ticket_line_items li ON li.ticket_id = t.id
    GROUP BY y
    ORDER BY y
  `);

  const [totalRevenue] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0)::numeric(12,2)`,
    })
    .from(ticketLineItemsTable)
    .innerJoin(ticketsTable, eq(ticketLineItemsTable.ticketId, ticketsTable.id))
    .where(eq(ticketsTable.vendorId, vendorId));

  const [ticketTotals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      kickedBack: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'kicked_back')::int`,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.vendorId, vendorId));

  const gpsMismatchCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(
      and(
        eq(ticketsTable.vendorId, vendorId),
        sql`${ticketsTable.checkInLatitude} IS NOT NULL`,
        sql`${siteLocationsTable.latitude} IS NOT NULL`,
        sql`(
          6371 * acos(
            cos(radians(${siteLocationsTable.latitude})) * cos(radians(${ticketsTable.checkInLatitude}))
            * cos(radians(${ticketsTable.checkInLongitude}) - radians(${siteLocationsTable.longitude}))
            + sin(radians(${siteLocationsTable.latitude})) * sin(radians(${ticketsTable.checkInLatitude}))
          )
        ) > 0.5`
      )
    );

  const [gpsTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.vendorId, vendorId),
        sql`${ticketsTable.checkInLatitude} IS NOT NULL`
      )
    );

  const employeeTicketCounts = await db
    .select({
      employeeId: fieldEmployeesTable.id,
      firstName: fieldEmployeesTable.firstName,
      lastName: fieldEmployeesTable.lastName,
      jobTitle: fieldEmployeesTable.jobTitle,
      ticketCount: sql<number>`count(${ticketsTable.id})::int`,
      approvedCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      kickedBackCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'kicked_back')::int`,
      revenue: sql<string>`COALESCE(SUM(sub.line_total), 0)::numeric(12,2)`,
    })
    .from(fieldEmployeesTable)
    .leftJoin(ticketsTable, eq(fieldEmployeesTable.id, ticketsTable.fieldEmployeeId))
    .leftJoin(
      sql`(SELECT ticket_id, SUM(quantity * unit_price) as line_total FROM ticket_line_items GROUP BY ticket_id) sub`,
      sql`sub.ticket_id = ${ticketsTable.id}`
    )
    .where(eq(fieldEmployeesTable.vendorId, vendorId))
    .groupBy(fieldEmployeesTable.id, fieldEmployeesTable.firstName, fieldEmployeesTable.lastName, fieldEmployeesTable.jobTitle)
    .orderBy(sql`count(${ticketsTable.id}) DESC`)
    .limit(15);

  const topWorkTypes = await db
    .select({
      workType: workTypesTable.name,
      count: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(sub.line_total), 0)::numeric(12,2)`,
    })
    .from(ticketsTable)
    .innerJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(
      sql`(SELECT ticket_id, SUM(quantity * unit_price) as line_total FROM ticket_line_items GROUP BY ticket_id) sub`,
      sql`sub.ticket_id = ${ticketsTable.id}`
    )
    .where(eq(ticketsTable.vendorId, vendorId))
    .groupBy(workTypesTable.name)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  const bySite = await db
    .select({
      siteId: siteLocationsTable.id,
      siteName: siteLocationsTable.name,
      ticketCount: sql<number>`count(*)::int`,
      revenue: sql<string>`COALESCE(SUM(sub.line_total), 0)::numeric(12,2)`,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(
      sql`(SELECT ticket_id, SUM(quantity * unit_price) as line_total FROM ticket_line_items GROUP BY ticket_id) sub`,
      sql`sub.ticket_id = ${ticketsTable.id}`
    )
    .where(eq(ticketsTable.vendorId, vendorId))
    .groupBy(siteLocationsTable.id, siteLocationsTable.name)
    .orderBy(sql`count(*) DESC`);

  const vendorScope = eq(ticketsTable.vendorId, vendorId);
  const revenuePipeline = await queryRevenuePipeline(vendorScope);
  const kickbackTrendByMonth = await queryKickbackTrendByMonth(vendorScope);

  const [invoiceAging, nec1099Exposure, spendByAfe] = await Promise.all([
    queryVendorInvoiceAging(vendorId),
    queryVendorNec1099Exposure(vendorId),
    querySpendByAfeForVendor(vendorId),
  ]);

  res.json({
    statusBreakdown,
    revenueByType: aggregateSpendByLineType(
      revenueByType.map((r) => ({ type: r.type, total: parseFloat(r.total) })),
    ),
    revenueByMonth: revenueByMonth.rows.map((r: any) => ({ month: r.month, total: parseFloat(r.total) })),
    revenueByYear: revenueByYear.rows.map((r: any) => ({ year: r.year, total: parseFloat(r.total) })),
    totalRevenue: parseFloat(totalRevenue.total),
    totalTickets: ticketTotals.total,
    approvedTickets: ticketTotals.approved,
    kickedBackTickets: ticketTotals.kickedBack,
    kickbackRate: computeKickbackRate(ticketTotals.kickedBack, ticketTotals.total),
    revenuePipeline,
    kickbackTrendByMonth,
    gpsCompliance: {
      total: gpsTotal.count,
      mismatches: gpsMismatchCount[0].count,
      rate: gpsTotal.count > 0 ? Math.round(((gpsTotal.count - gpsMismatchCount[0].count) / gpsTotal.count) * 100) : 100,
    },
    employeePerformance: employeeTicketCounts.map((e) => {
      const revenue = parseFloat(e.revenue);
      return {
        employeeId: e.employeeId,
        name: `${e.firstName} ${e.lastName}`,
        jobTitle: e.jobTitle,
        ticketCount: e.ticketCount,
        approvedCount: e.approvedCount,
        kickedBackCount: e.kickedBackCount,
        kickbackRate: computeKickbackRate(e.kickedBackCount, e.ticketCount),
        avgRevenuePerTicket: e.ticketCount > 0 ? revenue / e.ticketCount : 0,
        revenue,
      };
    }),
    topWorkTypes: topWorkTypes.map(w => ({
      workType: w.workType,
      count: w.count,
      revenue: parseFloat(w.revenue),
    })),
    bySite: bySite.map(s => ({
      siteId: s.siteId,
      siteName: s.siteName,
      ticketCount: s.ticketCount,
      revenue: parseFloat(s.revenue),
    })),
    invoiceAging,
    nec1099Exposure,
    spendByAfe,
  });
});

router.get("/analytics/partner/:partnerId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const partnerId = parseInt(req.params.partnerId);
  if (isNaN(partnerId)) {
    res.status(400).json({ error: "Invalid partner ID" });
    return;
  }

  // Enforce tenant scope: partners can only see their own analytics; admins see any.
  if (session.role === "partner") {
    if ((session.partnerId ?? null) !== partnerId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const partnerSiteRows = await db
    .select({ id: siteLocationsTable.id })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.partnerId, partnerId));
  const partnerSiteIds = partnerSiteRows.map((row) => row.id);

  const partnerSites = db
    .select({ id: siteLocationsTable.id })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.partnerId, partnerId));

  const statusBreakdown = await db
    .select({
      status: ticketsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ticketsTable)
    .where(sql`${ticketsTable.siteLocationId} IN (${partnerSites})`)
    .groupBy(ticketsTable.status);

  const [ticketTotals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      kickedBack: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'kicked_back')::int`,
      submitted: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'submitted')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review'))::int`,
    })
    .from(ticketsTable)
    .where(sql`${ticketsTable.siteLocationId} IN (${partnerSites})`);

  const [totalCost] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0)::numeric(12,2)`,
    })
    .from(ticketLineItemsTable)
    .innerJoin(ticketsTable, eq(ticketLineItemsTable.ticketId, ticketsTable.id))
    .where(sql`${ticketsTable.siteLocationId} IN (${partnerSites})`);

  const costByVendor = await db
    .select({
      vendorId: vendorsTable.id,
      vendorName: vendorsTable.name,
      ticketCount: sql<number>`count(DISTINCT ${ticketsTable.id})::int`,
      totalCost: sql<string>`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0)::numeric(12,2)`,
      approvedCount: sql<number>`count(DISTINCT ${ticketsTable.id}) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      kickedBackCount: sql<number>`count(DISTINCT ${ticketsTable.id}) FILTER (WHERE ${ticketsTable.status} = 'kicked_back')::int`,
    })
    .from(ticketsTable)
    .innerJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id))
    .leftJoin(ticketLineItemsTable, eq(ticketsTable.id, ticketLineItemsTable.ticketId))
    .where(sql`${ticketsTable.siteLocationId} IN (${partnerSites})`)
    .groupBy(vendorsTable.id, vendorsTable.name)
    .orderBy(sql`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0) DESC`);

  const costBySite = await db
    .select({
      siteId: siteLocationsTable.id,
      siteName: siteLocationsTable.name,
      ticketCount: sql<number>`count(DISTINCT ${ticketsTable.id})::int`,
      totalCost: sql<string>`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0)::numeric(12,2)`,
    })
    .from(siteLocationsTable)
    .leftJoin(ticketsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
    .leftJoin(ticketLineItemsTable, eq(ticketsTable.id, ticketLineItemsTable.ticketId))
    .where(eq(siteLocationsTable.partnerId, partnerId))
    .groupBy(siteLocationsTable.id, siteLocationsTable.name)
    .orderBy(sql`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0) DESC`);

  const costByMonthRaw = await db.execute<{ month: string; total: string }>(sql`
    SELECT to_char(m, 'YYYY-MM') AS month,
           COALESCE(SUM(li.quantity * li.unit_price), 0)::numeric(12,2) AS total
    FROM generate_series(
      date_trunc('month', now()) - interval '3 months',
      date_trunc('month', now()),
      interval '1 month'
    ) m
    LEFT JOIN tickets t
      ON date_trunc('month', t.created_at) = m
     AND t.site_location_id IN (${partnerSites})
    LEFT JOIN ticket_line_items li ON li.ticket_id = t.id
    GROUP BY m
    ORDER BY m
  `);

  const costByYearRaw = await db.execute<{ year: string; total: string }>(sql`
    SELECT to_char(y, 'YYYY') AS year,
           COALESCE(SUM(li.quantity * li.unit_price), 0)::numeric(12,2) AS total
    FROM generate_series(
      date_trunc('year', now()) - interval '3 years',
      date_trunc('year', now()),
      interval '1 year'
    ) y
    LEFT JOIN tickets t
      ON date_trunc('year', t.created_at) = y
     AND t.site_location_id IN (${partnerSites})
    LEFT JOIN ticket_line_items li ON li.ticket_id = t.id
    GROUP BY y
    ORDER BY y
  `);

  const costByType = await db
    .select({
      type: ticketLineItemsTable.type,
      total: sql<string>`COALESCE(SUM(${ticketLineItemsTable.quantity} * ${ticketLineItemsTable.unitPrice}), 0)::numeric(12,2)`,
    })
    .from(ticketLineItemsTable)
    .innerJoin(ticketsTable, eq(ticketLineItemsTable.ticketId, ticketsTable.id))
    .where(sql`${ticketsTable.siteLocationId} IN (${partnerSites})`)
    .groupBy(ticketLineItemsTable.type);

  const gpsMismatchCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(
      and(
        sql`${ticketsTable.siteLocationId} IN (${partnerSites})`,
        sql`${ticketsTable.checkInLatitude} IS NOT NULL`,
        sql`${siteLocationsTable.latitude} IS NOT NULL`,
        sql`(
          6371 * acos(
            cos(radians(${siteLocationsTable.latitude})) * cos(radians(${ticketsTable.checkInLatitude}))
            * cos(radians(${ticketsTable.checkInLongitude}) - radians(${siteLocationsTable.longitude}))
            + sin(radians(${siteLocationsTable.latitude})) * sin(radians(${ticketsTable.checkInLatitude}))
          )
        ) > 0.5`
      )
    );

  const [gpsTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(
      and(
        sql`${ticketsTable.siteLocationId} IN (${partnerSites})`,
        sql`${ticketsTable.checkInLatitude} IS NOT NULL`
      )
    );

  const topWorkTypes = await db
    .select({
      workType: workTypesTable.name,
      count: sql<number>`count(*)::int`,
      cost: sql<string>`COALESCE(SUM(sub.line_total), 0)::numeric(12,2)`,
    })
    .from(ticketsTable)
    .innerJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(
      sql`(SELECT ticket_id, SUM(quantity * unit_price) as line_total FROM ticket_line_items GROUP BY ticket_id) sub`,
      sql`sub.ticket_id = ${ticketsTable.id}`
    )
    .where(sql`${ticketsTable.siteLocationId} IN (${partnerSites})`)
    .groupBy(workTypesTable.name)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  const partnerScope =
    partnerSiteIds.length > 0
      ? inArray(ticketsTable.siteLocationId, partnerSiteIds)
      : sql`false`;
  const spendPipeline = await queryRevenuePipeline(partnerScope);
  const kickbackTrendByMonth = partnerSiteIds.length > 0
    ? await queryKickbackTrendByMonth(
        sql`${ticketsTable.siteLocationId} IN (${sql.join(partnerSiteIds.map((id) => sql`${id}`), sql`, `)})`,
      )
    : [];

  const kickbackRate = computeKickbackRate(ticketTotals.kickedBack, ticketTotals.total);

  const [spendByAfe, invoiceAging, nec1099Exposure] = await Promise.all([
    querySpendByAfe(partnerSiteIds),
    queryPartnerInvoiceAging(partnerId),
    queryPartnerNec1099Exposure(partnerId),
  ]);

  res.json({
    statusBreakdown,
    totalTickets: ticketTotals.total,
    approvedTickets: ticketTotals.approved,
    kickedBackTickets: ticketTotals.kickedBack,
    submittedTickets: ticketTotals.submitted,
    activeTickets: ticketTotals.inProgress,
    kickbackRate,
    totalCost: parseFloat(totalCost.total),
    spendPipeline,
    kickbackTrendByMonth,
    costByVendor: costByVendor.map((v) => {
      const totalCost = parseFloat(v.totalCost);
      return {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        ticketCount: v.ticketCount,
        totalCost,
        approvedCount: v.approvedCount,
        kickedBackCount: v.kickedBackCount,
        kickbackRate:
          v.ticketCount > 0 ? Math.round((v.kickedBackCount / v.ticketCount) * 100) : 0,
        avgCostPerTicket: v.ticketCount > 0 ? totalCost / v.ticketCount : 0,
      };
    }),
    costBySite: costBySite.map(s => ({
      siteId: s.siteId,
      siteName: s.siteName,
      ticketCount: s.ticketCount,
      totalCost: parseFloat(s.totalCost),
    })),
    costByMonth: costByMonthRaw.rows.map(m => ({ month: m.month, total: parseFloat(m.total) })),
    costByYear: costByYearRaw.rows.map(y => ({ year: y.year, total: parseFloat(y.total) })),
    costByType: aggregateSpendByLineType(
      costByType.map((t) => ({ type: t.type, total: parseFloat(t.total) })),
    ),
    gpsCompliance: {
      total: gpsTotal.count,
      mismatches: gpsMismatchCount[0].count,
      rate: gpsTotal.count > 0 ? Math.round(((gpsTotal.count - gpsMismatchCount[0].count) / gpsTotal.count) * 100) : 100,
    },
    topWorkTypes: topWorkTypes.map(w => ({
      workType: w.workType,
      count: w.count,
      cost: parseFloat(w.cost),
    })),
    spendByAfe,
    invoiceAging,
    nec1099Exposure,
  });
});

router.get("/analytics/foreman/:userId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session || !session.role || session.role === "guest") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const isForeman =
    session.vendorRole === "foreman" || session.vendorRole === "both";

  if (session.role === "field_employee") {
    if (!isForeman) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if ((session.userId ?? null) !== userId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const foremanScope = sql`(${ticketsTable.foremanUserId} = ${userId} OR ${ticketsTable.actingForemanUserId} = ${userId})`;

  const statusBreakdown = await db
    .select({
      status: ticketsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ticketsTable)
    .where(foremanScope)
    .groupBy(ticketsTable.status);

  const [ticketTotals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      kickedBack: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'kicked_back')::int`,
      submitted: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'submitted')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review'))::int`,
      onSiteToday: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} IN ('in_progress', 'pending_review') AND ${ticketsTable.checkInTime} >= date_trunc('day', now()))::int`,
    })
    .from(ticketsTable)
    .where(foremanScope);

  const bySite = await db
    .select({
      siteId: siteLocationsTable.id,
      siteName: siteLocationsTable.name,
      ticketCount: sql<number>`count(*)::int`,
      activeCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review', 'submitted'))::int`,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(foremanScope)
    .groupBy(siteLocationsTable.id, siteLocationsTable.name)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  const kickbackTrendByMonth = await queryKickbackTrendByMonth(foremanScope);

  const employeePerformance = await db
    .select({
      employeeId: fieldEmployeesTable.id,
      firstName: fieldEmployeesTable.firstName,
      lastName: fieldEmployeesTable.lastName,
      ticketCount: sql<number>`count(${ticketsTable.id})::int`,
      approvedCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'approved')::int`,
      kickedBackCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} = 'kicked_back')::int`,
      activeCount: sql<number>`count(*) FILTER (WHERE ${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'pending_review', 'submitted'))::int`,
    })
    .from(ticketsTable)
    .innerJoin(fieldEmployeesTable, eq(ticketsTable.fieldEmployeeId, fieldEmployeesTable.id))
    .where(and(foremanScope, sql`${ticketsTable.fieldEmployeeId} IS NOT NULL`))
    .groupBy(
      fieldEmployeesTable.id,
      fieldEmployeesTable.firstName,
      fieldEmployeesTable.lastName,
    )
    .orderBy(sql`count(${ticketsTable.id}) DESC`)
    .limit(10);

  res.json({
    statusBreakdown,
    totalTickets: ticketTotals.total,
    approvedTickets: ticketTotals.approved,
    kickedBackTickets: ticketTotals.kickedBack,
    submittedTickets: ticketTotals.submitted,
    activeTickets: ticketTotals.inProgress,
    onSiteToday: ticketTotals.onSiteToday,
    kickbackRate: computeKickbackRate(ticketTotals.kickedBack, ticketTotals.total),
    kickbackTrendByMonth,
    bySite: bySite.map((site) => ({
      siteId: site.siteId,
      siteName: site.siteName,
      ticketCount: site.ticketCount,
      activeCount: site.activeCount,
    })),
    employeePerformance: employeePerformance.map((employee) => ({
      employeeId: employee.employeeId,
      name: `${employee.firstName} ${employee.lastName}`,
      ticketCount: employee.ticketCount,
      approvedCount: employee.approvedCount,
      kickedBackCount: employee.kickedBackCount,
      kickbackRate: computeKickbackRate(employee.kickedBackCount, employee.ticketCount),
      activeCount: employee.activeCount,
    })),
  });
});

export default router;
