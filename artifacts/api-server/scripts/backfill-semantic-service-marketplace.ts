import { pathToFileURL } from "node:url";
import pg from "pg";
import { subjectFingerprint } from "../src/services/service-matching/candidates";
import type { ServiceSubjectInput } from "../src/services/service-matching/types";

/** Bind runtime eligibility to the exact saved wording, not its retrieval normalization. */
export function backfillMappingEvidence(subject: ServiceSubjectInput, lineage: Record<string, unknown>) {
  return { semanticMarketplaceBackfill: lineage, serviceMatching: { subjectFingerprint: subjectFingerprint(subject) } };
}

const PROCESS = "semantic-service-marketplace-backfill:v1";
const LOCK_KEY = 2026101802;

type WorkTypeRow = { id: number; partnerId: number | null; sourceWorkTypeId: number | null; name: string; category: string; description: string | null };
type VendorWorkTypeRow = { id: number; vendorId: number; workTypeId: number; unitPrice: string | null; unit: string | null; currency: string; notes: string | null };
type CanonicalRow = { id: number; code: string; name: string; category: string; definition: string; active: boolean };
type AliasRow = { canonicalServiceId: number; alias: string; active: boolean };
type ExistingMapping = { id: number; workTypeId: number | null; canonicalServiceId: number | null; status: string; actorProcess: string | null; mappingVersion?: number; subjectFingerprint?: string | null; reviewedAt?: Date | null; supersededAt?: Date | null; actorUserId?: number | null };
type ExistingCapability = { id: number; vendorId: number; canonicalServiceId: number; sourceVendorWorkTypeId: number };
type ExistingOffer = { id: number; vendorCapabilityId: number; partnerId: number; workTypeId: number; sourceVendorWorkTypeId: number | null };

export interface BackfillSnapshot {
  workTypes: WorkTypeRow[];
  vendorWorkTypes: VendorWorkTypeRow[];
  canonicalServices: CanonicalRow[];
  aliases: AliasRow[];
  mappings: ExistingMapping[];
  capabilities: ExistingCapability[];
  offers: ExistingOffer[];
  /** Audit-only input. Historical snapshots are never treated as current selections. */
  historicalVendorSelections?: Array<{ vendorId: number; workTypeId: number }>;
}

export interface BackfillPlan {
  canonicalServices: Array<{ code: string; name: string; category: string; definition: string; sourceWorkTypeId: number }>;
  mappings: Array<{ workTypeId: number; canonicalServiceId: number | null; canonicalServiceCode: string | null; status: "active" | "review_required"; confidence: number; candidateCanonicalServiceIds: number[] }>;
  capabilities: Array<{ vendorId: number; canonicalServiceId: number | null; canonicalServiceCode: string | null; sourceVendorWorkTypeId: number; workTypeId: number; name: string; description: string | null; defaultUnit: string | null; unitPrice: string | null; currency: string; notes: string | null }>;
  offers: Array<{ vendorId: number; canonicalServiceId: number | null; canonicalServiceCode: string | null; sourceVendorWorkTypeId: number; partnerId: number; workTypeId: number; unitPrice: string; unit: string; currency: string; notes: string | null }>;
  conflicts: Array<{ workTypeId: number; candidateCanonicalServiceIds: number[]; reason?: "ambiguous_alias" | "novel_service" | "capability_canonical_mismatch" }>;
}

