import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  FleetAssetCreateSchema, FleetAssetEditSchema, FleetAssetEnrollmentSchema,
  FleetInventorySchema, FleetInventoryDetailSchema, FleetInventoryReceiptSchema, FleetRunSchema,
  type FleetInventoryAsset, type FleetRun,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import { authorizeAssetHoldRelease } from "./asset-hold-release";
import { AssetServiceError } from "./assets";
import type { SessionPayload } from "../lib/session";

type Transaction = <T>(a: FleetActor, work: (s: FleetState, c: PoolClient) => Promise<T>) => Promise<T>;
type Access = (s: FleetState, a: FleetActor) => { fleetIds: readonly string[]; roles: readonly string[] } | null;
type ViewRun = (s: FleetState, a: FleetActor, r: FleetRun, action: "view") => boolean;
const vehicleCategories = ["vehicle", "truck", "trailer"];
const columns = `SELECT a.*, EXISTS(SELECT 1 FROM asset_holds h WHERE h.asset_id=a.id AND h.released_at IS NULL) AS held,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',x.kind,'value',x.display_value,'jurisdiction',NULLIF(x.jurisdiction,''))) FROM asset_aliases x WHERE x.asset_id=a.id AND x.active=true),'[]'::jsonb) AS aliases FROM assets a`;
function assetProjection(row: Record<string, any>, fleets: FleetState["fleets"]): FleetInventoryAsset {
  return {
    id: row.id, name: row.name, category: row.category, status: row.status, version: row.version,
    manufacturer: row.manufacturer ?? "", model: row.model ?? "", legalOwner: row.legal_owner_name,
    held: Boolean(row.held), currentHolderUserId: row.current_holder_user_id ?? null,
    aliases: (row.aliases ?? []).map((x: Record<string, string | null>) => ({ kind: x.kind, value: x.value, ...(x.jurisdiction ? { jurisdiction: x.jurisdiction } : {}) })),
    fleetIds: fleets.filter(f => f.equipmentAssetIds.includes(row.id)).map(f => f.id),
  } as FleetInventoryAsset;
}
async function inventoryAuthority(c: PoolClient, a: FleetActor) {
  await authorizeAssetHoldRelease(c, {
    userId: a.userId, vendorId: a.companyId, role: a.role, membershipRole: a.membershipRole,
    activeMembershipId: a.activeMembershipId, sv: a.sv,
  } as SessionPayload, { id: "", responsible_org_type: "vendor", responsible_org_id: a.companyId, version: 0, status: "available", current_holder_user_id: null });
}
export function createFleetInventoryOperations(transaction: Transaction, access: Access, viewRun: ViewRun) {
  function scope(s: FleetState, a: FleetActor) {
    const grant = access(s, a) ?? (s.enabled && a.role === "vendor" && a.membershipRole === "admin" ? { fleetIds: s.fleets.map(f => f.id), roles: ["fleet_manager"] } : null);
    if (!grant) throw new FleetError("fleet.inventory_required", 403);
    return { grant, fleets: s.fleets.filter(f => grant.fleetIds.includes(f.id)) };
  }
  async function managing(s: FleetState, c: PoolClient, a: FleetActor) {
    const current = scope(s, a);
    if (!current.grant.roles.includes("fleet_manager")) throw new FleetError("fleet.inventory_manage_required", 403);
    try { await inventoryAuthority(c, a); }
    catch (e) { if (e instanceof AssetServiceError) throw new FleetError(e.code, e.status); throw e; }
    return current;
  }
  async function canManage(s: FleetState, c: PoolClient, a: FleetActor) {
    try { await managing(s, c, a); return true; }
    catch (e) { if (e instanceof FleetError && e.status === 403) return false; throw e; }
  }
  function visibleAssetIds(s: FleetState, a: FleetActor, fleets: FleetState["fleets"], roles: readonly string[]) {
    if (roles.some(role => ["fleet_manager", "dispatcher"].includes(role)))
      return [...new Set(fleets.flatMap(f => f.equipmentAssetIds))];
    const assigned = s.runs.filter(run => run.driverUserId === a.userId && !["completed", "cancelled"].includes(run.status) && viewRun(s, a, run, "view"));
    return [...new Set(assigned.flatMap(run => [run.vehicleAssetId, run.trailerAssetId].filter((id): id is string => Boolean(id))))]
      .filter(id => fleets.some(f => f.equipmentAssetIds.includes(id)));
  }
  async function currentAsset(c: PoolClient, a: FleetActor, id: string) {
    const result = await c.query(`${columns} WHERE a.id=$1 AND a.responsible_org_type='vendor' AND a.responsible_org_id=$2 FOR UPDATE OF a`, [id, a.companyId]);
    const row = result.rows[0];
    if (!row || row.responsible_org_type !== "vendor" || row.responsible_org_id !== a.companyId) throw new FleetError("fleet.asset_not_found", 404);
    return row;
  }
  function addable(row: Record<string, any>) {
    if (!vehicleCategories.includes(row.category)) throw new FleetError("fleet.asset_type_required", 400);
    if (row.provisional || row.retired_at || row.merged_into_id || ["retired", "merged"].includes(row.status)) throw new FleetError("fleet.asset_read_only");
  }
  async function mutate(a: FleetActor, action: string, id: string | null, body: { operationId: string; expectedFleetVersion?: number; fleetId?: string; expectedVersion?: number }, change: (s: FleetState, c: PoolClient) => Promise<{ assetId: string; version: number }>) {
    return transaction(a, async (s, c) => {
      await managing(s, c, a);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["fleet-inventory:" + body.operationId]);
      const hash = createHash("sha256").update(JSON.stringify([action, id, a.userId, a.companyId, body])).digest("hex");
      const prior = await c.query("SELECT user_id,tool_input,tool_output,vendor_id FROM assistant_action_audit WHERE target_type='fleet-inventory-operation' AND target_id=$1 ORDER BY id DESC LIMIT 1", [body.operationId]);
      if (prior.rows.length) {
        const row = prior.rows[0], receipt = FleetInventoryReceiptSchema.parse(row.tool_output);
        if (row.user_id !== a.userId || row.vendor_id !== a.companyId || receipt.fingerprint !== hash) throw new FleetError("fleet.operation_conflict");
        // A saved response cannot outlive current company Inventory authority.
        await currentAsset(c, a, receipt.assetId);
        return receipt;
      }
      const result = await change(s, c);
      const receipt = FleetInventoryReceiptSchema.parse({ ...result, operationId: body.operationId, fleetVersion: s.version, fingerprint: hash });
      await c.query("INSERT INTO assistant_action_audit(user_id,vendor_id,target_id,tool_input,tool_output,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,result_status) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,'fleet','typed','canonical','fleet_inventory',$7,'fleet-inventory-operation','completed')", [a.userId, a.companyId, body.operationId, JSON.stringify({ action, assetId: result.assetId }), JSON.stringify(receipt), a.role, action]);
      return receipt;
    }).catch(e => { if ((e as { code?: string }).code === "23505") throw new FleetError("fleet.identifier_in_use"); throw e; });
  }
  async function event(c: PoolClient, a: FleetActor, assetId: string, operationId: string, version: number, type: string, note: string) {
    await c.query("INSERT INTO asset_custody_events(id,asset_id,event_type,actor_user_id,operation_id,asset_version,note) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), assetId, type, a.userId, operationId, version, note]);
  }
  return {
    fleetInventoryReceipt: (a: FleetActor, operationId: string) => transaction(a, async (s, c) => {
      z.uuid().parse(operationId);
      await managing(s, c, a);
      const result = await c.query("SELECT user_id,tool_input,tool_output,vendor_id FROM assistant_action_audit WHERE target_type='fleet-inventory-operation' AND target_id=$1 ORDER BY id DESC LIMIT 1", [operationId]);
      const row = result.rows[0];
      if (!row || row.user_id !== a.userId || row.vendor_id !== a.companyId) throw new FleetError("fleet.operation_not_found", 404);
      const receipt = FleetInventoryReceiptSchema.parse(row.tool_output);
      await currentAsset(c, a, receipt.assetId);
      return receipt;
    }),
    fleetInventory: (a: FleetActor, raw: unknown = {}) => transaction(a, async (s, c) => {
      const input = z.object({ after: z.uuid().optional(), fleetId: z.uuid().optional() }).parse(raw);
      const { fleets, grant } = scope(s, a);
      if (input.fleetId && !fleets.some(f => f.id === input.fleetId)) throw new FleetError("fleet.inventory_required", 403);
      const ids = visibleAssetIds(s, a, fleets.filter(f => !input.fleetId || f.id === input.fleetId), grant.roles);
      const companyInventoryManager = await canManage(s, c, a);
      const result = await c.query(`${columns} WHERE a.responsible_org_type='vendor' AND a.responsible_org_id=$2 AND (a.id=ANY($4::uuid[]) OR EXISTS(SELECT 1 FROM asset_attachment_links l WHERE l.asset_id=a.id AND l.attachment_type='fleet_inventory')) AND ($5::boolean OR a.id=ANY($1::uuid[])) AND ($6::boolean OR a.id=ANY($1::uuid[])) AND ($3::uuid IS NULL OR a.id>$3::uuid) AND a.merged_into_id IS NULL ORDER BY a.id LIMIT 51`, [ids, a.companyId, input.after ?? null, [...new Set(s.fleets.flatMap(f => f.equipmentAssetIds))], companyInventoryManager, !input.fleetId]);
      return FleetInventorySchema.parse({ canManage: companyInventoryManager, version: s.version, fleets: fleets.map(f => ({ id: f.id, name: f.name })), assets: result.rows.slice(0, 50).map(row => assetProjection(row, fleets)), nextCursor: result.rows.length > 50 ? result.rows[49].id : null });
    }),
    fleetInventoryDetail: (a: FleetActor, id: string) => transaction(a, async (s, c) => {
      const { fleets, grant } = scope(s, a);
      const companyInventoryManager = await canManage(s, c, a);
      const row = await currentAsset(c, a, id);
      const included = await c.query("SELECT asset_id FROM asset_attachment_links WHERE asset_id=$1 AND attachment_type='fleet_inventory' LIMIT 1", [id]);
      const inPool = included.rows.length > 0 || s.fleets.some(f => f.equipmentAssetIds.includes(id));
      if (!inPool || (!companyInventoryManager && !visibleAssetIds(s, a, fleets, grant.roles).includes(id))) throw new FleetError("fleet.asset_not_found", 404);
      const history = await c.query("SELECT id,event_type,note,occurred_at FROM asset_custody_events WHERE asset_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 101", [id]);
      const historical = await c.query("SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' ORDER BY target_id,id DESC) latest WHERE tool_output->>'vehicleAssetId'=$2 OR tool_output->>'trailerAssetId'=$2 ORDER BY id DESC LIMIT 101", [a.companyId, id]);
      const allRuns = new Map<string, FleetRun>();
      for (const r of [...historical.rows.map(x => FleetRunSchema.parse(x.tool_output)), ...s.runs]) if ((r.vehicleAssetId === id || r.trailerAssetId === id) && viewRun(s, a, r, "view")) allRuns.set(r.id, r);
      const maintenance = await c.query("SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-maintenance' ORDER BY target_id,id DESC) latest WHERE tool_output->>'assetId'=$2 ORDER BY id DESC LIMIT 101", [a.companyId, id]);
      return FleetInventoryDetailSchema.parse({ asset: assetProjection(row, fleets), canManage: await canManage(s, c, a), history: history.rows.slice(0, 100).map(e => ({ id: String(e.id), type: e.event_type, note: e.note ?? null, recordedAt: new Date(e.occurred_at).toISOString() })), runs: [...allRuns.values()].slice(0, 100).map(r => ({ id: r.id, title: r.title, status: r.status, ticketId: r.linkedTicketId })), maintenance: maintenance.rows.filter(x => fleets.some(f => f.id === x.tool_output.fleetId)).slice(0, 100).map(x => ({ id: x.tool_output.id, status: x.tool_output.status, notes: x.tool_output.title ?? "" })), historyLimited: history.rows.length > 100 || historical.rows.length > 100 || maintenance.rows.length > 100 || allRuns.size > 100 });
    }),
    createFleetAsset: (a: FleetActor, raw: unknown) => {
      const body = FleetAssetCreateSchema.parse(raw);
      return mutate(a, "create", null, body, async (s, c) => {
        const assetId = randomUUID();
        await c.query("INSERT INTO assets(id,name,category,legal_owner_name,responsible_org_type,responsible_org_id,manufacturer,model,created_by_user_id) VALUES($1,$2,$3,$4,'vendor',$5,$6,$7,$8)", [assetId, body.name, body.category, body.legalOwner, a.companyId, body.manufacturer || null, body.model || null, a.userId]);
        const alias = body.identifier;
        await c.query("INSERT INTO asset_aliases(asset_id,kind,jurisdiction,normalized_value,display_value) VALUES($1,$2,$3,$4,$5)", [assetId, alias.kind, alias.jurisdiction?.trim().toUpperCase() ?? "", alias.value.toUpperCase().replace(/[^A-Z0-9]/g, ""), alias.value]);
        await c.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)", [assetId, String(a.companyId), a.userId]);
        await event(c, a, assetId, body.operationId, 1, "registered", "Added to Fleet Inventory");
        return { assetId, version: 1 };
      });
    },
    enrollFleetAsset: (a: FleetActor, id: string, raw: unknown) => {
      const body = FleetAssetEnrollmentSchema.parse(raw);
      return mutate(a, "enroll", id, body, async (s, c) => {
        const row = await currentAsset(c, a, id); addable(row);
        if (row.version !== body.expectedVersion) throw new FleetError("fleet.version_conflict");
        const linked = await c.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3) ON CONFLICT DO NOTHING RETURNING id", [id, String(a.companyId), a.userId]);
        if (!linked.rows.length) return { assetId: id, version: row.version };
        await c.query("UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1", [id]);
        await event(c, a, id, body.operationId, row.version + 1, "fleet_added", "Added to Fleet Inventory");
        return { assetId: id, version: row.version + 1 };
      });
    },
    editFleetAsset: (a: FleetActor, id: string, raw: unknown) => {
      const body = FleetAssetEditSchema.parse(raw);
      return mutate(a, "edit", id, body, async (s, c) => {
        const { fleets } = scope(s, a);
        const included = await c.query("SELECT asset_id FROM asset_attachment_links WHERE asset_id=$1 AND attachment_type='fleet_inventory' LIMIT 1", [id]);
        if (!included.rows.length && !s.fleets.some(f => f.equipmentAssetIds.includes(id))) throw new FleetError("fleet.asset_not_found", 404);
        const row = await currentAsset(c, a, id); addable(row);
        if (row.version !== body.expectedVersion) throw new FleetError("fleet.version_conflict");
        await c.query("UPDATE assets SET name=$2,manufacturer=$3,model=$4,version=version+1,updated_at=now() WHERE id=$1", [id, body.name, body.manufacturer || null, body.model || null]);
        await event(c, a, id, body.operationId, row.version + 1, "details_updated", [["Name", row.name, body.name], ["Manufacturer", row.manufacturer, body.manufacturer], ["Model", row.model, body.model]].filter(([, before, after]) => (before ?? "") !== (after ?? "")).map(([label, before, after]) => `${label}: ${before || "—"} → ${after || "—"}`).join("\n") || "Asset details saved");
        return { assetId: id, version: row.version + 1 };
      });
    },
  };
}
