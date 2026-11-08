import { and, eq, inArray, sql } from "drizzle-orm";
import { db, vendorPeopleTable as staff, workHubFormInstancesTable as instances, workHubFormTemplatesTable as templates } from "@workspace/db";
import { AssignmentMetadataSchema, type WorkHubOwner } from "@workspace/api-zod";
import { companyLibraryPeople } from "./library-audience";
import { libraryAuthority, LibraryError, type LibraryActor } from "./library-core";
import { storedTrainingProjection } from "./stored-training-projections";

export function canViewTeamTraining(role: string, staffRoles: string[]) {
  return role === "admin" || staffRoles.some(role => role.trim().toLowerCase() === "training coordinator");
}
export async function teamTrainingAuthority(actor: LibraryActor) {
  const { owner, member } = await libraryAuthority(db, actor);
  if (!await hasTeamTrainingAccess(owner, member, actor.userId)) throw new LibraryError("Training Coordinator or company administrator required", 403);
  return { owner, member };
}
export async function hasTeamTrainingAccess(owner: WorkHubOwner, member: { role: string; vendorPeopleId: number | null }, userId: number) {
  if (member.role === "admin") return true;
  const [person] = owner.type === "vendor" ? await db.select({ roles: staff.roles, active: staff.isActive, deletedAt: staff.deletedAt }).from(staff).where(and(eq(staff.vendorId, owner.id), member.vendorPeopleId ? eq(staff.id, member.vendorPeopleId) : eq(staff.userId, userId))).limit(1) : [];
  return !!person?.active && !person.deletedAt && canViewTeamTraining(member.role, person.roles);
}
export type TeamCourse = { id: string; title: string; assignedAt: string; complete: boolean };
const metadataSchema = AssignmentMetadataSchema.pick({ membershipId: true, status: true, contentVersion: true, assignedAt: true });
export async function companyTrainingProgress(owner: WorkHubOwner, reader: Pick<typeof db, "select"> = db) {
  return storedTrainingProjection(`${owner.type}:${owner.id}:team`, () => computeCompanyTrainingProgress(owner, reader));
}
export function personTrainingStatus(courses: TeamCourse[], now: number) {
  if (!courses.length) return { color: "#9ca3af", label: "No assigned training", rank: 3 };
  const pending = courses.filter(course => !course.complete);
  if (!pending.length) return { color: "#22c55e", label: "Completed", rank: 2 };
  const days = (now - Math.min(...pending.map(course => Date.parse(course.assignedAt)))) / 86_400_000;
  return days > 14 ? { color: "#f87171", label: "Falling behind · over 14 days", rank: 0 }
    : days > 7 ? { color: "#f59e0b", label: "Needs attention · over 7 days", rank: 1 }
    : { color: "#22c55e", label: "On track · 7 days or less", rank: 2 };
}
function courseSummary(courses: TeamCourse[]) {
  const completedCount = courses.filter(course => course.complete).length;
  const totalCount = courses.length;
  const percent = totalCount ? Math.round(completedCount / totalCount * 100) : 0;
  return { completedCount, totalCount, percent, percentLabel: totalCount ? `${percent}%` : "—" };
}
async function computeCompanyTrainingProgress(owner: WorkHubOwner, reader: Pick<typeof db, "select">) {
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
  const now = Date.now();
  const projectedPeople = people.map(person => {
    const courses = [...(coursesByPerson.get(person.userId)?.values() ?? [])];
    return { userId: person.userId, membershipId: person.membershipId, name: person.name, courses,
      ...courseSummary(courses), status: personTrainingStatus(courses, now) };
  }).sort((a, b) => a.status.rank - b.status.rank || a.name.localeCompare(b.name));
  return { people: projectedPeople, ...courseSummary(projectedPeople.flatMap(person => person.courses)) };
}
