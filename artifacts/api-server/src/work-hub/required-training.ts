import {sql,and,eq}from'drizzle-orm';
import {db,workHubFormTemplatesTable as templates,workHubFormInstancesTable as instances}from'@workspace/db';
import {AssignmentMetadataSchema,type WorkHubOwner}from'@workspace/api-zod';
import {companyRequiredTraining}from'../lib/company-required-training';
import {type LibraryTx}from'./library-core';
import {allocateLibraryItems}from'./library-assignments';
import {lockCompanyTraining}from'./training-course-policy';
export async function ensureRequiredTraining(tx:LibraryTx,owner:WorkHubOwner,onlyUserId?:number){
 await lockCompanyTraining(tx,owner);
 const plan=await companyRequiredTraining(tx,owner,onlyUserId);
 // The company lock above also protects this shared snapshot. Reuse the same
 // active revision/membership that allocateLibraryItems would reuse, in one
 // read instead of one round trip per course on every Work Hub entry.
 const existing=await tx.select({templateId:instances.templateId,userId:instances.assigneeUserId,metadata:instances.assignmentMetadata}).from(instances).innerJoin(templates,eq(templates.id,instances.templateId)).where(and(eq(templates.ownerOrgType,owner.type),eq(templates.ownerOrgId,owner.id),onlyUserId?eq(instances.assigneeUserId,onlyUserId):undefined));
 const reusable=new Set(existing.flatMap(row=>{
  const a=AssignmentMetadataSchema.safeParse(row.metadata);
  return a.success&&a.data.status!=='cancelled'?[JSON.stringify([row.templateId,row.userId,a.data.membershipId,a.data.contentVersion])]:[];
 }));
 let assigned=0;
 for(const item of [...plan.items.values()].sort((a,b)=>a.record.id.localeCompare(b.record.id))){
  const required=plan.requirements.filter(r=>r.itemId===item.record.id&&!r.completed&&(!onlyUserId||r.userId===onlyUserId));
  const people=plan.audience.filter(p=>required.some(r=>r.userId===p.userId&&r.membershipId===p.membershipId)&&!reusable.has(JSON.stringify([item.record.id,p.userId,p.membershipId,item.metadata.contentVersion])));
  if(!people.length)continue;
  const root={...item,owner},entry={templateId:item.record.id,contentVersion:item.metadata.contentVersion,dueHours:item.metadata.content!.dueHours,presentation:'first_entry' as const,requiredBeforeWork:false};
  const result=await allocateLibraryItems(tx,root,[{...root,entry}],people,false,new Date(),undefined,plan.audience.find(p=>p.role==='admin')?.userId);
  assigned+=result.assigned.length;
 }
 return assigned;
}
let scanning=false,cursor=0;
export async function requiredTrainingOwners(){
 // Course bodies share a large toasted JSON value with their metadata. Gate
 // JSON inspection on the owner first; PostgreSQL may reorder ordinary AND
 // predicates and otherwise decompress other companies' courses repeatedly.
 const result=await db.execute<{type:string;id:number}>(sql`
  WITH owners AS MATERIALIZED (
   SELECT DISTINCT owner_org_type,owner_org_id FROM work_hub_form_templates
  )
  SELECT owners.owner_org_type AS type,owners.owner_org_id AS id FROM owners
  CROSS JOIN LATERAL (
   SELECT 1 FROM work_hub_form_templates candidate
   WHERE CASE WHEN candidate.owner_org_type=owners.owner_org_type AND candidate.owner_org_id=owners.owner_org_id THEN
    candidate.library_metadata->>'state'='published'
    AND candidate.library_metadata->>'kind'='training'
    AND candidate.library_metadata->'safetyResource' IS NOT NULL
   ELSE false END
   LIMIT 1
  ) eligible
  ORDER BY owners.owner_org_type,owners.owner_org_id
 `);
 return result.rows;
}
export async function runRequiredTrainingWork(){
 if(scanning)return 0;scanning=true;
 try{
  const owners=await requiredTrainingOwners();
  if(!owners.length)return 0;
  const selected=Array.from({length:Math.min(20,owners.length)},(_,i)=>owners[(cursor+i)%owners.length]);cursor=(cursor+selected.length)%owners.length;
  let assigned=0;
  for(const owner of selected){try{assigned+=await db.transaction(tx=>ensureRequiredTraining(tx,owner as WorkHubOwner));}catch{console.error('VNDRLY required-training scan deferred',owner.type,owner.id);}}
  return assigned;
 }finally{scanning=false;}
}
