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
let scanning=false,cursor:string|undefined;
type RequiredTrainingOwnerRow={cursorId:string;type:string;id:number;eligible:boolean};
async function requiredTrainingOwnerPage(options:{afterId?:string;limit?:number}={}){
 const boundary=options.afterId?sql`WHERE candidate.id > ${options.afterId}`:sql``;
 const limit=options.limit??25;
 // Limit on the primary key first. The JSON predicates are evaluated only for
 // that small page, so large course bodies can never turn this worker into a
 // table-wide scan.
 const result=await db.execute<RequiredTrainingOwnerRow>(sql`
  WITH candidate_page AS MATERIALIZED (
   SELECT candidate.id,candidate.owner_org_type,candidate.owner_org_id,candidate.library_metadata
   FROM work_hub_form_templates candidate
   ${boundary}
   ORDER BY candidate.id
   LIMIT ${limit}
  )
  SELECT candidate.id AS "cursorId",candidate.owner_org_type AS type,candidate.owner_org_id AS id,
   (candidate.library_metadata->>'state'='published'
    AND candidate.library_metadata->>'kind'='training'
    AND candidate.library_metadata->'safetyResource' IS NOT NULL) AS eligible
  FROM candidate_page candidate
  ORDER BY candidate.id
 `);
 const owners=new Map<string,{type:string;id:number}>();
 for(const row of result.rows){
  if(row.eligible)owners.set(`${row.type}:${row.id}`,{type:row.type,id:row.id});
 }
 return {owners:[...owners.values()],cursorId:result.rows.at(-1)?.cursorId};
}
export async function requiredTrainingOwners(options:{afterId?:string;limit?:number}={}){
 return (await requiredTrainingOwnerPage(options)).owners;
}
export async function runRequiredTrainingWork(){
 if(scanning)return 0;scanning=true;
 try{
  const page=await requiredTrainingOwnerPage({afterId:cursor,limit:25});
  cursor=page.cursorId;
  const owners=page.owners;
  if(!owners.length)return 0;
  let assigned=0;
  for(const owner of owners){try{assigned+=await db.transaction(tx=>ensureRequiredTraining(tx,owner as WorkHubOwner));}catch{console.error('VNDRLY required-training scan deferred',owner.type,owner.id);}}
  return assigned;
 }finally{scanning=false;}
}
