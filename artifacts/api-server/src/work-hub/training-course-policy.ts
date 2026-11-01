import {and,eq,isNull,sql} from 'drizzle-orm';
import {db,vendorsTable,vendorPeopleTable,workHubFormTemplatesTable as templates,vendorCrewPresetsTable as crews,workHubChannelsTable as channels,workHubChannelMembersTable as channelMembers} from '@workspace/db';
import {LibraryMetadataSchema,TrainingPolicyDetailsSchema,type WorkHubCommandEnvelope,type WorkHubOwner} from '@workspace/api-zod';
import {libraryAuthority,libraryRecord,libraryCommand,checkLibraryVersion,LibraryError,type LibraryActor,type LibraryTx} from './library-core';
import {companyLibraryPeople,libraryOptions} from './library-audience';
import {allocateLibraryItems} from './library-assignments';
import {trainingCatalog,selectedTrainingServices}from'../lib/company-required-training';

const normalized=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
export async function lockCompanyTraining(tx:LibraryTx,owner:WorkHubOwner){
 await tx.select({id:templates.id}).from(templates).where(and(eq(templates.ownerOrgType,owner.type),eq(templates.ownerOrgId,owner.id),sql`${templates.libraryMetadata}->>'kind'='training'`)).orderBy(templates.id).for('update');
}
type Position={id:string;label:string;aliases?:string[]};
export function trainingPositionIds(person:{jobTitle:string|null;roles:string[];vendorRole:string},positions:Position[]){
 const labels=[person.jobTitle??'',...person.roles].map(normalized).filter(Boolean);
 return [...new Set([`operation:${normalized(person.vendorRole)}`,...person.roles.map(r=>`operation:${normalized(r)}`),...(person.jobTitle?[`title:${normalized(person.jobTitle)}`]:[]),...positions.filter(p=>[p.label,...(p.aliases??[])].some(label=>labels.includes(normalized(label)))).map(p=>`staff:${p.id}`)])];
}
async function companyPositions(reader:Pick<typeof db,'select'>,owner:WorkHubOwner){
 if(owner.type!=='vendor')return {positions:[] as Position[],rows:[] as Array<typeof vendorPeopleTable.$inferSelect>,options:[] as {id:string;label:string}[]};
 const [vendor]=await reader.select({catalog:vendorsTable.staffRoleCatalog}).from(vendorsTable).where(eq(vendorsTable.id,owner.id)).limit(1);
 const positions=vendor?.catalog?.entries??[];
 const rows=await reader.select().from(vendorPeopleTable).where(and(eq(vendorPeopleTable.vendorId,owner.id),eq(vendorPeopleTable.isActive,true),isNull(vendorPeopleTable.deletedAt)));
 const options=new Map(positions.map(p=>[`staff:${p.id}`,{id:`staff:${p.id}`,label:p.label}]));
 for(const person of rows){
  if(person.jobTitle)options.set(`title:${normalized(person.jobTitle)}`,{id:`title:${normalized(person.jobTitle)}`,label:person.jobTitle});
  for(const role of [person.vendorRole,...person.roles])options.set(`operation:${normalized(role)}`,{id:`operation:${normalized(role)}`,label:`${role} (operational role)`});
 }
 return {positions,rows,options:[...options.values()].sort((a,b)=>a.label.localeCompare(b.label))};
}
async function linkedTraining(reader:Pick<typeof db,'select'>,owner:WorkHubOwner,familyId:string,lock=false){
 const query=reader.select().from(templates).where(and(eq(templates.ownerOrgType,owner.type),eq(templates.ownerOrgId,owner.id),sql`${templates.libraryMetadata}->'safetyResource'->>'familyId'=${familyId}`,sql`${templates.libraryMetadata}->>'kind'='training' AND ${templates.libraryMetadata}->>'state'<>'draft'`)).orderBy(templates.id);
 const rows=await(lock?query.for('update'):query);
 const latest=rows.sort((a,b)=>b.currentVersion-a.currentVersion)[0];
 return latest&&LibraryMetadataSchema.parse(latest.libraryMetadata).state==='published'?latest:undefined;
}
function checkPolicy(metadata:ReturnType<typeof LibraryMetadataSchema.parse>){
 if(!metadata.safetyResource||!['policy','training'].includes(metadata.kind))throw new LibraryError('A safety course or its Policy page is required',400);
}
export async function readTrainingPolicy(actor:LibraryActor,id:string){
 const {owner}=await libraryAuthority(db,actor,true);
 const own=await libraryRecord(db,actor,id,true);checkPolicy(own.metadata);
 const course=await linkedTraining(db,owner,own.metadata.safetyResource!.familyId);
 const options=await libraryOptions(actor),staff=await companyPositions(db,owner);
 const reference=trainingCatalog.curriculum.find(item=>item.id===own.metadata.safetyResource!.familyId);
 const policy=TrainingPolicyDetailsSchema.parse(own.metadata.trainingPolicy??{title:course?.name??own.record.name,description:course?.libraryMetadata?LibraryMetadataSchema.parse(course.libraryMetadata).content?.description??'':own.metadata.content?.description??'',purpose:reference?.purpose??own.metadata.content?.description??''});
 const requiredPeopleIds=options.people.filter(person=>{const worker=staff.rows.find(row=>row.id===person.vendorPeopleId||row.userId===person.userId);return policy.requiredUserIds.includes(person.userId)||(worker&&policy.requiredStaffRoleIds.some(role=>trainingPositionIds(worker,staff.positions).includes(role)));}).map(person=>person.userId);
 const selected=await selectedTrainingServices(db,owner),additional=trainingCatalog.additional.courses.find(item=>item.courseId===own.metadata.safetyResource!.familyId);
 const applicabilityOptions=additional?selected.services.filter(service=>additional.masterServiceIds.some(id=>service.masterServiceIds.includes(id))).map(service=>({serviceId:service.code,label:service.name,roleDescriptions:additional.roleMappings.filter(rule=>rule.masterServiceIds.some(id=>service.masterServiceIds.includes(id))).map(rule=>rule.trigger??rule.rationale)})):[];
 return {itemId:id,version:own.metadata.version,familyId:own.metadata.safetyResource!.familyId,trainingItemId:course?.id??null,policy,requiredPeopleIds,applicabilityOptions,people:options.people,groups:options.groups,positions:staff.options,files:options.files};
}
export async function saveTrainingPolicy(actor:LibraryActor,id:string,envelope:WorkHubCommandEnvelope){
 const input=TrainingPolicyDetailsSchema.parse(envelope.payload);
 const options=await libraryOptions(actor),{owner}=await libraryAuthority(db,actor,true),staff=await companyPositions(db,owner);
 const selected=await selectedTrainingServices(db,owner);
 return libraryCommand(actor,envelope,'library.training-policy',id,async tx=>{
  const own=await libraryRecord(tx,actor,id,true,true);checkPolicy(own.metadata);await checkLibraryVersion(own.metadata,envelope);
  const prior=own.metadata.trainingPolicy;
  const additional=trainingCatalog.additional.courses.find(item=>item.courseId===own.metadata.safetyResource!.familyId);
  if(input.serviceApplicability.some(decision=>!prior?.serviceApplicability.some(old=>old.serviceId===decision.serviceId)&&!selected.services.some(service=>service.code===decision.serviceId&&additional?.masterServiceIds.some(id=>service.masterServiceIds.includes(id)))))throw new LibraryError('Confirm only a reviewed service in this company catalog',400);
  // Retain historical selections visibly when a person/group/file becomes
  // unavailable; never accept a newly introduced out-of-company identifier.
  if(input.requiredUserIds.some(id=>!options.people.some(p=>p.userId===id)&&!prior?.requiredUserIds.includes(id))||input.requiredGroupIds.some(id=>!options.groups.some(g=>g.id===id)&&!prior?.requiredGroupIds.includes(id))||input.requiredStaffRoleIds.some(id=>!staff.options.some(r=>r.id===id)&&!prior?.requiredStaffRoleIds.includes(id))||input.attachmentFileIds.some(id=>!options.files.some(f=>f.id===id)&&!prior?.attachmentFileIds.includes(id)))throw new LibraryError('Choose people, groups, positions and files from this company',400);
  own.metadata.trainingPolicy={...input,activatedAt:(input.newHireRequired||input.roleChangeRequired)?prior?.activatedAt??new Date().toISOString():prior?.activatedAt??null,nextScanAt:null};
  own.metadata.version++;
  await tx.update(templates).set({libraryMetadata:own.metadata,...(own.metadata.kind==='policy'?{name:input.title}:{})}).where(eq(templates.id,id));
  return {itemId:id,version:own.metadata.version,policy:own.metadata.trainingPolicy,notificationState:'none'};
 });
}
export async function assignPolicyTraining(tx:LibraryTx,record:typeof templates.$inferSelect,onlyUserId?:number,now=new Date()){
 const metadata=LibraryMetadataSchema.parse(record.libraryMetadata),policy=metadata.trainingPolicy;
 if(!policy||!metadata.safetyResource||metadata.state!=='published'||(!policy.newHireRequired&&!policy.roleChangeRequired))return 0;
 const owner={type:record.ownerOrgType,id:record.ownerOrgId} as WorkHubOwner;
 await lockCompanyTraining(tx,owner);
 const people=await companyLibraryPeople(tx,owner),staff=await companyPositions(tx,owner);
 const administrator=people.find(p=>p.userId===record.createdById&&p.role==='admin')??people.find(p=>p.role==='admin');
 if(!administrator)return 0;
 const groupUserIds=new Set<number>();
 for(const groupId of policy.requiredGroupIds){
  if(groupId.startsWith('crew:')){
   if(owner.type!=='vendor')continue;
   const [crew]=await tx.select().from(crews).where(and(eq(crews.id,Number(groupId.slice(5))),eq(crews.vendorId,owner.id))).limit(1);
   const ids=Array.isArray(crew?.memberEmployeeIds)?crew.memberEmployeeIds:[];
   for(const person of people)if(person.vendorPeopleId!==null&&ids.includes(person.vendorPeopleId))groupUserIds.add(person.userId);
  }else{
   const [group]=await tx.select({id:channels.id}).from(channels).where(and(eq(channels.id,groupId),eq(channels.ownerOrgType,owner.type),eq(channels.ownerOrgId,owner.id),eq(channels.status,'active'))).limit(1);
   if(!group)continue;
   const members=await tx.select({userId:channelMembers.userId}).from(channelMembers).where(eq(channelMembers.channelId,group.id));
   for(const member of members)groupUserIds.add(member.userId);
  }
 }
 const selected=people.filter(person=>{
  if(onlyUserId&&person.userId!==onlyUserId)return false;
  const worker=staff.rows.find(p=>p.id===person.vendorPeopleId||p.userId===person.userId);
  if(person.vendorPeopleId!==null&&!worker)return false;
  if(worker&&!worker.isActive)return false;
  const roles=worker?trainingPositionIds(worker,staff.positions):[];
  const inScope=policy.requiredUserIds.includes(person.userId)||groupUserIds.has(person.userId)||policy.requiredStaffRoleIds.some(role=>roles.includes(role));
  if(!inScope)return false;
  return policy.roleChangeRequired||(policy.newHireRequired&&!!policy.activatedAt&&person.joinedAt.getTime()>=Date.parse(policy.activatedAt));
 });
 if(!selected.length)return 0;
 const training=await linkedTraining(tx,owner,metadata.safetyResource.familyId,true);
 if(!training)return 0;
 const courseMetadata=LibraryMetadataSchema.parse(training.libraryMetadata),root={record:training,metadata:courseMetadata,owner};
 const entry={templateId:training.id,contentVersion:courseMetadata.contentVersion,dueHours:courseMetadata.content!.dueHours,presentation:'first_entry' as const,requiredBeforeWork:false};
 const result=await allocateLibraryItems(tx,root,[{...root,entry}],selected,false,now,undefined,administrator.userId);
 return result.assigned.length;
}
export async function ensurePolicyTraining(tx:LibraryTx,owner:WorkHubOwner,userId:number){
 const policies=await tx.select().from(templates).where(and(eq(templates.ownerOrgType,owner.type),eq(templates.ownerOrgId,owner.id),sql`${templates.libraryMetadata}->>'state'<>'draft' AND ${templates.libraryMetadata}->>'kind' IN ('policy','training')`));
 const seen=new Set<string>();let count=0;
 for(const policy of policies.sort((a,b)=>b.currentVersion-a.currentVersion||a.id.localeCompare(b.id))){
  const metadata=LibraryMetadataSchema.parse(policy.libraryMetadata);if(seen.has(metadata.seriesId))continue;seen.add(metadata.seriesId);
  count+=await assignPolicyTraining(tx,policy,userId);
 }
 return count;
}
