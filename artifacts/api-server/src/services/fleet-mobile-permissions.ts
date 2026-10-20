import { FleetCapabilityAssignmentInputSchema, FleetCapabilitySchema, type FleetCapability } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { FleetError, FleetStateSchema, emptyFleetState } from "./fleet-repository";
import type { FleetActor } from "./fleet-ops";
import { hasFleetGrantScope, type FleetGrant } from "./fleet-permissions";

export type FleetMobileAction = "configure" | "office_review" | "dispatch" | "yard_work" | "perform_run" | "self_dispatch" | "view_live_map" | "view_compliance";
export type FleetMobileTarget = { companyId: number; fleetId: string; siteId?: number; driverUserId?: number; assignedToUserId?: number };
export type FleetMobileActor = { userId: number; companyId: number; capabilities: ReadonlySet<FleetCapability>; grant: FleetGrant | null };

const actions: readonly FleetMobileAction[] = ["configure", "office_review", "dispatch", "yard_work", "perform_run", "self_dispatch", "view_live_map", "view_compliance"];

/** Capability checks compose inside the existing company, Fleet, and site grant boundary. */
export function mayPerformFleetMobileAction(actor: FleetMobileActor, target: FleetMobileTarget, action: FleetMobileAction): boolean {
  const { grant, capabilities: c } = actor;
  if (actor.companyId !== target.companyId || !hasFleetGrantScope(actor.userId, grant, target)) return false;
  const admin = c.has("admin");
  switch (action) {
    case "configure": return admin;
    case "office_review": return admin || c.has("office");
    case "dispatch": return admin || c.has("dispatch");
    case "yard_work": return admin || (c.has("yard") && target.assignedToUserId === actor.userId);
    case "perform_run": return c.has("driver") && target.driverUserId === actor.userId;
    case "self_dispatch": return c.has("driver") && c.has("self_dispatch") && target.driverUserId === actor.userId;
    case "view_live_map": return admin || c.has("dispatch");
    case "view_compliance": return admin || c.has("office") || c.has("dispatch");
    default: return false;
  }
}

/** One action per kind even when an employee holds every capability. */
export function projectFleetMobileActions(actor: FleetMobileActor, target: FleetMobileTarget): FleetMobileAction[] {
  return actions.filter(action => mayPerformFleetMobileAction(actor, target, action));
}

export function legacyFleetCapabilities(roles: readonly string[]): ReadonlySet<FleetCapability> {
  const capabilities = new Set<FleetCapability>();
  if (roles.includes("fleet_manager")) { capabilities.add("admin"); capabilities.add("dispatch"); }
  if (roles.includes("dispatcher")) capabilities.add("dispatch");
  if (roles.includes("driver")) capabilities.add("driver");
  return capabilities;
}

/** Resolves only the active, current vendor membership; a stored row replaces legacy roles for this company. */
export async function resolveFleetCapabilities(actor: FleetActor, companyId: number): Promise<ReadonlySet<FleetCapability>> {
  if (actor.companyId !== companyId || !Number.isSafeInteger(actor.userId) || !Number.isSafeInteger(actor.activeMembershipId) || !Number.isSafeInteger(actor.sv) || !["vendor", "field_employee"].includes(actor.role ?? ""))
    throw new FleetError("fleet.membership_required", 403);
  const member = await pool.query(
    "SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor' AND m.role=$4 AND u.session_version=$5 AND u.suspended_at IS NULL",
    [actor.activeMembershipId, actor.userId, companyId, actor.membershipRole, actor.sv],
  );
  if (!member.rows.length) throw new FleetError("fleet.membership_required", 403);
  if (actor.role === "field_employee") {
    if (actor.membershipRole !== "field_employee") throw new FleetError("fleet.current_person_required", 403);
    const person = await pool.query("SELECT id FROM vendor_people WHERE id=$1 AND user_id=$2 AND vendor_id=$3 AND is_active=true AND deleted_at IS NULL", [actor.vendorPeopleId, actor.userId, companyId]);
    if (!person.rows.length) throw new FleetError("fleet.current_person_required", 403);
  } else if (!["admin", "member"].includes(actor.membershipRole ?? "")) throw new FleetError("fleet.membership_required", 403);
  const vendor = await pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [companyId]);
  if (!vendor.rows.length) throw new FleetError("fleet.not_found", 404);
  const state = FleetStateSchema.parse(vendor.rows[0].fleet_ops_state ?? emptyFleetState());
  const grant = state.enabled ? state.grants.find(g => g.userId === actor.userId && g.roles.length && g.fleetIds.some(id => state.fleets.some(f => f.id === id))) : null;
  if (!grant) return new Set();
  const stored = await pool.query("SELECT capabilities FROM fleet_person_capabilities WHERE company_id=$1 AND user_id=$2", [companyId, actor.userId]);
  return stored.rows.length ? new Set(FleetCapabilitySchema.array().parse(stored.rows[0].capabilities)) : legacyFleetCapabilities(grant.roles);
}

