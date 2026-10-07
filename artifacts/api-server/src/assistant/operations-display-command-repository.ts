import { pool } from "@workspace/db";
import type { Pool, PoolClient } from "pg";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { createOperationsDisplayCommands, type DisplayCommandActor, type DisplayCommandDependencies, type DisplayCommandReceipt, type LockedDisplayCommand } from "./operations-display-commands";
import type { OperationsDisplay, OperationsDisplayOutput } from "../services/operations-displays";

const fail = (code: string, status = 403): never => { throw Object.assign(new Error(`operations_display.${code}`), { status }); };
export function displayCommandActor(session: SessionPayload): DisplayCommandActor {
  const owner = session.role === "partner" && session.partnerId ? { type: "partner" as const, id: session.partnerId } : session.vendorId ? { type: "vendor" as const, id: session.vendorId } : null;
  if (!owner || !session.userId || !session.activeMembershipId || !session.sv) return fail("current_account_required");
  return { userId: session.userId, owner, membershipId: session.activeMembershipId, sessionVersion: session.sv };
}
const receiptSchema = z.object({ operationId: z.uuid(), displayId: z.uuid(), action: z.enum(["route", "join_room", "revoke"]), actorUserId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal("applied"), recordedAt: z.iso.datetime(), physicalDisplayVerified: z.literal(false), cameraStarted: z.literal(false), microphoneStarted: z.literal(false) }).strict();
const date = (value: unknown) => value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
function stateOf(row: Record<string, unknown>, outputs: Record<string, unknown>[]) {
  const display: OperationsDisplay = { id: String(row.id), owner: { type: z.enum(["vendor", "partner"]).parse(row.owner_org_type), id: Number(row.owner_org_id) }, name: String(row.name), kind: "operations_display", registeredByUserId: Number(row.registered_by_user_id), registeredCompanionDeviceId: String(row.registered_companion_device_id), siteAllowlist: z.array(z.number().int().positive()).parse(row.site_allowlist), viewAllowlist: z.array(z.enum(["crew_map", "gate_log", "safety", "coverage", "meeting_room"])).parse(row.view_allowlist), privacyMode: row.privacy_mode === true, tokenHash: String(row.token_hash), tokenExpiresAt: date(row.token_expires_at), revokedAt: row.revoked_at ? date(row.revoked_at) : null, revokedByUserId: row.revoked_by_user_id == null ? null : Number(row.revoked_by_user_id), createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
  return { display, outputs: outputs.map((output): OperationsDisplayOutput => ({ id: String(output.id), displayId: String(output.display_id), name: String(output.name), currentView: z.enum(["crew_map", "gate_log", "safety", "coverage", "meeting_room"]).nullable().parse(output.current_view), currentSiteLocationId: output.current_site_location_id == null ? null : Number(output.current_site_location_id), currentMeetingOccurrenceId: output.current_meeting_occurrence_id == null ? null : String(output.current_meeting_occurrence_id), cameraEnabled: false, microphoneEnabled: false, updatedAt: date(output.updated_at) })) };
}

/** Existing Work Hub operation/audit tables; no schema or pairing token changes. */
export function createDatabaseOperationsDisplayCommands(session: SessionPayload, database: Pick<Pool, "connect"> = pool) {
  const clients = new WeakMap<LockedDisplayCommand, PoolClient>();
  const deps: DisplayCommandDependencies = {
    now: () => new Date(),
    async withLockedCommand(command, actor, operation) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        // Same UUID cannot be concurrently reused across another selected display.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`operations-display:${actor.userId}:${command.operationId}`]);
        const selected = await client.query("SELECT * FROM operations_displays WHERE id=$1 FOR UPDATE", [command.displayId]);
        if (!selected.rows[0]) return fail("not_found", 404);
        const outputs = await client.query("SELECT * FROM operations_display_outputs WHERE display_id=$1 ORDER BY id FOR UPDATE", [command.displayId]);
        const prior = await client.query("SELECT * FROM work_hub_client_operations WHERE user_id=$1 AND command_kind='operations_display.command' AND operation_id=$2", [actor.userId, command.operationId]);
        let priorReceipt: DisplayCommandReceipt | null = null;
        if (prior.rows[0]) {
          if (prior.rows[0].owner_org_type !== actor.owner.type || prior.rows[0].owner_org_id !== actor.owner.id || !prior.rows[0].applied_at) return fail("operation_conflict", 409);
          priorReceipt = receiptSchema.parse(prior.rows[0].result_json);
        }
        const locked: LockedDisplayCommand = { state: stateOf(selected.rows[0], outputs.rows), prior: priorReceipt, async commit(next, receipt, reason) {
          await client.query("UPDATE operations_displays SET updated_at=$2,revoked_at=$3,revoked_by_user_id=$4 WHERE id=$1", [command.displayId, next.display.updatedAt, next.display.revokedAt, next.display.revokedByUserId]);
          for (const output of next.outputs) await client.query("UPDATE operations_display_outputs SET current_view=$3,current_site_location_id=$4,current_meeting_occurrence_id=$5,camera_enabled=false,microphone_enabled=false,updated_at=$6 WHERE id=$1 AND display_id=$2", [output.id, command.displayId, output.currentView, output.currentSiteLocationId, output.currentMeetingOccurrenceId, output.updatedAt]);
          await client.query("INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at) VALUES($1,'operations_display.command',$2,$3,$4,$5::jsonb,$6)", [actor.userId, command.operationId, actor.owner.type, actor.owner.id, JSON.stringify(receiptSchema.parse(receipt)), receipt.recordedAt]);
          await client.query("INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,source,operation_id,metadata) VALUES($1,$2,$3,$4,'operations_display',$5,'authenticated_account',$6,$7::jsonb)", [actor.userId, actor.owner.type, actor.owner.id, `operations_display.${command.action}`, command.displayId, command.operationId, JSON.stringify({ reason, fingerprint: receipt.fingerprint, expectedUpdatedAt: command.expectedUpdatedAt, updatedAt: next.display.updatedAt.toISOString(), physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false })]);
        } };
        clients.set(locked, client);
        const result = await operation(locked);
        await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async authorize(locked, actor, command) {
      const client = clients.get(locked); if (!client) return fail("transaction_required");
      const user = await client.query("SELECT role FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL FOR SHARE", [actor.userId, actor.sessionVersion]);
      if (!user.rows[0] || session.role === "admin" && user.rows[0].role !== "admin") return fail("current_session_required");
      const member = await client.query("SELECT role FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND org_type=$3 AND COALESCE(vendor_id,partner_id)=$4 FOR SHARE", [actor.membershipId, actor.userId, actor.owner.type, actor.owner.id]);
      if (!member.rows[0] || member.rows[0].role !== "admin" && !(session.role === "admin" && user.rows[0].role === "admin")) return fail("current_admin_required");
      // Device identity is taken from the selected saved display, never request args.
      const device = await client.query("SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type=$3 AND owner_org_id=$4 AND revoked_at IS NULL FOR SHARE", [locked.state.display.registeredCompanionDeviceId, actor.userId, actor.owner.type, actor.owner.id]);
      if (!device.rows[0]) return fail("trusted_companion_required");
      if (command.action === "route") {
        const site = await client.query("SELECT id,partner_id FROM site_locations WHERE id=$1 AND is_active=true AND hidden=false FOR SHARE", [command.siteLocationId]);
        if (!site.rows[0]) return fail("site_not_allowed", 404);
        if (actor.owner.type === "partner" && site.rows[0].partner_id !== actor.owner.id) return fail("site_not_allowed", 404);
        if (actor.owner.type === "vendor") {
          const relationship = await client.query("SELECT id FROM partner_vendor_relationships WHERE partner_id=$1 AND vendor_id=$2 AND status='approved' FOR SHARE", [site.rows[0].partner_id, actor.owner.id]);
          const assignment = await client.query("SELECT id FROM site_work_assignments WHERE site_location_id=$1 AND vendor_id=$2 FOR SHARE", [command.siteLocationId, actor.owner.id]);
          if (!relationship.rows.length || !assignment.rows.length) return fail("site_not_allowed", 404);
          if (command.view === "gate_log") {
            const gate = await client.query("SELECT id FROM site_work_assignments WHERE site_location_id=$1 AND vendor_id=$2 AND is_gate_contractor=true FOR SHARE", [command.siteLocationId, actor.owner.id]);
            if (!gate.rows.length) return fail("site_not_allowed", 404);
          }
        }
      }
      if (command.action === "join_room") {
        const meeting = await client.query("SELECT o.id FROM work_hub_meeting_occurrences o JOIN work_hub_meetings m ON m.id=o.meeting_id JOIN work_hub_meeting_participants p ON p.occurrence_id=o.id AND p.user_id=$2 WHERE o.id=$1 AND m.owner_org_type=$3 AND m.owner_org_id=$4 AND p.removed_at IS NULL AND o.status NOT IN ('ended','cancelled') FOR SHARE OF o,m,p", [command.meetingOccurrenceId, actor.userId, actor.owner.type, actor.owner.id]);
        if (!meeting.rows[0]) return fail("room_not_allowed", 404);
      }
      return { companionDeviceId: String(device.rows[0].id) };
    },
  };
  return createOperationsDisplayCommands(deps);
}