export interface CountSnapshot {
  workTypeCount: number; vendorWorkTypeCount: number; ticketCount: number;
  insertedMappings: number; insertedCapabilities: number; insertedOffers: number;
  afterWorkTypeCount: number; afterVendorWorkTypeCount: number; afterTicketCount: number;
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/**
 * Builds inserts only from current authoritative rows. It deliberately ignores
 * historical catalog snapshots so a removed vendor selection cannot reappear.
 */
export function buildSemanticMarketplaceBackfillPlan(snapshot: BackfillSnapshot, options: { activationThreshold: number }): BackfillPlan {
  if (!Number.isFinite(options.activationThreshold) || options.activationThreshold <= 0 || options.activationThreshold > 1) {
    throw new Error("activationThreshold must be explicitly set in (0,1]");
  }
  const plan: BackfillPlan = { canonicalServices: [], mappings: [], capabilities: [], offers: [], conflicts: [] };
  const vocabulary = new Map<string, Set<number>>();
  for (const service of snapshot.canonicalServices.filter((row) => row.active)) {
    const key = normalize(service.name);
    if (!vocabulary.has(key)) vocabulary.set(key, new Set());
    vocabulary.get(key)!.add(service.id);
  }
  for (const alias of snapshot.aliases.filter((row) => row.active)) {
    const key = normalize(alias.alias);
    if (!vocabulary.has(key)) vocabulary.set(key, new Set());
    vocabulary.get(key)!.add(alias.canonicalServiceId);
  }
  const resolution = new Map<number, { id: number | null; code: string | null; active: boolean }>();

  for (const workType of snapshot.workTypes) {
    const prior = snapshot.mappings.filter(row => row.workTypeId === workType.id)
      .sort((a, b) => (b.mappingVersion ?? b.id) - (a.mappingVersion ?? a.id))[0];
    if (prior) {
      // Existing decisions belong to their reviewer/classifier. Backfill must
      // neither reconsider a rejection nor bypass unresolved review work.
      if (prior.status === "active" && !prior.supersededAt && prior.canonicalServiceId !== null &&
          prior.subjectFingerprint === subjectFingerprint({ ...workType, subjectType: "partner_work_type", subjectId: workType.id }))
        resolution.set(workType.id, { id: prior.canonicalServiceId, code: null, active: true });
      continue;
    }
    const candidates = [...(vocabulary.get(normalize(workType.name)) ?? [])].sort((a, b) => a - b);
    if (candidates.length > 1) {
      plan.mappings.push({ workTypeId: workType.id, canonicalServiceId: null, canonicalServiceCode: null, status: "review_required", confidence: 0, candidateCanonicalServiceIds: candidates });
      plan.conflicts.push({ workTypeId: workType.id, candidateCanonicalServiceIds: candidates, reason: "ambiguous_alias" });
      resolution.set(workType.id, { id: null, code: null, active: false });
      continue;
    }
    if (candidates.length === 1) {
      plan.mappings.push({ workTypeId: workType.id, canonicalServiceId: candidates[0]!, canonicalServiceCode: null, status: "active", confidence: 1, candidateCanonicalServiceIds: candidates });
      resolution.set(workType.id, { id: candidates[0]!, code: null, active: true });
      continue;
    }
    // Novel services may be proposed by the classifier, but only a VNDRLY
    // administrator can create/activate the canonical concept. The backfill
    // records review work and never mints commercial vocabulary on its own.
    plan.mappings.push({ workTypeId: workType.id, canonicalServiceId: null, canonicalServiceCode: null, status: "review_required", confidence: 0, candidateCanonicalServiceIds: [] });
    plan.conflicts.push({ workTypeId: workType.id, candidateCanonicalServiceIds: [], reason: "novel_service" });
    resolution.set(workType.id, { id: null, code: null, active: false });
  }

  const partnerTargets = (workType: WorkTypeRow) => workType.partnerId !== null
    ? [workType]
    : snapshot.workTypes.filter((candidate) => candidate.partnerId !== null && candidate.sourceWorkTypeId === workType.id);
  for (const selection of snapshot.vendorWorkTypes) {
    const workType = snapshot.workTypes.find((row) => row.id === selection.workTypeId);
    const resolved = workType ? resolution.get(workType.id) : null;
    if (!workType || !resolved?.active) continue;
    const existingCapability = snapshot.capabilities.find((row) => row.sourceVendorWorkTypeId === selection.id);
    if (existingCapability && (resolved.id === null || existingCapability.canonicalServiceId !== resolved.id)) {
      plan.conflicts.push({ workTypeId: workType.id, candidateCanonicalServiceIds: [existingCapability.canonicalServiceId, ...(resolved.id === null ? [] : [resolved.id])], reason: "capability_canonical_mismatch" });
      continue;
    }
    if (!existingCapability) {
      plan.capabilities.push({ vendorId: selection.vendorId, canonicalServiceId: resolved.id, canonicalServiceCode: resolved.code, sourceVendorWorkTypeId: selection.id, workTypeId: workType.id, name: workType.name, description: workType.description, defaultUnit: selection.unit, unitPrice: selection.unitPrice, currency: selection.currency, notes: selection.notes });
    }
    if (selection.unitPrice === null || !selection.unit?.trim()) continue;
    for (const target of partnerTargets(workType)) {
      const already = snapshot.offers.some((row) => row.sourceVendorWorkTypeId === selection.id && row.partnerId === target.partnerId && row.workTypeId === target.id);
      if (!already) plan.offers.push({ vendorId: selection.vendorId, canonicalServiceId: resolved.id, canonicalServiceCode: resolved.code, sourceVendorWorkTypeId: selection.id, partnerId: target.partnerId!, workTypeId: target.id, unitPrice: selection.unitPrice, unit: selection.unit, currency: selection.currency, notes: selection.notes });
    }
  }
  return plan;
}

export function reconcileSemanticMarketplaceBackfill(snapshot: BackfillSnapshot, plan: BackfillPlan, counts: CountSnapshot) {
  const lineageComplete = plan.capabilities.every((row) => Number.isSafeInteger(row.sourceVendorWorkTypeId)) &&
    plan.offers.every((row) => Number.isSafeInteger(row.sourceVendorWorkTypeId)) &&
    plan.mappings.every((row) => Number.isSafeInteger(row.workTypeId));
  if (!lineageComplete) throw new Error("Backfill lineage is incomplete");
  const preserved = {
    workTypes: counts.workTypeCount === counts.afterWorkTypeCount && counts.workTypeCount === snapshot.workTypes.length,
    vendorWorkTypes: counts.vendorWorkTypeCount === counts.afterVendorWorkTypeCount && counts.vendorWorkTypeCount === snapshot.vendorWorkTypes.length,
    tickets: counts.ticketCount === counts.afterTicketCount,
  };
  if (!Object.values(preserved).every(Boolean)) throw new Error("Legacy catalog or ticket counts changed during backfill");
  return { ...counts, preserved, lineageComplete, conflictCount: plan.conflicts.length, planned: { canonicalServices: plan.canonicalServices.length, mappings: plan.mappings.length, capabilities: plan.capabilities.length, offers: plan.offers.length } };
}

export function assertSemanticMarketplaceBackfillApplyGuard(dryRun: boolean, env: Record<string, string | undefined>): void {
  if (!dryRun && env.APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL !== "1") {
    throw new Error("Set APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL=1 after reviewing a dry run");
  }
}

type Queryable = { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> };
const num = (value: unknown) => Number(value);
const mappingColumns = `id, work_type_id as "workTypeId", canonical_service_id as "canonicalServiceId", status, actor_process as "actorProcess", mapping_version as "mappingVersion", evidence->'serviceMatching'->>'subjectFingerprint' as "subjectFingerprint", reviewed_at as "reviewedAt", superseded_at as "supersededAt", actor_user_id as "actorUserId"`;
const decisionFingerprint = (rows: ExistingMapping[]) => JSON.stringify(rows.slice().sort((a, b) => a.id - b.id));

async function loadSnapshot(client: Queryable): Promise<BackfillSnapshot> {
  const [workTypes, vendorWorkTypes, canonical, aliases, mappings, capabilities, offers] = await Promise.all([
    client.query(`select id, partner_id as "partnerId", source_work_type_id as "sourceWorkTypeId", name, category, description from work_types order by id`),
    client.query(`select id, vendor_id as "vendorId", work_type_id as "workTypeId", unit_price::text as "unitPrice", unit, currency, notes from vendor_work_types order by id`),
    client.query(`select id, code, name, category, definition, active from canonical_services order by id`),
    client.query(`select canonical_service_id as "canonicalServiceId", alias, active from canonical_service_aliases order by id`),
    client.query(`select ${mappingColumns} from service_mappings where subject_type = 'partner_work_type' order by id`),
    client.query(`select id, vendor_id as "vendorId", (evidence->'semanticMarketplaceBackfill'->>'canonicalServiceId')::int as "canonicalServiceId", (evidence->'semanticMarketplaceBackfill'->>'sourceVendorWorkTypeId')::int as "sourceVendorWorkTypeId" from vendor_capabilities where evidence ? 'semanticMarketplaceBackfill' order by id`),
    client.query(`select id, vendor_capability_id as "vendorCapabilityId", partner_id as "partnerId", work_type_id as "workTypeId", source_vendor_work_type_id as "sourceVendorWorkTypeId" from vendor_partner_service_offers where source_vendor_work_type_id is not null order by id`),
  ]);
  return { workTypes: workTypes.rows as never, vendorWorkTypes: vendorWorkTypes.rows as never, canonicalServices: canonical.rows as never, aliases: aliases.rows as never, mappings: mappings.rows as never, capabilities: capabilities.rows as never, offers: offers.rows as never };
}

async function counts(client: Queryable) {
  const result = await client.query<{ work_types: string; vendor_work_types: string; tickets: string }>(`select (select count(*) from work_types)::text work_types, (select count(*) from vendor_work_types)::text vendor_work_types, (select count(*) from tickets)::text tickets`);
  return { workTypeCount: num(result.rows[0]!.work_types), vendorWorkTypeCount: num(result.rows[0]!.vendor_work_types), ticketCount: num(result.rows[0]!.tickets) };
}

async function resolveCanonicalId(client: Queryable, id: number | null, code: string | null): Promise<number> {
  if (id !== null) return id;
  const result = await client.query<{ id: number }>(`select id from canonical_services where code = $1 and active = true`, [code]);
  if (!result.rows[0]) throw new Error(`Canonical service ${code} was not created`);
  return result.rows[0].id;
}

export async function runSemanticServiceMarketplaceBackfill(client: Queryable, options: { dryRun: boolean; activationThreshold: number; maxConflictRate: number; batchSize: number }) {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000) throw new Error("batchSize must be 1..1000");
  if (!Number.isFinite(options.maxConflictRate) || options.maxConflictRate < 0 || options.maxConflictRate > 1) throw new Error("maxConflictRate must be 0..1");
  const locked = await client.query<{ locked: boolean }>(`select pg_try_advisory_lock($1) locked`, [LOCK_KEY]);
  if (!locked.rows[0]?.locked) throw new Error("Semantic marketplace backfill is already running");
  try {
    const beforeSnapshot = await loadSnapshot(client);
    const before = await counts(client);
    const plan = buildSemanticMarketplaceBackfillPlan(beforeSnapshot, { activationThreshold: options.activationThreshold });
    const conflictRate = beforeSnapshot.workTypes.length ? plan.conflicts.length / beforeSnapshot.workTypes.length : 0;
    if (conflictRate > options.maxConflictRate) throw new Error(`Conflict rate ${conflictRate.toFixed(5)} exceeds threshold ${options.maxConflictRate}`);
    if (options.dryRun) return { dryRun: true, conflictRate, plan, before };

    const expectedDecisions = new Map(beforeSnapshot.workTypes.map(work => [work.id,
      decisionFingerprint(beforeSnapshot.mappings.filter(row => row.workTypeId === work.id))]));
    const readDecisions = async (workTypeId: number) => (await client.query<ExistingMapping>(
      `select ${mappingColumns} from service_mappings where subject_type='partner_work_type' and subject_id=$1 order by id`, [workTypeId])).rows;
    const lockPlannedSubject = async (workTypeId: number) => {
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`service-mapping:partner_work_type:${workTypeId}`]);
      const saved = (await client.query<WorkTypeRow>(`select id, partner_id as "partnerId", source_work_type_id as "sourceWorkTypeId", name, description, category from work_types where id=$1 for update`, [workTypeId])).rows[0];
      const planned = beforeSnapshot.workTypes.find(subject => subject.id === workTypeId)!;
      const subject = { subjectType: "partner_work_type" as const, subjectId: workTypeId, ...saved };
      if (!saved || saved.partnerId !== planned.partnerId || saved.sourceWorkTypeId !== planned.sourceWorkTypeId || subjectFingerprint(subject) !== subjectFingerprint({ ...planned, subjectType: "partner_work_type", subjectId: workTypeId }))
        throw new Error(`Work type ${workTypeId} changed since backfill planning; rerun dry run`);
      if (decisionFingerprint(await readDecisions(workTypeId)) !== expectedDecisions.get(workTypeId))
        throw new Error(`Work type ${workTypeId} decision changed since backfill planning; rerun dry run`);
      return subject;
    };
    const lockPlannedSelection = async (selectionId: number) => {
      const planned = beforeSnapshot.vendorWorkTypes.find(selection => selection.id === selectionId)!;
      const saved = (await client.query<VendorWorkTypeRow>(`select id, vendor_id as "vendorId", work_type_id as "workTypeId", unit_price::text as "unitPrice", unit, currency, notes from vendor_work_types where id=$1 for share`, [selectionId])).rows[0];
      if (!saved || (Object.keys(planned) as Array<keyof VendorWorkTypeRow>).some(key => saved[key] !== planned[key]))
        throw new Error(`Vendor catalog ${selectionId} selection changed since backfill planning; rerun dry run`);
      return saved;
    };

    let insertedMappings = 0, insertedCapabilities = 0, insertedOffers = 0;
    for (let offset = 0; offset < plan.canonicalServices.length; offset += options.batchSize) {
      await client.query("begin");
      try {
        for (const row of plan.canonicalServices.slice(offset, offset + options.batchSize)) {
          await client.query(`insert into canonical_services (code,name,category,definition,active) values ($1,$2,$3,$4,true) on conflict (code) do nothing`, [row.code, row.name, row.category, row.definition]);
          await client.query(`insert into canonical_service_aliases (canonical_service_id,alias,provenance,active) select id,$2,'partner_usage',true from canonical_services where code=$1 and not exists (select 1 from canonical_service_aliases a where a.canonical_service_id=canonical_services.id and lower(btrim(a.alias))=lower(btrim($2)))`, [row.code, row.name]);
        }
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    for (let offset = 0; offset < plan.mappings.length; offset += options.batchSize) {
      await client.query("begin");
      try {
        for (const row of plan.mappings.slice(offset, offset + options.batchSize)) {
          const subject = await lockPlannedSubject(row.workTypeId);
          const canonicalId = row.status === "active" ? await resolveCanonicalId(client, row.canonicalServiceId, row.canonicalServiceCode) : null;
          const inserted = await client.query(`insert into service_mappings (subject_type,subject_id,work_type_id,canonical_service_id,status,confidence,explanation,evidence,model_version,mapping_version,actor_process)
            select 'partner_work_type',$1,$1,$2,$3,$4,$5,$6::jsonb,'deterministic-exact-v1',coalesce((select max(mapping_version)+1 from service_mappings where subject_type='partner_work_type' and subject_id=$1),1),$7
            where not exists (select 1 from service_mappings where subject_type='partner_work_type' and subject_id=$1 and actor_process=$7)`, [row.workTypeId, canonicalId, row.status, String(row.confidence), row.status === "active" ? "Deterministic exact normalized catalog match" : "Ambiguous exact alias requires review", JSON.stringify(backfillMappingEvidence(subject, { workTypeId: row.workTypeId, candidateCanonicalServiceIds: row.candidateCanonicalServiceIds, activationThreshold: options.activationThreshold })), PROCESS]);
          insertedMappings += inserted.rowCount ?? 0;
          expectedDecisions.set(row.workTypeId, decisionFingerprint(await readDecisions(row.workTypeId)));
        }
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    for (const row of plan.capabilities) {
      await client.query("begin");
      try {
        await lockPlannedSubject(row.workTypeId);
        await lockPlannedSelection(row.sourceVendorWorkTypeId);
        const canonicalId = await resolveCanonicalId(client, row.canonicalServiceId, row.canonicalServiceCode);
        const capability = await client.query<{ id: number }>(`insert into vendor_capabilities (vendor_id,name,description,default_unit,default_rate_card,capacity,evidence,active)
          select $1,$2,$3,$4,$5::jsonb,1,$6::jsonb,true where not exists (select 1 from vendor_capabilities where evidence->'semanticMarketplaceBackfill'->>'sourceVendorWorkTypeId'=$7) returning id`, [row.vendorId, row.name, row.description, row.defaultUnit, JSON.stringify({ unitPrice: row.unitPrice, currency: row.currency }), JSON.stringify({ semanticMarketplaceBackfill: { sourceVendorWorkTypeId: row.sourceVendorWorkTypeId, workTypeId: row.workTypeId, canonicalServiceId: canonicalId } }), String(row.sourceVendorWorkTypeId)]);
        let capabilityId = capability.rows[0]?.id;
        if (capabilityId) insertedCapabilities += 1;
        else capabilityId = (await client.query<{ id: number }>(`select id from vendor_capabilities where evidence->'semanticMarketplaceBackfill'->>'sourceVendorWorkTypeId'=$1`, [String(row.sourceVendorWorkTypeId)])).rows[0]!.id;
        await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`service-mapping:vendor_capability:${capabilityId}`]);
        const saved = (await client.query<{ name: string; description: string | null; active: boolean }>(`select name, description, active from vendor_capabilities where id=$1 for update`, [capabilityId])).rows[0];
        if (!saved?.active || saved.name !== row.name || saved.description !== row.description) throw new Error(`Capability ${capabilityId} changed since backfill planning; review required`);
        const inserted = await client.query(`insert into service_mappings (subject_type,subject_id,vendor_capability_id,canonical_service_id,status,confidence,explanation,evidence,model_version,mapping_version,actor_process)
          select 'vendor_capability',$1,$1,$2,'active','1','Projected from an active legacy vendor catalog selection',$3::jsonb,'deterministic-lineage-v1',coalesce((select max(mapping_version)+1 from service_mappings where subject_type='vendor_capability' and subject_id=$1),1),$4
          where not exists (select 1 from service_mappings where subject_type='vendor_capability' and subject_id=$1)`, [capabilityId, canonicalId, JSON.stringify(backfillMappingEvidence({ ...saved, subjectType: "vendor_capability", subjectId: capabilityId }, { sourceVendorWorkTypeId: row.sourceVendorWorkTypeId, canonicalServiceId: canonicalId })), PROCESS]);
        insertedMappings += inserted.rowCount ?? 0;
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    for (const row of plan.offers) {
      await client.query("begin");
      try {
        const source = beforeSnapshot.vendorWorkTypes.find(selection => selection.id === row.sourceVendorWorkTypeId)!;
        for (const workTypeId of [...new Set([source.workTypeId, row.workTypeId])].sort((a, b) => a - b)) await lockPlannedSubject(workTypeId);
        await lockPlannedSelection(row.sourceVendorWorkTypeId);
        const capability = await client.query<{ id: number }>(`select id from vendor_capabilities where vendor_id=$1 and evidence->'semanticMarketplaceBackfill'->>'sourceVendorWorkTypeId'=$2`, [row.vendorId, String(row.sourceVendorWorkTypeId)]);
        if (!capability.rows[0]) throw new Error(`Missing capability lineage for vendor_work_types ${row.sourceVendorWorkTypeId}`);
        const inserted = await client.query(`insert into vendor_partner_service_offers (vendor_capability_id,partner_id,work_type_id,source_vendor_work_type_id,unit_price,unit,currency,notes,capacity,active,version)
          values ($1,$2,$3,$4,$5,$6,$7,$8,1,true,1) on conflict (vendor_capability_id,partner_id,work_type_id) do nothing`, [capability.rows[0].id, row.partnerId, row.workTypeId, row.sourceVendorWorkTypeId, row.unitPrice, row.unit, row.currency, row.notes]);
        insertedOffers += inserted.rowCount ?? 0;
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    const after = await counts(client);
    const report = reconcileSemanticMarketplaceBackfill(beforeSnapshot, plan, { ...before, insertedMappings, insertedCapabilities, insertedOffers, afterWorkTypeCount: after.workTypeCount, afterVendorWorkTypeCount: after.vendorWorkTypeCount, afterTicketCount: after.ticketCount });
    return { dryRun: false, conflictRate, plan, report };
  } finally {
    await client.query(`select pg_advisory_unlock($1)`, [LOCK_KEY]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes("--dry-run");
  assertSemanticMarketplaceBackfillApplyGuard(dryRun, process.env);
  if (!process.env.DATABASE_URL) throw new Error("Set an explicit DATABASE_URL after target review");
  const activationThreshold = Number(process.env.SERVICE_MATCHING_ACTIVATION_THRESHOLD);
  const maxConflictRate = Number(process.env.SEMANTIC_MARKETPLACE_BACKFILL_MAX_CONFLICT_RATE);
  if (!process.env.SERVICE_MATCHING_ACTIVATION_THRESHOLD || !process.env.SEMANTIC_MARKETPLACE_BACKFILL_MAX_CONFLICT_RATE) throw new Error("Explicit activation and conflict thresholds are required");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await runSemanticServiceMarketplaceBackfill(client, { dryRun, activationThreshold, maxConflictRate, batchSize: Number(process.env.SEMANTIC_MARKETPLACE_BACKFILL_BATCH_SIZE ?? 100) });
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.end(); }
}