export async function readFleetCapabilities(actor: FleetActor, targetUserId = actor.userId) {
  const own = await resolveFleetCapabilities(actor, actor.companyId);
  if (targetUserId !== actor.userId) {
    if (actor.role !== "vendor" || actor.membershipRole !== "admin" || !own.has("admin")) throw new FleetError("fleet.permission_denied", 403);
    const vendor = await pool.query("SELECT fleet_ops_state FROM vendors WHERE id=$1", [actor.companyId]);
    const state = FleetStateSchema.parse(vendor.rows[0]?.fleet_ops_state ?? emptyFleetState());
    if (!state.enabled || !state.grants.some(g => g.userId === actor.userId && g.roles.includes("fleet_manager") && g.fleetIds.some(id => state.fleets.some(f => f.id === id)))) throw new FleetError("fleet.permission_denied", 403);
    const member = await pool.query("SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.vendor_id=$2 AND m.org_type='vendor' AND u.suspended_at IS NULL", [targetUserId, actor.companyId]);
    if (!member.rows.length) throw new FleetError("fleet.membership_required", 403);
    const stored = await pool.query("SELECT version,capabilities FROM fleet_person_capabilities WHERE company_id=$1 AND user_id=$2", [actor.companyId, targetUserId]);
    const grant = state.grants.find(g => g.userId === targetUserId && g.roles.length && g.fleetIds.some(id => state.fleets.some(f => f.id === id)));
    return { companyId: actor.companyId, userId: targetUserId, capabilities: grant ? [...(stored.rows.length ? new Set(FleetCapabilitySchema.array().parse(stored.rows[0].capabilities)) : legacyFleetCapabilities(grant.roles))] : [], version: stored.rows[0]?.version ?? 0, source: stored.rows.length ? "stored" : "legacy" };
  }
  const current = await pool.query("SELECT version FROM fleet_person_capabilities WHERE company_id=$1 AND user_id=$2", [actor.companyId, actor.userId]);
  return { companyId: actor.companyId, userId: actor.userId, capabilities: [...own], version: current.rows[0]?.version ?? 0, source: current.rows.length ? "stored" : "legacy" };
}

