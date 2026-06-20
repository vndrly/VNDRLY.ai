/**
 * Backfill crew roster, check-in/out sessions, auto labor lines, and sample
 * parts/equipment rows on the most recent tickets so Crew & Time and
 * Parts & Labor cards have realistic totals for QA.
 *
 * Idempotent: skips tickets already tagged with `source = 'backfill'` check-ins
 * or `[backfill]` line items.
 *
 *   pnpm --filter @workspace/api-server run backfill:crew-times
 *   pnpm --filter @workspace/api-server run backfill:crew-times -- --dry-run
 *   pnpm --filter @workspace/api-server run backfill:crew-times -- --ticket-id=10812
 *
 * Env:
 *   BACKFILL_CREW_LIMIT=100
 *   BACKFILL_CREW_DRY_RUN=1
 */
import { and, desc, eq, inArray, isNull, like, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  pool,
  siteLocationsTable,
  ticketCheckInsTable,
  ticketCrewTable,
  ticketLineItemsTable,
  ticketsTable,
  vendorPeopleTable,
} from "@workspace/db";
import { regenerateAutoLaborLines } from "../src/lib/auto-labor-lines";

const SOURCE = "backfill";
const MARKER = "[backfill]";
const LIMIT = Math.min(
  500,
  Math.max(1, Number(process.env.BACKFILL_CREW_LIMIT ?? "100") || 100),
);
const DRY_RUN =
  process.env.BACKFILL_CREW_DRY_RUN === "1" || process.argv.includes("--dry-run");
const TICKET_ID_ARG = process.argv.find((a) => a.startsWith("--ticket-id="));
const SINGLE_TICKET_ID = TICKET_ID_ARG
  ? Number(TICKET_ID_ARG.split("=")[1])
  : null;

const SKIP_STATUSES = ["cancelled", "denied"];

type TicketRow = {
  id: number;
  status: string;
  vendorId: number;
  fieldEmployeeId: number | null;
  closedAt: Date | null;
  createdAt: Date;
  latitude: number;
  longitude: number;
};

type EmployeeRow = typeof vendorPeopleTable.$inferSelect;

type ExistingSession = {
  id: number;
  employeeId: number;
  checkInAt: Date;
  checkOutAt: Date | null;
  hourlyRateAtTime: string | null;
};

function hoursForTicket(ticketId: number, crewIndex: number): number {
  return 4 + ((ticketId + crewIndex * 3) % 8);
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

function pickEmployees(
  ticket: TicketRow,
  poolRows: EmployeeRow[],
): EmployeeRow[] {
  if (poolRows.length === 0) return [];

  const picked: EmployeeRow[] = [];
  const want = 1 + (ticket.id % 3);

  if (ticket.fieldEmployeeId != null) {
    const primary = poolRows.find((e) => e.id === ticket.fieldEmployeeId);
    if (primary) picked.push(primary);
  }

  for (const emp of poolRows) {
    if (picked.length >= want) break;
    if (picked.some((p) => p.id === emp.id)) continue;
    picked.push(emp);
  }

  return picked.slice(0, Math.max(1, want));
}

async function loadCandidates(): Promise<TicketRow[]> {
  return db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      vendorId: ticketsTable.vendorId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      closedAt: ticketsTable.closedAt,
      createdAt: ticketsTable.createdAt,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
    })
    .from(ticketsTable)
    .innerJoin(
      siteLocationsTable,
      eq(ticketsTable.siteLocationId, siteLocationsTable.id),
    )
    .where(
      and(
        SINGLE_TICKET_ID != null && Number.isFinite(SINGLE_TICKET_ID)
          ? eq(ticketsTable.id, SINGLE_TICKET_ID)
          : undefined,
        SINGLE_TICKET_ID == null
          ? notInArray(ticketsTable.status, SKIP_STATUSES)
          : undefined,
        sql`NOT EXISTS (
          SELECT 1 FROM ticket_check_ins ci
          WHERE ci.ticket_id = ${ticketsTable.id}
            AND ci.source = ${SOURCE}
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM ticket_line_items li
          WHERE li.ticket_id = ${ticketsTable.id}
            AND li.description LIKE ${MARKER + "%"}
        )`,
      ),
    )
    .orderBy(desc(ticketsTable.id))
    .limit(SINGLE_TICKET_ID != null ? 1 : LIMIT);
}

