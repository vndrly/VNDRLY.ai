import {and,eq,desc,sql} from 'drizzle-orm';
import {db,workHubFormInstancesTable as instances,workHubFormTemplatesTable as templates} from '@workspace/db';
import {AssignmentMetadataSchema} from '@workspace/api-zod';
import {libraryRecord,LibraryError,type LibraryActor} from './library-core';
import {companyLibraryPeople} from './library-audience';

export async function trainingCourseReview(actor:LibraryActor,itemId:string){
 const own=await libraryRecord(db,actor,itemId,true);
 if(own.metadata.kind!=='training')throw new LibraryError('Training course required',400);
 const people=await companyLibraryPeople(db,own.owner);
 const family=own.metadata.safetyResource?.familyId;
 const rows=await db.select({id:instances.id,userId:instances.assigneeUserId,metadata:instances.assignmentMetadata})
  .from(instances).innerJoin(templates,eq(templates.id,instances.templateId))
  .where(and(eq(templates.ownerOrgType,own.owner.type),eq(templates.ownerOrgId,own.owner.id),family?sql`${templates.libraryMetadata}->'safetyResource'->>'familyId'=${family}`:sql`${templates.libraryMetadata}->>'seriesId'=${own.metadata.seriesId}`))
  .orderBy(desc(instances.createdAt));
 const records=rows.flatMap(row=>{const parsed=AssignmentMetadataSchema.safeParse(row.metadata);return parsed.success?[{...row,assignment:parsed.data}]:[];});
 return {itemId,title:own.record.name,people:people.map(person=>{
  const record=records.find(r=>r.userId===person.userId&&r.assignment.membershipId===person.membershipId);
  const a=record?.assignment,g=a?.progress.guided,exam=a?.progress.certificationExam?.attempts.filter(x=>x.submittedAt).at(-1);
  return {userId:person.userId,name:person.name??person.email??String(person.userId),status:a?.status??'not_assigned',instanceId:record?.id??null,contentVersion:a?.contentVersion??null,originalPercent:g?.scores?.originalPercent??null,remediatedPercent:g?.scores?.remediatedPercent??null,examPercent:exam?.score??null};
 })};
}
