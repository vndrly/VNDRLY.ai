/**
 * Seed AskV QA dataset: ~N tickets per vendor across all partners/sites,
 * every office lifecycle status with coherent field data (check-ins, crew,
 * hours, mileage, line items, GPS). No photos or attachment URLs.
 *
 * Idempotent: re-run deletes prior rows tagged `[ASKV-QA]` in description first.
 *
 *   pnpm --filter @workspace/api-server run seed:askv-qa
 *   pnpm --filter @workspace/api-server run seed:askv-qa -- --cleanup
 *
 * Env:
 *   ASKV_QA_TICKETS_PER_VENDOR=200   (default 200)
 *   ASKV_QA_VENDOR_NAMES=Baker Hughes,Winchester  (optional comma filter)
 *   ASKV_QA_INCLUDE_ALL_VENDORS=1    (include e2e/test vendor rows; default skips them)
 *   ASKV_QA_DRY_RUN=1
 */
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  db,
  pool,
  gpsLogsTable,
  partnerVendorRelationshipsTable,
  partnersTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  ticketCheckInsTable,
  ticketCrewTable,
  ticketLineItemsTable,
  ticketNoteLogsTable,
  ticketStatusHistoryTable,
  ticketsTable,
  userOrgMembershipsTable,
  vendorPeopleTable,
  vendorsTable,
  vendorWorkTypesTable,
  workTypesTable,
} from "@workspace/db";
import { lifecycleStateForOfficeStatus } from "../src/lib/ticket-lifecycle-coherence";

