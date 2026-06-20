import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, safetyEventsTable, siteLocationsTable } from "@workspace/db";

const OPEN_STATUSES = ["submitted", "under_review", "resolved"] as const;

export type SafetyMetricsResult = {
  safetyScore: number;
  daysWithoutRecordable: number | null;
  noRecordableMessage: string | null;
  openEventCount: number;
  openHipoCount: number;
  openRecordableCount: number;
  formulaExplanation: string;
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function computeSafetyMetrics(opts: {
  partnerId?: number;
  vendorId?: number;
  siteLocationId?: number;
}): Promise<SafetyMetricsResult> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  const scopeFilters = [];
  if (opts.siteLocationId != null) {
    scopeFilters.push(eq(safetyEventsTable.siteLocationId, opts.siteLocationId));
  } else if (opts.partnerId != null) {
    scopeFilters.push(eq(safetyEventsTable.partnerId, opts.partnerId));
  } else if (opts.vendorId != null) {
    scopeFilters.push(eq(safetyEventsTable.vendorId, opts.vendorId));
  }

  const baseWhere = scopeFilters.length > 0 ? and(...scopeFilters) : undefined;

  const openRows = await db
    .select({
      id: safetyEventsTable.id,
      status: safetyEventsTable.status,
      isHighPotential: safetyEventsTable.isHighPotential,
      isRecordable: safetyEventsTable.isRecordable,
      updatedAt: safetyEventsTable.updatedAt,
      createdAt: safetyEventsTable.createdAt,
      eventType: safetyEventsTable.eventType,
    })
    .from(safetyEventsTable)
    .where(
      baseWhere
        ? and(baseWhere, inArray(safetyEventsTable.status, [...OPEN_STATUSES]))
        : inArray(safetyEventsTable.status, [...OPEN_STATUSES]),
    );

  const openRecordables = openRows.filter((r) => r.isRecordable === true);
  const openHipoOld = openRows.filter(
    (r) => r.isHighPotential && r.createdAt < sevenDaysAgo,
  );
  const staleOpen = openRows.filter(
    (r) => r.updatedAt < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  );

  const nearMissRows = await db
    .select({ id: safetyEventsTable.id })
    .from(safetyEventsTable)
    .where(
      baseWhere
        ? and(
            baseWhere,
            eq(safetyEventsTable.eventType, "near_miss"),
            gte(safetyEventsTable.createdAt, thirtyDaysAgo),
          )
        : and(
            eq(safetyEventsTable.eventType, "near_miss"),
            gte(safetyEventsTable.createdAt, thirtyDaysAgo),
          ),
    );

  let score = 100;
  score -= openRecordables.length * 15;
  score -= openHipoOld.length * 5;
  score -= Math.min(10, staleOpen.length * 2);
  score += Math.min(10, nearMissRows.length * 2);

  const [lastRecordable] = await db
    .select({ closedAt: safetyEventsTable.closedAt, createdAt: safetyEventsTable.createdAt })
    .from(safetyEventsTable)
    .where(
      baseWhere
        ? and(
            baseWhere,
            eq(safetyEventsTable.isRecordable, true),
            eq(safetyEventsTable.status, "closed"),
            isNotNull(safetyEventsTable.closedAt),
          )
        : and(
            eq(safetyEventsTable.isRecordable, true),
            eq(safetyEventsTable.status, "closed"),
            isNotNull(safetyEventsTable.closedAt),
          ),
    )
    .orderBy(desc(safetyEventsTable.closedAt))
    .limit(1);

  let daysWithoutRecordable: number | null = null;
  let noRecordableMessage: string | null = null;
  if (lastRecordable?.closedAt) {
    const ms = now.getTime() - lastRecordable.closedAt.getTime();
    daysWithoutRecordable = Math.floor(ms / (24 * 60 * 60 * 1000));
  } else {
    noRecordableMessage = "No recordable in the last 365 days";
    daysWithoutRecordable = 365;
  }

  return {
    safetyScore: clampScore(score),
    daysWithoutRecordable,
    noRecordableMessage,
    openEventCount: openRows.length,
    openHipoCount: openRows.filter((r) => r.isHighPotential).length,
    openRecordableCount: openRecordables.length,
    formulaExplanation:
      "Score starts at 100, −15 per open recordable (90d), −5 per open HiPo older than 7 days, −2 per stale open event (cap −10), +2 per near miss reported (30d, cap +10).",
  };
}

export async function loadSiteOperationalStatus(siteLocationId: number) {
  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
      status: siteLocationsTable.status,
      isActive: siteLocationsTable.isActive,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteLocationId))
    .limit(1);
  if (!site) return null;

  const [lastStopWork] = await db
    .select({
      id: safetyEventsTable.id,
      eventNumber: safetyEventsTable.eventNumber,
      createdAt: safetyEventsTable.createdAt,
    })
    .from(safetyEventsTable)
    .where(
      and(
        eq(safetyEventsTable.siteLocationId, siteLocationId),
        eq(safetyEventsTable.isStopWork, true),
      ),
    )
    .orderBy(desc(safetyEventsTable.createdAt))
    .limit(1);

  return {
    ...site,
    lastStopWorkEvent: lastStopWork ?? null,
  };
}
