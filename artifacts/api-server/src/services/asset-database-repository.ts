import { and, eq, isNull } from "drizzle-orm";
import {
  assetAliasesTable,
  assetConditionEvidenceTable,
  assetCustodyEventsTable,
  assetHoldsTable,
  assetMergesTable,
  assetsTable,
  db,
} from "@workspace/db";
import { AssetServiceError } from "./assets";
import type {
  AssetAlias,
  AssetCondition,
  AssetRecord,
  AssetRepository,
  CustodyEvent,
} from "./assets";

const normalize = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeJurisdiction = (value?: string) => value?.trim().toUpperCase() ?? "";

function mapAlias(row: typeof assetAliasesTable.$inferSelect): AssetAlias {
  return {
    kind: row.kind as AssetAlias["kind"],
    ...(row.jurisdiction ? { jurisdiction: row.jurisdiction } : {}),
    value: row.displayValue,
  };
}

function mapEvent(row: typeof assetCustodyEventsTable.$inferSelect): CustodyEvent {
  return {
    id: row.id,
    type: row.eventType as CustodyEvent["type"],
    ...(row.condition ? { condition: row.condition as AssetCondition } : {}),
    fromHolderUserId: row.fromHolderUserId,
    toHolderUserId: row.toHolderUserId,
    actorUserId: row.actorUserId,
    commandFingerprint: row.commandFingerprint,
    ...(row.note ? { note: row.note } : {}),
    occurredAt: row.occurredAt,
  };
}

async function loadAsset(id: string): Promise<AssetRecord | null> {
  const [row] = await db.select().from(assetsTable).where(eq(assetsTable.id, id)).limit(1);
  if (!row) return null;
  const [aliases, history, evidence, activeHold] = await Promise.all([
    db.select().from(assetAliasesTable).where(and(eq(assetAliasesTable.assetId, id), eq(assetAliasesTable.active, true))),
    db.select().from(assetCustodyEventsTable).where(eq(assetCustodyEventsTable.assetId, id)).orderBy(assetCustodyEventsTable.occurredAt),
    db.select().from(assetConditionEvidenceTable).where(eq(assetConditionEvidenceTable.assetId, id)).orderBy(assetConditionEvidenceTable.reportedAt),
    db.select().from(assetHoldsTable).where(and(eq(assetHoldsTable.assetId, id), isNull(assetHoldsTable.releasedAt))).limit(1),
  ]);
  const latestEvidence = evidence.at(-1);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    legalOwner: row.legalOwnerName,
    ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
    ...(row.model ? { model: row.model } : {}),
    responsibleOwner: { type: row.responsibleOrgType as "vendor" | "partner", id: row.responsibleOrgId },
    aliases: aliases.map(mapAlias),
    provisional: row.provisional,
    status: row.status as AssetRecord["status"],
    holderUserId: row.currentHolderUserId,
    currentLocationType: row.currentLocationType,
    currentLocationId: row.currentLocationId,
    currentLocation: row.currentLocationType && row.currentLocationId ? `${row.currentLocationType}:${row.currentLocationId}` : null,
    condition: latestEvidence?.condition && latestEvidence.condition !== "not_reported" ? latestEvidence.condition as AssetCondition : null,
    hold: activeHold[0]?.reason ?? null,
    ...(row.expectedReturnAt ? { expectedReturnAt: row.expectedReturnAt } : {}),
    version: row.version,
    history: history.map(mapEvent),
    ...(row.mergedIntoId ? { mergedIntoId: row.mergedIntoId } : {}),
  };
}