const MARKER = "[ASKV-QA]";
const TICKETS_PER_VENDOR = Math.min(
  500,
  Math.max(1, Number(process.env.ASKV_QA_TICKETS_PER_VENDOR ?? "200") || 200),
);
const VENDOR_NAME_FILTER = (process.env.ASKV_QA_VENDOR_NAMES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DRY_RUN = process.env.ASKV_QA_DRY_RUN === "1";
const INCLUDE_ALL_VENDORS = process.env.ASKV_QA_INCLUDE_ALL_VENDORS === "1";

/** Skip e2e / uniqueness-test vendor rows unless ASKV_QA_INCLUDE_ALL_VENDORS=1 */
function isSeedableVendor(name: string): boolean {
  if (INCLUDE_ALL_VENDORS) return true;
  const n = name.trim();
  if (/^VENDOR-UNIQ-/i.test(n)) return false;
  if (/^E\d{3} Vendor /i.test(n)) return false;
  if (/^E2E Members Vendor /i.test(n)) return false;
  if (/^Test Addr Vendor /i.test(n)) return false;
  if (/^Quick Vendor$/i.test(n)) return false;
  if (/^ttx-helper-test-/i.test(n)) return false;
  if (/^void-audit-/i.test(n)) return false;
  if (/mol[a-z0-9]{6,}/i.test(n)) return false;
  return true;
}

/** Slot drives which timestamp / crew fields are populated (mirrors seed-test-tickets.sql). */
type Template = {
  status: string;
  lifecycleState: string;
  slot: number;
};

const TEMPLATES: Template[] = [
  { status: "awaiting_acceptance", lifecycleState: "pending_arrival", slot: 0 },
  { status: "initiated", lifecycleState: "pending_arrival", slot: 0 },
  { status: "initiated", lifecycleState: "en_route", slot: 1 },
  { status: "in_progress", lifecycleState: "on_site", slot: 2 },
  { status: "in_progress", lifecycleState: "on_site", slot: 3 },
  { status: "pending_review", lifecycleState: "off_site", slot: 6 },
  { status: "submitted", lifecycleState: "off_site", slot: 4 },
  { status: "submitted", lifecycleState: "off_site", slot: 5 },
  { status: "approved", lifecycleState: "off_site", slot: 7 },
  { status: "awaiting_payment", lifecycleState: "off_site", slot: 7 },
  { status: "kicked_back", lifecycleState: "off_site", slot: 9 },
  { status: "funds_dispersed", lifecycleState: "off_site", slot: 10 },
  { status: "cancelled", lifecycleState: "off_site", slot: 11 },
  { status: "denied", lifecycleState: "off_site", slot: 0 },
];

const FIELD_FIRST = [
  "Carlos", "Amy", "Daniel", "Ryan", "Joe", "Matt", "Sofia", "Liam",
  "Elena", "Marcus", "Priya", "Tyler", "Nina", "Omar", "Grace",
];
const FIELD_LAST = [
  "Mendez", "Nguyen", "Ortiz", "Foster", "Boggs", "Elerick", "Reyes",
  "Walsh", "Chen", "Brooks", "Patel", "Hart", "Silva", "Khan", "Moore",
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

function daysAgo(days: number): Date {
  return minutesAgo(-days * 24 * 60);
}

function needsCheckIn(slot: number): boolean {
  return slot >= 2 && slot <= 10;
}

function needsCheckOut(slot: number): boolean {
  return slot >= 4 && slot <= 10;
}

function needsLineItems(status: string): boolean {
  return [
    "submitted", "pending_review", "approved", "awaiting_payment",
    "awaiting_acceptance", "kicked_back", "funds_dispersed",
  ].includes(status);
}

async function cleanup(): Promise<void> {
  const ids = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(like(ticketsTable.description, `${MARKER}%`));
  const ticketIds = ids.map((r) => r.id);
  if (ticketIds.length === 0) {
    console.log("No prior AskV QA tickets to remove.");
    return;
  }
  console.log(`Removing ${ticketIds.length} prior ${MARKER} ticket(s)…`);
  await db.delete(ticketStatusHistoryTable).where(inArray(ticketStatusHistoryTable.ticketId, ticketIds));
  await db.delete(ticketCheckInsTable).where(inArray(ticketCheckInsTable.ticketId, ticketIds));
  await db.delete(ticketCrewTable).where(inArray(ticketCrewTable.ticketId, ticketIds));
  await db.delete(ticketLineItemsTable).where(inArray(ticketLineItemsTable.ticketId, ticketIds));
  await db.delete(ticketNoteLogsTable).where(inArray(ticketNoteLogsTable.ticketId, ticketIds));
  await db.delete(gpsLogsTable).where(inArray(gpsLogsTable.ticketId, ticketIds));
  await db.delete(ticketsTable).where(inArray(ticketsTable.id, ticketIds));
  console.log("Cleanup done.");
}

async function loadContext() {
  const vendors = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable);
  const seedable = vendors.filter((v) => isSeedableVendor(v.name));
  const filtered =
    VENDOR_NAME_FILTER.length === 0
      ? seedable
      : seedable.filter((v) =>
          VENDOR_NAME_FILTER.some(
            (f) => v.name.toLowerCase().includes(f.toLowerCase()),
          ),
        );

  const sites = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
    })
    .from(siteLocationsTable)
    .where(isNull(siteLocationsTable.supersededAt));

  const sitesByPartner = new Map<number, typeof sites>();
  for (const s of sites) {
    const list = sitesByPartner.get(s.partnerId) ?? [];
    list.push(s);
    sitesByPartner.set(s.partnerId, list);
  }

  const partnerIds = [...sitesByPartner.keys()];
  const partners = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .where(inArray(partnersTable.id, partnerIds));

  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const workTypes = await db
    .select({ id: workTypesTable.id, name: workTypesTable.name })
    .from(workTypesTable)
    .where(isNull(workTypesTable.partnerId))
    .limit(12);

  return { vendors: filtered, partners, partnerById, allSites: sites, sitesByPartner, workTypes };
}

