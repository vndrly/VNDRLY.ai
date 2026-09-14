import { randomUUID } from "node:crypto";

export type AssetOwner = { type: "vendor" | "partner"; id: number };
export type AssetAlias = { kind: "vin" | "plate" | "serial" | "asset_tag" | "model" | "other"; jurisdiction?: string; value: string };
export type AssetCondition = "new" | "good" | "fair" | "damaged" | "missing" | "stolen";
export type AssetRecord = {
  id: string;
  name: string;
  category: string;
  legalOwner: string;
  manufacturer?: string;
  model?: string;
  responsibleOwner: AssetOwner;
  aliases: AssetAlias[];
  provisional: boolean;
  status: "available" | "checked_out" | "held" | "retired" | "merged";
  holderUserId: number | null;
  expectedReturnAt?: Date;
  version: number;
  history: CustodyEvent[];
  mergedIntoId?: string;
};
export type CustodyEvent = { id: string; type: "checkout" | "return" | "transfer" | "condition" | "hold" | "merge"; condition?: AssetCondition; fromHolderUserId?: number | null; toHolderUserId?: number | null; note?: string; photos?: string[]; occurredAt: Date };

export class AssetServiceError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export interface AssetRepository {
  create(input: Omit<AssetRecord, "id" | "version" | "history" | "status" | "holderUserId">): Promise<AssetRecord>;
  get(id: string): Promise<AssetRecord | null>;
  find(alias: AssetAlias): Promise<AssetRecord | null>;
  save(asset: AssetRecord, expectedVersion: number): Promise<AssetRecord | null>;
  all(owner: AssetOwner): Promise<AssetRecord[]>;
  recordMerge?(input: { survivingAssetId: string; mergedAssetId: string; reason: string }): Promise<void>;
}

const normalized = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const aliasKey = (alias: AssetAlias) => `${alias.kind}:${alias.jurisdiction?.trim().toUpperCase() ?? ""}:${normalized(alias.value)}`;

export function createMemoryAssetRepository(): AssetRepository {
  const records = new Map<string, AssetRecord>();
  return {
    async create(input) {
      const row: AssetRecord = { ...structuredClone(input), id: randomUUID(), version: 1, history: [], status: "available", holderUserId: null };
      records.set(row.id, row);
      return structuredClone(row);
    },
    async get(id) { const row = records.get(id); return row ? structuredClone(row) : null; },
    async find(alias) {
      const key = aliasKey(alias);
      const row = [...records.values()].find((candidate) => candidate.status !== "merged" && candidate.aliases.some((item) => aliasKey(item) === key));
      return row ? structuredClone(row) : null;
    },
    async save(asset, expectedVersion) {
      const current = records.get(asset.id);
      if (!current || current.version !== expectedVersion) return null;
      const saved = structuredClone({ ...asset, version: expectedVersion + 1 });
      records.set(saved.id, saved);
      return structuredClone(saved);
    },
    async all(owner) { return [...records.values()].filter((row) => row.responsibleOwner.type === owner.type && row.responsibleOwner.id === owner.id).map((row) => structuredClone(row)); },
  };
}

