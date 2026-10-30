import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { executeWorkHubCommand } from "./commands";
import { canManageTaskAssignments } from "./task-assignment";
import { WorkHubAccessError } from "./context-access";
import { authorizeGateSchedulingSite, gateAssignmentTransactionClient, guardGateShiftAssignments, lockShiftSchedulingRows } from "../services/gate-shift-assignment";
import { gateClockLabel, gateDefinitionWindows, localGateDay, type GateShiftDefinitionInput } from "./gate-shift-definition-policy";
import type { WorkHubCommandEnvelope } from "@workspace/api-zod";

type Client = Pick<PoolClient, "query">;
type Definition = GateShiftDefinitionInput & { id: string; version: number; stationId: string; siteId: number; siteName: string; gateName: string; createdById: number; vendorId: number };
export async function gateDefinitionManager(saved: SessionPayload, vendorId: number) {
  const session = await validateAssistantSession(saved, db);
  if (session.managedSubcontractor || session.vendorId !== vendorId || !(canManageTaskAssignments(session) || session.vendorRole === "gate_supervisor")) throw new WorkHubAccessError("forbidden");
  return session;
}
export async function definitionGates(c: Client, vendorId: number) {
  return (await c.query(`SELECT DISTINCT g.id,g.name,s.id AS "siteId",s.name AS "siteName" FROM gate_stations g
    JOIN site_locations s ON s.id=g.site_id JOIN site_work_assignments a ON a.site_location_id=s.id
    WHERE a.vendor_id=$1 AND a.is_gate_contractor=true AND g.active=true AND s.is_active=true AND s.hidden IS DISTINCT FROM true ORDER BY s.name,g.name,g.id`, [vendorId])).rows as { id: string; name: string; siteId: number; siteName: string }[];
}
export async function readGateDefinitions(c: Client, vendorId: number): Promise<Definition[]> {
  const rows = (await c.query(`SELECT r.*,g.name AS gate_name,s.name AS site_name FROM workforce_staffing_requirements r
    JOIN gate_stations g ON g.id::text=r.gate_definition->>'stationId' JOIN site_locations s ON s.id=r.site_id
    WHERE r.owner_org_type='vendor' AND r.owner_org_id=$1 AND r.retired_at IS NULL AND r.gate_definition IS NOT NULL
    AND g.active=true AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=$1 AND a.site_location_id=s.id AND a.is_gate_contractor=true)
    ORDER BY s.name,g.name,r.starts_at_local,r.weekday`, [vendorId])).rows;
  const groups = new Map<string, Definition>();
  for (const row of rows) {
    const meta = row.gate_definition;
    const existing = groups.get(meta.id);
    if (existing) existing.weekdays.push(row.weekday);
    else groups.set(meta.id, { ...meta, stationId: meta.stationId, stationIds: [meta.stationId], vendorId, siteId: row.site_id, siteName: row.site_name, gateName: row.gate_name, createdById: row.created_by_id,
      startsAtLocal: row.starts_at_local, endsAtLocal: row.ends_at_local, weekdays: [row.weekday], timezone: row.timezone ?? "America/Chicago", requiredCount: row.required_count });
  }
  return [...groups.values()];
}
export async function gateDefinitionList(session: SessionPayload, vendorId: number) {
  await gateDefinitionManager(session, vendorId);
  const [gates, definitions, watches] = await Promise.all([
    definitionGates(pool, vendorId), readGateDefinitions(pool, vendorId),
    pool.query(`SELECT s.id,s.gate_definition_id AS "definitionId",s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.timezone,s.milestone_status AS status,
      coalesce((SELECT json_agg(json_build_object('id',a.user_id,'name',u.display_name) ORDER BY u.display_name) FROM work_hub_shift_assignments a JOIN users u ON u.id=a.user_id WHERE a.shift_id=s.id AND a.status NOT IN ('cancelled','declined')),'[]') AS people
      FROM work_hub_shifts s WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.gate_definition_id IS NOT NULL
      AND (s.starts_at AT TIME ZONE s.timezone)::date BETWEEN (now() AT TIME ZONE s.timezone)::date-30 AND (now() AT TIME ZONE s.timezone)::date+7 ORDER BY s.starts_at`, [vendorId]),
  ]);
  return { gates, definitions: definitions.map(definition => ({ ...definition, watches: watches.rows.filter(watch => watch.definitionId === definition.id) })) };
}
export async function materializeGateDefinition(c: Client, definition: Definition, session?: SessionPayload) {
  let created = 0;
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gate-definition:${definition.vendorId}:${definition.id}`]);
  const current = await c.query("SELECT id FROM workforce_staffing_requirements WHERE owner_org_type='vendor' AND owner_org_id=$1 AND gate_definition->>'id'=$2 AND (gate_definition->>'version')::int=$3 AND retired_at IS NULL LIMIT 1", [definition.vendorId, definition.id, definition.version]);
  if (!current.rows.length) return 0;
  for (const window of gateDefinitionWindows(definition, new Date())) {
    const existing = await c.query(`SELECT id FROM work_hub_shifts WHERE owner_org_type='vendor' AND owner_org_id=$1 AND gate_station_id=$2
      AND ((gate_definition_id=$3 AND (starts_at AT TIME ZONE timezone)::date=$6::date) OR (starts_at=$4 AND ends_at=$5)) LIMIT 1`, [definition.vendorId, definition.stationId, definition.id, window.startsAt, window.endsAt, localGateDay(window.startsAt, definition.timezone)]);
    if (existing.rows.length) continue;
    const id = randomUUID();
    const title = `${definition.siteName} | ${definition.gateName} — ${gateClockLabel(definition.startsAtLocal)}–${gateClockLabel(definition.endsAtLocal)}`;
    await c.query(`INSERT INTO work_hub_shifts(id,owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,open,calendar_type,site_location_id,gate_station_id,gate_definition_id,required_staff_count,work_start_policy,instructions,created_by_id)
      VALUES($1,'vendor',$2,$3,$4,$5,$6,false,'company',$7,$8,$9,$10,'on_site',$11,$12)`, [id, definition.vendorId, title, window.startsAt, window.endsAt, definition.timezone, definition.siteId, definition.stationId, definition.id, definition.requiredCount, definition.notes, definition.createdById]);
    if (definition.userIds.length && session) {
      await lockShiftSchedulingRows(c, session.userId!, id, definition.userIds);
      await guardGateShiftAssignments(c, session, id, definition.userIds);
      for (const userId of definition.userIds) await c.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id,status) VALUES($1,$2,$3,'assigned') ON CONFLICT DO NOTHING", [id, userId, session.userId]);
    }
    created++;
  }
  return created;
}
export async function saveGateDefinition(saved: SessionPayload, envelope: WorkHubCommandEnvelope, input: GateShiftDefinitionInput) {
  if (envelope.owner.type !== "vendor") throw new WorkHubAccessError("forbidden");
  const session = await gateDefinitionManager(saved, envelope.owner.id);
  return executeWorkHubCommand({ userId: session.userId!, source: "web" }, "gate-shift-definition.save", envelope, async tx => {
    const c = gateAssignmentTransactionClient(tx);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gate-definitions:${envelope.owner.id}`]);
    if (input.id) await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gate-definition:${envelope.owner.id}:${input.id}`]);
    const gates = await definitionGates(c, envelope.owner.id);
    for (const siteId of [...new Set(gates.filter(gate => input.stationIds.includes(gate.id)).map(gate => gate.siteId))].sort((a,b) => a-b)) await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`site-shift-plan:vendor:${envelope.owner.id}:${siteId}`]);
    const definitions = await readGateDefinitions(c, envelope.owner.id);
    const current = input.id ? definitions.find(definition => definition.id === input.id) : undefined;
    if (input.id && (!current || current.version !== input.version || input.stationIds[0] !== current.stationId)) throw Object.assign(new Error("This definition changed. Reload before editing."), { status: 409 });
    const userIds = new Set(input.userIds);
    for (const crewId of input.crewIds) {
      const crew = await c.query("SELECT id FROM work_hub_crews WHERE id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND status='active' AND archived_at IS NULL", [crewId, envelope.owner.id]);
      if (!crew.rows.length) throw new WorkHubAccessError("forbidden");
      for (const member of (await c.query("SELECT user_id FROM work_hub_crew_members WHERE crew_id=$1", [crewId])).rows) userIds.add(member.user_id);
    }
    if (userIds.size > input.requiredCount * input.stationIds.length) throw Object.assign(new Error("Increase the number of gatekeepers required, or select fewer people."), { status: 400 });
    if (userIds.size) {
      const members = await c.query(`SELECT DISTINCT u.id FROM users u JOIN user_org_memberships m ON m.user_id=u.id
        LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=u.id AND p.vendor_id=m.vendor_id
        WHERE m.org_type='vendor' AND m.vendor_id=$1 AND u.id=ANY($2::int[]) AND u.suspended_at IS NULL
        AND (m.role='admin' OR p.is_active=true AND p.deleted_at IS NULL OR EXISTS(SELECT 1 FROM managed_subcontractor_worker_sponsorships w WHERE w.worker_user_id=u.id AND w.sponsor_vendor_id=$1 AND w.status='active'))`, [envelope.owner.id, [...userIds]]);
      if (members.rows.length !== userIds.size) throw new WorkHubAccessError("forbidden");
    }
    const result = [];
    for (const stationId of input.stationIds) {
      const gate = gates.find(item => item.id === stationId);
      if (!gate) throw new WorkHubAccessError("forbidden");
      if (session.vendorRole === "gate_supervisor") await authorizeGateSchedulingSite(c, session, gate.siteId, stationId);
      if (definitions.some(item => item.id !== input.id && item.stationId === stationId && item.startsAtLocal === input.startsAtLocal && item.endsAtLocal === input.endsAtLocal && item.weekdays.some(day => input.weekdays.includes(day)))) throw Object.assign(new Error("This gate already has that recurring shift. Select it to edit."), { status: 409 });
      const id = current?.id ?? randomUUID(), version = (current?.version ?? 0) + 1;
      const meta = { id, version, stationId, notes: input.notes, userIds: [...userIds].slice(input.stationIds.indexOf(stationId) * input.requiredCount, (input.stationIds.indexOf(stationId) + 1) * input.requiredCount), crewIds: input.crewIds };
      if (current) await c.query("UPDATE workforce_staffing_requirements SET retired_at=now() WHERE owner_org_type='vendor' AND owner_org_id=$1 AND gate_definition->>'id'=$2 AND retired_at IS NULL", [envelope.owner.id, id]);
      for (const weekday of input.weekdays) await c.query(`INSERT INTO workforce_staffing_requirements(owner_org_type,owner_org_id,site_id,role_code,pattern_name,timezone,weekday,starts_at_local,ends_at_local,required_count,created_by_id,gate_definition)
        VALUES('vendor',$1,$2,'general',$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [envelope.owner.id, gate.siteId, `${gate.name} ${gateClockLabel(input.startsAtLocal)}–${gateClockLabel(input.endsAtLocal)}`, input.timezone, weekday, input.startsAtLocal, input.endsAtLocal, input.requiredCount, session.userId, JSON.stringify(meta)]);
      const definition: Definition = { ...input, ...meta, vendorId: envelope.owner.id, siteId: gate.siteId, siteName: gate.siteName, gateName: gate.name, createdById: session.userId! };
      const created = await materializeGateDefinition(c, definition, session);
      result.push({ id, version, createdWatches: created });
    }
    await c.query(`INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,source,operation_id,metadata)
      VALUES($1,'vendor',$2,'gate-shift-definition.save','gate-shift-definition',$3,'web',$4,$5::jsonb)`, [session.userId, envelope.owner.id, result[0].id, envelope.operationId, JSON.stringify({ definitions: result })]);
    return { definitions: result };
  });
}