async function loadEmployeesByVendor(
  vendorIds: number[],
): Promise<Map<number, EmployeeRow[]>> {
  if (vendorIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(vendorPeopleTable)
    .where(
      and(
        inArray(vendorPeopleTable.vendorId, vendorIds),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
        inArray(vendorPeopleTable.vendorRole, ["field", "foreman", "both"]),
      ),
    );

  const map = new Map<number, EmployeeRow[]>();
  for (const row of rows) {
    const list = map.get(row.vendorId) ?? [];
    list.push(row);
    map.set(row.vendorId, list);
  }
  return map;
}

async function loadExistingSessions(ticketId: number): Promise<ExistingSession[]> {
  return db
    .select({
      id: ticketCheckInsTable.id,
      employeeId: ticketCheckInsTable.employeeId,
      checkInAt: ticketCheckInsTable.checkInAt,
      checkOutAt: ticketCheckInsTable.checkOutAt,
      hourlyRateAtTime: ticketCheckInsTable.hourlyRateAtTime,
    })
    .from(ticketCheckInsTable)
    .where(eq(ticketCheckInsTable.ticketId, ticketId))
    .orderBy(ticketCheckInsTable.checkInAt);
}

async function ensureCrewRoster(
  ticketId: number,
  employeeIds: number[],
  dryRun: boolean,
): Promise<number> {
  if (employeeIds.length === 0) return 0;

  const existing = await db
    .select({ employeeId: ticketCrewTable.employeeId })
    .from(ticketCrewTable)
    .where(
      and(
        eq(ticketCrewTable.ticketId, ticketId),
        isNull(ticketCrewTable.removedAt),
      ),
    );
  const have = new Set(existing.map((r) => r.employeeId));
  const missing = employeeIds.filter((id) => !have.has(id));
  if (missing.length === 0 || dryRun) return missing.length;

  await db.insert(ticketCrewTable).values(
    missing.map((employeeId) => ({
      ticketId,
      employeeId,
      ackStatus: "accepted" as const,
      ackAt: new Date(),
    })),
  );
  return missing.length;
}

async function patchExistingSessions(
  ticket: TicketRow,
  sessions: ExistingSession[],
  employees: EmployeeRow[],
): Promise<number> {
  let patched = 0;
  for (const session of sessions) {
    const emp = employees.find((e) => e.id === session.employeeId);
    const rate = emp?.hourlyRate ?? "75.00";
    const needsRate = session.hourlyRateAtTime == null || session.hourlyRateAtTime === "0";
    const needsCheckout =
      session.checkOutAt == null &&
      ticket.status !== "in_progress" &&
      ticket.status !== "initiated";

    if (!needsRate && !needsCheckout) continue;

    const checkOutAt = needsCheckout
      ? new Date(
          session.checkInAt.getTime() +
            hoursForTicket(ticket.id, session.employeeId % 3) * 3_600_000,
        )
      : session.checkOutAt;

    if (DRY_RUN) {
      patched++;
      continue;
    }

    await db
      .update(ticketCheckInsTable)
      .set({
        hourlyRateAtTime: needsRate ? rate : session.hourlyRateAtTime,
        checkOutAt: needsCheckout ? checkOutAt : session.checkOutAt,
        checkOutLatitude: needsCheckout ? ticket.latitude + 0.001 : undefined,
        checkOutLongitude: needsCheckout ? ticket.longitude + 0.001 : undefined,
        source: SOURCE,
      })
      .where(eq(ticketCheckInsTable.id, session.id));
    patched++;
  }
  return patched;
}

async function countLaborLineItems(ticketId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ticketLineItemsTable)
    .where(
      and(
        eq(ticketLineItemsTable.ticketId, ticketId),
        or(
          eq(ticketLineItemsTable.type, "labor"),
          like(ticketLineItemsTable.description, "[auto]%"),
        ),
      ),
    );
  return row?.n ?? 0;
}