export const databaseAssetRepository: AssetRepository = {
  async create(input) {
    const id = await db.transaction(async (tx) => {
      const [created] = await tx.insert(assetsTable).values({
        name: input.name,
        category: input.category,
        legalOwnerName: input.legalOwner,
        responsibleOrgType: input.responsibleOwner.type,
        responsibleOrgId: input.responsibleOwner.id,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        provisional: input.provisional,
      }).returning({ id: assetsTable.id });
      if (!created) throw new Error("asset.create_failed");
      if (input.aliases.length) {
        await tx.insert(assetAliasesTable).values(input.aliases.map((alias) => ({
          assetId: created.id,
          kind: alias.kind,
          jurisdiction: normalizeJurisdiction(alias.jurisdiction),
          normalizedValue: normalize(alias.value),
          displayValue: alias.value.trim(),
        })));
      }
      return created.id;
    });
    const created = await loadAsset(id);
    if (!created) throw new Error("asset.create_failed");
    return created;
  },

  get: loadAsset,

  async find(alias) {
    const [match] = await db.select({ assetId: assetAliasesTable.assetId })
      .from(assetAliasesTable)
      .where(and(
        eq(assetAliasesTable.kind, alias.kind),
        eq(assetAliasesTable.jurisdiction, normalizeJurisdiction(alias.jurisdiction)),
        eq(assetAliasesTable.normalizedValue, normalize(alias.value)),
        eq(assetAliasesTable.active, true),
      ))
      .limit(1);
    return match ? loadAsset(match.assetId) : null;
  },

  async save(asset, expectedVersion) {
    const applied = await db.transaction(async (tx) => {
      const [updated] = await tx.update(assetsTable).set({
        name: asset.name,
        category: asset.category,
        legalOwnerName: asset.legalOwner,
        manufacturer: asset.manufacturer ?? null,
        model: asset.model ?? null,
        currentHolderUserId: asset.holderUserId,
        currentLocationType: asset.currentLocationType ?? null,
        currentLocationId: asset.currentLocationId ?? null,
        expectedReturnAt: asset.expectedReturnAt ?? null,
        status: asset.status,
        mergedIntoId: asset.mergedIntoId ?? null,
        version: expectedVersion + 1,
        updatedAt: new Date(),
      }).where(and(eq(assetsTable.id, asset.id), eq(assetsTable.version, expectedVersion)))
        .returning({ id: assetsTable.id });
      if (!updated) return false;

      for (const alias of asset.aliases) {
        await tx.insert(assetAliasesTable).values({
          assetId: asset.id,
          kind: alias.kind,
          jurisdiction: normalizeJurisdiction(alias.jurisdiction),
          normalizedValue: normalize(alias.value),
          displayValue: alias.value.trim(),
        }).onConflictDoUpdate({
          target: [assetAliasesTable.kind, assetAliasesTable.jurisdiction, assetAliasesTable.normalizedValue],
          set: { assetId: asset.id, displayValue: alias.value.trim(), active: true, retiredAt: null },
        });
      }

      const existing = await tx.select({ id: assetCustodyEventsTable.id })
        .from(assetCustodyEventsTable)
        .where(eq(assetCustodyEventsTable.assetId, asset.id));
      const existingIds = new Set(existing.map((event) => event.id));
      for (const event of asset.history.filter((candidate) => !existingIds.has(candidate.id))) {
        const [insertedEvent] = await tx.insert(assetCustodyEventsTable).values({
          id: event.id,
          assetId: asset.id,
          eventType: event.type,
          fromHolderUserId: event.fromHolderUserId ?? null,
          toHolderUserId: event.toHolderUserId ?? null,
          actorUserId: event.actorUserId ?? null,
          condition: event.condition ?? null,
          note: event.note ?? null,
          operationId: event.id,
          commandFingerprint: event.commandFingerprint ?? null,
          assetVersion: expectedVersion + 1,
          occurredAt: event.occurredAt,
        }).onConflictDoNothing({ target: assetCustodyEventsTable.operationId }).returning({ id: assetCustodyEventsTable.id });
        if (!insertedEvent) throw new AssetServiceError("asset.operation_reused");
        if (event.type === "hold" || (event.condition && ["damaged", "missing", "stolen"].includes(event.condition))) {
          await tx.insert(assetHoldsTable).values({
            assetId: asset.id,
            reason: event.note ?? event.condition ?? "Asset held for review",
            placedAt: event.occurredAt,
          });
        }
        if (event.condition || event.note || event.photos?.length) {
          await tx.insert(assetConditionEvidenceTable).values({
            assetId: asset.id,
            custodyEventId: event.id,
            condition: event.condition ?? "not_reported",
            note: event.note ?? null,
            photoUrls: event.photos ?? [],
          });
        }
      }
      return true;
    });
    return applied ? loadAsset(asset.id) : null;
  },

  async all(owner) {
    const rows = await db.select({ id: assetsTable.id }).from(assetsTable).where(and(
      eq(assetsTable.responsibleOrgType, owner.type),
      eq(assetsTable.responsibleOrgId, owner.id),
    ));
    return (await Promise.all(rows.map((row) => loadAsset(row.id)))).filter((row): row is AssetRecord => row !== null);
  },

  async recordMerge(input) {
    await db.transaction(async (tx) => {
      await tx.update(assetCustodyEventsTable)
        .set({ assetId: input.survivingAssetId })
        .where(eq(assetCustodyEventsTable.assetId, input.mergedAssetId));
      await tx.update(assetConditionEvidenceTable)
        .set({ assetId: input.survivingAssetId })
        .where(eq(assetConditionEvidenceTable.assetId, input.mergedAssetId));
      await tx.update(assetHoldsTable)
        .set({ assetId: input.survivingAssetId })
        .where(eq(assetHoldsTable.assetId, input.mergedAssetId));
      await tx.insert(assetMergesTable).values({
        survivingAssetId: input.survivingAssetId,
        mergedAssetId: input.mergedAssetId,
        reason: input.reason,
      }).onConflictDoNothing({ target: assetMergesTable.mergedAssetId });
    });
  },
};