export function createAssetService(repository: AssetRepository) {
  async function getCurrent(id: string) {
    const asset = await repository.get(id);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    if (asset.status === "merged" && asset.mergedIntoId) return getCurrent(asset.mergedIntoId);
    return asset;
  }

  return {
    async createAsset(input: { name: string; category: string; legalOwner: string; manufacturer?: string; model?: string; responsibleOwner: AssetOwner; aliases: AssetAlias[]; provisional?: boolean }) {
      for (const alias of input.aliases) if (await repository.find(alias)) throw new AssetServiceError("asset.identifier_in_use");
      return repository.create({ ...input, provisional: input.provisional ?? false, aliases: input.aliases.map((alias) => ({ ...alias, jurisdiction: alias.jurisdiction?.trim().toUpperCase(), value: alias.value.trim() })) });
    },
    findAsset(alias: AssetAlias) { return repository.find(alias); },
    async addAlias(assetId: string, alias: AssetAlias, expectedVersion: number) {
      const asset = await getCurrent(assetId);
      if (await repository.find(alias)) throw new AssetServiceError("asset.identifier_in_use");
      asset.aliases.push({ ...alias, jurisdiction: alias.jurisdiction?.trim().toUpperCase(), value: alias.value.trim() });
      const saved = await repository.save(asset, expectedVersion);
      if (!saved) throw new AssetServiceError("asset.version_conflict");
      return saved;
    },
    async findOrCreateProvisional(input: { identifier: AssetAlias; responsibleOwner: AssetOwner }) {
      const found = await repository.find(input.identifier);
      if (found) return found;
      return repository.create({ name: `${input.identifier.kind.toUpperCase()} ${input.identifier.value}`, category: input.identifier.kind === "plate" || input.identifier.kind === "vin" ? "vehicle" : "uncategorized", legalOwner: "Unknown", responsibleOwner: input.responsibleOwner, aliases: [input.identifier], provisional: true });
    },
    async checkoutAsset(input: { assetId: string; holderUserId: number; condition: AssetCondition; confirmed: boolean; expectedVersion: number; note?: string; photos?: string[]; expectedReturnAt?: Date }) {
      if (!input.confirmed) return { status: "blocked" as const, code: "asset.confirmation_required" };
      const asset = await getCurrent(input.assetId);
      if (asset.version !== input.expectedVersion) return { status: "conflict" as const, code: "asset.version_conflict", version: asset.version };
      if (asset.status === "held") return { status: "blocked" as const, code: "asset.on_hold" };
      if (asset.holderUserId !== null) return { status: "conflict" as const, code: "asset.already_checked_out", version: asset.version };
      asset.holderUserId = input.holderUserId;
      asset.status = "checked_out";
      asset.expectedReturnAt = input.expectedReturnAt;
      asset.history.push({ id: randomUUID(), type: "checkout", condition: input.condition, fromHolderUserId: null, toHolderUserId: input.holderUserId, note: input.note, photos: input.photos, occurredAt: new Date() });
      const saved = await repository.save(asset, input.expectedVersion);
      return saved ? { status: "applied" as const, version: saved.version, asset: saved } : { status: "conflict" as const, code: "asset.version_conflict" };
    },
    async returnAsset(input: { assetId: string; holderUserId: number; condition: AssetCondition; confirmed: boolean; expectedVersion: number; note?: string; photos?: string[]; expectedReturnAt?: Date }) {
      if (!input.confirmed) return { status: "blocked" as const, code: "asset.confirmation_required" };
      const asset = await getCurrent(input.assetId);
      if (asset.version !== input.expectedVersion) return { status: "conflict" as const, code: "asset.version_conflict", version: asset.version };
      if (asset.holderUserId !== input.holderUserId) return { status: "blocked" as const, code: "asset.holder_mismatch" };
      asset.history.push({ id: randomUUID(), type: "return", condition: input.condition, fromHolderUserId: input.holderUserId, toHolderUserId: null, note: input.note, photos: input.photos, occurredAt: new Date() });
      asset.holderUserId = null;
      asset.expectedReturnAt = undefined;
      asset.status = ["damaged", "missing", "stolen"].includes(input.condition) ? "held" : "available";
      const saved = await repository.save(asset, input.expectedVersion);
      return saved ? { status: "applied" as const, version: saved.version, asset: saved } : { status: "conflict" as const, code: "asset.version_conflict" };
    },
    async transferAsset(input: { assetId: string; fromHolderUserId: number; toHolderUserId: number; condition: AssetCondition; confirmed: boolean; expectedVersion: number; note?: string; photos?: string[]; expectedReturnAt?: Date }) {
      const asset = await getCurrent(input.assetId);
      if (!input.confirmed) return { status: "blocked" as const, code: "asset.confirmation_required" };
      if (asset.version !== input.expectedVersion) return { status: "conflict" as const, code: "asset.version_conflict", version: asset.version };
      if (asset.holderUserId !== input.fromHolderUserId) return { status: "blocked" as const, code: "asset.holder_mismatch" };
      asset.holderUserId = input.toHolderUserId;
      asset.history.push({ id: randomUUID(), type: "transfer", condition: input.condition, fromHolderUserId: input.fromHolderUserId, toHolderUserId: input.toHolderUserId, note: input.note, photos: input.photos, occurredAt: new Date() });
      const saved = await repository.save(asset, input.expectedVersion);
      return saved ? { status: "applied" as const, version: saved.version, asset: saved } : { status: "conflict" as const, code: "asset.version_conflict" };
    },
    async reportAssetCondition(input: { assetId: string; condition: AssetCondition; expectedVersion: number; note?: string; photos?: string[]; expectedReturnAt?: Date }) {
      const asset = await getCurrent(input.assetId);
      asset.history.push({ id: randomUUID(), type: "condition", condition: input.condition, note: input.note, photos: input.photos, occurredAt: new Date() });
      if (["damaged", "missing", "stolen"].includes(input.condition)) asset.status = "held";
      const saved = await repository.save(asset, input.expectedVersion);
      if (!saved) throw new AssetServiceError("asset.version_conflict");
      return saved;
    },
    async placeAssetHold(input: { assetId: string; reason: string; expectedVersion: number }) {
      const asset = await getCurrent(input.assetId);
      asset.status = "held";
      asset.history.push({ id: randomUUID(), type: "hold", note: input.reason, occurredAt: new Date() });
      const saved = await repository.save(asset, input.expectedVersion);
      if (!saved) throw new AssetServiceError("asset.version_conflict");
      return saved;
    },
    async mergeAssets(input: { survivingAssetId: string; mergedAssetId: string; actorRoles: string[]; reason: string }) {
      if (!input.actorRoles.includes("asset_manager") && !input.actorRoles.includes("admin")) throw new AssetServiceError("asset.asset_manager_required", 403);
      if (input.survivingAssetId === input.mergedAssetId) throw new AssetServiceError("asset.invalid_merge");
      const surviving = await getCurrent(input.survivingAssetId);
      const merged = await getCurrent(input.mergedAssetId);
      for (const alias of merged.aliases) if (!surviving.aliases.some((item) => aliasKey(item) === aliasKey(alias))) surviving.aliases.push(alias);
      surviving.history.push(...merged.history, { id: randomUUID(), type: "merge", note: input.reason, occurredAt: new Date() });
      const saved = await repository.save(surviving, surviving.version);
      if (!saved) throw new AssetServiceError("asset.version_conflict");
      merged.status = "merged";
      merged.mergedIntoId = saved.id;
      merged.aliases = [];
      await repository.save(merged, merged.version);
      await repository.recordMerge?.({ survivingAssetId: saved.id, mergedAssetId: merged.id, reason: input.reason });
      return saved;
    },
  };
}
