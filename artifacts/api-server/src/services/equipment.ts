import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "@workspace/db";
import { CreateEquipmentSchema, UpdateEquipmentSchema, EquipmentOperationSchema, type EquipmentItem, type EquipmentProfile, type EquipmentHistoryEvent, type EquipmentLocation, type EquipmentOptions } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { getObjectStore } from "../lib/objectStore";
import { AssetServiceError, createAssetService, type AssetRecord, type AssetRepository, type AssetAlias } from "./assets";
import { equipmentProfile, projectEquipmentLocation, assertEquipmentConnection, droppedEquipmentLocation, newestEquipmentLocation } from "./equipment-model";

type Row = { id: string; name: string; category: string; legal_owner_name: string; responsible_org_type: string; responsible_org_id: number; manufacturer: string | null; model: string | null; status: AssetRecord["status"]; version: number; current_holder_user_id: number | null; current_location_type: string | null; current_location_id: string | null; expected_return_at: Date | null; provisional: boolean; equipment_profile: Record<string, unknown> | null };
type Actor = { userId: number; type: "vendor" | "partner"; id: number; canManage: boolean; supervisor: boolean; canCreate: boolean };
type Database = Pick<Pool, "connect">;
export type EquipmentQueryClient = Pick<PoolClient, "query">;
const fail = (code: string, status = 409): never => { throw new AssetServiceError(code, status); };
const normalize = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Re-read membership and user state; signed cached titles alone never grant office authority. */
async function actor(c: EquipmentQueryClient, s: SessionPayload): Promise<Actor> {
  if (!s.userId || (!s.vendorId && !s.partnerId)) fail("equipment.company_required", 403);
  const type = s.vendorId ? "vendor" : "partner", id = (s.vendorId ?? s.partnerId)!;
  const user = (await c.query("SELECT role FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL FOR SHARE", [s.userId, s.sv])).rows[0];
  if (!user) fail("equipment.current_session_required", 403);
  const m = (await c.query(`SELECT m.role,vp.vendor_role FROM user_org_memberships m LEFT JOIN vendor_people vp ON vp.id=m.vendor_people_id AND vp.user_id=m.user_id AND vp.vendor_id=m.vendor_id AND vp.is_active=true AND vp.deleted_at IS NULL WHERE m.id=$1 AND m.user_id=$2 AND m.org_type=$3 AND COALESCE(m.vendor_id,m.partner_id)=$4 FOR SHARE OF m`, [s.activeMembershipId, s.userId, type, id])).rows[0];
  if (!m && !(s.role === "admin" && user.role === "admin")) fail("equipment.current_membership_required", 403);
  const grants = type === "vendor" ? (await c.query("SELECT g.role FROM managed_subcontractor_role_grants g JOIN managed_subcontractor_worker_sponsorships sp ON sp.id=g.sponsorship_id JOIN managed_subcontractor_sponsors sponsor ON sponsor.managed_organization_id=sp.managed_organization_id AND sponsor.sponsor_vendor_id=sp.sponsor_vendor_id AND sponsor.status='active' WHERE sp.worker_user_id=$1 AND sp.sponsor_vendor_id=$2 AND sp.status='active' AND g.status='active' FOR SHARE OF g,sp,sponsor", [s.userId, id])).rows.map(r => r.role) : [];
  if (s.managedSubcontractor && !grants.some(role => ["gatekeeper", "gate_supervisor", "foreman", "asset_manager"].includes(role))) fail("equipment.active_sponsorship_required", 403);
  const roles = s.managedSubcontractor ? grants : [m?.role, m?.vendor_role, ...grants];
  const canManage = (s.role === "admin" && user.role === "admin") || roles.some(role => ["admin", "office", "both", "asset_manager"].includes(role));
  return { userId: s.userId!, type, id, canManage, supervisor: canManage || roles.includes("gate_supervisor"), canCreate: canManage || roles.some(role => ["field_employee", "field", "gatekeeper", "gate_supervisor", "foreman"].includes(role)) };
}
async function ownedRows(c: EquipmentQueryClient, a: Actor, lock = false): Promise<Row[]> {
  return (await c.query(`SELECT * FROM assets WHERE responsible_org_type=$1 AND responsible_org_id=$2 AND status NOT IN ('merged','retired') ORDER BY name,id${lock ? " FOR UPDATE" : ""}`, [a.type, a.id])).rows;
}
async function policy(c: EquipmentQueryClient, a: Actor, category: string) {
  return (await c.query("SELECT * FROM asset_category_policies WHERE owner_org_type=$1 AND owner_org_id=$2 AND category=$3 FOR SHARE", [a.type, a.id, category])).rows[0] ?? {};
}
async function aliases(c: EquipmentQueryClient, id: string): Promise<AssetAlias[]> {
  return (await c.query("SELECT kind,display_value,jurisdiction FROM asset_aliases WHERE asset_id=$1 AND active=true ORDER BY id", [id])).rows.map(r => ({ kind: r.kind, value: r.display_value, ...(r.jurisdiction ? { jurisdiction: r.jurisdiction } : {}) }));
}
async function personInScope(c: EquipmentQueryClient, a: Actor, id: number) {
  const member = (await c.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.suspended_at IS NULL AND ${personScope("$2", "$3")} FOR SHARE OF u`, [id, a.type, a.id])).rows[0];
  if (!member) fail("equipment.person_not_found", 404);
}
/** Sponsor-only workers are selectable, but a terminated managed-only membership is not authority. */
function personScope(orgType: string, orgId: string) {
  return `(EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=u.id AND m.org_type=${orgType} AND COALESCE(m.vendor_id,m.partner_id)=${orgId} AND (m.role<>'field_employee' OR m.vendor_people_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM managed_subcontractor_worker_sponsorships history WHERE history.worker_user_id=u.id AND history.sponsor_vendor_id=${orgId}))) OR (${orgType}='vendor' AND EXISTS(SELECT 1 FROM managed_subcontractor_worker_sponsorships sp JOIN managed_subcontractor_sponsors sponsor ON sponsor.managed_organization_id=sp.managed_organization_id AND sponsor.sponsor_vendor_id=sp.sponsor_vendor_id AND sponsor.status='active' WHERE sp.worker_user_id=u.id AND sp.sponsor_vendor_id=${orgId} AND sp.status='active' AND EXISTS(SELECT 1 FROM managed_subcontractor_role_grants g WHERE g.sponsorship_id=sp.id AND g.status='active'))))`;
}
async function validateRelations(c: EquipmentQueryClient, a: Actor, body: { assignedUserId?: number | null; ticketId?: number | null; taskId?: string | null }, self = false) {
  if (body.assignedUserId != null) await personInScope(c, a, body.assignedUserId);
  if (body.ticketId != null) {
    const row = (await c.query(`SELECT t.id FROM tickets t JOIN site_locations site ON site.id=t.site_location_id WHERE t.id=$1 AND (($2='vendor' AND t.vendor_id=$3) OR ($2='partner' AND site.partner_id=$3)) AND t.status NOT IN ('cancelled','denied','funds_dispersed','completed','approved','awaiting_payment') AND ($4::boolean=false OR t.foreman_user_id=$5 OR t.acting_foreman_user_id=$5 OR t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$5 AND vendor_id=t.vendor_id AND is_active=true AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND tc.removed_at IS NULL AND vp.user_id=$5 AND vp.vendor_id=t.vendor_id AND vp.is_active=true AND vp.deleted_at IS NULL)) FOR SHARE OF t`, [body.ticketId, a.type, a.id, self, a.userId])).rows[0];
    if (!row) fail("equipment.ticket_not_found", 404);
  }
  if (body.taskId != null) {
    const row = (await c.query("SELECT id FROM work_hub_tasks WHERE id=$1 AND owner_org_type=$2 AND owner_org_id=$3 AND status NOT IN ('completed','cancelled','deleted') AND ($4::boolean=false OR assignee_user_id=$5 OR created_by_id=$5 OR (assignee_user_id IS NULL AND channel_id IS NULL AND gate_hopper IS NULL)) FOR SHARE", [body.taskId, a.type, a.id, self, a.userId])).rows[0];
    if (!row) fail("equipment.task_not_found", 404);
  }
}

/** Canonical saved uploads only; public URLs and another uploader's objects are not evidence. */
async function validatePhotos(a: Actor, urls: string[], retained: string[] = []) {
  for (const url of urls) {
    if (retained.includes(url)) continue;
    if (!/^\/api\/storage\/objects\/uploads\/[0-9a-f-]{36}$/i.test(url)) fail("equipment.invalid_photo", 400);
    const object = await getObjectStore().getObject(url.slice("/api/storage".length));
    if (!object || object.acl?.owner !== String(a.userId) || !/^image\/(jpeg|png|gif|webp|heic|heif)$/i.test(object.contentType.split(";")[0]) || object.acl?.purpose) fail("equipment.photo_access_denied", 403);
  }
}

/** Same company, current association, designated unrevoked phone, active consent and duty. */
async function holderPhone(c: EquipmentQueryClient, a: Actor, row: Row, profile: EquipmentProfile, now: Date): Promise<EquipmentLocation | null> {
  const holder = row.current_holder_user_id ?? profile.assignedUserId;
  if (!holder || a.type !== "vendor" || (!a.canManage && holder !== a.userId) || row.equipment_profile?.phoneLocationEnabled === false) return null;
  const saved = (await c.query(`SELECT audit.tool_output,p.native_operations FROM work_hub_device_preferences p JOIN users u ON u.id=p.user_id AND u.suspended_at IS NULL JOIN LATERAL (SELECT tool_output FROM assistant_action_audit x WHERE x.user_id=p.user_id AND x.vendor_id=$2 AND x.partner_id IS NULL AND x.target_type='work-duty-location' ORDER BY x.id DESC LIMIT 1) audit ON true JOIN work_hub_devices d ON d.id::text=audit.tool_output->>'deviceId' AND d.user_id=p.user_id AND d.owner_org_type='vendor' AND d.owner_org_id=$2 AND d.device_class='phone' AND d.revoked_at IS NULL WHERE p.user_id=$1 AND p.owner_org_type='vendor' AND p.owner_org_id=$2 AND ${personScope("'vendor'", "$2")} AND EXISTS(SELECT 1 FROM location_consents lc WHERE lc.user_id=p.user_id AND lc.device_id=audit.tool_output->>'deviceId' AND lc.revoked_at IS NULL)`, [holder, a.id])).rows[0];
  const native = saved?.native_operations, raw = saved?.tool_output?.location;
  if (!raw || !native?.consent?.locationSharing || native.designatedDeviceId !== saved.tool_output.deviceId) return null;
  const duty = native.duty;
  let active = duty?.active && (!duty.endsAt || Date.parse(duty.endsAt) > now.getTime());
  if (active && duty.mode === "ticket") active = !!(await c.query("SELECT t.id FROM tickets t WHERE t.id=$1 AND t.vendor_id=$2 AND t.status='in_progress' AND t.lifecycle_state='on_site' AND (t.foreman_user_id=$3 OR t.acting_foreman_user_id=$3 OR t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$3 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND tc.removed_at IS NULL AND vp.user_id=$3 AND vp.vendor_id=$2 AND vp.is_active=true AND vp.deleted_at IS NULL))", [duty.ticketId, a.id, holder])).rows.length;
  if (active && duty.mode === "scheduled") active = !!(await c.query("SELECT sh.id FROM work_hub_shifts sh JOIN work_hub_shift_assignments sa ON sa.shift_id=sh.id WHERE sh.id=$1 AND sa.user_id=$2 AND sh.owner_org_type='vendor' AND sh.owner_org_id=$3 AND sa.status IN('assigned','accepted') AND sh.starts_at<=$4 AND sh.ends_at>$4 AND sh.milestone_status<>'cancelled'", [duty.shiftId, holder, a.id, now])).rows.length;
  if (!active && !duty?.overrideEndedAt) active = !!(await c.query("SELECT d.id FROM gate_duty_sessions d JOIN gate_stations g ON g.id=d.station_id WHERE d.user_id=$1 AND d.ended_at IS NULL AND (d.post_coverage->>'vendorId')::int=$2 AND EXISTS(SELECT 1 FROM site_work_assignments s WHERE s.site_location_id=g.site_id AND s.vendor_id=$2 AND s.is_gate_contractor=true) LIMIT 1", [holder, a.id])).rows.length;
  if (!active) return null;
  const age = now.getTime() - Date.parse(raw.capturedAt);
  const associatedAt = profile.history.filter(event => ["assign", "checkout", "connect"].includes(event.action)).at(-1)?.occurredAt;
  if (!Number.isFinite(age) || age < -30000 || !Number.isFinite(raw.latitude) || Math.abs(raw.latitude) > 90 || !Number.isFinite(raw.longitude) || Math.abs(raw.longitude) > 180 || !Number.isFinite(raw.accuracy) || raw.accuracy < 0 || raw.accuracy > 100 || (associatedAt && Date.parse(raw.capturedAt) < Date.parse(associatedAt))) return null;
  return { latitude: raw.latitude, longitude: raw.longitude, observedAt: raw.capturedAt, source: "holder_phone", freshness: age <= 120000 ? "fresh" : "last_known", holderUserId: holder, label: "Associated person's phone; equipment position unverified" };
}
async function projectedLocation(c: EquipmentQueryClient, a: Actor, row: Row, rows: Row[], now: Date, visited = new Set<string>()): Promise<EquipmentLocation | null> {
  if (visited.has(row.id)) return null;
  visited.add(row.id);
  const p = equipmentProfile(row.equipment_profile, row.category);
  let connected: EquipmentLocation | null = null;
  if (p.parentAssetId) {
    const parent = rows.find(other => other.id === p.parentAssetId);
    const inherited = parent ? await projectedLocation(c, a, parent, rows, now, visited) : null;
    if (inherited) connected = { ...inherited, source: "connected_equipment", viaAssetId: parent!.id, label: `Connected equipment (${inherited.source.replaceAll("_", " ")})` };
  }
  return newestEquipmentLocation(projectEquipmentLocation(p.location, now), connected, await holderPhone(c, a, row, p, now));
}
async function project(c: EquipmentQueryClient, a: Actor, row: Row, rows: Row[], now: Date): Promise<EquipmentItem> {
  const profile = equipmentProfile(row.equipment_profile, row.category), rules = await policy(c, a, row.category);
  const holds = (await c.query("SELECT id,reason FROM asset_holds WHERE asset_id=$1 AND released_at IS NULL ORDER BY placed_at", [row.id])).rows;
  const policyAllows = !rules.supervisor_approval_required || a.supervisor;
  const available = ["available", "active"].includes(row.status) && !holds.length && row.current_holder_user_id == null;
  const own = row.current_holder_user_id === a.userId;
  const holder = row.current_holder_user_id == null ? null : (await c.query("SELECT display_name FROM users WHERE id=$1", [row.current_holder_user_id])).rows[0]?.display_name ?? "Employee";
  return { id: row.id, name: row.name, category: row.category, legalOwner: row.legal_owner_name, ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}), ...(row.model ? { model: row.model } : {}), status: row.status, version: row.version, holderUserId: row.current_holder_user_id, currentHolderDisplayName: holder, aliases: await aliases(c, row.id), profile, location: await projectedLocation(c, a, row, rows, now), holds: holds.map(h => ({ id: h.id, reason: h.reason })), policy: { photosRequiredOnCheckout: !!rules.photos_required_on_checkout, photosRequiredOnReturn: !!rules.photos_required_on_return, expectedReturnRequired: !!rules.expected_return_required, supervisorApprovalRequired: !!rules.supervisor_approval_required }, capabilities: { canManage: a.canManage, canCheckout: a.canCreate && policyAllows && available && (!profile.assignedUserId || profile.assignedUserId === a.userId || a.canManage), canReturn: policyAllows && row.current_holder_user_id != null && (own || a.canManage), canOperate: a.canManage || own } };
}

/** Internal custody writes use the same authorized observation checks before clearing associations. */
export async function equipmentLocationForCustody(c: EquipmentQueryClient, owner: { type: "vendor" | "partner"; id: number }, assetId: string, actorUserId: number, now = new Date()): Promise<EquipmentLocation | null> {
  const a: Actor = { ...owner, userId: actorUserId, canManage: true, supervisor: true, canCreate: true };
  const rows = await ownedRows(c, a), row = rows.find(item => item.id === assetId);
  return row ? projectedLocation(c, a, row, rows, now) : null;
}

function assetRecord(row: Row, currentAliases: AssetAlias[]): AssetRecord {
  return { id: row.id, name: row.name, category: row.category, legalOwner: row.legal_owner_name, responsibleOwner: { type: row.responsible_org_type as "vendor" | "partner", id: row.responsible_org_id }, aliases: currentAliases, provisional: row.provisional, status: row.status, holderUserId: row.current_holder_user_id, version: row.version, history: [], ...(row.expected_return_at ? { expectedReturnAt: new Date(row.expected_return_at) } : {}) };
}

/** An adapter keeps canonical identity/custody rules inside this route's single transaction. */
function transactionAssets(c: EquipmentQueryClient, a: Actor, row?: Row): AssetRepository {
  return {
    async get(id) { const found = row?.id === id ? row : (await c.query("SELECT * FROM assets WHERE id=$1 AND responsible_org_type=$2 AND responsible_org_id=$3", [id, a.type, a.id])).rows[0]; return found ? assetRecord(found, await aliases(c, id)) : null; },
    async find(alias) { const found = (await c.query("SELECT asset_id FROM asset_aliases WHERE kind=$1 AND jurisdiction=$2 AND normalized_value=$3 AND active=true", [alias.kind, alias.jurisdiction?.trim().toUpperCase() ?? "", normalize(alias.value)])).rows[0]; return found ? { id: found.asset_id } as AssetRecord : null; },
    async create(input) {
      const created: Row = (await c.query("INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id,manufacturer,model,provisional,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [input.name, input.category, input.legalOwner, a.type, a.id, input.manufacturer ?? null, input.model ?? null, input.provisional, a.userId])).rows[0];
      for (const alias of input.aliases) await c.query("INSERT INTO asset_aliases(asset_id,kind,jurisdiction,normalized_value,display_value) VALUES($1,$2,$3,$4,$5)", [created.id, alias.kind, alias.jurisdiction ?? "", normalize(alias.value), alias.value]);
      return assetRecord(created, input.aliases);
    },
    async save(asset, expectedVersion) {
      const updated: Row = (await c.query("UPDATE assets SET current_holder_user_id=$3,current_location_type=$4,current_location_id=$5,expected_return_at=$6,status=$7,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING *", [asset.id, expectedVersion, asset.holderUserId, asset.currentLocationType ?? null, asset.currentLocationId ?? null, asset.expectedReturnAt ?? null, asset.status])).rows[0];
      if (!updated) return null;
      const event = asset.history.at(-1)!;
      const saved = (await c.query("INSERT INTO asset_custody_events(asset_id,event_type,from_holder_user_id,to_holder_user_id,condition,note,actor_user_id,operation_id,asset_version,command_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id", [asset.id, event.type, event.fromHolderUserId ?? null, event.toHolderUserId ?? null, event.condition ?? null, event.note ?? null, a.userId, event.id, updated.version, event.commandFingerprint])).rows[0];
      await c.query("INSERT INTO asset_condition_evidence(asset_id,custody_event_id,condition,note,photo_urls,reported_by_user_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [asset.id, saved.id, event.condition ?? "not_reported", event.note ?? null, JSON.stringify(event.photos ?? []), a.userId]);
      if (updated.status === "held" && row?.status !== "held") await c.query("INSERT INTO asset_holds(asset_id,reason,placed_by_user_id) VALUES($1,$2,$3)", [asset.id, `Condition: ${event.condition}`, a.userId]);
      return { ...asset, version: updated.version };
    },
    async all() { return []; },
  };
}

export function createEquipmentService(database: Database = pool, clock = () => new Date()) {
  async function transaction<T>(s: SessionPayload, work: (c: EquipmentQueryClient, a: Actor) => Promise<T>) {
    const c = await database.connect();
    try { await c.query("BEGIN"); const a = await actor(c, s); const result = await work(c, a); await c.query("COMMIT"); return result; }
    catch (error) { await c.query("ROLLBACK"); if ((error as { code?: string }).code === "23505") fail("equipment.identifier_or_operation_in_use"); throw error; }
    finally { c.release(); }
  }
  async function mutate(s: SessionPayload, id: string, raw: unknown, patch: boolean) {
    const body = patch ? UpdateEquipmentSchema.parse(raw) : EquipmentOperationSchema.parse(raw);
    return transaction(s, async (c, a) => {
      if (s.publicDemo) fail("equipment.read_only", 403);
      // Serialize graph changes as well as CAS against the same inventory rows.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`equipment:${a.type}:${a.id}`]);
      const rows = await ownedRows(c, a, true), row = rows.find(item => item.id === id);
      if (!row) fail("equipment.not_found", 404);
      const hash = fingerprint([a.userId, id, body]);
      const prior = (await c.query("SELECT asset_id,command_fingerprint FROM asset_custody_events WHERE operation_id=$1", [body.operationId])).rows[0];
      if (prior) {
        if (prior.asset_id !== id || prior.command_fingerprint !== hash) fail("equipment.operation_reused");
        return project(c, a, row!, rows, clock());
      }
      if (row!.version !== body.expectedVersion) fail("equipment.version_conflict");
      const p = equipmentProfile(row!.equipment_profile, row!.category), now = clock();
      const event: EquipmentHistoryEvent = { operationId: body.operationId, action: patch ? "update" : "action" in body ? body.action : "update", actorUserId: a.userId, occurredAt: now.toISOString() };
      let custody = false, phoneEnabled = row!.equipment_profile?.phoneLocationEnabled !== false;
      if (patch) {
        if (!a.canManage) fail("equipment.manager_required", 403);
        const changes = UpdateEquipmentSchema.parse(body);
        if (changes.photoUrls) { await validatePhotos(a, changes.photoUrls, p.photoUrls); p.photoUrls = changes.photoUrls; }
        if (changes.equipmentType) p.equipmentType = changes.equipmentType;
        if (changes.trackOnMap !== undefined) p.trackOnMap = changes.trackOnMap;
        await c.query("UPDATE assets SET name=COALESCE($2,name),manufacturer=COALESCE($3,manufacturer),model=COALESCE($4,model) WHERE id=$1", [id, changes.name ?? null, changes.manufacturer ?? null, changes.model ?? null]);
      } else {
        const op = EquipmentOperationSchema.parse(body);
        const previousContext = { assignedUserId: row!.current_holder_user_id ?? p.assignedUserId, ticketId: p.ticketId, taskId: p.taskId, parentAssetId: p.parentAssetId };
        const own = row!.current_holder_user_id === a.userId;
        if (op.action === "checkout" && !a.canCreate) fail("equipment.checkout_forbidden", 403);
        if (op.action === "assign" && !a.canManage) fail("equipment.manager_required", 403);
        if (["connect", "disconnect", "location"].includes(op.action) && !a.canManage && !own) fail("equipment.operator_required", 403);
        const holds = (await c.query("SELECT id FROM asset_holds WHERE asset_id=$1 AND released_at IS NULL FOR SHARE", [id])).rows;
        if (["assign", "checkout", "connect"].includes(op.action) && (row!.status === "held" || holds.length)) fail("asset.on_hold");
        await validateRelations(c, a, op, !a.canManage);
        event.note = op.note;
        if (op.action === "assign" || op.action === "checkout") {
          if (op.action === "checkout" && !a.canManage && ((op.assignedUserId != null && op.assignedUserId !== a.userId) || (p.assignedUserId != null && p.assignedUserId !== a.userId))) fail("equipment.assigned_to_another_person", 403);
          if (op.assignedUserId !== undefined) p.assignedUserId = op.assignedUserId;
          if (op.ticketId !== undefined) p.ticketId = op.ticketId;
          if (op.taskId !== undefined) p.taskId = op.taskId;
          // Preserve and revalidate inherited work associations, including stale assignments.
          await validateRelations(c, a, p, !a.canManage);
          phoneEnabled = true;
        }
        if (op.action === "checkout" || op.action === "return") {
          const rules = await policy(c, a, row!.category);
          if (rules.supervisor_approval_required && !a.supervisor) fail("asset.asset_manager_approval_required", 403);
          if ((op.action === "checkout" ? rules.photos_required_on_checkout : rules.photos_required_on_return) && !op.photos.length) fail(`asset.${op.action}_photos_required`);
          if (op.action === "checkout" && rules.expected_return_required && !op.expectedReturnAt) fail("asset.expected_return_required");
          await validatePhotos(a, op.photos);
          const service = createAssetService(transactionAssets(c, a, row));
          const holder = op.action === "checkout" ? op.assignedUserId ?? a.userId : row!.current_holder_user_id;
          if (!holder || (op.action === "return" && !a.canManage && !own)) fail("equipment.holder_mismatch", 403);
          // Return releases existing custody; it must remain available to office after a worker leaves.
          if (op.action === "checkout") await personInScope(c, a, holder!);
          const previousLocation = await projectedLocation(c, a, row!, rows, now);
          const input = { assetId: id, holderUserId: holder!, actorUserId: a.userId, operationId: body.operationId, expectedVersion: body.expectedVersion, condition: op.condition, confirmed: true, note: op.note, photos: op.photos, expectedReturnAt: op.expectedReturnAt ? new Date(op.expectedReturnAt) : undefined };
          const result = op.action === "checkout" ? await service.checkoutAsset(input) : await service.returnAsset(input);
          if (result.status !== "applied") fail(result.code);
          // This transaction's fingerprint covers work associations in addition to custody.
          await c.query("UPDATE asset_custody_events SET command_fingerprint=$2 WHERE operation_id=$1", [body.operationId, hash]);
          custody = true;
          p.assignedUserId = op.action === "checkout" ? holder! : null;
          if (op.action === "return") { p.location = op.location ?? droppedEquipmentLocation(previousLocation); p.ticketId = null; p.taskId = null; p.parentAssetId = null; phoneEnabled = false; }
        }
        if (op.action === "connect") {
          if (p.parentAssetId) fail("equipment.already_connected");
          const parent = rows.find(item => item.id === op.parentAssetId);
          if (!parent) fail("equipment.parent_not_found", 404);
          if (!a.canManage && parent!.current_holder_user_id !== a.userId) fail("equipment.parent_operator_required", 403);
          if (parent!.status === "held" || (await c.query("SELECT id FROM asset_holds WHERE asset_id=$1 AND released_at IS NULL", [parent!.id])).rows.length) fail("asset.on_hold");
          assertEquipmentConnection(id, parent!.id, new Map(rows.map(item => [item.id, equipmentProfile(item.equipment_profile, item.category)])));
          p.parentAssetId = parent!.id; phoneEnabled = true;
        }
        if (op.action === "disconnect") {
          if (!p.parentAssetId) fail("equipment.not_connected");
          p.location = op.location ?? droppedEquipmentLocation(await projectedLocation(c, a, row!, rows, now));
          p.parentAssetId = null; phoneEnabled = false;
        }
        if (op.location) {
          const age = now.getTime() - Date.parse(op.location.observedAt);
          if (age < -30000) fail("equipment.future_observation", 400);
          if (p.location && Date.parse(op.location.observedAt) < Date.parse(p.location.observedAt)) fail("equipment.older_observation");
          // One-time capture is an actor-reported phone position, never equipment-mounted GPS.
          if (op.location.source !== "manual") {
            if (age > 120000 || (row!.current_holder_user_id !== a.userId && p.assignedUserId !== a.userId)) fail("equipment.device_observation_required", 403);
            op.location = { ...op.location, source: "phone_report", label: "User-reported phone position; equipment presence unverified" };
          }
          p.location = { ...op.location, reportedByUserId: a.userId };
        }
        if (op.activity) p.activity = op.activity;
        else if (op.action === "return" || op.action === "disconnect") p.activity = "unassigned";
        Object.assign(event, { parentAssetId: p.parentAssetId, assignedUserId: p.assignedUserId, ticketId: p.ticketId, taskId: p.taskId, activity: p.activity, location: p.location }, op.action === "return" ? previousContext : op.action === "disconnect" ? { parentAssetId: previousContext.parentAssetId } : {});
        if (["assign", "checkout", "return"].includes(op.action)) {
          for (const [kind, relationId] of [["ticket", event.ticketId], ["task", event.taskId]] as const) {
            if (relationId != null) await c.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(asset_id,attachment_type,attachment_id) DO NOTHING", [id, kind, String(relationId), a.userId]);
          }
        }
      }
      p.history.push(event);
      // Full operation payload is also durable in the custody audit note; no history truncation.
      if (!custody) await c.query("INSERT INTO asset_custody_events(asset_id,event_type,actor_user_id,operation_id,asset_version,command_fingerprint,note) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, `equipment.${event.action}`, a.userId, body.operationId, body.expectedVersion + 1, hash, JSON.stringify(event)]);
      await c.query(`UPDATE assets SET equipment_profile=$2::jsonb,version=$3,updated_at=now() WHERE id=$1`, [id, JSON.stringify({ ...p, phoneLocationEnabled: phoneEnabled }), body.expectedVersion + 1]);
      const refreshed = await ownedRows(c, a);
      return project(c, a, refreshed.find(item => item.id === id)!, refreshed, now);
    });
  }
  return {
    async list(s: SessionPayload) { return transaction(s, async (c, a) => { const rows = await ownedRows(c, a), now = clock(); return { equipment: await Promise.all(rows.map(row => project(c, a, row, rows, now))), capabilities: { canManage: a.canManage } }; }); },
    async detail(s: SessionPayload, id: string) { return transaction(s, async (c, a) => { const rows = await ownedRows(c, a), row = rows.find(item => item.id === id); if (!row) fail("equipment.not_found", 404); return project(c, a, row!, rows, clock()); }); },
    async create(s: SessionPayload, raw: unknown) {
      const body = CreateEquipmentSchema.parse(raw);
      return transaction(s, async (c, a) => {
        if (s.publicDemo || !a.canCreate) fail("equipment.create_forbidden", 403);
        const operationId = body.operationId ?? randomUUID(), hash = fingerprint([a.userId, body]);
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`equipment-operation:${operationId}`]);
        const prior = (await c.query("SELECT asset_id,command_fingerprint FROM asset_custody_events WHERE operation_id=$1", [operationId])).rows[0];
        if (prior) {
          if (prior.command_fingerprint !== hash) fail("equipment.operation_reused");
          const rows = await ownedRows(c, a), row = rows.find(item => item.id === prior.asset_id);
          if (!row) fail("equipment.not_found", 404);
          return project(c, a, row!, rows, clock());
        }
        const rules = await policy(c, a, body.equipmentType);
        if (rules.identifier_required && !body.aliases.length) fail("asset.identifier_required");
        await validatePhotos(a, body.photoUrls);
        const created = await createAssetService(transactionAssets(c, a)).createAsset({ ...body, category: body.equipmentType, responsibleOwner: { type: a.type, id: a.id }, provisional: !a.canManage });
        const p = equipmentProfile(null, body.equipmentType); p.trackOnMap = body.trackOnMap; p.photoUrls = body.photoUrls;
        const event: EquipmentHistoryEvent = { operationId, action: "create", actorUserId: a.userId, occurredAt: clock().toISOString() }; p.history.push(event);
        await c.query("UPDATE assets SET equipment_profile=$2::jsonb WHERE id=$1", [created.id, JSON.stringify(p)]);
        await c.query("INSERT INTO asset_custody_events(asset_id,event_type,actor_user_id,operation_id,asset_version,command_fingerprint,note) VALUES($1,'equipment.create',$2,$3,1,$4,$5)", [created.id, a.userId, operationId, hash, JSON.stringify(event)]);
        const rows = await ownedRows(c, a); return project(c, a, rows.find(item => item.id === created.id)!, rows, clock());
      });
    },
    update: (s: SessionPayload, id: string, raw: unknown) => mutate(s, id, raw, true),
    operate: (s: SessionPayload, id: string, raw: unknown) => mutate(s, id, raw, false),
    async options(s: SessionPayload): Promise<EquipmentOptions> {
      return transaction(s, async (c, a) => {
        const people = (await c.query(`SELECT u.id,COALESCE(NULLIF(u.display_name,''),'Employee') AS label FROM users u WHERE u.suspended_at IS NULL AND ${personScope("$1", "$2")} AND ($3::boolean OR u.id=$4) ORDER BY label,u.id`, [a.type, a.id, a.canManage, a.userId])).rows;
        const tickets = (await c.query("SELECT t.id,'Ticket #'||t.id AS label FROM tickets t JOIN site_locations site ON site.id=t.site_location_id WHERE (($1='vendor' AND t.vendor_id=$2) OR ($1='partner' AND site.partner_id=$2)) AND t.status NOT IN ('cancelled','denied','funds_dispersed','completed','approved','awaiting_payment') AND ($3::boolean OR t.foreman_user_id=$4 OR t.acting_foreman_user_id=$4 OR t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=$4 AND vendor_id=t.vendor_id AND is_active=true AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND tc.removed_at IS NULL AND vp.user_id=$4 AND vp.vendor_id=t.vendor_id AND vp.is_active=true AND vp.deleted_at IS NULL)) ORDER BY t.id DESC", [a.type, a.id, a.canManage, a.userId])).rows;
        const tasks = (await c.query("SELECT id,title AS label FROM work_hub_tasks WHERE owner_org_type=$1 AND owner_org_id=$2 AND status NOT IN ('completed','cancelled','deleted') AND ($3::boolean OR assignee_user_id=$4 OR created_by_id=$4 OR (assignee_user_id IS NULL AND channel_id IS NULL AND gate_hopper IS NULL)) ORDER BY title,id", [a.type, a.id, a.canManage, a.userId])).rows;
        const sites = (await c.query("SELECT site.id,site.name AS label,site.latitude,site.longitude FROM site_locations site WHERE site.is_active=true AND site.hidden=false AND (($1='partner' AND site.partner_id=$2) OR ($1='vendor' AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=site.id AND a.vendor_id=$2))) ORDER BY site.name,site.id", [a.type, a.id])).rows;
        return { people, tickets, tasks, sites };
      });
    },
    async canReadPhoto(s: SessionPayload, objectPath: string) {
      return transaction(s, async (c, a) => !!(await c.query("SELECT id FROM assets WHERE responsible_org_type=$1 AND responsible_org_id=$2 AND (equipment_profile->'photoUrls') ? $3 LIMIT 1", [a.type, a.id, `/api/storage${objectPath}`])).rows.length);
    },
  };
}
