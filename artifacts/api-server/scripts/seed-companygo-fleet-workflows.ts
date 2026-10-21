import bcrypt from "bcryptjs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  FleetComplianceConfigurationSchema,
  FleetComplianceRecordSchema,
  FleetResourcesRegistrySchema,
  FleetRunSchema,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import { repairCompanyGoComplianceSource } from "./companygo-compliance-repair";

const CompanyGoFleetStateSchema = z.object({
  version: z.number().int().positive(), enabled: z.boolean(), fleets: z.array(z.any()), grants: z.array(z.any()),
  supportGrants: z.array(z.any()).default([]), runs: z.array(FleetRunSchema).max(1000),
  dispatchPlans: z.array(z.any()).default([]), dispatchPlanReceipts: z.array(z.any()).default([]),
  preferences: z.array(z.any()).default([]), operations: z.array(z.any()),
}).strict();
const emptyCompanyGoFleetState = () => ({ version: 1, enabled: false, fleets: [], grants: [], supportGrants: [], runs: [], dispatchPlans: [], dispatchPlanReceipts: [], preferences: [], operations: [] });

type DbClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };

export const COMPANYGO_FLEET_ACCOUNTS = [
  { login: "vendor_admin@fleetgo.com", capabilities: ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"] },
  { login: "vendor_office@fleetgo.com", capabilities: ["office"] },
  { login: "vendor_fleet_dispatch@fleetgo.com", capabilities: ["dispatch"] },
  { login: "vendor_fleet_driver@fleetgo.com", capabilities: ["yard", "driver", "self_dispatch"] },
] as const;

type CompanyGoFleetContext = {
  companyId: number; siteId: number; driverUserId: number; dispatcherUserId: number;
  accountUserIds: number[];
  vehicleAssetId: string; trailerAssetId: string;
  fleetOpsState: unknown; fleetResources: unknown; compliance: unknown;
};

type CompanyGoAssetCandidate = { id: string; name: string; category: string };

export function selectCompanyGoAssetRoles(candidates: CompanyGoAssetCandidate[], existingState?: { runs?: Array<{ vehicleAssetId?: string | null; trailerAssetId?: string | null }> }): { vehicleAssetId: string; trailerAssetId: string } {
  const usage = new Map<string, number>();
  const referenceOrder: string[] = [];
  for (const run of existingState?.runs ?? []) {
    for (const assetId of [run.vehicleAssetId, run.trailerAssetId]) if (assetId) {
      usage.set(assetId, (usage.get(assetId) ?? 0) + 1);
      if (!referenceOrder.includes(assetId)) referenceOrder.push(assetId);
    }
  }
  const select = (categories: string[], preferredName: string, label: string) => {
    const categoryPriority = new Map(categories.map((category, index) => [category, index]));
    const matches = candidates.filter((asset) => categoryPriority.has(asset.category.trim().toLowerCase()));
    if (matches.length === 0) throw new Error(`CompanyGo authoritative Fleet prerequisites require a ${label} asset.`);

    const preferredMatches = matches.filter((asset) => asset.name.trim().toLowerCase() === preferredName);
    if (preferredMatches.length === 1) return preferredMatches[0].id;
    if (preferredMatches.length > 1)
      throw new Error(`CompanyGo authoritative Fleet prerequisites contain an ambiguous duplicate ${label} preferred natural key.`);

    const bestPriority = Math.min(...matches.map((asset) => categoryPriority.get(asset.category.trim().toLowerCase())!));
    const bestMatches = matches.filter((asset) => categoryPriority.get(asset.category.trim().toLowerCase()) === bestPriority);
    const highestUsage = Math.max(...bestMatches.map((asset) => usage.get(asset.id) ?? 0));
    const mostUsed = bestMatches.filter((asset) => (usage.get(asset.id) ?? 0) === highestUsage);
    if (highestUsage > 0 && mostUsed.length === 1) return mostUsed[0].id;
    const firstReferenced = referenceOrder.find((assetId) => bestMatches.some((asset) => asset.id === assetId));
    if (highestUsage > 0 && firstReferenced) return firstReferenced;
    if (bestMatches.length !== 1)
      throw new Error(`CompanyGo authoritative Fleet prerequisites contain ambiguous ${label} assets without a unique preferred natural key.`);
    return bestMatches[0].id;
  };

  return {
    vehicleAssetId: select(["truck", "vehicle"], "fleetgo truck 1", "vehicle/truck"),
    trailerAssetId: select(["trailer", "rigging"], "fleetgo trailer 1", "trailer/rigging"),
  };
}

const fleetId = stableCompanyGoUuid("fleet:stanton");
const rigPackageId = stableCompanyGoUuid("rig-package:standard");
const detailId = stableCompanyGoUuid("detail:standard");

function isoDay(offset: number, hour: number): string {
  const value = new Date();
  value.setUTCHours(hour, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString();
}

function buildCompanyGoRun(context: CompanyGoFleetContext, ordinal: number, future: boolean) {
  const runKey = future ? `schedule:${ordinal}` : `history:${ordinal}`;
  const runId = stableCompanyGoUuid(`run:${runKey}`);
  const stopId = stableCompanyGoUuid(`run:${runKey}:stop`);
  const startOffset = future ? ordinal : -ordinal;
  const startedAt = isoDay(startOffset, 14);
  const finishedAt = isoDay(startOffset, 22);
  const snapshotDetail = {
    id: detailId, companyId: context.companyId, version: 1,
    name: "FleetGo Standard Detail", vehicleAssetId: context.vehicleAssetId,
    rigPackageId, rigPackageVersion: 1, driverUserId: context.driverUserId,
    accessGroupIds: [fleetId], effectiveFrom: isoDay(-60, 12), effectiveUntil: null, archivedAt: null,
  };
  const rigPackage = {
    id: rigPackageId, companyId: context.companyId, version: 1, name: "FleetGo Standard Rigging",
    components: [{ assetId: context.trailerAssetId, role: "trailer" as const, sequence: 0 }],
    effectiveFrom: isoDay(-60, 12), effectiveUntil: null, archivedAt: null,
  };
  const reservation = {
    id: stableCompanyGoUuid(`reservation:${runKey}`), runId, detailId, detailVersion: 1,
    driverUserId: context.driverUserId, assetIds: [context.vehicleAssetId, context.trailerAssetId],
    startAt: startedAt, plannedEndAt: finishedAt, timeZone: "America/Chicago",
    state: future ? "reserved" as const : "released" as const,
    actualReleasedAt: future ? null : finishedAt,
    releaseReason: future ? null : "Completed CompanyGo fixture run", version: 1,
  };
  return FleetRunSchema.parse({
    id: runId, fleetId, companyId: context.companyId,
    title: future ? `GasGo scheduled Fleet run day ${ordinal + 1}` : `GasGo completed Fleet run day ${ordinal + 1}`,
    driverUserId: context.driverUserId, vehicleAssetId: context.vehicleAssetId,
    trailerAssetId: context.trailerAssetId, siteIds: [context.siteId],
    status: future ? "dispatched" : "completed", phase: future ? "dispatch" : null,
    pausedFromPhase: null, records: [], version: 1,
    stops: [{ id: stopId, siteId: context.siteId, kind: "delivery", sequence: 0 }],
    loads: [], inspections: [], currentStopId: future ? stopId : null,
    visitedStopIds: future ? [] : [stopId], events: [],
    linkedTicketId: historyTicketBase + (future ? 100 + ordinal : ordinal),
    allowedActions: future ? ["acknowledge"] : [],
    schedule: { plannedStartAt: startedAt, plannedEndAt: finishedAt, timezone: "America/Chicago" },
    resourceAssignment: {
      version: 2, snapshot: {
        detail: snapshotDetail, rigPackage,
        labels: { truck: "FleetGo Truck 1", rigPackage: "FleetGo Standard Rigging", driver: "FleetGo Driver", components: [{ assetId: context.trailerAssetId, label: "FleetGo Trailer 1" }] },
        carrierOfRecordId: context.companyId, snapshottedAt: startedAt,
      }, reservation, returnPolicy: "return_required",
    },
    labels: { driverName: "FleetGo Driver", vehicleName: "FleetGo Truck 1", trailerName: "FleetGo Trailer 1", sites: [{ siteId: context.siteId, name: "GasGo Test Site" }] },
    assignmentRecordedAt: startedAt,
  });
}

async function mergeCompanyGoFleetState(client: DbClient): Promise<void> {
  const result = await client.query(`
    SELECT v.id company_id,v.fleet_ops_state,v.fleet_resources,v.fleet_compliance_configuration compliance,
      (SELECT s.id FROM site_locations s JOIN partners p ON p.id=s.partner_id WHERE lower(p.name)='gasgo' ORDER BY s.id LIMIT 1) site_id,
      (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_fleet_driver@fleetgo.com' LIMIT 1) driver_user_id,
      (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1) dispatcher_user_id,
      (SELECT array_agg(u.id ORDER BY lower(coalesce(u.email,u.username))) FROM users u WHERE lower(coalesce(u.email,u.username))=ANY($1::text[])) account_user_ids,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'category',a.category) ORDER BY lower(a.name),a.id),'[]'::jsonb)
       FROM assets a WHERE a.responsible_org_type='vendor' AND a.responsible_org_id=v.id AND a.retired_at IS NULL) asset_candidates
    FROM vendors v WHERE lower(v.name)='fleetgo' FOR UPDATE`, [COMPANYGO_FLEET_ACCOUNTS.map(account => account.login)]);
  const row = result.rows[0];
  if (!row?.site_id || !row?.driver_user_id || !row?.dispatcher_user_id)
    throw new Error("CompanyGo authoritative Fleet prerequisites are incomplete.");
  const assetRoles = selectCompanyGoAssetRoles(z.array(z.object({ id: z.string().uuid(), name: z.string(), category: z.string() })).parse(row.asset_candidates), row.fleet_ops_state ?? undefined);
  const context: CompanyGoFleetContext = {
    companyId: Number(row.company_id), siteId: Number(row.site_id), driverUserId: Number(row.driver_user_id), dispatcherUserId: Number(row.dispatcher_user_id),
    accountUserIds: row.account_user_ids.map(Number),
    vehicleAssetId: assetRoles.vehicleAssetId, trailerAssetId: assetRoles.trailerAssetId,
    fleetOpsState: row.fleet_ops_state, fleetResources: row.fleet_resources, compliance: row.compliance,
  };
  const originalState = CompanyGoFleetStateSchema.parse(context.fleetOpsState ?? emptyCompanyGoFleetState());
  const fixtureRuns = [...Array.from({ length: 30 }, (_, n) => buildCompanyGoRun(context, n, false)), ...Array.from({ length: 7 }, (_, n) => buildCompanyGoRun(context, n, true))];
  const fixtureRunIds = new Set(fixtureRuns.map(run => run.id));
  const grantByUser = new Map(originalState.grants.map(grant => [grant.userId, grant]));
  const fixtureGrants = context.accountUserIds.map(userId => {
    const current = grantByUser.get(userId);
    if (current) return { ...current, fleetIds: current.fleetIds.includes(fleetId) ? current.fleetIds : [...current.fleetIds, fleetId], siteIds: current.siteIds.includes(context.siteId) ? current.siteIds : [...current.siteIds, context.siteId] };
    const roles = userId === context.driverUserId ? ["driver" as const] : userId === context.dispatcherUserId ? ["dispatcher" as const] : ["fleet_manager" as const];
    return { userId, fleetIds: [fleetId], siteIds: [context.siteId], roles, safetyRelease: false, financeRead: userId !== context.driverUserId };
  });
  const fixtureUserIds = new Set(context.accountUserIds);
  const state = CompanyGoFleetStateSchema.parse({
    ...originalState, enabled: true,
    fleets: [...originalState.fleets.filter(fleet => fleet.id !== fleetId), { id: fleetId, name: "FleetGo Stanton Fleet", siteIds: [context.siteId], equipmentAssetIds: [context.vehicleAssetId, context.trailerAssetId], requiredCertifications: [] }],
    grants: [...originalState.grants.filter(grant => !fixtureUserIds.has(grant.userId)), ...fixtureGrants],
    runs: [...originalState.runs.filter(run => !fixtureRunIds.has(run.id)), ...fixtureRuns],
  });
  const originalResources = FleetResourcesRegistrySchema.parse(context.fleetResources ?? { version: 1, rigPackages: [], details: [], reservations: [] });
  const packageRecord = fixtureRuns[0]!.resourceAssignment!.snapshot.rigPackage!;
  const reusableDetail = { ...fixtureRuns[0]!.resourceAssignment!.snapshot.detail, driverUserId: null };
  const resources = FleetResourcesRegistrySchema.parse({
    ...originalResources,
    rigPackages: [...originalResources.rigPackages.filter(item => item.id !== rigPackageId), packageRecord],
    details: [...originalResources.details.filter(item => item.id !== detailId), reusableDetail],
    reservations: [...originalResources.reservations.filter(item => !fixtureRunIds.has(item.runId)), ...fixtureRuns.map(run => run.resourceAssignment!.reservation)],
  });
  await client.query("UPDATE vendors SET fleet_ops_state=$2::jsonb,fleet_resources=$3::jsonb WHERE id=$1", [context.companyId, JSON.stringify(state), JSON.stringify(resources)]);
  await mergeCompanyGoCompliance(client, context);
}

async function mergeCompanyGoCompliance(client: DbClient, context: CompanyGoFleetContext): Promise<void> {
  const existing = FleetComplianceConfigurationSchema.parse(context.compliance ?? { version: 1, reviewerUserIds: [], entries: [] });
  const recordId = stableCompanyGoUuid("compliance:driver-license");
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required for CompanyGo compliance storage");
  const objectStoreModulePath: string = "../src/lib/objectStore";
  const { getObjectStore } = await import(objectStoreModulePath) as typeof import("../src/lib/objectStore");
  const store = getObjectStore();
  const previous = existing.entries.find(entry => entry.id === recordId);
  if (previous) {
    const { localGetObject } = await import("../src/lib/localObjectStorage");
    const objectPath = await repairCompanyGoComplianceSource(context.companyId, previous, store, async path => {
      const local = await localGetObject(path);
      if (!local) return null;
      const { readFile } = await import("node:fs/promises");
      return { ...local, body: await readFile(local.filePath) };
    }, secret);
    if (objectPath !== previous.objectPath) {
      const configuration = FleetComplianceConfigurationSchema.parse({
        ...existing, version: existing.version + 1,
        entries: existing.entries.map(entry => entry.id === recordId ? { ...entry, objectPath } : entry),
        facts: existing.facts.map(fact => fact.sourceObjectPath === previous.objectPath ? { ...fact, sourceObjectPath: objectPath } : fact),
      });
      await client.query("UPDATE vendors SET fleet_compliance_configuration=$2::jsonb WHERE id=$1", [context.companyId, JSON.stringify(configuration)]);
    }
    return;
  }
  const at = isoDay(-1, 16), until = isoDay(365, 16);
  const record = FleetComplianceRecordSchema.parse({
    evidence: { id: recordId, revision: 1, subject: { kind: "driver", id: context.driverUserId }, requirementId: "companygo-driver-license", requirementVersion: 1, status: "reviewed", validFrom: isoDay(-365, 16), validUntil: until, verifiedAt: at, verifiedByUserId: context.dispatcherUserId, source: "CompanyGo synthetic qualification record", privateDocumentRef: null, restrictions: {} },
    attributes: { kind: "driver_license", issuingState: "OK", licenseNumber: "COMPANYGO-SYNTHETIC", licenseClass: "A", endorsements: ["N"], restrictions: [], licenseStatus: "active", sourceRecordId: null },
    retentionClass: "qualification", retainUntil: null, legalHold: false,
  });
  const digest = createHmac("sha256", secret).update(JSON.stringify(record)).digest("hex");
  const objectPath = `/objects/fleet-compliance-private/${context.companyId}/${recordId}/1/${digest}`;
  await store.putObject(objectPath, "application/json", Buffer.from(JSON.stringify(record)), { owner: `fleet-compliance:${context.companyId}`, visibility: "private", purpose: "fleet-compliance-private" });
  const entry = { id: recordId, revision: 1, subject: record.evidence.subject, requirementId: record.evidence.requirementId, requirementVersion: 1, status: record.evidence.status, validFrom: record.evidence.validFrom, validUntil: record.evidence.validUntil, verifiedAt: record.evidence.verifiedAt, verifiedByUserId: record.evidence.verifiedByUserId, attributeKind: record.attributes.kind, objectPath, updatedAt: at };
  const categories = [
    { category: "vehicle", score: 0 }, { category: "driver_license", score: 100 },
    { category: "insurance", score: 0 }, { category: "company_records", score: 0 },
  ];
  const preview = { score: 25, status: "red", advisoryOnly: true as const, evaluatedAt: at, categories, reasons: [
    { category: "vehicle", reason: "Add current vehicle evidence.", reasonCode: "missing_evidence" },
    { category: "insurance", reason: "Add current insurance evidence.", reasonCode: "missing_evidence" },
    { category: "company_records", reason: "Add current company records.", reasonCode: "missing_evidence" },
  ] };
  const configuration = FleetComplianceConfigurationSchema.parse({
    ...existing, version: existing.version + 1,
    reviewerUserIds: existing.reviewerUserIds.includes(context.dispatcherUserId) ? existing.reviewerUserIds : [...existing.reviewerUserIds, context.dispatcherUserId],
    entries: [...existing.entries, entry],
    facts: [...existing.facts, { subject: record.evidence.subject, version: 1, facts: { cdlRequired: true, medicalRequired: true, testingRequired: true, state: "OK", carrierId: context.companyId, vehicleAssetId: context.vehicleAssetId }, reviewedAt: at, reviewedByUserId: context.dispatcherUserId, sourceKind: "employer_record", sourceObjectPath: objectPath }],
    scoreHistory: [...existing.scoreHistory.filter(item => item.at.slice(0, 10) !== at.slice(0, 10)), { at, score: 25 }].slice(-365), partnerScorePreview: preview,
  });
  await client.query("UPDATE vendors SET fleet_compliance_configuration=$2::jsonb WHERE id=$1", [context.companyId, JSON.stringify(configuration)]);
}

export function stableCompanyGoUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`companygo:fleet-mobile:${value}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const yardId = stableCompanyGoUuid("yard:home");
const historyTicketBase = 1_870_000_000;
const custodyOperationIds = [1, 2, 3].map((ordinal) => stableCompanyGoUuid(`custody-event:${ordinal}`));
const orders = [
  { key: "requested", status: "requested", outcome: null, assignee: null, offset: "6 days", note: "Upcoming ticket detail awaiting yard assignment." },
  { key: "assigned", status: "assigned", outcome: null, assignee: "vendor_fleet_driver@fleetgo.com", offset: "2 days", note: "Driver and Yard capability coverage for a small-shop hookup." },
  { key: "in-progress", status: "in_progress", outcome: null, assignee: "vendor_fleet_driver@fleetgo.com", offset: "-1 hour", note: "Rigging package is being assembled and inspected." },
  { key: "ready", status: "reported", outcome: "ready", assignee: "vendor_fleet_driver@fleetgo.com", offset: "-2 days", note: "Truck and rigging verified ready for dispatch." },
  { key: "attention", status: "reported", outcome: "needs_attention", assignee: "vendor_fleet_driver@fleetgo.com", offset: "-5 days", note: "Substitute trailer recorded; Dispatch may continue ticket flow." },
] as const;

const capabilitySql = `
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
spec(login, capabilities, fixture_id) AS (VALUES
${COMPANYGO_FLEET_ACCOUNTS.map((row) => `  ('${row.login}', ARRAY[${row.capabilities.map((c) => `'${c}'`).join(",")}]::text[], '${stableCompanyGoUuid(`capability:${row.login}`)}'::uuid)`).join(",\n")}
), resolved AS (
  SELECT f.id company_id, u.id user_id, s.capabilities, s.fixture_id
  FROM fleetgo f JOIN spec s ON true
  JOIN users u ON lower(coalesce(u.email,u.username)) = s.login
  JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=f.id
)
INSERT INTO fleet_person_capabilities(id,company_id,user_id,capabilities,version,granted_by_user_id)
SELECT fixture_id,company_id,user_id,capabilities,1,
  (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_admin@fleetgo.com' LIMIT 1)
FROM resolved ON CONFLICT DO NOTHING;
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
spec(login, capabilities) AS (VALUES
${COMPANYGO_FLEET_ACCOUNTS.map((row) => `  ('${row.login}', ARRAY[${row.capabilities.map((c) => `'${c}'`).join(",")}]::text[])`).join(",\n")}
), resolved AS (
  SELECT f.id company_id, u.id user_id, s.capabilities
  FROM fleetgo f JOIN spec s ON true
  JOIN users u ON lower(coalesce(u.email,u.username)) = s.login
  JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=f.id
)
UPDATE fleet_person_capabilities current
SET capabilities=(SELECT array_agg(DISTINCT capability ORDER BY capability) FROM unnest(current.capabilities || resolved.capabilities) capability),
    version=current.version+1,updated_at=now()
FROM resolved
WHERE current.company_id=resolved.company_id AND current.user_id=resolved.user_id
  AND NOT current.capabilities @> resolved.capabilities`;

const orderSql = `
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
actors AS (
 SELECT f.id company_id,
  (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1) dispatcher_id,
  (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1) driver_id
 FROM fleetgo f
), asset_pool AS (
 SELECT array_agg(id ORDER BY id) FILTER (WHERE ordinal <= 3) asset_ids FROM (
  SELECT a.id,row_number() OVER(ORDER BY a.id) ordinal FROM assets a JOIN fleetgo f ON a.responsible_org_type='vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL
 ) ranked
), spec(id,status,outcome,assignee,scheduled_at,notes) AS (VALUES
${orders.map((row) => ` ('${stableCompanyGoUuid(`yard-order:${row.key}`)}'::uuid,'${row.status}',${row.outcome ? `'${row.outcome}'` : "NULL"},${row.assignee ? "'driver'" : "NULL"},now()+interval '${row.offset}','${row.note.replaceAll("'", "''")}')`).join(",\n")}
)
INSERT INTO fleet_yard_orders(id,company_id,yard_id,status,outcome,requested_by_user_id,assigned_to_user_id,requested_at,scheduled_at,started_at,reported_at,requested_asset_ids,actual_asset_ids,findings,notes,version)
SELECT s.id,a.company_id,'${yardId}',s.status,s.outcome,a.dispatcher_id,
 CASE WHEN s.assignee='driver' THEN a.driver_id END,now()-interval '7 days',s.scheduled_at,
 CASE WHEN s.status IN ('in_progress','reported') THEN s.scheduled_at END,
 CASE WHEN s.status='reported' THEN s.scheduled_at+interval '30 minutes' END,
 coalesce(p.asset_ids,'{}'::uuid[]),CASE WHEN s.status='reported' THEN coalesce(p.asset_ids,'{}'::uuid[]) ELSE '{}'::uuid[] END,
 CASE WHEN s.outcome='needs_attention' THEN jsonb_build_array(jsonb_build_object('assetId',(p.asset_ids)[1],'kind','substituted','note','Recorded substitute; advisory only')) ELSE '[]'::jsonb END,
 s.notes,1 FROM spec s CROSS JOIN actors a CROSS JOIN asset_pool p ON CONFLICT DO NOTHING`;

export const COMPANYGO_FLEET_SEED_SQL = [
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1)
   INSERT INTO fleet_yards(id,company_id,name,time_zone,is_home_base,active,version)
   SELECT '${yardId}',id,'FleetGo Stanton Yard','America/Chicago',true,true,1 FROM fleetgo ON CONFLICT DO NOTHING`,
  capabilitySql,
  orderSql,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), dispatcher AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1)
   INSERT INTO fleet_yard_order_assignments(id,company_id,order_id,assigned_to_user_id,assigned_by_user_id,assigned_at,ended_at)
   SELECT '${stableCompanyGoUuid("assignment:driver")}',f.id,'${stableCompanyGoUuid("yard-order:assigned")}',d.id,x.id,now()-interval '1 day',NULL FROM fleetgo f CROSS JOIN driver d CROSS JOIN dispatcher x ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), actor AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1), rows(order_id,event_type,version,operation_id) AS (VALUES
   ('${stableCompanyGoUuid("yard-order:requested")}'::uuid,'requested',1,'${stableCompanyGoUuid("event:requested")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:assigned")}'::uuid,'assigned',1,'${stableCompanyGoUuid("event:assigned")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:in-progress")}'::uuid,'started',1,'${stableCompanyGoUuid("event:started")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:ready")}'::uuid,'reported',1,'${stableCompanyGoUuid("event:ready")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:attention")}'::uuid,'reported',1,'${stableCompanyGoUuid("event:attention")}'::uuid))
   INSERT INTO fleet_yard_order_events(id,company_id,order_id,operation_id,actor_user_id,event_type,order_version,detail,occurred_at)
   SELECT gen_random_uuid(),f.id,r.order_id,r.operation_id,a.id,r.event_type,r.version,jsonb_build_object('fixture','companygo-fleet-mobile'),now()-interval '1 day' FROM rows r CROSS JOIN fleetgo f CROSS JOIN actor a ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), selected AS (SELECT a.id,row_number() OVER(ORDER BY a.id) ordinal FROM assets a JOIN fleetgo f ON a.responsible_org_type = 'vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL LIMIT 3)
   INSERT INTO fleet_asset_custody(id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,notes,version)
   SELECT gen_random_uuid(),f.id,s.id,CASE WHEN s.ordinal=1 THEN 'attached' WHEN s.ordinal=2 THEN 'reserved' ELSE 'at_yard' END,'driver_app',now()-interval '30 minutes',d.id,'${yardId}','CompanyGo canonical Fleet custody fixture',1 FROM selected s CROSS JOIN fleetgo f CROSS JOIN driver d ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), selected AS (SELECT a.id,row_number() OVER(ORDER BY a.id) ordinal FROM assets a JOIN fleetgo f ON a.responsible_org_type = 'vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL LIMIT 3)
   INSERT INTO fleet_asset_custody_events(id,operation_id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,notes,asset_version,occurred_at)
   SELECT gen_random_uuid(),CASE s.ordinal WHEN 1 THEN '${custodyOperationIds[0]}'::uuid WHEN 2 THEN '${custodyOperationIds[1]}'::uuid ELSE '${custodyOperationIds[2]}'::uuid END,f.id,s.id,CASE WHEN s.ordinal=1 THEN 'attached' WHEN s.ordinal=2 THEN 'reserved' ELSE 'at_yard' END,'driver_app',now()-interval '30 minutes',d.id,'${yardId}','CompanyGo canonical readback receipt',1,now()-interval '30 minutes' FROM selected s CROSS JOIN fleetgo f CROSS JOIN driver d ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name)='fleetgo' LIMIT 1), gasgo AS (SELECT id FROM partners WHERE lower(name)='gasgo' LIMIT 1), site AS (SELECT s.id FROM site_locations s JOIN gasgo g ON s.partner_id=g.id ORDER BY s.id LIMIT 1), work AS (SELECT w.id FROM vendor_work_types w JOIN fleetgo f ON w.vendor_id=f.id ORDER BY w.id LIMIT 1), employee AS (SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN fleetgo f ON vp.vendor_id=f.id WHERE lower(coalesce(u.email,u.username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), creator AS (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_admin@fleetgo.com' LIMIT 1), days AS (SELECT generate_series(0,29) n)
   INSERT INTO tickets(id,site_location_id,vendor_id,field_employee_id,work_type_id,status,intake_channel,description,notes,check_in_time,check_out_time,lifecycle_state,scheduled_start_at,scheduled_duration_minutes,created_by_id,closed_by_id,closed_at,approved_at,created_at,updated_at)
   SELECT ${historyTicketBase}+d.n,s.id,f.id,e.id,w.id,'approved','partner_self_service','CompanyGo completed Fleet run day '||(d.n+1),'Stable additive 30-day Fleet workflow fixture',current_date-d.n+interval '08:00',current_date-d.n+interval '16:00','off_site',current_date-d.n+interval '08:00',480,c.id,c.id,current_date-d.n+interval '16:00',current_date-d.n+interval '17:00',current_date-d.n+interval '07:00',current_date-d.n+interval '17:00' FROM days d CROSS JOIN fleetgo f CROSS JOIN site s CROSS JOIN work w CROSS JOIN employee e CROSS JOIN creator c ON CONFLICT(id) DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name)='fleetgo' LIMIT 1), gasgo AS (SELECT id FROM partners WHERE lower(name)='gasgo' LIMIT 1), site AS (SELECT s.id FROM site_locations s JOIN gasgo g ON s.partner_id=g.id ORDER BY s.id LIMIT 1), work AS (SELECT w.id FROM vendor_work_types w JOIN fleetgo f ON w.vendor_id=f.id ORDER BY w.id LIMIT 1), employee AS (SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN fleetgo f ON vp.vendor_id=f.id WHERE lower(coalesce(u.email,u.username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), creator AS (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1), days AS (SELECT generate_series(0,6) n)
   INSERT INTO tickets(id,site_location_id,vendor_id,field_employee_id,work_type_id,status,intake_channel,description,notes,lifecycle_state,scheduled_start_at,scheduled_duration_minutes,created_by_id,created_at,updated_at)
   SELECT ${historyTicketBase}+100+d.n,s.id,f.id,e.id,w.id,'initiated','partner_self_service','CompanyGo scheduled Fleet run day '||(d.n+1),'Stable additive seven-day Fleet schedule fixture','pending_arrival',current_date+d.n+interval '08:00',480,c.id,now(),now() FROM days d CROSS JOIN fleetgo f CROSS JOIN site s CROSS JOIN work w CROSS JOIN employee e CROSS JOIN creator c ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price,fleet_billing_metadata)
   SELECT t.id,'labor','CompanyGo Fleet day rate',1,1250,jsonb_build_object('fixture','companygo-fleet-mobile','billingMode','per_day') FROM tickets t WHERE t.id BETWEEN ${historyTicketBase} AND ${historyTicketBase}+29 AND NOT EXISTS(SELECT 1 FROM ticket_line_items li WHERE li.ticket_id=t.id AND li.description='CompanyGo Fleet day rate')`,
] as const;

export const COMPANYGO_FLEET_ACCEPTANCE_SQL = `
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
gasgo AS (SELECT id FROM partners WHERE lower(name) = 'gasgo' LIMIT 1)
SELECT
 (SELECT count(DISTINCT t.check_in_time::date) FROM tickets t JOIN fleetgo f ON t.vendor_id=f.id WHERE t.id BETWEEN ${historyTicketBase} AND ${historyTicketBase}+29 AND t.check_in_time::date BETWEEN current_date - 29 AND current_date) history_days,
 (SELECT count(DISTINCT t.scheduled_start_at::date) FROM tickets t JOIN fleetgo f ON t.vendor_id=f.id WHERE t.id BETWEEN ${historyTicketBase}+100 AND ${historyTicketBase}+106 AND t.scheduled_start_at::date BETWEEN current_date AND current_date + 6) scheduled_days,
 (SELECT count(*) FROM tickets t JOIN fleetgo f ON t.vendor_id=f.id WHERE (t.id BETWEEN ${historyTicketBase} AND ${historyTicketBase}+29 OR t.id BETWEEN ${historyTicketBase}+100 AND ${historyTicketBase}+106)) ticket_count,
 (SELECT count(*) FROM ticket_line_items li JOIN tickets t ON t.id=li.ticket_id JOIN fleetgo f ON t.vendor_id=f.id WHERE t.id BETWEEN ${historyTicketBase} AND ${historyTicketBase}+29 AND li.description='CompanyGo Fleet day rate') billing_line_count,
 (SELECT jsonb_array_length(coalesce(v.fleet_ops_state->'runs','[]'::jsonb)) FROM vendors v JOIN fleetgo f ON v.id=f.id) run_count,
 (SELECT jsonb_array_length(coalesce(v.fleet_resources->'details','[]'::jsonb)) FROM vendors v JOIN fleetgo f ON v.id=f.id) detail_count,
 (SELECT jsonb_array_length(coalesce(v.fleet_compliance_configuration->'entries','[]'::jsonb)) FROM vendors v JOIN fleetgo f ON v.id=f.id) compliance_entry_count,
 (SELECT count(*) FROM users u WHERE lower(coalesce(u.email,u.username))=ANY($1::text[])) account_count,
 (SELECT count(*) FROM fleet_person_capabilities c JOIN fleetgo f ON c.company_id=f.id JOIN users u ON u.id=c.user_id JOIN (VALUES
${COMPANYGO_FLEET_ACCOUNTS.map((row) => `('${row.login}',ARRAY[${row.capabilities.map((c) => `'${c}'`).join(",")}]::text[])`).join(",\n")}
 ) required(login,capabilities) ON lower(coalesce(u.email,u.username))=required.login WHERE c.capabilities @> required.capabilities) capability_account_count,
 (SELECT count(*) FROM gasgo) gasgo_count`;

export async function verifyCompanyGoFleetCoverage(client: DbClient): Promise<Record<string, number>> {
  const result = await client.query(COMPANYGO_FLEET_ACCEPTANCE_SQL, [COMPANYGO_FLEET_ACCOUNTS.map((row) => row.login)]);
  const counts = Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
  const required: Array<[string, number]> = [["history_days", 30], ["scheduled_days", 7], ["ticket_count", 37], ["billing_line_count", 30], ["run_count", 37], ["detail_count", 1], ["compliance_entry_count", 1], ["account_count", COMPANYGO_FLEET_ACCOUNTS.length], ["capability_account_count", COMPANYGO_FLEET_ACCOUNTS.length], ["gasgo_count", 1]];
  for (const [key, minimum] of required) if ((counts[key] ?? 0) < minimum) throw new Error(`CompanyGo Fleet acceptance requires ${key} >= ${minimum}; found ${counts[key] ?? 0}.`);
  const canonical = await client.query("SELECT id,fleet_ops_state,fleet_resources,fleet_compliance_configuration FROM vendors WHERE lower(name)='fleetgo' LIMIT 1");
  const state = CompanyGoFleetStateSchema.parse(canonical.rows[0]?.fleet_ops_state);
  const resources = FleetResourcesRegistrySchema.parse(canonical.rows[0]?.fleet_resources);
  const compliance = FleetComplianceConfigurationSchema.parse(canonical.rows[0]?.fleet_compliance_configuration);
  const canonicalRunIds = new Set([...Array.from({ length: 30 }, (_, ordinal) => stableCompanyGoUuid(`run:history:${ordinal}`)), ...Array.from({ length: 7 }, (_, ordinal) => stableCompanyGoUuid(`run:schedule:${ordinal}`))]);
  const fixtureRuns = state.runs.filter(run => canonicalRunIds.has(run.id));
  if (fixtureRuns.length !== 37) throw new Error(`CompanyGo Fleet acceptance requires exactly 37 canonical runs; found ${fixtureRuns.length}.`);
  if (new Set(fixtureRuns.filter(run => run.status === "completed").map(run => run.schedule?.plannedStartAt.slice(0, 10))).size < 30) throw new Error("CompanyGo Fleet acceptance requires 30 distinct canonical historical run days.");
  if (new Set(fixtureRuns.filter(run => run.status === "dispatched").map(run => run.schedule?.plannedStartAt.slice(0, 10))).size < 7) throw new Error("CompanyGo Fleet acceptance requires seven canonical future schedule days.");
  if (!fixtureRuns.every(run => run.linkedTicketId && run.siteIds.length && run.resourceAssignment?.snapshot.detail.driverUserId === run.driverUserId)) throw new Error("CompanyGo Fleet runs must retain canonical ticket, site, and Detail snapshots.");
  const assetIds = [...new Set(fixtureRuns.flatMap(run => [run.vehicleAssetId, run.trailerAssetId, ...(run.resourceAssignment?.reservation.assetIds ?? []), ...(run.resourceAssignment?.snapshot.rigPackage?.components.map(component => component.assetId) ?? [])]).filter((id): id is string => Boolean(id)))];
  const assetResult = await client.query("SELECT id,lower(category) category FROM assets WHERE id=ANY($1::uuid[])", [assetIds]);
  const assetCategories = new Map(assetResult.rows.map(row => [String(row.id), String(row.category)]));
  const validVehicle = (id: string | null | undefined) => Boolean(id && ["vehicle", "truck"].includes(assetCategories.get(id) ?? ""));
  const validRigging = (id: string | null | undefined) => Boolean(id && ["trailer", "rigging"].includes(assetCategories.get(id) ?? ""));
  if (!fixtureRuns.every(run => validVehicle(run.vehicleAssetId) && validRigging(run.trailerAssetId))) throw new Error("CompanyGo Fleet runs must use canonical vehicle/truck and trailer/rigging asset roles.");
  if (!fixtureRuns.every(run => {
    const assignment = run.resourceAssignment;
    const riggingIds = assignment?.snapshot.rigPackage?.components.map(component => component.assetId) ?? [];
    return assignment?.snapshot.detail.vehicleAssetId === run.vehicleAssetId
      && assignment.snapshot.detail.rigPackageId === rigPackageId
      && riggingIds.length > 0 && riggingIds.every(validRigging)
      && assignment.reservation.assetIds.includes(run.vehicleAssetId)
      && Boolean(run.trailerAssetId && assignment.reservation.assetIds.includes(run.trailerAssetId));
  })) throw new Error("CompanyGo Fleet snapshots and reservations must retain canonical asset linkage.");
  const relationships = await client.query(`SELECT count(*) relationship_count FROM tickets t JOIN vendors v ON v.id=t.vendor_id JOIN site_locations s ON s.id=t.site_location_id JOIN partners p ON p.id=s.partner_id WHERE lower(v.name)='fleetgo' AND lower(p.name)='gasgo' AND (t.id BETWEEN $1 AND $2 OR t.id BETWEEN $3 AND $4)`, [historyTicketBase, historyTicketBase + 29, historyTicketBase + 100, historyTicketBase + 106]);
  if (Number(relationships.rows[0]?.relationship_count) !== 37) throw new Error("CompanyGo Fleet acceptance requires all 37 fixture tickets to retain the FleetGo/GasGo relationship.");
  const canonicalDetail = resources.details.find(detail => detail.id === detailId);
  const canonicalRigPackage = resources.rigPackages.find(item => item.id === rigPackageId);
  const fixtureRunIds = new Set(fixtureRuns.map(run => run.id));
  const fixtureReservations = resources.reservations.filter(item => fixtureRunIds.has(item.runId));
  if (!canonicalDetail || canonicalDetail.driverUserId !== null || !validVehicle(canonicalDetail.vehicleAssetId)
    || !canonicalRigPackage || !canonicalRigPackage.components.length || !canonicalRigPackage.components.every(component => validRigging(component.assetId))
    || fixtureReservations.length !== 37
    || !fixtureReservations.every(item => item.assetIds.some(validVehicle) && item.assetIds.some(validRigging)))
    throw new Error("CompanyGo Fleet acceptance requires valid reusable Detail, rig package, and reservation asset roles.");
  if (!compliance.entries.length || !compliance.facts.length || !compliance.scoreHistory.length || !compliance.partnerScorePreview) throw new Error("CompanyGo Fleet acceptance requires canonical evidence, facts, score history, and Partner preview.");
  const fixtureEntry = compliance.entries.find(entry => entry.id === stableCompanyGoUuid("compliance:driver-license"));
  if (!fixtureEntry || !process.env.SESSION_SECRET) throw new Error("CompanyGo private evidence verification requires fixture and SESSION_SECRET");
  const { readFleetPrivateComplianceSource } = await import("../src/services/fleet-compliance-source");
  const { getObjectStore } = await import("../src/lib/objectStore");
  await readFleetPrivateComplianceSource(fixtureEntry, Number(canonical.rows[0].id), getObjectStore, value => createHmac("sha256", process.env.SESSION_SECRET!).update(JSON.stringify(value)).digest("hex"));
  return counts;
}

export async function readCompanyGoFleetFixtureFingerprint(client: DbClient): Promise<string> {
  const result = await client.query(`SELECT v.fleet_ops_state,v.fleet_resources,v.fleet_compliance_configuration,
    (SELECT count(*) FROM fleet_yard_orders o WHERE o.company_id=v.id) yard_orders,
    (SELECT count(*) FROM fleet_asset_custody c WHERE c.company_id=v.id) custody,
    (SELECT count(*) FROM tickets t WHERE t.vendor_id=v.id AND (t.id BETWEEN $1 AND $2 OR t.id BETWEEN $3 AND $4)) tickets,
    (SELECT count(*) FROM ticket_line_items li WHERE li.ticket_id BETWEEN $1 AND $2 AND li.description='CompanyGo Fleet day rate') billing
    FROM vendors v WHERE lower(v.name)='fleetgo'`, [historyTicketBase, historyTicketBase + 29, historyTicketBase + 100, historyTicketBase + 106]);
  return createHash("sha256").update(JSON.stringify(result.rows[0] ?? null)).digest("hex");
}

export async function seedCompanyGoFleetWorkflows(client: DbClient): Promise<void> {
  const accounts = await client.query(`SELECT lower(coalesce(email,username)) login,password_hash FROM users WHERE lower(coalesce(email,username)) = ANY($1::text[])`, [COMPANYGO_FLEET_ACCOUNTS.map((row) => row.login)]);
  for (const expected of COMPANYGO_FLEET_ACCOUNTS) {
    const actual = accounts.rows.find((row) => row.login === expected.login);
    if (!actual) throw new Error(`Missing CompanyGo Fleet account: ${expected.login}`);
    if (!bcrypt.compareSync("companygo", actual.password_hash)) throw new Error(`CompanyGo password hash drifted for ${expected.login}; run the canonical account backfill instead of rotating it here.`);
  }
  const prerequisites = await client.query(`SELECT (SELECT count(*) FROM vendors WHERE lower(name)='fleetgo') vendor_count,(SELECT count(*) FROM partners WHERE lower(name)='gasgo') partner_count,(SELECT count(*) FROM assets a JOIN vendors v ON a.responsible_org_type='vendor' AND a.responsible_org_id=v.id WHERE lower(v.name)='fleetgo' AND a.retired_at IS NULL) asset_count,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'category',a.category) ORDER BY lower(a.name),lower(a.category)),'[]'::jsonb) FROM assets a JOIN vendors v ON a.responsible_org_type='vendor' AND a.responsible_org_id=v.id WHERE lower(v.name)='fleetgo' AND a.retired_at IS NULL) asset_candidates,(SELECT fleet_ops_state FROM vendors WHERE lower(name)='fleetgo' LIMIT 1) fleet_ops_state`);
  const prerequisite = prerequisites.rows[0] ?? {};
  if (Number(prerequisite.vendor_count) !== 1 || Number(prerequisite.partner_count) !== 1 || Number(prerequisite.asset_count) < 3) throw new Error(`CompanyGo Fleet prerequisites are incomplete: ${JSON.stringify(prerequisite)}.`);
  selectCompanyGoAssetRoles(z.array(z.object({ id: z.string().uuid(), name: z.string(), category: z.string() })).parse(prerequisite.asset_candidates), prerequisite.fleet_ops_state ?? undefined);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('companygo_fleet_mobile_fixtures'))");
  for (const statement of COMPANYGO_FLEET_SEED_SQL) await client.query(statement);
  await mergeCompanyGoFleetState(client);
}

export function isCompanyGoFleetSeedMain(moduleUrl: string, argvPath: string | undefined, platform: NodeJS.Platform = process.platform): boolean {
  if (!argvPath) return false;
  const api = platform === "win32" ? path.win32 : path.posix;
  const modulePath = api.resolve(fileURLToPath(moduleUrl, { windows: platform === "win32" }));
  const invokedPath = api.resolve(argvPath);
  return platform === "win32" ? modulePath.toLowerCase() === invokedPath.toLowerCase() : modulePath === invokedPath;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) throw new Error("Pass --apply to add the idempotent CompanyGo Fleet workflow fixtures.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try { await client.query("BEGIN"); await seedCompanyGoFleetWorkflows(client); const counts = await verifyCompanyGoFleetCoverage(client); await client.query("COMMIT"); console.info("CompanyGo Fleet acceptance", counts); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}

if (isCompanyGoFleetSeedMain(import.meta.url, process.argv[1])) main().catch((error) => { console.error(error); process.exitCode = 1; });