/** Retire the repeating definition without removing watches, assignments, or their history. */
export async function retireGateDefinition(c: Client, session: SessionPayload, vendorId: number, id: string, version: number, operationId: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gate-definitions:${vendorId}`]);
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gate-definition:${vendorId}:${id}`]);
  const current = (await readGateDefinitions(c, vendorId)).find(item => item.id === id);
  if (!current || current.version !== version) throw Object.assign(new Error("This definition changed. Reload before deleting."), { status: 409 });
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`site-shift-plan:vendor:${vendorId}:${current.siteId}`]);
  if (session.vendorRole === "gate_supervisor") await authorizeGateSchedulingSite(c, session, current.siteId, current.stationId);
  await c.query("UPDATE workforce_staffing_requirements SET retired_at=now() WHERE owner_org_type='vendor' AND owner_org_id=$1 AND gate_definition->>'id'=$2 AND retired_at IS NULL", [vendorId, id]);
  await c.query(`INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,source,operation_id,metadata)
    VALUES($1,'vendor',$2,'gate-shift-definition.retire','gate-shift-definition',$3,'web',$4,$5::jsonb)`, [session.userId, vendorId, id, operationId, JSON.stringify({ version, preservedScheduledWatches: true })]);
  return { id, retired: true };
}

export async function deleteGateDefinition(saved: SessionPayload, envelope: WorkHubCommandEnvelope, input: { id: string; version: number }) {
  if (envelope.owner.type !== "vendor") throw new WorkHubAccessError("forbidden");
  const session = await gateDefinitionManager(saved, envelope.owner.id);
  return executeWorkHubCommand({ userId: session.userId!, source: "web" }, "gate-shift-definition.retire", envelope,
    async tx => retireGateDefinition(gateAssignmentTransactionClient(tx), session, envelope.owner.id, input.id, input.version, envelope.operationId));
}

/** Maintain the next week of empty watches; people are assigned through the existing roster controls. */
export async function extendGateDefinitionSchedules() {
  const vendors = await pool.query("SELECT DISTINCT owner_org_id FROM workforce_staffing_requirements WHERE gate_definition IS NOT NULL AND retired_at IS NULL AND owner_org_type='vendor'");
  for (const vendor of vendors.rows) {
    for (const definition of await readGateDefinitions(pool, vendor.owner_org_id)) {
      // Standing person/crew assignments need the current scheduling checks at save time.
      // The rolling horizon adds open staffing needs, without silently assigning workers.
      const c = await pool.connect();
      try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await materializeGateDefinition(c, { ...definition, userIds: [] }); await c.query("COMMIT"); }
      catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
    }
  }
}
