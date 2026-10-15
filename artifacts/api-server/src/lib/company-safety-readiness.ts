import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, vendorsTable, vendorPeopleTable, employeeCertificationsTable, workHubFormTemplatesTable as templates, workHubFormInstancesTable as instances, safetyTrainingModulesTable as modules, safetyTrainingCompletionsTable as completions, safetyEventsTable as events, safetyCorrectiveActionsTable as actions } from "@workspace/db";
import { FleetStateSchema } from "../services/fleet-repository";
import { AssignmentMetadataSchema, LibraryMetadataSchema } from "@workspace/api-zod";
import { libraryAuthority, type LibraryActor } from "../work-hub/library-core";
import { companyLibraryPeople } from "../work-hub/library-audience";
import { computeSafetyMetrics } from "./safety-metrics";
import { assessSafetyReadiness, type ReadinessEvidence } from "./safety-readiness";

export async function companySafetyReadiness(actor: LibraryActor) {
  const { owner, member } = await libraryAuthority(db, actor);
  const people = await companyLibraryPeople(db, owner);
  const userIds = people.map(p => p.userId);
  const [incident, published, activeModules, completedModules, assigned] = await Promise.all([
    computeSafetyMetrics(owner.type === "vendor" ? { vendorId: owner.id } : { partnerId: owner.id }),
    db.select().from(templates).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id))),
    db.select().from(modules).where(eq(modules.isActive, true)),
    userIds.length ? db.select().from(completions).where(inArray(completions.userId, userIds)) : Promise.resolve([] as (typeof completions.$inferSelect)[]),
    db.select().from(instances).innerJoin(templates, eq(templates.id, instances.templateId)).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id))),
  ]);
  const training: ReadinessEvidence = { id: "training", completed: 0, required: 0, unknown: 0 };
  const acknowledgements: ReadinessEvidence = { id: "acknowledgements", completed: 0, required: 0, unknown: 0 };
  for (const module of activeModules) for (const person of people) {
    const role = person.role === "field_employee" ? "field_employee" : owner.type === "vendor" ? "vendor_office" : "partner_office";
    if (!module.requiredRoles.includes(role) && !module.requiredRoles.includes("all")) continue;
    training.required++;
    if (module.version > 1) { training.unknown++; continue; }
    if (completedModules.some(c => c.userId === person.userId && c.moduleId === module.id && c.watchProgressPct >= 100 && c.completedAt >= module.createdAt)) training.completed++;
  }
  const candidates = published.flatMap(t => {
    const parsed = LibraryMetadataSchema.safeParse(t.libraryMetadata);
    return parsed.success && parsed.data.state === "published" && parsed.data.content?.safetyRelated && ["training", "policy", "form"].includes(parsed.data.kind) ? [{ row: t, metadata: parsed.data }] : [];
  });
  const marked = candidates.filter(item => !candidates.some(other => other.metadata.seriesId === item.metadata.seriesId && other.metadata.contentVersion > item.metadata.contentVersion));
  // Current published versions define company-wide requirements. Missing assignments are outstanding.
  for (const item of marked) for (const person of people) {
    const category = item.metadata.kind === "training" ? training : acknowledgements;
    category.required++;
    const evidence = assigned.some(joined => {
      const row = joined.work_hub_form_instances;
      if (row.templateId !== item.row.id || row.templateVersion !== item.metadata.contentVersion || row.assigneeUserId !== person.userId) return false;
      const parsed = AssignmentMetadataSchema.safeParse(row.assignmentMetadata);
      return parsed.success && parsed.data.membershipId === person.membershipId && parsed.data.status === "completed" && (!parsed.data.refresherDueAt || new Date(parsed.data.refresherDueAt).getTime() > Date.now());
    });
    if (evidence) category.completed++;
  }
  const credentials: ReadinessEvidence = { id: "credentials", completed: 0, required: 0, unknown: 0 };
  const drivers: ReadinessEvidence = { id: "drivers", completed: 0, required: 0, unknown: 0 };
  const inspections: ReadinessEvidence = { id: "inspections", completed: 0, required: 0, unknown: 0 };
  if (owner.type === "vendor") {
    const employees = await db.select({ id: vendorPeopleTable.id, userId: vendorPeopleTable.userId, role: vendorPeopleTable.vendorRole }).from(vendorPeopleTable).where(and(eq(vendorPeopleTable.vendorId, owner.id), eq(vendorPeopleTable.isActive, true), isNull(vendorPeopleTable.deletedAt)));
    const ids = employees.map(e => e.id);
    const certificates = ids.length ? await db.select().from(employeeCertificationsTable).where(and(inArray(employeeCertificationsTable.employeeId, ids), isNull(employeeCertificationsTable.deletedAt))) : [];
    const today = new Date().toISOString().slice(0, 10);
    credentials.required = certificates.length;
    for (const certificate of certificates) {
      if (!certificate.vendorVerifiedAt || !certificate.expirationDate) credentials.unknown++;
      else if (certificate.expirationDate >= today) credentials.completed++;
    }
    // No recorded credential for a person is unknown, never assumed qualified.
    const missing = employees.filter(e => !certificates.some(c => c.employeeId === e.id)).length;
    credentials.required += missing; credentials.unknown += missing;
    const [vendor] = await db.select({ fleet: vendorsTable.fleetOpsState }).from(vendorsTable).where(eq(vendorsTable.id, owner.id)).limit(1);
    const fleet = FleetStateSchema.safeParse(vendor?.fleet);
    if (fleet.success && fleet.data.enabled) {
      for (const grant of fleet.data.grants.filter(g => g.roles.includes("driver") && userIds.includes(g.userId))) {
        const names = [...new Set(fleet.data.fleets.filter(f => grant.fleetIds.includes(f.id)).flatMap(f => f.requiredCertifications))];
        const person = employees.find(p => p.userId === grant.userId);
        if (!names.length) { drivers.required++; drivers.unknown++; continue; }
        for (const name of names) {
          drivers.required++;
          const matches = certificates.filter(c => c.employeeId === person?.id && c.name === name);
          if (matches.some(c => c.vendorVerifiedAt && c.expirationDate && c.expirationDate >= today)) drivers.completed++;
          else if (!matches.length || matches.some(c => !c.vendorVerifiedAt || !c.expirationDate)) drivers.unknown++;
        }
      }
      for (const run of fleet.data.runs.filter(run => !["draft", "cancelled", "completed"].includes(run.status))) {
        inspections.required++;
        const latest = [...run.inspections].reverse().find(i => i.vehicleAssetId === run.vehicleAssetId && i.trailerAssetId === run.trailerAssetId && i.driverUserId === run.driverUserId);
        if (latest?.outcome === "passed") inspections.completed++;
      }
    }

  }
  const correctiveRows = await db.select({ status: actions.status, verifiedAt: actions.verifiedAt }).from(actions).innerJoin(events, eq(events.id, actions.eventId)).where(owner.type === "vendor" ? eq(events.vendorId, owner.id) : eq(events.partnerId, owner.id));
  const correctiveActions = { id: "correctiveActions", required: correctiveRows.length, completed: correctiveRows.filter(a => a.status === "verified" && a.verifiedAt).length, unknown: 0 };
  const assessment = assessSafetyReadiness(incident.safetyScore, [training, acknowledgements, credentials, drivers, inspections, correctiveActions]);
  return { ...assessment, activePeople: people.length, canManage: member.role === "admin", incident, asOf: new Date().toISOString() };
}
