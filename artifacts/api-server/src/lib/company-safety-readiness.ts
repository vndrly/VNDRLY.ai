import { and, eq, inArray, isNull,sql } from "drizzle-orm";
import { db, vendorsTable, vendorPeopleTable, employeeCertificationsTable, workHubFormTemplatesTable as templates, workHubFormInstancesTable as instances, safetyEventsTable as events, safetyCorrectiveActionsTable as actions } from "@workspace/db";
import { FleetStateSchema } from "../services/fleet-repository";
import { AssignmentMetadataSchema, LibraryMetadataSchema } from "@workspace/api-zod";
import { libraryAuthority, type LibraryActor } from "../work-hub/library-core";
import { companyLibraryPeople } from "../work-hub/library-audience";
import { computeSafetyMetrics } from "./safety-metrics";
import { assessSafetyReadiness, currentCredential, currentFleetInspection, type ReadinessEvidence } from "./safety-readiness";
import {companyRequiredTraining}from'./company-required-training';

export async function companySafetyReadiness(actor: LibraryActor) {
  const { owner, member } = await libraryAuthority(db, actor);
  const people = await companyLibraryPeople(db, owner);
  const userIds = people.map(p => p.userId);
  const [incident, published, assigned, requiredTraining] = await Promise.all([
    computeSafetyMetrics(owner.type === "vendor" ? { vendorId: owner.id } : { partnerId: owner.id }),
    db.select({id:templates.id,libraryMetadata:sql<unknown>`CASE WHEN ${templates.libraryMetadata}->>'kind'='training' THEN ${templates.libraryMetadata}-'content'-'fileSnapshots'-'trainingPolicy' ELSE ${templates.libraryMetadata} END`}).from(templates).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id))),
    db.select({templateId:instances.templateId,templateVersion:instances.templateVersion,assigneeUserId:instances.assigneeUserId,assignment:sql<unknown>`jsonb_build_object('status',${instances.assignmentMetadata}->'status','membershipId',${instances.assignmentMetadata}->'membershipId','refresherDueAt',${instances.assignmentMetadata}->'refresherDueAt')`}).from(instances).innerJoin(templates, eq(templates.id, instances.templateId)).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id))),
    companyRequiredTraining(db,owner),
  ]);
  const completedAssignments = new Set(assigned.flatMap(joined => {
    const row=joined, parsed=AssignmentMetadataSchema.pick({status:true,membershipId:true,refresherDueAt:true}).safeParse(row.assignment);
    return parsed.success && parsed.data.status === "completed" && (!parsed.data.refresherDueAt || new Date(parsed.data.refresherDueAt).getTime() > Date.now()) ? [`${row.templateId}:${row.templateVersion}:${row.assigneeUserId}:${parsed.data.membershipId}`] : [];
  }));
  const training: ReadinessEvidence = { id: "training", completed: requiredTraining.completed, required: requiredTraining.required, unknown: requiredTraining.unavailable };
  const acknowledgements: ReadinessEvidence = { id: "acknowledgements", completed: 0, required: 0, unknown: 0 };
  const candidates = published.flatMap(t => {
    const parsed = LibraryMetadataSchema.safeParse(t.libraryMetadata);
    return parsed.success && parsed.data.state !== "draft" ? [{ row: t, metadata: parsed.data }] : [];
  });
  const marked = candidates.filter(item => !candidates.some(other => other.metadata.seriesId === item.metadata.seriesId && other.metadata.contentVersion > item.metadata.contentVersion)).filter(item => item.metadata.state === "published" && item.metadata.content?.safetyRelated && ["training", "policy", "form"].includes(item.metadata.kind));
  // Keep existing acknowledgment evidence separate from the role/service training baseline.
  for (const item of marked) for (const person of people) {
    if(item.metadata.kind==='training')continue;
    const category = acknowledgements;
    category.required++;
    const evidence = completedAssignments.has(`${item.row.id}:${item.metadata.contentVersion}:${person.userId}:${person.membershipId}`);
    if (evidence) category.completed++;
  }
  const credentials: ReadinessEvidence = { id: "credentials", completed: 0, required: 0, unknown: 0 };
  const drivers: ReadinessEvidence = { id: "drivers", completed: 0, required: 0, unknown: 0 };
  const inspections: ReadinessEvidence = { id: "inspections", completed: 0, required: 0, unknown: 0 };
  if (owner.type === "vendor") {
    const employees = await db.select({ id: vendorPeopleTable.id, userId: vendorPeopleTable.userId, role: vendorPeopleTable.vendorRole }).from(vendorPeopleTable).where(and(eq(vendorPeopleTable.vendorId, owner.id), eq(vendorPeopleTable.isActive, true), inArray(vendorPeopleTable.userId, userIds.length ? userIds : [-1]), isNull(vendorPeopleTable.deletedAt)));
    const ids = employees.map(e => e.id);
    const certificates = ids.length ? await db.select().from(employeeCertificationsTable).where(and(inArray(employeeCertificationsTable.employeeId, ids), isNull(employeeCertificationsTable.deletedAt))) : [];
    const today = new Date().toISOString().slice(0, 10);
    credentials.required = employees.length;
    for (const employee of employees) {
      const records=certificates.filter(c=>c.employeeId===employee.id);
      if (!records.length || records.some(c=>!c.vendorVerifiedAt || !c.expirationDate)) credentials.unknown++;
      else if (records.every(c=>currentCredential(c,today))) credentials.completed++;
    }
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
          if (matches.some(c => currentCredential(c, today))) drivers.completed++;
          else if (!matches.length || matches.some(c => !c.vendorVerifiedAt || !c.expirationDate)) drivers.unknown++;
        }
      }
      for (const run of fleet.data.runs.filter(run => !["draft", "cancelled", "completed"].includes(run.status))) {
        inspections.required++;
        if (currentFleetInspection(run)) inspections.completed++;
      }
    }

  }
  const correctiveRows = await db.select({ status: actions.status, verifiedAt: actions.verifiedAt }).from(actions).innerJoin(events, eq(events.id, actions.eventId)).where(owner.type === "vendor" ? eq(events.vendorId, owner.id) : eq(events.partnerId, owner.id));
  const correctiveActions = { id: "correctiveActions", required: correctiveRows.length, completed: correctiveRows.filter(a => a.status === "verified" && a.verifiedAt).length, unknown: 0 };
  const assessment = assessSafetyReadiness(incident.safetyScore, [training, acknowledgements, credentials, drivers, inspections, correctiveActions]);
  return { ...assessment, provisional:assessment.provisional||requiredTraining.provisional,categories:assessment.categories.map(category=>category.id==='training'?{...category,provisional:category.provisional||requiredTraining.provisional}:category),activePeople: people.length, canManage: member.role === "admin", incident, trainingBaseline:{catalogServices:963,services:requiredTraining.services,required:requiredTraining.required,completed:requiredTraining.completed,unavailable:requiredTraining.unavailable,provisional:requiredTraining.provisional,unmappedServiceIds:requiredTraining.unmappedServiceIds,unresolvedRoles:requiredTraining.unresolvedRoles,scopeIssues:requiredTraining.scopeIssues,conditionalCourseGaps:requiredTraining.conditionalCourseGaps.map(gap=>({...gap,trainingItemId:requiredTraining.items.get(gap.familyId)?.record.id??null,courseTitle:requiredTraining.items.get(gap.familyId)?.record.name??gap.familyId})),vendorExtrasCountTowardScore:false},asOf: new Date().toISOString() };
}