async function insertManualLaborFromSessions(
  ticketId: number,
  sessions: ExistingSession[],
  employees: EmployeeRow[],
): Promise<number> {
  const rows: (typeof ticketLineItemsTable.$inferInsert)[] = [];
  for (const session of sessions) {
    if (!session.checkOutAt) continue;
    const emp = employees.find((e) => e.id === session.employeeId);
    const rate = parseFloat(session.hourlyRateAtTime ?? emp?.hourlyRate ?? "75");
    const hours = hoursBetween(session.checkInAt, session.checkOutAt);
    if (hours <= 0 || rate <= 0) continue;
    const name = emp
      ? `${emp.firstName} ${emp.lastName}`.trim()
      : `Employee #${session.employeeId}`;
    rows.push({
      ticketId,
      type: "labor",
      description: `${MARKER} Labor — ${name} @ $${rate.toFixed(2)}/hr`,
      quantity: String(Math.round(hours * 100) / 100),
      unitPrice: String(Math.round(rate * 100) / 100),
    });
  }
  if (rows.length === 0 || DRY_RUN) return rows.length;
  await db.insert(ticketLineItemsTable).values(rows);
  return rows.length;
}

async function insertExtraLineItems(ticketId: number): Promise<number> {
  const extraRows: (typeof ticketLineItemsTable.$inferInsert)[] = [
    {
      ticketId,
      type: "parts",
      description: `${MARKER} Consumables / fittings`,
      quantity: String(1 + (ticketId % 4)),
      unitPrice: String(85 + (ticketId % 5) * 15),
    },
    {
      ticketId,
      type: "equipment",
      description: `${MARKER} Specialty tool rental`,
      quantity: "1",
      unitPrice: String(250 + (ticketId % 3) * 50),
      taxRate: "0.0825",
    },
    {
      ticketId,
      type: "mileage",
      description: `${MARKER} Round-trip truck mileage`,
      quantity: String(35 + (ticketId % 25)),
      unitPrice: "0.67",
    },
  ];
  if (DRY_RUN) return extraRows.length;
  await db.insert(ticketLineItemsTable).values(extraRows);
  return extraRows.length;
}