/** Versioned Admin assignment; the vendor row lock serializes concurrent first grants. */
export async function saveFleetCapabilities(actor: FleetActor, targetUserId: number, raw: unknown) {
  const input = FleetCapabilityAssignmentInputSchema.parse(raw);
  if (actor.readOnly) throw new FleetError("fleet.read_only", 403);
  if (input.assignment.userId !== targetUserId || input.assignment.companyId !== actor.companyId || input.scope.owner.type !== "vendor" || input.scope.owner.id !== actor.companyId || input.scope.userId !== actor.userId || input.scope.membershipId !== actor.activeMembershipId || input.scope.sessionVersion !== actor.sv)
    throw new FleetError("fleet.company_required", 403);
  if (input.assignment.version !== input.expectedVersion + 1) throw new FleetError("fleet.version_conflict", 409);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const member = await client.query("SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor' AND m.role='admin' AND u.session_version=$4 AND u.suspended_at IS NULL FOR SHARE OF m,u", [actor.activeMembershipId, actor.userId, actor.companyId, actor.sv]);
    if (!member.rows.length || actor.role !== "vendor" || actor.membershipRole !== "admin") throw new FleetError("fleet.membership_required", 403);
    const vendor = await client.query("SELECT fleet_ops_state FROM vendors WHERE id=$1 FOR UPDATE", [actor.companyId]);
    if (!vendor.rows.length) throw new FleetError("fleet.not_found", 404);
    const state = FleetStateSchema.parse(vendor.rows[0].fleet_ops_state ?? emptyFleetState());
    const adminGrant = state.enabled && state.grants.find(g => g.userId === actor.userId && g.roles.includes("fleet_manager") && g.fleetIds.some(id => state.fleets.some(f => f.id === id)));
    if (!adminGrant) throw new FleetError("fleet.permission_denied", 403);
    const actorStored = await client.query("SELECT capabilities FROM fleet_person_capabilities WHERE company_id=$1 AND user_id=$2", [actor.companyId, actor.userId]);
    if (actorStored.rows.length && !FleetCapabilitySchema.array().parse(actorStored.rows[0].capabilities).includes("admin")) throw new FleetError("fleet.permission_denied", 403);
    const target = await client.query("SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.vendor_id=$2 AND m.org_type='vendor' AND u.suspended_at IS NULL FOR SHARE OF m,u", [targetUserId, actor.companyId]);
    if (!target.rows.length) throw new FleetError("fleet.membership_required", 403);
    const fingerprint = JSON.stringify({ expectedVersion: input.expectedVersion, assignment: input.assignment });
    const replay = await client.query("SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-capability-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1", [actor.companyId, input.operationId]);
    if (replay.rows.length) {
      if (replay.rows[0].user_id !== actor.userId || replay.rows[0].tool_input?.fingerprint !== fingerprint) throw new FleetError("fleet.operation_conflict", 409);
      await client.query("COMMIT");
      return replay.rows[0].tool_output;
    }
    const current = await client.query("SELECT version FROM fleet_person_capabilities WHERE company_id=$1 AND user_id=$2 FOR UPDATE", [actor.companyId, targetUserId]);
    if ((current.rows[0]?.version ?? 0) !== input.expectedVersion) throw new FleetError("fleet.version_conflict", 409);
    const saved = current.rows.length
      ? await client.query("UPDATE fleet_person_capabilities SET capabilities=$3::text[],version=version+1,granted_by_user_id=$4,updated_at=now() WHERE company_id=$1 AND user_id=$2 RETURNING version,capabilities", [actor.companyId, targetUserId, input.assignment.capabilities, actor.userId])
      : await client.query("INSERT INTO fleet_person_capabilities(company_id,user_id,capabilities,version,granted_by_user_id) VALUES($1,$2,$3::text[],1,$4) RETURNING version,capabilities", [actor.companyId, targetUserId, input.assignment.capabilities, actor.userId]);
    const result = { companyId: actor.companyId, userId: targetUserId, version: saved.rows[0].version as number, capabilities: FleetCapabilitySchema.array().parse(saved.rows[0].capabilities) };
    await client.query("INSERT INTO assistant_action_audit(user_id,actor_role,actor_membership_role,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'fleet','typed','canonical','fleet_capability_update','update','fleet-capability-operation',$5,$6::jsonb,$7::jsonb,'completed')", [actor.userId, actor.role, actor.membershipRole, actor.companyId, input.operationId, JSON.stringify({ fingerprint }), JSON.stringify(result)]);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
