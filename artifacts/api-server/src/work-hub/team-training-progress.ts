import { and, eq, inArray, sql } from "drizzle-orm";
import { db, vendorPeopleTable as staff, workHubFormInstancesTable as instances, workHubFormTemplatesTable as templates } from "@workspace/db";
import { AssignmentMetadataSchema, type WorkHubOwner } from "@workspace/api-zod";
import { companyLibraryPeople } from "./library-audience";
import { libraryAuthority, LibraryError, type LibraryActor } from "./library-core";

export function canViewTeamTraining(role: string, staffRoles: string[]) {
  return role === "admin" || staffRoles.some(role => role.trim().toLowerCase() === "training coordinator");
}
export async function teamTrainingAuthority(actor: LibraryActor) {
  const { owner, member } = await libraryAuthority(db, actor);
  if (!await hasTeamTrainingAccess(owner, member, actor.userId)) throw new LibraryError("Training Coordinator or company administrator required", 403);
  return { owner };
}
export async function hasTeamTrainingAccess(owner: WorkHubOwner, member: { role: string; vendorPeopleId: number | null }, userId: number) {
  if (member.role === "admin") return true;
  const [person] = owner.type === "vendor" ? await db.select({ roles: staff.roles, active: staff.isActive, deletedAt: staff.deletedAt }).from(staff).where(and(eq(staff.vendorId, owner.id), member.vendorPeopleId ? eq(staff.id, member.vendorPeopleId) : eq(staff.userId, userId))).limit(1) : [];
  return !!person?.active && !person.deletedAt && canViewTeamTraining(member.role, person.roles);
}
export type TeamCourse = { id: string; title: string; assignedAt: string; complete: boolean };
const metadataSchema = AssignmentMetadataSchema.pick({ membershipId: true, status: true, contentVersion: true, assignedAt: true });
export async function companyTrainingProgress(owner: WorkHubOwner, reader: Pick<typeof db, "select"> = db) {
  const [people, catalog] = await Promise.all([
    companyLibraryPeople(reader, owner),
    reader.select({ id: templates.id, title: templates.name,
      version: sql<number>`(${templates.libraryMetadata}->>'contentVersion')::int`,
    }).from(templates).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id), sql`${templates.libraryMetadata}->>'kind'='training' AND ${templates.libraryMetadata}->>'state'='published'`)),
  ]);
  const currentCourses = new Map(catalog.map(course => [course.id, course]));
  const rows = catalog.length ? await reader.select({ id: instances.id, userId: instances.assigneeUserId, templateId: instances.templateId,
      metadata: sql<unknown>`jsonb_build_object('membershipId',${instances.assignmentMetadata}->'membershipId','status',${instances.assignmentMetadata}->'status','contentVersion',${instances.assignmentMetadata}->'contentVersion','assignedAt',${instances.assignmentMetadata}->'assignedAt')`,
    }).from(instances).where(inArray(instances.templateId, catalog.map(course => course.id))) : [];
  const members = new Map(people.map(person => [person.userId, person.membershipId]));
  const coursesByPerson = new Map<number, Map<string, TeamCourse>>();
  for (const row of rows) {
    const parsed = metadataSchema.safeParse(row.metadata);
    if (!row.userId || !parsed.success) continue;
    const a = parsed.data;
    const course = currentCourses.get(row.templateId);
    if (!course || members.get(row.userId) !== a.membershipId || a.contentVersion !== course.version || ["cancelled", "exempted"].includes(a.status)) continue;
    const courses = coursesByPerson.get(row.userId) ?? new Map<string, TeamCourse>();
    const prior = courses.get(row.templateId);
    if (!prior || Date.parse(prior.assignedAt) < Date.parse(a.assignedAt)) courses.set(row.templateId, { id: row.id, title: course.title, assignedAt: a.assignedAt, complete: a.status === "completed" });
    coursesByPerson.set(row.userId, courses);
  }
  return { people: people.map(person => {
    const courses = [...(coursesByPerson.get(person.userId)?.values() ?? [])];
    return { userId: person.userId, name: person.name, courses };
  }).sort((a, b) => a.name.localeCompare(b.name)) };
}
