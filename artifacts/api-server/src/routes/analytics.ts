import { Router, type IRouter } from "express";
import { sql, eq, and } from "drizzle-orm";
import { getSessionFromRequest } from "../lib/session";
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

  res.json({
    statusBreakdown,
    revenueByType: revenueByType.map(r => ({ type: r.type, total: parseFloat(r.total) })),
    revenueByMonth: revenueByMonth.rows.map((r: any) => ({ month: r.month, total: parseFloat(r.total) })),
    revenueByYear: revenueByYear.rows.map((r: any) => ({ year: r.year, total: parseFloat(r.total) })),
    totalRevenue: parseFloat(totalRevenue.total),
    totalTickets: ticketTotals.total,
    approvedTickets: ticketTotals.approved,
    kickedBackTickets: ticketTotals.kickedBack,
    kickbackRate: ticketTotals.total > 0 ? Math.round((ticketTotals.kickedBack / ticketTotals.total) * 100) : 0,
    gpsCompliance: {
      total: gpsTotal.count,
      mismatches: gpsMismatchCount[0].count,
      rate: gpsTotal.count > 0 ? Math.round(((gpsTotal.count - gpsMismatchCount[0].count) / gpsTotal.count) * 100) : 100,
    },
    employeePerformance: employeeTicketCounts.map(e => ({
      employeeId: e.employeeId,
      name: `${e.firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      ticketCount: e.ticketCount,
      approvedCount: e.approvedCount,
      revenue: parseFloat(e.revenue),
    })),
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

  res.json({
    statusBreakdown,
    totalTickets: ticketTotals.total,
    approvedTickets: ticketTotals.approved,
    kickedBackTickets: ticketTotals.kickedBack,
    submittedTickets: ticketTotals.submitted,
    activeTickets: ticketTotals.inProgress,
    totalCost: parseFloat(totalCost.total),
    costByVendor: costByVendor.map(v => ({
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      ticketCount: v.ticketCount,
      totalCost: parseFloat(v.totalCost),
      approvedCount: v.approvedCount,
      kickedBackCount: v.kickedBackCount,
    })),
    costBySite: costBySite.map(s => ({
      siteId: s.siteId,
      siteName: s.siteName,
      ticketCount: s.ticketCount,
      totalCost: parseFloat(s.totalCost),
    })),
    costByMonth: costByMonthRaw.rows.map(m => ({ month: m.month, total: parseFloat(m.total) })),
    costByYear: costByYearRaw.rows.map(y => ({ year: y.year, total: parseFloat(y.total) })),
    costByType: costByType.map(t => ({ type: t.type, total: parseFloat(t.total) })),
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
  });
});

export default router;
