import { and, eq, inArray, isNotNull, sql, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, workHubCrewsTable as crews, workHubCrewMembersTable as members, workHubTasksTable as tasks, workHubTaskEventsTable as events, workHubAnnouncementsTable as announcements, workHubAnnouncementRecipientsTable as recipients } from "@workspace/db";
import type { WorkHubCommandEnvelope, WorkHubOwner } from "@workspace/api-zod";
import { executeWorkHubCommand, type WorkHubActor } from "./commands";
import { WorkHubAccessError } from "./context-access";
import { appendWorkHubAudit } from "./audit";
import { createWorkCrewPayload, crewJobPayload, workCrewExpiration } from "./work-crew-policy";
import { announcementPayload } from "./assistant-payload-schemas";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select" | "execute">;
const owned = (owner: WorkHubOwner) => and(eq(crews.ownerOrgType, owner.type), eq(crews.ownerOrgId, owner.id), eq(crews.status, "active"), isNotNull(crews.workCrew));
export async function workCrewWorkers(reader: Reader, owner: WorkHubOwner, lock = false) {
  const result = await reader.execute(sql`SELECT u.id AS "userId",COALESCE(u.display_name,'Worker') AS name,p.last_name AS "lastName",m.role AS "membershipRole",p.vendor_role AS "vendorRole"
    FROM user_org_memberships m JOIN users u ON u.id=m.user_id AND u.suspended_at IS NULL
    LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=u.id AND p.vendor_id=m.vendor_id
    WHERE m.org_type=${owner.type} AND (${owner.type}='vendor' AND m.vendor_id=${owner.id} OR ${owner.type}='partner' AND m.partner_id=${owner.id})
    AND (${owner.type}='partner' OR m.role='admin' OR (p.is_active=true AND p.deleted_at IS NULL))
    ORDER BY COALESCE(NULLIF(p.last_name,''),split_part(trim(u.display_name),' ',-1)),u.display_name,u.id ${lock ? sql`FOR SHARE OF m,u` : sql``}`);
  return [...new Map((result.rows as { userId: number; name: string; lastName: string | null; membershipRole: string; vendorRole: string | null }[]).map(person => [person.userId,person])).values()];
}
export async function readWorkCrews(owner: WorkHubOwner) {
  const [workers, rows] = await Promise.all([workCrewWorkers(db, owner), db.select().from(crews).where(owned(owner)).orderBy(desc(crews.createdAt)).limit(1000)]);
  const roster = rows.length ? await db.select().from(members).where(inArray(members.crewId, rows.map(row => row.id))) : [];
  return { workers, crews: rows.map(row => ({ id: row.id, name: row.name, purpose: row.workCrew!.purpose, noExpiry: row.workCrew!.noExpiry,
    lastAssignedAt: row.workCrew!.lastAssignedAt, createdAt: row.createdAt, ...workCrewExpiration(row),
    members: roster.filter(member => member.crewId === row.id).map(member => ({ userId: member.userId, name: workers.find(person => person.userId === member.userId)?.name ?? "Unavailable worker" })) })) };
}
async function currentCrew(tx: Tx, owner: WorkHubOwner, id: string) {
  const [crew] = await tx.select().from(crews).where(and(owned(owner), eq(crews.id, id))).for("update");
  if (!crew) throw new WorkHubAccessError("not_found");
  if (workCrewExpiration(crew).expired) throw Object.assign(new Error("This work crew has expired"), { status: 409 });
  const roster = await tx.select().from(members).where(eq(members.crewId, id)).for("share");
  const eligible = new Set((await workCrewWorkers(tx, owner, true)).map(worker => worker.userId));
  if (!roster.length || roster.some(member => !eligible.has(member.userId))) throw Object.assign(new Error("The crew includes a worker who is no longer available in this company"), { status: 409 });
  return { crew, userIds: [...new Set(roster.map(member => member.userId))] };
}
export async function saveWorkCrew(actor: WorkHubActor, envelope: WorkHubCommandEnvelope<unknown>) {
  const payload = createWorkCrewPayload.parse(envelope.payload);
  return executeWorkHubCommand(actor, "work-crew.create", envelope, async tx => {
    const eligible = new Set((await workCrewWorkers(tx, envelope.owner, true)).map(person => person.userId));
    if (payload.userIds.some(id => !eligible.has(id))) throw new WorkHubAccessError("forbidden");
    const [crew] = await tx.insert(crews).values({ name: payload.name, ownerOrgType: envelope.owner.type, ownerOrgId: envelope.owner.id,
      createdById: actor.userId, workCrew: { purpose: payload.purpose, noExpiry: payload.noExpiry, lastAssignedAt: null } }).returning();
    await tx.insert(members).values(payload.userIds.map(userId => ({ crewId: crew.id, userId, mode: "member" })));
    await appendWorkHubAudit({ actorUserId: actor.userId, owner: envelope.owner, action: "work-crew.created", subjectType: "work-crew", subjectId: crew.id, source: actor.source, operationId: envelope.operationId }, tx);
    return { id: crew.id, name: crew.name, memberCount: payload.userIds.length };
  });
}
export async function assignWorkCrew(actor: WorkHubActor, envelope: WorkHubCommandEnvelope<unknown>, crewId: string) {
  const payload = crewJobPayload.parse(envelope.payload);
  return executeWorkHubCommand(actor, "work-crew.assign", envelope, async tx => {
    const { crew, userIds } = await currentCrew(tx, envelope.owner, crewId);
    const assignedAt = new Date(), assignmentId = randomUUID();
    const assigned = await tx.insert(tasks).values(userIds.map(userId => ({ ownerOrgType: envelope.owner.type, ownerOrgId: envelope.owner.id,
      title: payload.title, description: payload.description || null, assigneeUserId: userId, createdById: actor.userId,
      dueAt: payload.dueAt ? new Date(payload.dueAt) : null }))).returning();
    await tx.insert(events).values(assigned.map(task => ({ taskId: task.id, actorUserId: actor.userId, eventType: "created", detail: { crewId, crewName: crew.name, assignmentId } })));
    await tx.update(crews).set({ workCrew: { ...crew.workCrew!, lastAssignedAt: assignedAt.toISOString() } }).where(eq(crews.id, crewId));
    await appendWorkHubAudit({ actorUserId: actor.userId, owner: envelope.owner, action: "work-crew.assigned", subjectType: "work-crew", subjectId: crewId, source: actor.source, operationId: envelope.operationId, metadata: { assignmentId, taskIds: assigned.map(task => task.id) } }, tx);
    return { crewId, crewName: crew.name, tasks: assigned, memberCount: userIds.length, assignedAt: assignedAt.toISOString() };
  });
}
export async function announceToWorkCrew(actor: WorkHubActor, envelope: WorkHubCommandEnvelope<unknown>, crewId: string) {
  const payload = announcementPayload.omit({ recipientUserIds: true, channelId: true }).strict().parse(envelope.payload);
  return executeWorkHubCommand(actor, "work-crew.announce", envelope, async tx => {
    const { userIds } = await currentCrew(tx, envelope.owner, crewId);
    const [announcement] = await tx.insert(announcements).values({ ownerOrgType: envelope.owner.type, ownerOrgId: envelope.owner.id,
      workCrewId: crewId, title: payload.title, body: payload.body, urgency: payload.urgency, acknowledgementRequired: payload.acknowledgementRequired, publishedById: actor.userId,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null }).returning();
    await tx.insert(recipients).values(userIds.map(userId => ({ announcementId: announcement.id, userId })));
    return { announcement, userIds };
  });
}