async function resolveOrgUsers(
  vendorId: number,
  partnerId: number,
  cache: Map<string, Awaited<ReturnType<typeof resolveOrgUsersUncached>>>,
) {
  const key = `${vendorId}:${partnerId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const value = await resolveOrgUsersUncached(vendorId, partnerId);
  cache.set(key, value);
  return value;
}

async function resolveOrgUsersUncached(vendorId: number, partnerId: number) {
  const [vendorAdmin] = await db
    .select({ userId: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, vendorId),
        eq(userOrgMembershipsTable.role, "admin"),
      ),
    )
    .limit(1);
  const [partnerAdmin] = await db
    .select({ userId: userOrgMembershipsTable.userId })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "partner"),
        eq(userOrgMembershipsTable.partnerId, partnerId),
        eq(userOrgMembershipsTable.role, "admin"),
      ),
    )
    .limit(1);
  return {
    foremanUserId: vendorAdmin?.userId ?? null,
    partnerAdminUserId: partnerAdmin?.userId ?? null,
  };
}

async function ensureEmployees(vendorId: number, vendorName: string) {
  const slug = slugify(vendorName);
  const existing = await db
    .select()
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        like(vendorPeopleTable.email, `askv-qa.${slug}.%@vndrly.demo`),
        isNull(vendorPeopleTable.deletedAt),
      ),
    );

  if (existing.length >= 8) return existing;

  const rows: (typeof vendorPeopleTable.$inferInsert)[] = [];
  const foremanEmail = `askv-qa.${slug}.foreman@vndrly.demo`;
  if (!existing.some((e) => e.email === foremanEmail)) {
    rows.push({
      vendorId,
      vendorRole: "foreman",
      firstName: "QA",
      lastName: `Foreman ${vendorName.split(" ")[0]}`,
      email: foremanEmail,
      hourlyRate: "72.00",
      isActive: true,
    });
  }
  for (let i = existing.length; i < 8; i++) {
    const fn = FIELD_FIRST[i % FIELD_FIRST.length];
    const ln = FIELD_LAST[(i + vendorId) % FIELD_LAST.length];
    rows.push({
      vendorId,
      vendorRole: i % 3 === 0 ? "both" : "field",
      firstName: fn,
      lastName: ln,
      email: `askv-qa.${slug}.fe${i + 1}@vndrly.demo`,
      hourlyRate: String(42 + ((vendorId + i) % 25)),
      isActive: true,
    });
  }
  if (rows.length === 0) return existing;
  const inserted = await db.insert(vendorPeopleTable).values(rows).returning();
  return [...existing, ...inserted];
}

async function ensureVendorCatalog(
  vendorId: number,
  workTypeIds: number[],
) {
  for (const workTypeId of workTypeIds) {
    const [row] = await db
      .select({ id: vendorWorkTypesTable.id })
      .from(vendorWorkTypesTable)
      .where(
        and(
          eq(vendorWorkTypesTable.vendorId, vendorId),
          eq(vendorWorkTypesTable.workTypeId, workTypeId),
        ),
      )
      .limit(1);
    if (!row) {
      await db.insert(vendorWorkTypesTable).values({
        vendorId,
        workTypeId,
        unitPrice: String(150 + (workTypeId % 50)),
        unit: "per_hour",
      });
    }
  }
}

async function ensureRelationship(
  partnerId: number,
  vendorId: number,
  cache: Set<string>,
) {
  const key = `${partnerId}:${vendorId}`;
  if (cache.has(key)) return;
  await ensureRelationshipUncached(partnerId, vendorId);
  cache.add(key);
}

async function ensureRelationshipUncached(partnerId: number, vendorId: number) {
  const [row] = await db
    .select({ id: partnerVendorRelationshipsTable.id, status: partnerVendorRelationshipsTable.status })
    .from(partnerVendorRelationshipsTable)
    .where(
      and(
        eq(partnerVendorRelationshipsTable.partnerId, partnerId),
        eq(partnerVendorRelationshipsTable.vendorId, vendorId),
      ),
    )
    .limit(1);
  if (!row) {
    await db.insert(partnerVendorRelationshipsTable).values({
      partnerId,
      vendorId,
      status: "approved",
    });
  } else if (row.status !== "approved") {
    await db
      .update(partnerVendorRelationshipsTable)
      .set({ status: "approved" })
      .where(eq(partnerVendorRelationshipsTable.id, row.id));
  }
}

async function ensureSiteAssignment(
  siteId: number,
  vendorId: number,
  workTypeId: number,
  cache: Set<string>,
) {
  const key = `${siteId}:${vendorId}:${workTypeId}`;
  if (cache.has(key)) return;
  await ensureSiteAssignmentUncached(siteId, vendorId, workTypeId);
  cache.add(key);
}

async function ensureSiteAssignmentUncached(
  siteId: number,
  vendorId: number,
  workTypeId: number,
) {
  const [row] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, siteId),
        eq(siteWorkAssignmentsTable.vendorId, vendorId),
        eq(siteWorkAssignmentsTable.workTypeId, workTypeId),
      ),
    )
    .limit(1);
  if (!row) {
    await db.insert(siteWorkAssignmentsTable).values({
      siteLocationId: siteId,
      vendorId,
      workTypeId,
    });
  }
}

type EmployeeRow = typeof vendorPeopleTable.$inferSelect;

type SiteRow = {
  id: number;
  partnerId: number;
  name: string;
  latitude: number;
  longitude: number;
};

type PendingMeta = {
  template: Template;
  site: SiteRow;
  slot: number;
  checkIn: Date | null;
  checkOut: Date | null;
  primary: EmployeeRow;
  secondary: EmployeeRow;
  fieldEmployeeId: number | null;
  workType: { id: number; name: string };
  i: number;
  foremanUserId: number | null;
  partnerAdminUserId: number | null;
  hasSchedule: boolean;
};

const BATCH_SIZE = 25;

async function flushTicketBatch(
  pending: { values: typeof ticketsTable.$inferInsert; meta: PendingMeta }[],
  employees: EmployeeRow[],
): Promise<number> {
  if (pending.length === 0) return 0;

  const inserted = await db
    .insert(ticketsTable)
    .values(pending.map((p) => p.values))
    .returning({ id: ticketsTable.id });

  const crewRows: (typeof ticketCrewTable.$inferInsert)[] = [];
  const checkInRows: (typeof ticketCheckInsTable.$inferInsert)[] = [];
  const lineItemRows: (typeof ticketLineItemsTable.$inferInsert)[] = [];
  const gpsRows: (typeof gpsLogsTable.$inferInsert)[] = [];
  const noteRows: (typeof ticketNoteLogsTable.$inferInsert)[] = [];
  const historyRows: (typeof ticketStatusHistoryTable.$inferInsert)[] = [];

  for (let idx = 0; idx < inserted.length; idx++) {
    const ticketId = inserted[idx].id;
    const {
      template,
      site,
      slot,
      checkIn,
      checkOut,
      primary,
      secondary,
      fieldEmployeeId,
      workType,
      i,
      foremanUserId,
      partnerAdminUserId,
      hasSchedule,
    } = pending[idx].meta;
    const actor = foremanUserId ?? partnerAdminUserId;

    if (fieldEmployeeId) {
      crewRows.push({
        ticketId,
        employeeId: fieldEmployeeId,
        addedByUserId: actor,
        ackStatus:
          template.status === "initiated" && !hasSchedule ? "pending" : "accepted",
        ackAt: hasSchedule ? daysAgo(4) : null,
      });
      if (
        secondary.id !== primary.id &&
        [
          "in_progress",
          "submitted",
          "pending_review",
          "approved",
          "awaiting_payment",
          "kicked_back",
          "funds_dispersed",
        ].includes(template.status)
      ) {
        crewRows.push({
          ticketId,
          employeeId: secondary.id,
          addedByUserId: actor,
          ackStatus: "accepted",
          ackAt: daysAgo(4),
        });
      }
    }

    const crewIds = [primary.id];
    if (secondary.id !== primary.id && needsCheckIn(slot)) crewIds.push(secondary.id);

    for (const empId of crewIds) {
      if (!checkIn) continue;
      const emp = employees.find((e) => e.id === empId);
      const out = checkOut ?? null;
      checkInRows.push({
        ticketId,
        employeeId: empId,
        checkInAt: checkIn,
        checkOutAt: out,
        checkInLatitude: site.latitude,
        checkInLongitude: site.longitude,
        checkOutLatitude: out ? site.latitude + 0.001 : null,
        checkOutLongitude: out ? site.longitude + 0.001 : null,
        hourlyRateAtTime: emp?.hourlyRate ?? "55.00",
        source: "auto",
      });
    }

    if (needsLineItems(template.status)) {
      lineItemRows.push(
        {
          ticketId,
          type: "labor",
          description: `${workType.name} — field hours`,
          quantity: "8.00",
          unitPrice: "175.00",
        },
        {
          ticketId,
          type: "mileage",
          description: "Round-trip truck mileage",
          quantity: String(45 + (i % 40)),
          unitPrice: "0.67",
        },
      );
    }

    if (checkIn && template.status === "in_progress") {
      for (let g = 0; g < 4; g++) {
        gpsRows.push({
          ticketId,
          latitude: site.latitude + g * 0.0003,
          longitude: site.longitude + g * 0.0002,
          eventType: g === 0 ? "en_route" : "check_in",
          speedMps: 12 + g,
          batteryLevel: 0.85 - g * 0.05,
          recordedAt: new Date(checkIn.getTime() + g * 15 * 60_000),
        });
      }
    }

    if (needsCheckOut(slot)) {
      noteRows.push({
        ticketId,
        content: `QA note: ${workType.name} completed at ${site.name}. No issues reported.`,
        attachments: [],
        createdById: actor,
      });
    }

    historyRows.push({
      ticketId,
      fromStatus: "initiated",
      toStatus: "initiated",
      actorUserId: partnerAdminUserId,
      actorRole: "partner",
      reason: "Ticket created (QA seed)",
      createdAt: daysAgo(10 + (i % 60)),
    });
  }

  const writes: Promise<unknown>[] = [];
  if (crewRows.length > 0) writes.push(db.insert(ticketCrewTable).values(crewRows));
  if (checkInRows.length > 0) writes.push(db.insert(ticketCheckInsTable).values(checkInRows));
  if (lineItemRows.length > 0) writes.push(db.insert(ticketLineItemsTable).values(lineItemRows));
  if (gpsRows.length > 0) writes.push(db.insert(gpsLogsTable).values(gpsRows));
  if (noteRows.length > 0) writes.push(db.insert(ticketNoteLogsTable).values(noteRows));
  if (historyRows.length > 0) writes.push(db.insert(ticketStatusHistoryTable).values(historyRows));
  await Promise.all(writes);

  return inserted.length;
}

async function seedVendorTickets(args: {
  vendorId: number;
  vendorName: string;
  partners: { id: number; name: string }[];
  partnerById: Map<number, { id: number; name: string }>;
  allSites: SiteRow[];
  sitesByPartner: Map<number, SiteRow[]>;
  workTypes: { id: number; name: string }[];
  employees: EmployeeRow[];
}) {
  const { vendorId, vendorName, partners, partnerById, allSites, workTypes, employees } = args;
  const workTypeIds = workTypes.map((w) => w.id);
  await ensureVendorCatalog(vendorId, workTypeIds);

  const fieldEmployees = employees.filter((e) =>
    ["field", "foreman", "both"].includes(e.vendorRole),
  );
  if (fieldEmployees.length === 0) {
    console.warn(`  ! no field employees for vendor ${vendorName}, skipping tickets`);
    return 0;
  }

  const relationshipCache = new Set<string>();
  const assignmentCache = new Set<string>();

  if (!DRY_RUN) {
    for (const partner of partners) {
      await ensureRelationship(partner.id, vendorId, relationshipCache);
    }
  }

  let created = 0;
  const orgUserCache = new Map<
    string,
    Awaited<ReturnType<typeof resolveOrgUsersUncached>>
  >();
  const pending: { values: typeof ticketsTable.$inferInsert; meta: PendingMeta }[] = [];

  for (let i = 0; i < TICKETS_PER_VENDOR; i++) {
    const template = TEMPLATES[i % TEMPLATES.length];
    const site = allSites[(i + vendorId) % allSites.length];
    const partner =
      partnerById.get(site.partnerId) ?? partners[i % partners.length];
    const workType = workTypes[(i + vendorId) % workTypes.length];
    const primary = fieldEmployees[i % fieldEmployees.length];
    const secondary = fieldEmployees[(i + 1) % fieldEmployees.length];

    if (!DRY_RUN) {
      await ensureSiteAssignment(site.id, vendorId, workType.id, assignmentCache);
    }

    const { foremanUserId, partnerAdminUserId } = DRY_RUN
      ? { foremanUserId: null, partnerAdminUserId: null }
      : await resolveOrgUsers(vendorId, partner.id, orgUserCache);

    const slot = template.slot;
    const unassigned = slot === 0 && template.status === "initiated";
    const hasSchedule = slot >= 1 && template.status !== "cancelled" && template.status !== "denied";
    const checkIn = needsCheckIn(slot) ? daysAgo(3 + (i % 30)) : null;
    const checkOut = needsCheckOut(slot) && checkIn
      ? new Date(checkIn.getTime() + 7 * 3600_000)
      : null;
    const startMileage = checkIn ? String(12000 + (i % 500) + vendorId) : null;
    const endMileage = checkOut ? String(Number(startMileage) + 45 + (i % 80)) : null;

    const lifecycle =
      template.lifecycleState ||
      lifecycleStateForOfficeStatus(template.status);

    const description = `${MARKER} ${template.status} — ${workType.name} @ ${site.name}`;

    if (DRY_RUN) {
      created++;
      continue;
    }

    const fieldEmployeeId =
      unassigned || template.status === "denied" ? null : primary.id;

    pending.push({
      values: {
        siteLocationId: site.id,
        vendorId,
        workTypeId: workType.id,
        fieldEmployeeId,
        status: template.status,
        lifecycleState: lifecycle,
        intakeChannel: "partner_self_service",
        description,
        notes: `QA seed slot ${slot}. Partner ${partner.name}.`,
        kickbackReason:
          template.status === "kicked_back"
            ? "Line-item rates exceed AFE allotment — adjust hours and re-submit."
            : null,
        checkInTime: checkIn,
        checkOutTime: checkOut,
        checkInLatitude: checkIn ? site.latitude : null,
        checkInLongitude: checkIn ? site.longitude : null,
        checkOutLatitude: checkOut ? site.latitude + 0.002 : null,
        checkOutLongitude: checkOut ? site.longitude + 0.002 : null,
        startingMileage: startMileage,
        endingMileage: endMileage,
        enRouteAt: hasSchedule ? new Date((checkIn ?? daysAgo(5)).getTime() - 90 * 60_000) : null,
        onLocationAt: checkIn ? new Date(checkIn.getTime() - 15 * 60_000) : null,
        scheduledStartAt: hasSchedule ? daysAgo(4 + (i % 20)) : null,
        scheduledDurationMinutes: hasSchedule ? 480 : null,
        foremanUserId: hasSchedule ? foremanUserId : null,
        scheduledAt: hasSchedule ? daysAgo(5 + (i % 20)) : null,
        scheduledById: partnerAdminUserId,
        approvedAt:
          ["approved", "awaiting_payment", "funds_dispersed"].includes(template.status)
            ? daysAgo(2 + (i % 10))
            : null,
        paymentMethod: template.status === "funds_dispersed" ? "ach" : null,
        paymentReference:
          template.status === "funds_dispersed"
            ? `ACH-${vendorId}-${partner.id}-${i}`
            : null,
        paymentNote:
          template.status === "funds_dispersed" ? "Net-30 ACH — QA seed" : null,
        paymentDispersedAt:
          template.status === "funds_dispersed" ? daysAgo(1) : null,
        paymentDispersedById:
          template.status === "funds_dispersed" ? partnerAdminUserId : null,
        preCancelStatus: template.status === "cancelled" ? "initiated" : null,
        cancelledAt: template.status === "cancelled" ? daysAgo(2) : null,
        cancelledById: template.status === "cancelled" ? partnerAdminUserId : null,
        createdById: partnerAdminUserId,
        createdAt: daysAgo(10 + (i % 60)),
        updatedAt: daysAgo(1 + (i % 5)),
      },
      meta: {
        template,
        site,
        slot,
        checkIn,
        checkOut,
        primary,
        secondary,
        fieldEmployeeId,
        workType,
        i,
        foremanUserId,
        partnerAdminUserId,
        hasSchedule,
      },
    });

    if (pending.length >= BATCH_SIZE) {
      created += await flushTicketBatch(pending, employees);
      pending.length = 0;
      if (created % 50 === 0) {
        console.log(`  … ${vendorName}: ${created}/${TICKETS_PER_VENDOR} tickets`);
      }
    }
  }

  if (pending.length > 0) {
    created += await flushTicketBatch(pending, employees);
  }
  return created;
}

async function main() {
  const cleanupOnly = process.argv.includes("--cleanup");
  if (cleanupOnly) {
    await cleanup();
    await pool.end();
    return;
  }

  console.log(`${MARKER} AskV QA seed — ${TICKETS_PER_VENDOR} tickets/vendor${DRY_RUN ? " (DRY RUN)" : ""}`);
  if (!DRY_RUN) {
    await cleanup();
  }

  const ctx = await loadContext();
  if (ctx.vendors.length === 0) {
    throw new Error("No vendors matched filter.");
  }
  if (ctx.partners.length === 0) {
    throw new Error("No partners with site locations found.");
  }
  console.log(
    `Vendors: ${ctx.vendors.length}, partners with sites: ${ctx.partners.length}, sites: ${ctx.allSites.length}, work types: ${ctx.workTypes.length}`,
  );

  let total = 0;
  for (const vendor of ctx.vendors) {
    console.log(`\n→ ${vendor.name} (#${vendor.id})`);
    const employees = await ensureEmployees(vendor.id, vendor.name);
    const n = await seedVendorTickets({
      vendorId: vendor.id,
      vendorName: vendor.name,
      partners: ctx.partners,
      partnerById: ctx.partnerById,
      allSites: ctx.allSites,
      sitesByPartner: ctx.sitesByPartner,
      workTypes: ctx.workTypes,
      employees,
    });
    total += n;
    console.log(`  ✓ ${n} tickets`);
  }

  console.log(`\nDone. ${total} tickets seeded (${MARKER}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  void pool.end();
  process.exit(1);
});
