import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import {
  FleetCanonicalIdSchema,
  FleetAssetCreateSchema,
  FleetInventorySchema,
  FleetCustodyObservationInputSchema,
  FleetCustodyObservationSchema,
  FleetDetailSchema,
  FleetDetailPageSchema,
  FleetCommercialSettingsSchema,
  FleetYardInputSchema,
  FleetYardOrderActionSchema,
  FleetYardOrderInputSchema,
  FleetYardOrderSchema,
  FleetYardSchema,
  fleetRunAssetIds,
  type FleetYardOrder,
  type FleetYardOrderAction,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import {
  databaseFleetRepository,
  FleetError,
  type FleetRepository,
  type FleetState,
} from "./fleet-repository";
import { legacyFleetCapabilities } from "./fleet-mobile-permissions";
import {
  readFleetResourceAssets,
  readFleetResourceRecord,
  readFleetResourceRegistry,
} from "./fleet-resource-store";
import { readFleetAuthoritySites } from "./fleet-commercial-authority";
import { notifyUsers } from "../routes/notifications";

type YardRow = Record<string, any>;
const page = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();
const yardAssetQuery = z.object({ after: z.uuid().optional(), assetId: z.uuid().optional() }).strict();
const yardAssetCreate = z.object({
  scope: z.object({ owner: z.object({ type: z.literal("vendor"), id: z.number().int().positive() }), userId: z.number().int().positive(), membershipId: z.number().int().positive(), sessionVersion: z.number().int().nonnegative() }),
  fleetId: z.uuid(), asset: FleetAssetCreateSchema,
}).strict();
const assetColumns = `SELECT a.*, EXISTS(SELECT 1 FROM asset_holds h WHERE h.asset_id=a.id AND h.released_at IS NULL) AS held,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',x.kind,'value',x.display_value,'jurisdiction',NULLIF(x.jurisdiction,''))) FROM asset_aliases x WHERE x.asset_id=a.id AND x.active=true),'[]'::jsonb) AS aliases FROM assets a`;
function yardAsset(row: YardRow, fleets: FleetState["fleets"]) {
  return { id: row.id, name: row.name, manufacturer: row.manufacturer ?? "", model: row.model ?? "", category: row.category,
    status: row.status, version: row.version, legalOwner: row.legal_owner_name, held: Boolean(row.held),
    currentHolderUserId: row.current_holder_user_id ?? null,
    aliases: (row.aliases ?? []).map((alias: { kind: string; value: string; jurisdiction?: string | null }) => ({
      kind: alias.kind, value: alias.value, ...(alias.jurisdiction ? { jurisdiction: alias.jurisdiction } : {}),
    })),
    fleetIds: fleets.filter(fleet => fleet.equipmentAssetIds.includes(row.id)).map(fleet => fleet.id) };
}
const recommendation = z
  .object({
    yardId: FleetCanonicalIdSchema,
    vehicleAssetId: FleetCanonicalIdSchema.optional(),
    rigPackageId: FleetCanonicalIdSchema.optional(),
    window: z
      .object({
        startAt: z.iso.datetime({ offset: true }),
        endAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
const iso = (value: Date | string | null) =>
  value == null ? null : new Date(value).toISOString();
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function yard(row: YardRow) {
  return FleetYardSchema.parse({
    id: row.id,
    companyId: row.company_id,
    version: row.version,
    name: row.name,
    timeZone: row.time_zone,
    destinationId: row.destination_id,
    isHomeBase: row.is_home_base,
    active: row.active,
  });
}
function order(row: YardRow): FleetYardOrder {
  return FleetYardOrderSchema.parse({
    id: row.id,
    companyId: row.company_id,
    version: row.version,
    yardId: row.yard_id,
    detailId: row.detail_id,
    runId: row.run_id,
    status: row.status,
    outcome: row.outcome,
    requestedByUserId: row.requested_by_user_id,
    assignedToUserId: row.assigned_to_user_id,
    requestedAt: iso(row.requested_at),
    scheduledAt: iso(row.scheduled_at),
    startedAt: iso(row.started_at),
    reportedAt: iso(row.reported_at),
    requestedAssetIds: row.requested_asset_ids,
    actualAssetIds: row.actual_asset_ids,
    findings: row.findings,
    notes: row.notes,
  });
}
function custody(row: YardRow) {
  return {
    version: row.version,
    observation: FleetCustodyObservationSchema.parse({
      id: row.id,
      companyId: row.company_id,
      assetId: row.asset_id,
      state: row.state,
      method: row.method,
      observedAt: iso(row.observed_at),
      observedByUserId: row.observed_by_user_id,
      yardId: row.yard_id,
      runId: row.run_id,
      detailId: row.detail_id,
      latitude: row.latitude,
      longitude: row.longitude,
      notes: row.notes,
    }),
  };
}
function scope(
  actor: FleetActor,
  input: {
    owner: { type: string; id: number };
    userId: number;
    membershipId: number;
    sessionVersion: number;
  },
) {
  if (
    input.owner.type !== "vendor" ||
    input.owner.id !== actor.companyId ||
    input.userId !== actor.userId ||
    input.membershipId !== actor.activeMembershipId ||
    input.sessionVersion !== actor.sv
  )
    throw new FleetError("fleet.company_required", 403);
}
function permission(
  state: FleetState,
  actor: FleetActor,
  allowed: readonly string[],
  write = false,
) {
  const grant = state.grants.find(
    (g) =>
      g.userId === actor.userId &&
      g.fleetIds.some((id) => state.fleets.some((f) => f.id === id)),
  );
  const capabilities =
    actor.fleetCapabilities ?? legacyFleetCapabilities(grant?.roles ?? []);
  if (
    !state.enabled ||
    !grant ||
    !allowed.some((value) => capabilities.has(value as never)) ||
    (write && actor.readOnly)
  )
    throw new FleetError("fleet.permission_denied", 403);
  return grant;
}
function assetInGrant(
  state: FleetState,
  grant: { fleetIds: readonly string[] },
  assetId: string,
) {
  return state.fleets.some(
    (f) =>
      grant.fleetIds.includes(f.id) && f.equipmentAssetIds.includes(assetId),
  );
}
function requireAssetScope(
  state: FleetState,
  grant: { fleetIds: readonly string[] },
  ids: readonly string[],
) {
  if (!ids.every((id) => assetInGrant(state, grant, id)))
    throw new FleetError("fleet.asset_not_found", 404);
}
function capabilities(state: FleetState, actor: FleetActor) {
  const grant = state.grants.find((g) => g.userId === actor.userId);
  return actor.fleetCapabilities ?? legacyFleetCapabilities(grant?.roles ?? []);
}
function usesAssignedDriverCustodyAuthority(caps: ReadonlySet<string>) {
  // Office read access does not replace Driver authority for custody operations.
  return caps.has("driver") && !["admin", "dispatch", "yard"].some((cap) => caps.has(cap));
}
function yardTargetFleets(
  state: FleetState,
  value: FleetYardOrder,
  detailAccessGroupIds?: readonly string[] | null,
) {
  const run = value.runId ? state.runs.find((row) => row.id === value.runId) : null;
  if (value.runId && !run) return [];
  const assets = [...new Set([
    ...value.requestedAssetIds,
    ...value.actualAssetIds,
    ...value.findings.map((row) => row.assetId),
    ...(run ? fleetRunAssetIds(run) : []),
  ])];
  if (!assets.length) return [];
  return state.fleets.filter((fleet) =>
    assets.every((id) => fleet.equipmentAssetIds.includes(id)) &&
    (!value.detailId || detailAccessGroupIds?.includes(fleet.id)) &&
    (!run || (run.fleetId === fleet.id && run.siteIds.every((id) => fleet.siteIds.includes(id)))),
  ).map((fleet) => fleet.id);
}
function assertYardOrderScope(
  state: FleetState,
  actor: FleetActor,
  value: FleetYardOrder,
  notFound = true,
  detailAccessGroupIds?: readonly string[] | null,
) {
  const grant = state.grants.find((g) => g.userId === actor.userId);
  const caps = capabilities(state, actor);
  const targetFleets = yardTargetFleets(state, value, detailAccessGroupIds);
  if (!targetFleets.length || (!caps.has("admin") && !targetFleets.some((id) => grant?.fleetIds.includes(id))))
    throw new FleetError(notFound ? "fleet.yard_order_not_found" : "fleet.asset_not_found", 404);
  if (value.runId) {
    const run = state.runs.find((row) => row.id === value.runId)!;
    const ownSelfDispatch = caps.has("driver") && caps.has("self_dispatch") && run.driverUserId === actor.userId;
    if (!caps.has("admin") && !ownSelfDispatch && !run.siteIds.every((id) => grant?.siteIds.includes(id)))
      throw new FleetError(notFound ? "fleet.yard_order_not_found" : "fleet.permission_denied", notFound ? 404 : 403);
  }
  return targetFleets;
}
async function currentCompanySiteIds(client: PoolClient, companyId: number, siteIds: readonly number[]) {
  const unique = [...new Set(siteIds)];
  if (!unique.length) return [];
  const rows = await readFleetAuthoritySites(client, companyId, { siteIds: unique, activeOnly: true });
  return rows.map((row) => row.id as number);
}
async function requireOrderCompanySites(client: PoolClient, state: FleetState, actor: FleetActor, value: FleetYardOrder, notFound = true) {
  const run = value.runId ? state.runs.find((row) => row.id === value.runId) : null;
  if (!run?.siteIds.length) return;
  const current = await currentCompanySiteIds(client, actor.companyId, run.siteIds);
  if (!run.siteIds.every((id) => current.includes(id)))
    throw new FleetError(notFound ? "fleet.yard_order_not_found" : "fleet.permission_denied", notFound ? 404 : 403);
}
async function detailAccessForOrder(client: PoolClient, actor: FleetActor, value: FleetYardOrder): Promise<string[] | null> {
  if (!value.detailId) return null;
  const event = await client.query(
    "SELECT detail FROM fleet_yard_order_events WHERE company_id=$1 AND order_id=$2 AND event_type='requested' ORDER BY occurred_at,id LIMIT 1",
    [actor.companyId, value.id],
  );
  const captured = event.rows[0]?.detail?.detailAccessGroupIds;
  if (Array.isArray(captured)) return captured.filter((id): id is string => typeof id === "string");
  // Older events never captured Detail access. Current mutable configuration
  // cannot retroactively establish who was authorized for that order.
  return [];
}
async function assertScopedYardOrder(client: PoolClient, state: FleetState, actor: FleetActor, value: FleetYardOrder, notFound = true) {
  const groups = await detailAccessForOrder(client, actor, value);
  const target = assertYardOrderScope(state, actor, value, notFound, groups);
  await requireOrderCompanySites(client, state, actor, value, notFound);
  return target;
}
async function currentAssignedDriverSites(client: PoolClient, state: FleetState, actor: FleetActor) {
  const grant = state.grants.find((row) => row.userId === actor.userId);
  const ids = state.runs.filter((run) => run.driverUserId === actor.userId && grant?.fleetIds.includes(run.fleetId) &&
    state.fleets.some((fleet) => fleet.id === run.fleetId && run.siteIds.every((id) => fleet.siteIds.includes(id))))
    .flatMap((run) => run.siteIds);
  return currentCompanySiteIds(client, actor.companyId, ids);
}
function activeDriverRunForAsset(state: FleetState, userId: number, runId: string | null, assetId: string, currentSiteIds: readonly number[]) {
  if (!runId) return null;
  const run = state.runs.find((row) => row.id === runId);
  const grant = state.grants.find((row) => row.userId === userId);
  if (!run || run.driverUserId !== userId || !["dispatched", "acknowledged", "in_progress"].includes(run.status) ||
    !grant?.fleetIds.includes(run.fleetId) ||
    !state.fleets.some((fleet) => fleet.id === run.fleetId && run.siteIds.every((id) => fleet.siteIds.includes(id))) ||
    !run.siteIds.every((id) => currentSiteIds.includes(id)) ||
    (run.resourceAssignment && !["reserved", "active"].includes(run.resourceAssignment.reservation.state)) ||
    !fleetRunAssetIds(run).includes(assetId)) return null;
  if (state.runs.some((other) => other.id !== run.id &&
    ["dispatched", "acknowledged", "in_progress"].includes(other.status) &&
    (!other.resourceAssignment || ["reserved", "active"].includes(other.resourceAssignment.reservation.state)) &&
    fleetRunAssetIds(other).includes(assetId))) return null;
  return run;
}
const retainedAttachmentSchema = z.object({
  truckAssetId: FleetCanonicalIdSchema,
  componentAssetId: FleetCanonicalIdSchema,
  detailId: FleetCanonicalIdSchema,
  detailVersion: z.number().int().positive(),
  rigPackageId: FleetCanonicalIdSchema,
  rigPackageVersion: z.number().int().positive(),
  detailAccessGroupIds: z.array(FleetCanonicalIdSchema).optional(),
}).strict();
async function assertRetainedAttachmentAuthority(
  client: PoolClient,
  state: FleetState,
  actor: FleetActor,
  grant: { fleetIds: readonly string[] },
  result: unknown,
  currentSiteIds: readonly number[],
) {
  const body = z.object({ observation: FleetCustodyObservationSchema, attachment: retainedAttachmentSchema.nullable().optional() }).passthrough().parse(result);
  const observation = body.observation;
  if (observation.state !== "attached") return;
  const attachment = body.attachment;
  if (!attachment || attachment.componentAssetId !== observation.assetId || attachment.detailId !== observation.detailId)
    throw new FleetError("fleet.detail_attachment_required", 409);
  const caps = capabilities(state, actor);
  const driverOnly = usesAssignedDriverCustodyAuthority(caps);
  const run = observation.runId ? state.runs.find((row) => row.id === observation.runId) : null;
  const snapshot = run?.resourceAssignment?.snapshot ?? run?.recoveredWork?.snapshot;
  const snapshotRig = snapshot?.rigPackage;
  if (snapshot && (snapshot.detail.id !== attachment.detailId || snapshot.detail.version !== attachment.detailVersion ||
    snapshot.detail.vehicleAssetId !== attachment.truckAssetId || !snapshotRig || snapshotRig.id !== attachment.rigPackageId ||
    snapshotRig.version !== attachment.rigPackageVersion ||
    !snapshotRig.components.some((part) => part.assetId === observation.assetId)))
    throw new FleetError("fleet.detail_attachment_required", 409);
  const historical = !snapshot && !attachment.detailAccessGroupIds
    ? await readFleetResourceRecord(client, actor.companyId, "fleet-detail", attachment.detailId, attachment.detailVersion)
    : null;
  const detailGroups = snapshot?.detail.accessGroupIds ?? attachment.detailAccessGroupIds ??
    (historical ? FleetDetailSchema.parse(historical).accessGroupIds : []);
  const scoped = state.fleets.some((fleet) => detailGroups.includes(fleet.id) &&
    fleet.equipmentAssetIds.includes(observation.assetId) && fleet.equipmentAssetIds.includes(attachment.truckAssetId) &&
    (caps.has("admin") || grant.fleetIds.includes(fleet.id)) && (!run || run.fleetId === fleet.id));
  if (!scoped || (run && (run.vehicleAssetId !== attachment.truckAssetId || !fleetRunAssetIds(run).includes(observation.assetId))) ||
    (driverOnly && !activeDriverRunForAsset(state, actor.userId, observation.runId, attachment.truckAssetId, currentSiteIds)))
    throw new FleetError("fleet.detail_attachment_required", 409);
  const [truck] = await readFleetResourceAssets(client, actor, state, [attachment.truckAssetId], true);
  const holder = truck.current_holder_user_id;
  if ((driverOnly && holder !== null && holder !== actor.userId) ||
    (!driverOnly && holder !== null && holder !== actor.userId && holder !== run?.driverUserId))
    throw new FleetError("fleet.detail_attachment_required", 409);
  const custody = await client.query("SELECT run_id,state FROM fleet_asset_custody WHERE company_id=$1 AND asset_id=$2 FOR UPDATE",
    [actor.companyId, attachment.truckAssetId]);
  if (custody.rows.some((row) => (row.run_id && row.run_id !== observation.runId) ||
    (!run && row.state === "in_transit")))
    throw new FleetError("fleet.detail_attachment_required", 409);
}
async function assertYard(
  client: PoolClient,
  companyId: number,
  id: string | null,
) {
  if (!id) return;
  const found = await client.query(
    "SELECT id FROM fleet_yards WHERE company_id=$1 AND id=$2 AND active=true",
    [companyId, id],
  );
  if (!found.rows.length) throw new FleetError("fleet.yard_not_found", 404);
}
async function assertMember(
  client: PoolClient,
  companyId: number,
  userId: number,
) {
  const found = await client.query(
    "SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.user_id=$2 AND m.org_type='vendor' AND u.suspended_at IS NULL",
    [companyId, userId],
  );
  if (!found.rows.length)
    throw new FleetError("fleet.membership_required", 403);
}
async function assertYardAssignee(
  client: PoolClient,
  state: FleetState,
  companyId: number,
  userId: number,
) {
  await assertMember(client, companyId, userId);
  const grant = state.grants.find(
    (g) =>
      g.userId === userId &&
      g.fleetIds.some((id) => state.fleets.some((f) => f.id === id)),
  );
  if (!grant) throw new FleetError("fleet.permission_denied", 403);
  const stored = await client.query(
    "SELECT capabilities FROM fleet_person_capabilities WHERE company_id=$1 AND user_id=$2",
    [companyId, userId],
  );
  const caps = stored.rows.length
    ? new Set<string>(stored.rows[0].capabilities)
    : legacyFleetCapabilities(grant.roles);
  if (!caps.has("yard") && !caps.has("admin"))
    throw new FleetError("fleet.permission_denied", 403);
}
async function auditReplay(
  client: PoolClient,
  actor: FleetActor,
  operationId: string,
  hash: string,
  targetType = "fleet-yard-operation",
) {
  const found = await client.query(
    "SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
    [actor.companyId, targetType, operationId],
  );
  if (!found.rows.length) return null;
  const row = found.rows[0];
  if (row.user_id !== actor.userId || row.tool_input?.fingerprint !== hash)
    throw new FleetError("fleet.operation_conflict", 409);
  return row.tool_output;
}
async function saveOrderReceipt(
  client: PoolClient,
  actor: FleetActor,
  operationId: string,
  hash: string,
  result: FleetYardOrder,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,actor_membership_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'fleet','typed','canonical','fleet_yard_order','action','fleet-yard-order-operation',$5,$6::jsonb,$7::jsonb,'completed')",
    [
      actor.userId,
      actor.companyId,
      actor.role,
      actor.membershipRole,
      operationId,
      JSON.stringify({ fingerprint: hash }),
      JSON.stringify(result),
    ],
  );
}

/** A reported Yard result is advice to Dispatch; no ticket or run state is changed here. */
export function transitionYardOrder(
  current: FleetYardOrder,
  action: FleetYardOrderAction,
  now: Date,
): FleetYardOrder {
  if (
    current.id !== action.orderId ||
    current.version !== action.expectedVersion
  )
    throw new FleetError("fleet.version_conflict", 409);
  let next: FleetYardOrder;
  if (
    action.kind === "assign" &&
    ["requested", "assigned"].includes(current.status)
  )
    next = {
      ...current,
      version: current.version + 1,
      status: "assigned",
      assignedToUserId: action.assignedToUserId,
    };
  else if (action.kind === "start" && current.status === "assigned")
    next = {
      ...current,
      version: current.version + 1,
      status: "in_progress",
      startedAt: now.toISOString(),
    };
  else if (action.kind === "report" && current.status === "in_progress")
    next = {
      ...current,
      version: current.version + 1,
      status: "reported",
      outcome: action.outcome,
      reportedAt: now.toISOString(),
      actualAssetIds: action.actualAssetIds ?? current.actualAssetIds,
      findings: action.findings ?? current.findings,
      notes: action.notes,
    };
  else throw new FleetError("fleet.yard_order_transition_conflict", 409);
  return FleetYardOrderSchema.parse(next);
}

export type CustodyLocation = {
  assetId: string;
  detailId?: string | null;
  yardId: string | null;
  runId: string | null;
  state: string;
  latitude: number | null;
  longitude: number | null;
  inheritedFromAssetId?: string | null;
};
/** Attached rig components follow the truck only while the attachment remains current. */
export function resolveAttachedCustody<T extends CustodyLocation>(
  rows: readonly T[],
  attachments: readonly {
    truckAssetId: string;
    componentAssetId: string;
    detailId?: string;
  }[],
) {
  const byId = new Map(rows.map((row) => [row.assetId, row]));
  return rows.map((row) => {
    const link =
      row.state === "attached"
        ? attachments.find(
            (item) =>
              item.componentAssetId === row.assetId &&
              (item.detailId === undefined || item.detailId === row.detailId),
          )
        : undefined;
    const truckId = link?.truckAssetId;
    const truck = truckId ? byId.get(truckId) : undefined;
    return truck
      ? {
          ...row,
          yardId: truck.yardId,
          runId: truck.runId,
          latitude: truck.latitude,
          longitude: truck.longitude,
          inheritedFromAssetId: truckId,
        }
      : { ...row, inheritedFromAssetId: null };
  });
}

export function isAssetInAttachedDetail(
  assetId: string,
  detailId: string | null,
  details: readonly {
    id: string;
    vehicleAssetId: string;
    rigPackageId: string | null;
    rigPackageVersion: number | null;
  }[],
  rigs: readonly {
    id: string;
    version: number;
    components: readonly { assetId: string }[];
  }[],
) {
  const detail = details.find((row) => row.id === detailId);
  if (!detail?.rigPackageId) return false;
  const rig = rigs.find(
    (row) =>
      row.id === detail.rigPackageId &&
      row.version === detail.rigPackageVersion,
  );
  return !!rig?.components.some((component) => component.assetId === assetId);
}

type Candidate = { assetId: string; yardId: string | null; kind: string };
type ReservationWindow = {
  assetIds: string[];
  startAt: string;
  endAt: string | null;
};
/** Advisory availability; an excluded candidate remains visible with reasons. */
export function suggestYardResources(input: {
  yardId: string;
  vehicleAssetId?: string;
  rigPackageId?: string;
  window: { startAt: string; endAt: string };
  candidates: readonly Candidate[];
  reservations: readonly ReservationWindow[];
}) {
  return input.candidates.map((candidate) => {
    const reasons: string[] = [];
    if (candidate.yardId !== input.yardId) reasons.push("different_yard");
    if (
      input.reservations.some(
        (r) =>
          r.assetIds.includes(candidate.assetId) &&
          Date.parse(input.window.startAt) <
            (r.endAt ? Date.parse(r.endAt) : Infinity) &&
          Date.parse(r.startAt) < Date.parse(input.window.endAt),
      )
    )
      reasons.push("reserved_in_window");
    return {
      assetId: candidate.assetId,
      available: reasons.length === 0,
      reasons,
    };
  });
}

export function createFleetYardOperations(
  repository: FleetRepository = databaseFleetRepository,
) {
  const tx = <T>(
    actor: FleetActor,
    work: (state: FleetState, client: PoolClient) => Promise<T>,
  ) => repository.transaction(actor.companyId, actor.userId, work, actor);
  return {
    yardAssemblyTargets: (actor: FleetActor, raw: unknown) => tx(actor, async (state, client) => {
      const { assetId } = z.object({ assetId: FleetCanonicalIdSchema }).strict().parse(raw);
      const grant = permission(state, actor, ["admin", "dispatch", "yard"]);
      requireAssetScope(state, grant, [assetId]);
      const registry = await readFleetResourceRegistry(client, actor.companyId);
      const details = registry.details.filter(detail => {
        if (detail.archivedAt || detail.driverUserId !== null || !detail.rigPackageId || detail.rigPackageVersion === null) return false;
        const rig = registry.rigPackages.find(item => item.id === detail.rigPackageId && item.version === detail.rigPackageVersion && !item.archivedAt);
        if (!rig?.components.some(component => component.assetId === assetId)) return false;
        return state.fleets.some(fleet => grant.fleetIds.includes(fleet.id) && detail.accessGroupIds.includes(fleet.id) &&
          fleet.equipmentAssetIds.includes(assetId) && fleet.equipmentAssetIds.includes(detail.vehicleAssetId));
      }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return FleetDetailPageSchema.parse({ details, nextCursor: null, canManage: false });
    }),
    yardAssets: (actor: FleetActor, raw: unknown = {}) => tx(actor, async (state, client) => {
      const grant = permission(state, actor, ["admin", "dispatch", "yard", "office", "driver"]);
      const input = yardAssetQuery.parse(raw);
      const visibleFleets = state.fleets.filter(fleet => grant.fleetIds.includes(fleet.id));
      const allIds = [...new Set(visibleFleets.flatMap(fleet => fleet.equipmentAssetIds))];
      const caps = capabilities(state, actor);
      const driverOnly = usesAssignedDriverCustodyAuthority(caps) && !caps.has("office");
      const currentSiteIds = driverOnly ? await currentAssignedDriverSites(client, state, actor) : [];
      const assigned = driverOnly ? allIds.filter(assetId => state.runs.some(run => activeDriverRunForAsset(state, actor.userId, run.id, assetId, currentSiteIds))) : allIds;
      const holders = driverOnly && assigned.length ? await client.query("SELECT id,current_holder_user_id FROM assets WHERE id=ANY($1::uuid[]) AND responsible_org_type='vendor' AND responsible_org_id=$2", [assigned, actor.companyId]) : { rows: [] };
      const ids = driverOnly ? assigned.filter(assetId => holders.rows.some(row => row.id === assetId && (row.current_holder_user_id === null || row.current_holder_user_id === actor.userId))) : assigned;
      if (input.assetId && !ids.includes(input.assetId)) throw new FleetError("fleet.asset_not_found", 404);
      const found = await client.query(`${assetColumns} WHERE a.responsible_org_type='vendor' AND a.responsible_org_id=$1 AND a.id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR a.id>$3::uuid) AND ($4::uuid IS NULL OR a.id=$4::uuid) AND a.merged_into_id IS NULL ORDER BY a.id LIMIT 51`,
        [actor.companyId, ids, input.after ?? null, input.assetId ?? null]);
      return FleetInventorySchema.parse({ canManage: !actor.readOnly && ["admin", "dispatch", "yard"].some(cap => capabilities(state, actor).has(cap as never)),
        version: state.version, fleets: visibleFleets.map(fleet => ({ id: fleet.id, name: fleet.name })),
        assets: found.rows.slice(0, 50).map(row => yardAsset(row, visibleFleets)), nextCursor: found.rows.length > 50 ? found.rows[49].id : null });
    }),
    yardAssetReceipt: (actor: FleetActor, rawId: string) => tx(actor, async (state, client) => {
      const grant = permission(state, actor, ["admin", "dispatch", "yard"]);
      const operationId = FleetCanonicalIdSchema.parse(rawId);
      const found = await client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-yard-asset-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1", [actor.companyId, operationId]);
      const record = found.rows[0];
      if (!record || record.user_id !== actor.userId) throw new FleetError("fleet.operation_not_found", 404);
      requireAssetScope(state, grant, [record.tool_output.assetId]);
      return record.tool_output as { operationId: string; assetId: string; version: number };
    }),
    receiveYardAsset: (actor: FleetActor, raw: unknown) => tx(actor, async (state, client) => {
      const input = yardAssetCreate.parse(raw);
      scope(actor, input.scope);
      const grant = permission(state, actor, ["admin", "dispatch", "yard"], true);
      const fleet = state.fleets.find(item => item.id === input.fleetId && grant.fleetIds.includes(item.id));
      if (!fleet) throw new FleetError("fleet.asset_not_found", 404);
      const hash = fingerprint(input);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`fleet-yard-asset:${input.asset.operationId}`]);
      const replay = await client.query("SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-yard-asset-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1", [actor.companyId, input.asset.operationId]);
      if (replay.rows.length) {
        if (replay.rows[0].user_id !== actor.userId || replay.rows[0].tool_input?.fingerprint !== hash) throw new FleetError("fleet.operation_conflict", 409);
        const receipt = replay.rows[0].tool_output;
        requireAssetScope(state, grant, [receipt.assetId]);
        return receipt;
      }
      const assetId = randomUUID();
      await client.query("INSERT INTO assets(id,name,category,legal_owner_name,responsible_org_type,responsible_org_id,manufacturer,model,created_by_user_id) VALUES($1,$2,$3,$4,'vendor',$5,$6,$7,$8)",
        [assetId, input.asset.name, input.asset.category, input.asset.legalOwner, actor.companyId, input.asset.manufacturer || null, input.asset.model || null, actor.userId]);
      const alias = input.asset.identifier;
      await client.query("INSERT INTO asset_aliases(asset_id,kind,jurisdiction,normalized_value,display_value) VALUES($1,$2,$3,$4,$5)",
        [assetId, alias.kind, alias.jurisdiction?.trim().toUpperCase() ?? "", alias.value.toUpperCase().replace(/[^A-Z0-9]/g, ""), alias.value]);
      await client.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)", [assetId, String(actor.companyId), actor.userId]);
      fleet.equipmentAssetIds.push(assetId); state.version++;
      const receipt = { operationId: input.asset.operationId, assetId, version: 1 };
      await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,target_id,tool_input,tool_output,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,result_status) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,'fleet','typed','canonical','fleet_yard_asset','create','fleet-yard-asset-operation','completed')",
        [actor.userId, actor.companyId, input.asset.operationId, JSON.stringify({ fingerprint: hash }), JSON.stringify(receipt), actor.role]);
      return receipt;
    }),
    yards: (actor: FleetActor, raw: unknown = {}) =>
      tx(actor, async (state, client) => {
        permission(state, actor, [
          "admin",
          "dispatch",
          "yard",
          "driver",
          "office",
        ]);
        const { limit } = page.parse(raw);
        const found = await client.query(
          "SELECT * FROM fleet_yards WHERE company_id=$1 ORDER BY name,id LIMIT $2",
          [actor.companyId, limit],
        );
        return { yards: found.rows.map(yard) };
      }),
    saveYard: (actor: FleetActor, raw: unknown) =>
      tx(actor, async (state, client) => {
        const input = FleetYardInputSchema.parse(raw);
        scope(actor, input.scope);
        permission(state, actor, ["admin"], true);
        if (input.yard.companyId !== actor.companyId)
          throw new FleetError("fleet.company_required", 403);
        const hash = fingerprint(input);
        const replay = await auditReplay(
          client,
          actor,
          input.operationId,
          hash,
        );
        if (replay) return FleetYardSchema.parse(replay);
        if (input.yard.destinationId) {
          const settings = await client.query(
            "SELECT fleet_commercial_settings FROM vendors WHERE id=$1",
            [actor.companyId],
          );
          const directory = FleetCommercialSettingsSchema.parse(
            settings.rows[0]?.fleet_commercial_settings ?? {},
          );
          if (
            !directory.destinations.some(
              (d) =>
                d.id === input.yard.destinationId &&
                d.ownerType === "vendor" &&
                d.ownerId === actor.companyId &&
                d.kind === "yard" &&
                d.active,
            )
          )
            throw new FleetError("fleet.destination_not_found", 404);
        }
        const found = input.yardId
          ? await client.query(
              "SELECT * FROM fleet_yards WHERE company_id=$1 AND id=$2 FOR UPDATE",
              [actor.companyId, input.yardId],
            )
          : { rows: [] };
        if ((found.rows[0]?.version ?? 0) !== input.expectedVersion)
          throw new FleetError("fleet.version_conflict", 409);
        const saved = input.yardId
          ? await client.query(
              "UPDATE fleet_yards SET name=$3,time_zone=$4,destination_id=$5,is_home_base=$6,active=$7,version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING *",
              [
                actor.companyId,
                input.yardId,
                input.yard.name,
                input.yard.timeZone,
                input.yard.destinationId,
                input.yard.isHomeBase,
                input.yard.active,
              ],
            )
          : await client.query(
              "INSERT INTO fleet_yards(company_id,name,time_zone,destination_id,is_home_base,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                actor.companyId,
                input.yard.name,
                input.yard.timeZone,
                input.yard.destinationId,
                input.yard.isHomeBase,
                input.yard.active,
              ],
            );
        const result = yard(saved.rows[0]);
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,actor_membership_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'fleet','typed','canonical','fleet_yard','save','fleet-yard-operation',$5,$6::jsonb,$7::jsonb,'completed')",
          [
            actor.userId,
            actor.companyId,
            actor.role,
            actor.membershipRole,
            input.operationId,
            JSON.stringify({ fingerprint: hash }),
            JSON.stringify(result),
          ],
        );
        return result;
      }),
    yardOrders: (actor: FleetActor, raw: unknown = {}) =>
      tx(actor, async (state, client) => {
        permission(state, actor, [
          "admin",
          "dispatch",
          "yard",
          "driver",
          "office",
        ]);
        const { limit } = page.parse(raw);
        const broad =
          actor.fleetCapabilities?.has("admin") ||
          actor.fleetCapabilities?.has("dispatch") ||
          actor.fleetCapabilities?.has("office") ||
          (!actor.fleetCapabilities &&
            state.grants
              .find((g) => g.userId === actor.userId)
              ?.roles.some((r) => ["fleet_manager", "dispatcher"].includes(r)));
        const found = await client.query(
          "SELECT * FROM fleet_yard_orders WHERE company_id=$1 AND ($2::boolean OR requested_by_user_id=$3 OR assigned_to_user_id=$3) ORDER BY requested_at DESC,id LIMIT $4",
          [actor.companyId, !!broad, actor.userId, limit],
        );
        const orders: FleetYardOrder[] = [];
        for (const row of found.rows) {
          const value = order(row);
          try { await assertScopedYardOrder(client, state, actor, value); orders.push(value); }
          catch (error) { if (!(error instanceof FleetError)) throw error; }
        }
        return { orders };
      }),
    yardOrder: (actor: FleetActor, id: string) =>
      tx(actor, async (state, client) => {
        permission(state, actor, [
          "admin",
          "dispatch",
          "yard",
          "driver",
          "office",
        ]);
        id = FleetCanonicalIdSchema.parse(id);
        const found = await client.query(
          "SELECT * FROM fleet_yard_orders WHERE company_id=$1 AND id=$2",
          [actor.companyId, id],
        );
        if (!found.rows.length)
          throw new FleetError("fleet.yard_order_not_found", 404);
        const value = order(found.rows[0]);
        await assertScopedYardOrder(client, state, actor, value);
        const caps =
          actor.fleetCapabilities ??
          legacyFleetCapabilities(
            state.grants.find((g) => g.userId === actor.userId)?.roles ?? [],
          );
        if (
          !["admin", "dispatch", "office"].some((c) => caps.has(c as never)) &&
          value.requestedByUserId !== actor.userId &&
          value.assignedToUserId !== actor.userId
        )
          throw new FleetError("fleet.yard_order_not_found", 404);
        const events = await client.query(
          "SELECT id,operation_id,event_type,order_version,detail,occurred_at FROM fleet_yard_order_events WHERE company_id=$1 AND order_id=$2 ORDER BY occurred_at,id",
          [actor.companyId, id],
        );
        return {
          order: value,
          events: events.rows.map((row) => ({
            id: row.id,
            operationId: row.operation_id,
            type: row.event_type,
            version: row.order_version,
            detail: row.detail,
            at: iso(row.occurred_at),
          })),
        };
      }),
    yardOperationReceipt: (actor: FleetActor, rawId: string) =>
      tx(actor, async (state, client) => {
        permission(state, actor, ["admin", "dispatch", "yard", "driver", "self_dispatch", "office"]);
        const operationId = FleetCanonicalIdSchema.parse(rawId);
        const found = await client.query(
          "SELECT user_id,tool_output,target_type FROM assistant_action_audit WHERE vendor_id=$1 AND target_type IN ('fleet-yard-operation','fleet-yard-order-operation') AND target_id=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, operationId],
        );
        const record = found.rows[0];
        if (!record || record.user_id !== actor.userId)
          throw new FleetError("fleet.operation_not_found", 404);
        if (record.target_type === "fleet-yard-operation") {
          permission(state, actor, ["admin"]);
          return { operationId, result: FleetYardSchema.parse(record.tool_output) };
        }
        const result = FleetYardOrderSchema.parse(record.tool_output);
        const current = await client.query(
          "SELECT * FROM fleet_yard_orders WHERE company_id=$1 AND id=$2",
          [actor.companyId, result.id],
        );
        if (!current.rows.length) throw new FleetError("fleet.operation_not_found", 404);
        const value = order(current.rows[0]);
        await assertScopedYardOrder(client, state, actor, value);
        const caps = capabilities(state, actor);
        if (!["admin", "dispatch", "office"].some((cap) => caps.has(cap as never)) &&
          value.requestedByUserId !== actor.userId && value.assignedToUserId !== actor.userId)
          throw new FleetError("fleet.operation_not_found", 404);
        return { operationId, result };
      }),
    createYardOrder: (actor: FleetActor, raw: unknown) =>
      tx(actor, async (state, client) => {
        const input = FleetYardOrderInputSchema.parse(raw);
        scope(actor, input.scope);
        const grant = permission(state, actor, ["admin", "dispatch", "self_dispatch"], true);
        const value = input.order;
        if (
          value.companyId !== actor.companyId ||
          value.requestedByUserId !== actor.userId
        )
          throw new FleetError("fleet.company_required", 403);
        if (
          input.expectedVersion !== 0 ||
          value.version !== 1 ||
          value.status !== "requested" ||
          value.assignedToUserId !== null
        )
          throw new FleetError("fleet.version_conflict", 409);
        const ownSelfDispatch = capabilities(state, actor).has("driver") && capabilities(state, actor).has("self_dispatch") &&
          !!value.runId && state.runs.some((run) => run.id === value.runId && run.driverUserId === actor.userId &&
            ["draft", "dispatched", "acknowledged", "in_progress", "submitted_for_review"].includes(run.status));
        if (!capabilities(state, actor).has("admin") && !capabilities(state, actor).has("dispatch") && !ownSelfDispatch)
          throw new FleetError("fleet.permission_denied", 403);
        const hash = fingerprint(input);
        const replay = await client.query(
          "SELECT actor_user_id,detail FROM fleet_yard_order_events WHERE operation_id=$1",
          [input.operationId],
        );
        if (replay.rows.length) {
          if (
            replay.rows[0].actor_user_id !== actor.userId ||
            replay.rows[0].detail?.fingerprint !== hash
          )
            throw new FleetError("fleet.operation_conflict", 409);
          const receipt = await auditReplay(
            client,
            actor,
            input.operationId,
            hash,
            "fleet-yard-order-operation",
          );
          if (!receipt) throw new FleetError("fleet.operation_conflict", 409);
          const previous = FleetYardOrderSchema.parse(receipt);
          await assertScopedYardOrder(client, state, actor, previous);
          return previous;
        }
        await assertYard(client, actor.companyId, value.yardId);
        requireAssetScope(state, grant, value.requestedAssetIds);
        const targetIds = [...value.requestedAssetIds];
        let detailFleetIds: string[] | null = null;
        if (value.detailId) {
          const run = value.runId ? state.runs.find((row) => row.id === value.runId) : null;
          const runSnapshot = run?.resourceAssignment?.snapshot ?? run?.recoveredWork?.snapshot;
          const snapshot = runSnapshot?.detail.id === value.detailId ? runSnapshot : null;
          const registry = snapshot ? null : await readFleetResourceRegistry(client, actor.companyId);
          const detail = snapshot?.detail ?? registry?.details.find((d) => d.id === value.detailId && !d.archivedAt);
          if (!detail) throw new FleetError("fleet.detail_not_found", 404);
          detailFleetIds = detail.accessGroupIds;
          const rig = snapshot?.rigPackage ?? registry?.rigPackages.find((r) => r.id === detail.rigPackageId && r.version === detail.rigPackageVersion);
          if (detail.rigPackageId && !rig) throw new FleetError("fleet.rig_package_not_found", 404);
          targetIds.push(detail.vehicleAssetId, ...(rig?.components.map((part) => part.assetId) ?? []));
        }
        if (value.runId) {
          const run = state.runs.find((r) => r.id === value.runId);
          if (!run) throw new FleetError("fleet.run_not_found", 404);
          if (ownSelfDispatch && run.driverUserId !== actor.userId) throw new FleetError("fleet.permission_denied", 403);
          targetIds.push(...fleetRunAssetIds(run));
        }
        const targeted = FleetYardOrderSchema.parse({ ...value, requestedAssetIds: [...new Set(targetIds)] });
        if (detailFleetIds && !yardTargetFleets(state, targeted, detailFleetIds).some((id) =>
          detailFleetIds!.includes(id) && (capabilities(state, actor).has("admin") || grant.fleetIds.includes(id))))
          throw new FleetError("fleet.detail_not_found", 404);
        assertYardOrderScope(state, actor, targeted, false, detailFleetIds);
        await requireOrderCompanySites(client, state, actor, targeted, false);
        if (targeted.requestedAssetIds.length)
          await readFleetResourceAssets(
            client,
            actor,
            state,
            targeted.requestedAssetIds,
          );
        const saved = await client.query(
          "INSERT INTO fleet_yard_orders(id,company_id,yard_id,detail_id,run_id,status,outcome,requested_by_user_id,assigned_to_user_id,requested_at,scheduled_at,started_at,reported_at,requested_asset_ids,actual_asset_ids,findings,notes,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid[],$15::uuid[],$16::jsonb,$17,$18) RETURNING *",
          [
            value.id,
            actor.companyId,
            value.yardId,
            value.detailId,
            value.runId,
            value.status,
            value.outcome,
            value.requestedByUserId,
            null,
            value.requestedAt,
            value.scheduledAt,
            value.startedAt,
            value.reportedAt,
            targeted.requestedAssetIds,
            value.actualAssetIds,
            JSON.stringify(value.findings),
            value.notes,
            value.version,
          ],
        );
        const result = order(saved.rows[0]);
        await client.query(
          "INSERT INTO fleet_yard_order_events(company_id,order_id,operation_id,actor_user_id,event_type,order_version,detail) VALUES($1,$2,$3,$4,'requested',1,$5::jsonb)",
          [
            actor.companyId,
            value.id,
            input.operationId,
            actor.userId,
            JSON.stringify({ fingerprint: hash, status: result.status, detailAccessGroupIds: detailFleetIds }),
          ],
        );
        await saveOrderReceipt(client, actor, input.operationId, hash, result);
        return result;
      }),
    actOnYardOrder: async (actor: FleetActor, id: string, raw: unknown) => {
      const input = FleetYardOrderActionSchema.parse(raw);
      const result = await tx(actor, async (state, client) => {
        id = FleetCanonicalIdSchema.parse(id);
        scope(actor, input.scope);
        if (input.orderId !== id)
          throw new FleetError("fleet.invalid_request", 400);
        permission(
          state,
          actor,
          input.kind === "assign"
            ? ["admin", "dispatch", "self_dispatch"]
            : ["admin", "dispatch", "yard", "self_dispatch"],
          true,
        );
        const hash = fingerprint(input);
        const found = await client.query(
          "SELECT * FROM fleet_yard_orders WHERE company_id=$1 AND id=$2 FOR UPDATE",
          [actor.companyId, id],
        );
        if (!found.rows.length)
          throw new FleetError("fleet.yard_order_not_found", 404);
        const prior = order(found.rows[0]);
        const targetFleets = await assertScopedYardOrder(client, state, actor, prior);
        const caps = capabilities(state, actor);
        const ownSelfDispatch = caps.has("driver") && caps.has("self_dispatch") &&
          !!prior.runId && state.runs.some((run) => run.id === prior.runId && run.driverUserId === actor.userId &&
            ["draft", "dispatched", "acknowledged", "in_progress", "submitted_for_review"].includes(run.status));
        if (!caps.has("admin") && !caps.has("dispatch") && !caps.has("yard") && !ownSelfDispatch)
          throw new FleetError("fleet.permission_denied", 403);
        if (input.kind === "assign" && !caps.has("admin") && !caps.has("dispatch") &&
          (!ownSelfDispatch || input.assignedToUserId !== actor.userId))
          throw new FleetError("fleet.permission_denied", 403);
        if (input.kind === "assign") {
          if (!ownSelfDispatch || input.assignedToUserId !== actor.userId) await assertYardAssignee(
            client,
            state,
            actor.companyId,
            input.assignedToUserId,
          );
          if (!targetFleets.some((fleetId) => state.grants.some((g) =>
            g.userId === input.assignedToUserId && g.fleetIds.includes(fleetId) &&
            (!prior.runId || state.runs.find((run) => run.id === prior.runId)?.siteIds.every((siteId) =>
              g.siteIds.includes(siteId) || (ownSelfDispatch && input.assignedToUserId === actor.userId))))))
            throw new FleetError("fleet.permission_denied", 403);
        } else if (prior.assignedToUserId !== actor.userId) {
          if (!caps.has("admin") && !caps.has("dispatch"))
            throw new FleetError("fleet.permission_denied", 403);
        }
        const replay = await client.query(
          "SELECT actor_user_id,detail FROM fleet_yard_order_events WHERE operation_id=$1",
          [input.operationId],
        );
        if (replay.rows.length) {
          if (replay.rows[0].actor_user_id !== actor.userId || replay.rows[0].detail?.fingerprint !== hash)
            throw new FleetError("fleet.operation_conflict", 409);
          const receipt = await auditReplay(client, actor, input.operationId, hash, "fleet-yard-order-operation");
          if (!receipt) throw new FleetError("fleet.operation_conflict", 409);
          const previous = FleetYardOrderSchema.parse(receipt);
          await assertScopedYardOrder(client, state, actor, previous);
          return previous;
        }
        const next = transitionYardOrder(prior, input, new Date());
        if (input.kind === "report") {
          const grant = state.grants.find((g) => g.userId === actor.userId)!;
          requireAssetScope(state, grant, next.actualAssetIds);
          await assertScopedYardOrder(client, state, actor, next, false);
          if (next.actualAssetIds.length)
            await readFleetResourceAssets(
              client,
              actor,
              state,
              next.actualAssetIds,
            );
        }
        if (input.kind === "assign") {
          await client.query(
            "UPDATE fleet_yard_order_assignments SET ended_at=now() WHERE company_id=$1 AND order_id=$2 AND ended_at IS NULL",
            [actor.companyId, id],
          );
          await client.query(
            "INSERT INTO fleet_yard_order_assignments(company_id,order_id,assigned_to_user_id,assigned_by_user_id) VALUES($1,$2,$3,$4)",
            [actor.companyId, id, input.assignedToUserId, actor.userId],
          );
        }
        const saved = await client.query(
          "UPDATE fleet_yard_orders SET status=$3,outcome=$4,assigned_to_user_id=$5,started_at=$6,reported_at=$7,actual_asset_ids=$8::uuid[],findings=$9::jsonb,notes=$10,version=$11,updated_at=now() WHERE company_id=$1 AND id=$2 AND version=$12 RETURNING *",
          [
            actor.companyId,
            id,
            next.status,
            next.outcome,
            next.assignedToUserId,
            next.startedAt,
            next.reportedAt,
            next.actualAssetIds,
            JSON.stringify(next.findings),
            next.notes,
            next.version,
            prior.version,
          ],
        );
        if (!saved.rows.length)
          throw new FleetError("fleet.version_conflict", 409);
        const result = order(saved.rows[0]);
        await client.query(
          "INSERT INTO fleet_yard_order_events(company_id,order_id,operation_id,actor_user_id,event_type,order_version,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [
            actor.companyId,
            id,
            input.operationId,
            actor.userId,
            input.kind,
            result.version,
            JSON.stringify({
              fingerprint: hash,
              status: result.status,
              outcome: result.outcome,
              assignedToUserId: result.assignedToUserId,
              actualAssetIds: result.actualAssetIds,
              findingCount: result.findings.length,
            }),
          ],
        );
        await saveOrderReceipt(client, actor, input.operationId, hash, result);
        return result;
      });
      const recipients =
        input.kind === "assign"
          ? [input.assignedToUserId]
          : input.kind === "report"
            ? [result.requestedByUserId]
            : [];
      const otherRecipients = recipients.filter(
        (userId) => userId !== actor.userId,
      );
      if (otherRecipients.length) {
        try {
          await notifyUsers(otherRecipients, {
            type: "fleet_yard_order",
            category: "system",
            title:
              input.kind === "assign"
                ? "Yard Order assigned"
                : "Yard Order reported",
            body:
              input.kind === "report"
                ? `Outcome: ${result.outcome}`
                : "A Yard Order is ready for you.",
            link: `/fleet/yard-orders/${result.id}`,
            dedupeKey: `fleet-yard:${input.operationId}`,
          });
        } catch {
          /* The committed operation remains recoverable from its canonical event. */
        }
      }
      return result;
    },
    custody: (actor: FleetActor, raw: unknown = {}) =>
      tx(actor, async (state, client) => {
        const grant = permission(state, actor, [
          "admin",
          "dispatch",
          "yard",
          "driver",
          "office",
        ]);
        const { limit, assetId } = page.extend({ assetId: FleetCanonicalIdSchema.optional() }).parse(raw);
        const caps =
          actor.fleetCapabilities ?? legacyFleetCapabilities(grant.roles);
        const driverOnly = caps.has("driver") && !["admin", "dispatch", "yard", "office"].some((c) => caps.has(c as never));
        const currentSiteIds = driverOnly ? await currentAssignedDriverSites(client, state, actor) : [];
        const candidateIds = state.fleets
          .filter((f) => grant.fleetIds.includes(f.id))
          .flatMap((f) => f.equipmentAssetIds)
          .filter(
            (assetId) =>
              !caps.has("driver") ||
              ["admin", "dispatch", "yard", "office"].some((c) =>
                caps.has(c as never),
              ) ||
              state.runs.some((run) => !!activeDriverRunForAsset(state, actor.userId, run.id, assetId, currentSiteIds)),
          );
        const holderRows = driverOnly && candidateIds.length ? await client.query(
          "SELECT id,current_holder_user_id FROM assets WHERE id=ANY($1::uuid[]) AND responsible_org_type='vendor' AND responsible_org_id=$2",
          [candidateIds, actor.companyId],
        ) : { rows: [] };
        const allowed = driverOnly ? candidateIds.filter((id) => holderRows.rows.some((row) =>
          row.id === id && (row.current_holder_user_id === null || row.current_holder_user_id === actor.userId))) : candidateIds;
        if (assetId && !allowed.includes(assetId)) throw new FleetError("fleet.asset_not_found", 404);
        const selectedIds = assetId ? [assetId] : allowed;
        const found = await client.query(
          "SELECT c.* FROM fleet_asset_custody c WHERE c.company_id=$1 AND c.asset_id=ANY($2::uuid[]) ORDER BY c.updated_at DESC,c.id LIMIT $3",
          [actor.companyId, selectedIds, limit],
        );
        const observations = found.rows.map(custody);
        // The attachment is fixed by its custody event, never by today's editable Detail.
        const attached = observations.filter((row) => row.observation.state === "attached");
        const attachmentRows = attached.length ? await client.query(
          "SELECT e.asset_id,e.asset_version,a.tool_output FROM fleet_asset_custody_events e JOIN assistant_action_audit a ON a.vendor_id=e.company_id AND a.target_type='fleet-custody-operation' AND a.target_id=e.operation_id::text WHERE e.company_id=$1 AND e.asset_id=ANY($2::uuid[]) ORDER BY e.asset_version DESC",
          [actor.companyId, attached.map((row) => row.observation.assetId)],
        ) : { rows: [] };
        const links = attachmentRows.rows.flatMap((event) => {
          const current = attached.find((row) => row.observation.assetId === event.asset_id && row.version === event.asset_version);
          const link = event.tool_output?.attachment;
          return current && link?.componentAssetId === current.observation.assetId &&
            link?.detailId === current.observation.detailId && typeof link?.truckAssetId === "string"
            ? [{ truckAssetId: link.truckAssetId as string, componentAssetId: link.componentAssetId as string, detailId: link.detailId as string }]
            : [];
        });
        const missingTruckIds = [
          ...new Set(
            links
              .filter((link) =>
                observations.some(
                  (row) =>
                    row.observation.assetId === link.componentAssetId &&
                    row.observation.state === "attached" &&
                    row.observation.detailId === link.detailId,
                ),
              )
              .map((link) => link.truckAssetId),
          ),
        ].filter(
          (id) =>
            allowed.includes(id) &&
            !observations.some((row) => row.observation.assetId === id),
        );
        const linkedTrucks = missingTruckIds.length
          ? (
              await client.query(
                "SELECT * FROM fleet_asset_custody WHERE company_id=$1 AND asset_id=ANY($2::uuid[])",
                [actor.companyId, missingTruckIds],
              )
            ).rows.map(custody)
          : [];
        const locations = resolveAttachedCustody(
          [...observations, ...linkedTrucks].map(
            ({ observation }) => observation,
          ),
          links,
        );
        return {
          custody: observations.map((row, index) => ({
            ...row,
            location: locations[index],
          })),
        };
      }),
    custodyOperationReceipt: (actor: FleetActor, rawId: string) =>
      tx(actor, async (state, client) => {
        const grant = permission(state, actor, ["admin", "dispatch", "yard", "driver", "office"]);
        const operationId = FleetCanonicalIdSchema.parse(rawId);
        const found = await client.query(
          "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-custody-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, operationId],
        );
        const record = found.rows[0];
        if (!record || record.user_id !== actor.userId)
          throw new FleetError("fleet.operation_not_found", 404);
        const result = record.tool_output;
        const observation = FleetCustodyObservationSchema.parse(result.observation);
        requireAssetScope(state, grant, [observation.assetId]);
        const caps = capabilities(state, actor);
        const driverOnly = usesAssignedDriverCustodyAuthority(caps);
        const currentSiteIds = driverOnly ? await currentAssignedDriverSites(client, state, actor) : [];
        if (driverOnly && !caps.has("office")) {
          const [asset] = await readFleetResourceAssets(client, actor, state, [observation.assetId], true);
          if (!activeDriverRunForAsset(state, actor.userId, observation.runId, observation.assetId, currentSiteIds) ||
            (asset.current_holder_user_id !== null && asset.current_holder_user_id !== actor.userId))
            throw new FleetError("fleet.permission_denied", 403);
        }
        await assertRetainedAttachmentAuthority(client, state, actor, grant, result, currentSiteIds);
        return { operationId, result };
      }),
    observeCustody: (actor: FleetActor, raw: unknown) =>
      tx(actor, async (state, client) => {
        const input = FleetCustodyObservationInputSchema.parse(raw);
        scope(actor, input.scope);
        const value = input.observation;
        const grant = permission(
          state,
          actor,
          ["yard", "driver"],
          true,
        );
        if (
          value.companyId !== actor.companyId ||
          value.observedByUserId !== actor.userId
        )
          throw new FleetError("fleet.company_required", 403);
        requireAssetScope(state, grant, [value.assetId]);
        const hash = fingerprint(input);
        await assertYard(client, actor.companyId, value.yardId);
        if (
          value.method === "gps_geofence" &&
          (value.latitude === null || value.longitude === null)
        )
          throw new FleetError("fleet.coordinates_required", 400);
        const [asset] = await readFleetResourceAssets(client, actor, state, [value.assetId]);
        const caps = capabilities(state, actor);
        const driverOnly = usesAssignedDriverCustodyAuthority(caps);
        const currentSiteIds = driverOnly ? await currentAssignedDriverSites(client, state, actor) : [];
        if (driverOnly &&
          (value.method !== "driver_app" || !activeDriverRunForAsset(state, actor.userId, value.runId, value.assetId, currentSiteIds) ||
            (asset.current_holder_user_id !== null && asset.current_holder_user_id !== actor.userId)))
          throw new FleetError("fleet.permission_denied", 403);
        if (value.runId && !state.runs.some((r) => r.id === value.runId))
          throw new FleetError("fleet.run_not_found", 404);
        const replay = await client.query("SELECT id FROM fleet_asset_custody_events WHERE operation_id=$1", [input.operationId]);
        if (replay.rows.length) {
          const prior = await client.query(
            "SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-custody-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",
            [actor.companyId, input.operationId],
          );
          if (!prior.rows.length || prior.rows[0].user_id !== actor.userId || prior.rows[0].tool_input?.fingerprint !== hash)
            throw new FleetError("fleet.operation_conflict", 409);
          await assertRetainedAttachmentAuthority(client, state, actor, grant, prior.rows[0].tool_output, currentSiteIds);
          return prior.rows[0].tool_output;
        }
        let attachment: { truckAssetId: string; componentAssetId: string; detailId: string; detailVersion: number; rigPackageId: string; rigPackageVersion: number; detailAccessGroupIds: string[] } | null = null;
        if (value.state === "attached") {
          const registry = await readFleetResourceRegistry(
            client,
            actor.companyId,
          );
          const run = value.runId ? state.runs.find((row) => row.id === value.runId) : null;
          const runSnapshot = run?.resourceAssignment?.snapshot ?? run?.recoveredWork?.snapshot;
          if (runSnapshot && runSnapshot.detail.id !== value.detailId)
            throw new FleetError("fleet.detail_attachment_required", 409);
          const detail = runSnapshot?.detail.id === value.detailId
            ? runSnapshot.detail
            : registry.details.find((row) => row.id === value.detailId && !row.archivedAt);
          const rig = runSnapshot?.detail.id === value.detailId
            ? runSnapshot.rigPackage
            : registry.rigPackages.find((row) => row.id === detail?.rigPackageId && row.version === detail?.rigPackageVersion && !row.archivedAt);
          if (!detail || !rig || !rig.components.some((part) => part.assetId === value.assetId))
            throw new FleetError("fleet.detail_attachment_required", 409);
          const targetFleets = state.fleets.filter((fleet) =>
            detail.accessGroupIds.includes(fleet.id) &&
            fleet.equipmentAssetIds.includes(value.assetId) &&
            fleet.equipmentAssetIds.includes(detail.vehicleAssetId) &&
            (caps.has("admin") || grant.fleetIds.includes(fleet.id)));
          if (!targetFleets.length || (run && (!targetFleets.some((fleet) => fleet.id === run.fleetId) ||
            run.vehicleAssetId !== detail.vehicleAssetId || !fleetRunAssetIds(run).includes(value.assetId))))
            throw new FleetError("fleet.detail_attachment_required", 409);
          const [truck] = await readFleetResourceAssets(client, actor, state, [detail.vehicleAssetId]);
          const truckHolder = truck.current_holder_user_id;
          if ((driverOnly && (!activeDriverRunForAsset(state, actor.userId, value.runId, detail.vehicleAssetId, currentSiteIds) ||
            (truckHolder !== null && truckHolder !== actor.userId))) ||
            (!driverOnly && truckHolder !== null && truckHolder !== actor.userId && truckHolder !== run?.driverUserId))
            throw new FleetError("fleet.detail_attachment_required", 409);
          const truckCustody = await client.query(
            "SELECT run_id,state FROM fleet_asset_custody WHERE company_id=$1 AND asset_id=$2 FOR UPDATE",
            [actor.companyId, detail.vehicleAssetId],
          );
          if (truckCustody.rows.some((row) => (row.run_id && row.run_id !== value.runId) ||
            (!run && row.state === "in_transit")))
            throw new FleetError("fleet.detail_attachment_required", 409);
          attachment = { truckAssetId: detail.vehicleAssetId, componentAssetId: value.assetId,
            detailId: detail.id, detailVersion: detail.version, rigPackageId: rig.id, rigPackageVersion: rig.version,
            detailAccessGroupIds: detail.accessGroupIds };
        }
        const prior = await client.query(
          "SELECT * FROM fleet_asset_custody WHERE company_id=$1 AND asset_id=$2 FOR UPDATE",
          [actor.companyId, value.assetId],
        );
        if ((prior.rows[0]?.version ?? 0) !== input.expectedVersion)
          throw new FleetError("fleet.version_conflict", 409);
        const id = prior.rows[0]?.id ?? randomUUID();
        const saved = prior.rows.length
          ? await client.query(
              "UPDATE fleet_asset_custody SET state=$3,method=$4,observed_at=$5,observed_by_user_id=$6,yard_id=$7,run_id=$8,detail_id=$9,latitude=$10,longitude=$11,notes=$12,version=version+1,updated_at=now() WHERE company_id=$1 AND asset_id=$2 RETURNING *",
              [
                actor.companyId,
                value.assetId,
                value.state,
                value.method,
                value.observedAt,
                actor.userId,
                value.yardId,
                value.runId,
                value.detailId,
                value.latitude,
                value.longitude,
                value.notes,
              ],
            )
          : await client.query(
              "INSERT INTO fleet_asset_custody(id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,run_id,detail_id,latitude,longitude,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
              [
                id,
                actor.companyId,
                value.assetId,
                value.state,
                value.method,
                value.observedAt,
                actor.userId,
                value.yardId,
                value.runId,
                value.detailId,
                value.latitude,
                value.longitude,
                value.notes,
              ],
            );
        const result = custody(saved.rows[0]);
        await client.query(
          "INSERT INTO fleet_asset_custody_events(operation_id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,run_id,detail_id,latitude,longitude,notes,asset_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [
            input.operationId,
            actor.companyId,
            value.assetId,
            value.state,
            value.method,
            value.observedAt,
            actor.userId,
            value.yardId,
            value.runId,
            value.detailId,
            value.latitude,
            value.longitude,
            value.notes,
            result.version,
          ],
        );
        const receipt = {
          operationId: input.operationId,
          version: result.version,
          observation: result.observation,
          attachment,
        };
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,actor_membership_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'fleet','typed','canonical','fleet_custody','observe','fleet-custody-operation',$5,$6::jsonb,$7::jsonb,'completed')",
          [
            actor.userId,
            actor.companyId,
            actor.role,
            actor.membershipRole,
            input.operationId,
            JSON.stringify({ fingerprint: hash }),
            JSON.stringify(receipt),
          ],
        );
        return receipt;
      }),
    suggestYardResources: (actor: FleetActor, raw: unknown) =>
      tx(actor, async (state, client) => {
        const grant = permission(state, actor, ["admin", "dispatch", "yard"]);
        const input = recommendation.parse(raw);
        if (Date.parse(input.window.endAt) <= Date.parse(input.window.startAt))
          throw new FleetError("fleet.invalid_window", 400);
        await assertYard(client, actor.companyId, input.yardId);
        const allowed = state.fleets
          .filter((f) => grant.fleetIds.includes(f.id))
          .flatMap((f) => f.equipmentAssetIds);
        const registry = await readFleetResourceRegistry(
          client,
          actor.companyId,
        );
        const rig = input.rigPackageId
          ? registry.rigPackages.find(
              (r) =>
                r.id === input.rigPackageId &&
                r.companyId === actor.companyId &&
                !r.archivedAt,
            )
          : null;
        if (input.rigPackageId && !rig)
          throw new FleetError("fleet.rig_package_not_found", 404);
        const requestedAssetIds = [
          input.vehicleAssetId,
          ...(rig?.components.map((c) => c.assetId) ?? []),
        ].filter((id): id is string => !!id);
        requireAssetScope(state, grant, requestedAssetIds);
        const found = await client.query(
          "SELECT a.id AS asset_id,c.yard_id FROM assets a LEFT JOIN fleet_asset_custody c ON c.asset_id=a.id AND c.company_id=$1 WHERE a.id=ANY($2::uuid[]) AND a.responsible_org_type='vendor' AND a.responsible_org_id=$1 ORDER BY a.id",
          [actor.companyId, allowed],
        );
        const reservations = registry.reservations
          .filter((r) => ["reserved", "active"].includes(r.state))
          .map((r) => ({
            assetIds: r.assetIds,
            startAt: r.startAt,
            endAt: r.plannedEndAt,
          }));
        const candidates = suggestYardResources({
          ...input,
          candidates: found.rows.map((row) => ({
            assetId: row.asset_id,
            yardId: row.yard_id,
            kind: "asset",
          })),
          reservations,
        });
        return {
          requestedAssetIds,
          candidates: candidates.sort(
            (a, b) =>
              Number(requestedAssetIds.includes(b.assetId)) -
              Number(requestedAssetIds.includes(a.assetId)),
          ),
        };
      }),
  };
}