async function backfillTicket(
  ticket: TicketRow,
  employees: EmployeeRow[],
): Promise<{
  sessions: number;
  patched: number;
  roster: number;
  laborLines: number;
  extras: number;
  mode: "insert" | "enrich";
}> {
  const existing = await loadExistingSessions(ticket.id);
  const closedExisting = existing.filter((s) => s.checkOutAt != null);

  let crew = pickEmployees(ticket, employees);
  if (closedExisting.length > 0 || existing.length > 0) {
    const ids = new Set([
      ...existing.map((s) => s.employeeId),
      ...crew.map((c) => c.id),
    ]);
    crew = employees.filter((e) => ids.has(e.id));
    if (crew.length === 0) crew = pickEmployees(ticket, employees);
  }

  if (crew.length === 0) {
    return { sessions: 0, patched: 0, roster: 0, laborLines: 0, extras: 0, mode: "insert" };
  }

  const rosterAdded = await ensureCrewRoster(
    ticket.id,
    crew.map((c) => c.id),
    DRY_RUN,
  );

  let sessionsAdded = 0;
  let patched = 0;
  let mode: "insert" | "enrich" = "insert";

  if (closedExisting.length === 0 && existing.length === 0) {
    const anchor = ticket.createdAt ?? new Date(Date.now() - 7 * 86_400_000);
    const checkInBase = new Date(anchor.getTime() + 2 * 3_600_000);
    const openSessionOnly =
      ticket.status === "in_progress" && ticket.id % 5 === 0;

    const sessionRows: (typeof ticketCheckInsTable.$inferInsert)[] = [];
    for (let i = 0; i < crew.length; i++) {
      const emp = crew[i];
      const checkInAt = new Date(checkInBase.getTime() + i * 45 * 60_000);
      const hours = hoursForTicket(ticket.id, i);
      const checkOutAt = openSessionOnly
        ? null
        : new Date(checkInAt.getTime() + hours * 3_600_000);
      const rate = emp.hourlyRate ?? "75.00";

      sessionRows.push({
        ticketId: ticket.id,
        employeeId: emp.id,
        checkInAt,
        checkOutAt,
        checkInLatitude: ticket.latitude,
        checkInLongitude: ticket.longitude,
        checkOutLatitude: checkOutAt ? ticket.latitude + 0.001 : null,
        checkOutLongitude: checkOutAt ? ticket.longitude + 0.001 : null,
        hourlyRateAtTime: rate,
        source: SOURCE,
      });
    }

    if (!DRY_RUN && sessionRows.length > 0) {
      await db.insert(ticketCheckInsTable).values(sessionRows);

      if (ticket.fieldEmployeeId != null) {
        const primarySession = sessionRows.find(
          (s) => s.employeeId === ticket.fieldEmployeeId,
        );
        if (primarySession) {
          await db
            .update(ticketsTable)
            .set({
              checkInTime: primarySession.checkInAt,
              checkOutTime: primarySession.checkOutAt ?? null,
              checkInLatitude: ticket.latitude,
              checkInLongitude: ticket.longitude,
              checkOutLatitude: primarySession.checkOutAt
                ? ticket.latitude + 0.001
                : null,
              checkOutLongitude: primarySession.checkOutAt
                ? ticket.longitude + 0.001
                : null,
            })
            .where(eq(ticketsTable.id, ticket.id));
        }
      }
    }
    sessionsAdded = sessionRows.length;
  } else {
    mode = "enrich";
    patched = await patchExistingSessions(ticket, existing, employees);
  }

  const refreshed = await loadExistingSessions(ticket.id);
  let laborLines = 0;
  const laborCount = await countLaborLineItems(ticket.id);
  if (laborCount === 0) {
    if (!DRY_RUN && !ticket.closedAt) {
      laborLines = await regenerateAutoLaborLines(ticket.id);
    }
    if (laborLines === 0) {
      laborLines = await insertManualLaborFromSessions(
        ticket.id,
        refreshed,
        employees,
      );
    }
  }

  const extras = await insertExtraLineItems(ticket.id);

  return {
    sessions: sessionsAdded,
    patched,
    roster: rosterAdded,
    laborLines,
    extras,
    mode,
  };
}

async function main() {
  console.log(
    `Crew/time backfill — last ${LIMIT} ticket(s)${SINGLE_TICKET_ID ? `, ticket #${SINGLE_TICKET_ID}` : ""}${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  const candidates = await loadCandidates();
  if (candidates.length === 0) {
    console.log("No tickets matched (already backfilled or none in range).");
    await pool.end();
    return;
  }

  const vendorIds = [...new Set(candidates.map((t) => t.vendorId))];
  const employeesByVendor = await loadEmployeesByVendor(vendorIds);

  let updated = 0;
  let skippedNoPeople = 0;
  let totalSessions = 0;
  let totalPatched = 0;
  let totalLaborLines = 0;
  let totalExtras = 0;

  for (const ticket of candidates) {
    const employees = employeesByVendor.get(ticket.vendorId) ?? [];
    if (employees.length === 0) {
      skippedNoPeople++;
      console.log(`  skip #${ticket.id} — vendor ${ticket.vendorId} has no field employees`);
      continue;
    }

    const result = await backfillTicket(ticket, employees);
    if (result.sessions === 0 && result.patched === 0 && result.laborLines === 0 && result.extras === 0) {
      skippedNoPeople++;
      continue;
    }

    updated++;
    totalSessions += result.sessions;
    totalPatched += result.patched;
    totalLaborLines += result.laborLines;
    totalExtras += result.extras;
    console.log(
      `  ✓ #${ticket.id} (${ticket.status}, ${result.mode}) — +${result.sessions} session(s), patched ${result.patched}, +${result.roster} roster, ${result.laborLines} labor line(s), +${result.extras} extra line item(s)`,
    );
  }

  console.log(
    `\nDone. ${updated} ticket(s) updated, ${totalSessions} new session(s), ${totalPatched} patched session(s), ${totalLaborLines} labor row(s), ${totalExtras} parts/equipment/mileage row(s). Skipped ${skippedNoPeople}.`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
