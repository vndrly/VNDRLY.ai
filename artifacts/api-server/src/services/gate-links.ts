import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess, requireGateStationManagementAccess } from "./gate-change-over";

type Client = Pick<PoolClient, "query">;
const fail = (status: number, message: string): never => { throw new ChangeOverError(status, "gate_links.rejected", message); };

async function requireLinkedRead(c: Client, session: SessionPayload, siteId: number) {
  try { await requireChangeOverAccess(c,session,siteId); }
  catch(error) { if(!(error instanceof ChangeOverError)||error.status!==403)throw error; await requireGateStationManagementAccess(c,session,siteId); }
}

/** A parallel group is explicit, partner-owned, and never grants site access. */
export async function linkedGateScope(c: Client, session: SessionPayload, siteId: number) {
  const source = (await c.query("SELECT id,partner_id,gate_link_id,gate_link_name FROM site_locations WHERE id=$1", [siteId])).rows[0];
  if (!source?.gate_link_id) return { siteIds: [siteId], groupId: null, name: null };
  const candidates = (await c.query("SELECT id FROM site_locations WHERE gate_link_id=$1 AND partner_id=$2 AND is_active IS DISTINCT FROM false AND hidden IS DISTINCT FROM true ORDER BY id", [source.gate_link_id, source.partner_id])).rows;
  const siteIds: number[] = [];
  for (const row of candidates) {
    try { await requireLinkedRead(c, session, row.id); siteIds.push(row.id); }
    catch (error) { if (!(error instanceof ChangeOverError) || error.status !== 403) throw error; }
  }
  if (!siteIds.includes(siteId)) fail(403, "Current site access required");
  return { siteIds, groupId: source.gate_link_id as string, name: source.gate_link_name as string | null };
}

export async function readLinkedGates(session: SessionPayload, siteId: number, client: Client = pool) {
  await requireLinkedRead(client, session, siteId);
  const scope = await linkedGateScope(client, session, siteId);
  const gates = (await client.query(`SELECT g.id,g.site_id AS "siteId",g.name,s.name AS "siteName",g.active,
    g.connection->>'seenAt' AS "lastSeenAt",
    CASE WHEN g.connection IS NULL THEN 'unknown'
      WHEN g.active=true AND (g.connection->>'seenAt')::timestamptz >= now()-interval '90 seconds'
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=(g.connection->>'userId')::int AND u.suspended_at IS NULL AND u.session_version=(g.connection->>'sessionVersion')::int)
        AND (EXISTS(SELECT 1 FROM gate_shifts w WHERE w.station_id=g.id AND w.operator_id=(g.connection->>'userId')::int AND w.ended_at IS NULL)
          OR EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.station_id=g.id AND d.user_id=(g.connection->>'userId')::int AND d.ended_at IS NULL))
      THEN 'online' ELSE 'offline' END AS connection
    FROM gate_stations g JOIN site_locations s ON s.id=g.site_id
    WHERE g.site_id=ANY($1::int[]) AND g.active=true ORDER BY s.name,g.name,g.id`, [scope.siteIds])).rows;
  return { ...scope, gates, observedAt: new Date().toISOString() };
}

export async function gateConnectionHeartbeat(session: SessionPayload, stationId: string) {
  if (session.realm === "demo" || session.publicDemo) fail(403, "This session is read only");
  return changeOverTransaction(async c => {
    const gate = (await c.query("SELECT site_id FROM gate_stations WHERE id=$1 AND active=true", [stationId])).rows[0];
    if (!gate) fail(404, "Gate unavailable");
    await requireChangeOverAccess(c, session, gate.site_id);
    // An office user browsing a gate cannot make its booth appear online.
    const result = await c.query(`UPDATE gate_stations g SET connection=jsonb_build_object('userId',$2::int,'sessionVersion',$3::int,'seenAt',now())
      WHERE g.id=$1 AND g.active=true AND
      (EXISTS(SELECT 1 FROM gate_shifts w WHERE w.station_id=g.id AND w.operator_id=$2 AND w.ended_at IS NULL)
        OR EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.station_id=g.id AND d.user_id=$2 AND d.ended_at IS NULL)) RETURNING id`, [stationId, session.userId, session.sv]);
    return { recorded: Boolean(result.rowCount) };
  });
}

/** Called inside gate creation as well as the explicit Link action. */
export async function linkGateSite(c: Client, session: SessionPayload, siteId: number, targetSiteId?: number, name?: string) {
  if (session.realm === "demo" || session.publicDemo) fail(403, "This session is read only");
  await requireGateStationManagementAccess(c, session, siteId);
  if (targetSiteId) await requireGateStationManagementAccess(c, session, targetSiteId);
  const ids = [...new Set([siteId, targetSiteId ?? siteId])].sort((a,b) => a-b);
  const rows = (await c.query("SELECT id,name,partner_id,gate_link_id,gate_link_name FROM site_locations WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids])).rows;
  const source = rows.find(row => row.id === siteId), target = rows.find(row => row.id === (targetSiteId ?? siteId));
  if (!source || !target || source.partner_id !== target.partner_id) fail(400, "Linked gates must belong to the same partner");
  if (source.gate_link_id && target.gate_link_id && source.gate_link_id !== target.gate_link_id) fail(409, "These sites already belong to different links. Existing links were not merged.");
  const groupId = target.gate_link_id ?? source.gate_link_id ?? randomUUID();
  const groupName = target.gate_link_name ?? source.gate_link_name ?? name?.trim() ?? target.name ?? "";
  if (!groupName || groupName.length > 100) fail(400, "Enter a Site / Spur link name (up to 100 characters)");
  await c.query("UPDATE site_locations SET gate_link_id=$2,gate_link_name=$3 WHERE id=ANY($1::int[])", [ids, groupId, groupName]);
  return { groupId, name: groupName };
}

export async function saveGateSiteLink(session: SessionPayload, input: { siteId: number; targetSiteId?: number; name?: string }) {
  return changeOverTransaction(c => linkGateSite(c, session, input.siteId, input.targetSiteId, input.name));
}
