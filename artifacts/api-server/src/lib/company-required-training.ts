import {safetyTrainingContentHash}from'./safety-training-content-hash';
import {and,eq,inArray,isNull,or,sql}from'drizzle-orm';
import {db,vendorsTable as vendors,canonicalServicesTable as canonical,vendorCapabilitiesTable as capabilities,vendorWorkTypesTable as vendorWork,workTypesTable as workTypes,serviceMappingsTable as mappings,vendorPartnerServiceOffersTable as offers,vendorPeopleTable as workers,workHubFormTemplatesTable as templates,workHubFormInstancesTable as instances}from'@workspace/db';
import {LibraryMetadataSchema,LibraryDraftSchema,AssignmentMetadataSchema,type WorkHubOwner}from'@workspace/api-zod';
import {companyLibraryPeople}from'../work-hub/library-audience';
import {subjectFingerprint}from'../services/service-matching/candidates';
import {safetyTrainingCatalog}from'../data/safety-training-catalog';
import {matchSafetyTrainingRoles,type ReviewedTrainingRoleRule,type CommonTrainingRoleRule}from'./safety-training-role-match';
import {requiredTrainingCoverage,type RequiredTrainingRule}from'./safety-training-requirements';
import {trainingPositionIds}from'./safety-training-position';
type Reader=Pick<typeof db,'select'>;
type Course={id:string;title:string;purpose:string;practicalBoundary:string;sourceSha256:string;contentSha256:string;sourceVersion:string;categoryId:string;compatibleVersions?:{sourceSha256:string;contentSha256:string}[]};
type LegacyService={existingCanonicalId:number;code:string;name:string;canonicalDefinition:string;relation:string;rationale:string;roleMappings:ReviewedTrainingRoleRule[];masterServiceIds:string[];resolutionMode?:string};
type MasterService={id:string;name:string;deliveryMode:string;roleRuleIds:string[];conditionalRuleIds:string[];gapTopicIds:string[];sourceUrls:string[];scopeNotes:string[]};
type ConditionalRoleRule={trigger:string;familyIds:string[];roles:string[];rationale:string};
type AdditionalRule=ReviewedTrainingRoleRule&{masterServiceIds:string[];legacyServiceCodes?:string[];requiresExposureConfirmation:boolean;sourceUrls:string[]};
export type TrainingResidual={serviceEvidence?:{serviceId:string;sourceContext:string;vendorEvidenceRequired:string[];practicalAssessmentRequired:string[]}[];groupId:string;title:string;courseId:string|null;role:string;serviceIds:string[];vendorEvidenceRequired:string[];practicalAssessmentRequired:string[];scopeConfirmation:string;sourceUrls:string[]};
export const trainingCatalog=safetyTrainingCatalog as {residuals?:{groups:TrainingResidual[];extensions?:{id:string;name:string;sourceUrls:string[];scopeNotes:string[];roleMappings:ReviewedTrainingRoleRule[];residualRequirements:TrainingResidual[]}[]};curriculum:Course[];legacy:{entries:LegacyService[]};common:{rules:CommonTrainingRoleRule[]};additional:{courses:{courseId:string;title:string;masterServiceIds:string[];legacyServiceCodes?:string[];roleMappings:AdditionalRule[]}[]};catalog:{catalogSha256:string;services:MasterService[];roleRules:Record<string,ReviewedTrainingRoleRule>;conditionalRules:Record<string,ConditionalRoleRule>;gapTopics:Record<string,unknown>}};
export function additionalTrainingApplies(rule:{masterServiceIds:string[];legacyServiceCodes?:string[]},service:{code:string;masterServiceIds:string[]}){return !!rule.legacyServiceCodes?.includes(service.code)||rule.masterServiceIds.some(id=>service.masterServiceIds.includes(id));}
const normalize=(value:string|null)=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
export async function selectedTrainingServices(reader:Reader,owner:WorkHubOwner){
 if(owner.type!=='vendor')return {services:[] as LegacyService[],unmapped:[] as string[]};
 const [concepts,selected,caps]=await Promise.all([
  reader.select().from(canonical).where(eq(canonical.active,true)),
  reader.select({id:workTypes.id,name:workTypes.name,description:workTypes.description,category:workTypes.category,sourceWorkTypeId:workTypes.sourceWorkTypeId}).from(vendorWork).innerJoin(workTypes,eq(workTypes.id,vendorWork.workTypeId)).where(eq(vendorWork.vendorId,owner.id)),
  reader.select().from(capabilities).where(and(eq(capabilities.vendorId,owner.id),eq(capabilities.active,true))),
 ]);
 const workById=new Map(selected.map(row=>[row.id,row]));
 for(let depth=0;depth<4;depth++){
  const needed=[...new Set([...workById.values()].flatMap(row=>row.sourceWorkTypeId&&!workById.has(row.sourceWorkTypeId)?[row.sourceWorkTypeId]:[]))];if(!needed.length)break;
  const parents=await reader.select({id:workTypes.id,name:workTypes.name,description:workTypes.description,category:workTypes.category,sourceWorkTypeId:workTypes.sourceWorkTypeId}).from(workTypes).where(inArray(workTypes.id,needed));for(const row of parents)workById.set(row.id,row);
 }
 const [decisions,offerRows]=await Promise.all([
  reader.select().from(mappings).where(and(eq(mappings.status,'active'),isNull(mappings.supersededAt),or(and(eq(mappings.subjectType,'vendor_capability'),inArray(mappings.subjectId,caps.length?caps.map(c=>c.id):[-1])),and(eq(mappings.subjectType,'partner_work_type'),inArray(mappings.subjectId,workById.size?[...workById.keys()]:[-1]))))),
  caps.length?reader.select({workTypeId:offers.workTypeId,capabilityId:offers.vendorCapabilityId}).from(offers).where(and(inArray(offers.vendorCapabilityId,caps.map(c=>c.id)),eq(offers.active,true))):Promise.resolve([] as {workTypeId:number;capabilityId:number}[]),
 ]);
 const selectedIds=new Set<number>(),capConcepts=new Map<number,number>(),unmapped:string[]=[];
 function currentConcept(type:'vendor_capability'|'partner_work_type',row:{id:number;name:string;description:string|null;category?:string|null}){
  const fingerprint=subjectFingerprint({subjectType:type,subjectId:row.id,name:row.name,description:row.description,category:row.category??null});
  return decisions.find(m=>m.subjectType===type&&m.subjectId===row.id&&(m.evidence.serviceMatching as {subjectFingerprint?:string}|undefined)?.subjectFingerprint===fingerprint&&concepts.some(c=>c.id===m.canonicalServiceId))?.canonicalServiceId??null;
 }
 for(const cap of caps){const id=currentConcept('vendor_capability',cap);if(id){selectedIds.add(id);capConcepts.set(cap.id,id);}else unmapped.push(`capability:${cap.id}`);}
 for(const chosen of selected){
  let row:typeof chosen|undefined=chosen,id:number|null=null;const visited=new Set<number>();
  while(row&&!visited.has(row.id)){visited.add(row.id);id=currentConcept('partner_work_type',row);if(id)break;
   // Exact current catalog identity is a training lookup only. It never writes
   // marketplace matches or treats similar names as operational equivalence.
   const exact=concepts.find(c=>normalize(c.name)===normalize(row!.name)&&normalize(c.definition)===normalize(row!.description));if(exact){id=exact.id;break;}
   row=row.sourceWorkTypeId?workById.get(row.sourceWorkTypeId):undefined;
  }
  if(!id){const linked=offerRows.find(o=>o.workTypeId===chosen.id&&capConcepts.has(o.capabilityId));if(linked)id=capConcepts.get(linked.capabilityId)!;}
  if(id)selectedIds.add(id);else unmapped.push(`catalog:${chosen.id}`);
 }
 const services:LegacyService[]=[];
 for(const id of selectedIds){const concept=concepts.find(c=>c.id===id),review=trainingCatalog.legacy.entries.find(c=>c.existingCanonicalId===id&&c.code===concept?.code&&c.canonicalDefinition===concept.definition);if(review)services.push(review);else unmapped.push(`service:${id}`);}
 return {services,unmapped:[...new Set(unmapped)]};
}
export async function companyRequiredTraining(reader:Reader,owner:WorkHubOwner){
  const [members,staff,selected,published,assigned,vendorRows]=await Promise.all([
  companyLibraryPeople(reader,owner),
  owner.type==='vendor'?reader.select().from(workers).where(and(eq(workers.vendorId,owner.id),eq(workers.isActive,true),isNull(workers.deletedAt))):Promise.resolve([] as (typeof workers.$inferSelect)[]),
  selectedTrainingServices(reader,owner),
  reader.select().from(templates).where(and(eq(templates.ownerOrgType,owner.type),eq(templates.ownerOrgId,owner.id),sql`${templates.libraryMetadata}->>'state'='published' AND ${templates.libraryMetadata}->>'kind' IN ('training','policy')`)),
  reader.select({templateId:instances.templateId,assigneeUserId:instances.assigneeUserId,assignment:sql<unknown>`jsonb_build_object('status',${instances.assignmentMetadata}->'status','membershipId',${instances.assignmentMetadata}->'membershipId','contentVersion',${instances.assignmentMetadata}->'contentVersion','refresherDueAt',${instances.assignmentMetadata}->'refresherDueAt')`,sourceSha256:sql<string|null>`${templates.libraryMetadata}->'safetyResource'->>'sourceSha256'`}).from(instances).innerJoin(templates,eq(templates.id,instances.templateId)).where(and(eq(templates.ownerOrgType,owner.type),eq(templates.ownerOrgId,owner.id))),
   owner.type==='vendor'?reader.select({catalog:vendors.staffRoleCatalog}).from(vendors).where(eq(vendors.id,owner.id)).limit(1):Promise.resolve([]),
 ]);
 const people=members.filter(p=>p.vendorPeopleId===null||staff.some(w=>w.id===p.vendorPeopleId));
 const trusted=new Map<string,{record:typeof templates.$inferSelect;metadata:ReturnType<typeof LibraryMetadataSchema.parse>}>();
 const trustedVersionFamilies=new Map<string,{familyId:string;contentVersion:number;compatible:boolean}>();
 for(const record of published){
  const parsed=LibraryMetadataSchema.safeParse(record.libraryMetadata);if(!parsed.success)continue;const metadata=parsed.data;
  if(metadata.kind!=='training'||metadata.state!=='published'||!metadata.content||!metadata.safetyResource)continue;
  const course=trainingCatalog.curriculum.find(c=>c.id===metadata.safetyResource!.familyId);if(!course)continue;
  const version=[course,...(course.compatibleVersions??[])].find(v=>v.sourceSha256===metadata.safetyResource!.sourceSha256);if(!version)continue;
  const hash=safetyTrainingContentHash(LibraryDraftSchema.parse(metadata.content));if(hash!==version.contentSha256)continue;
  trustedVersionFamilies.set(record.id,{familyId:course.id,contentVersion:metadata.contentVersion,compatible:!!course.compatibleVersions?.some(v=>v.sourceSha256===metadata.safetyResource!.sourceSha256&&v.contentSha256===hash)});
  if(!trusted.has(course.id)||trusted.get(course.id)!.metadata.contentVersion<metadata.contentVersion)trusted.set(course.id,{record,metadata});
 }
  const positions=vendorRows[0]?.catalog?.entries??[];
  const scopeDecisions=new Map<string,{applies:boolean;userIds:number[];staffRoleIds:string[]}>();
 for(const row of [...published].sort((a,b)=>a.currentVersion-b.currentVersion)){
  const parsed=LibraryMetadataSchema.safeParse(row.libraryMetadata);if(!parsed.success||parsed.data.state!=='published'||!parsed.data.safetyResource)continue;
   for(const decision of parsed.data.trainingPolicy?.serviceApplicability??[])scopeDecisions.set(`${parsed.data.safetyResource.familyId}:${decision.serviceId}`,decision);
 }
 const rules:RequiredTrainingRule[]=[],unresolved:Array<{userId:number;serviceId:string;role:string;reason:string}>=[],conditionalCourseGaps:Array<{userId:number;serviceId:string;familyId:string;role:string;reason:string}>=[];
 const coveragePeople=people.map(person=>{
  const worker=staff.find(w=>w.id===person.vendorPeopleId||w.userId===person.userId);
  const input={roles:worker?.roles??[],vendorRole:worker?.vendorRole??(person.role==='field_employee'?'field':'office'),jobTitle:worker?.jobTitle??null,membershipRole:person.role};
   const positionIds=trainingPositionIds(input,positions);
  const personalRole=`member:${person.membershipId}`;
  const common=matchSafetyTrainingRoles(input,[],trainingCatalog.common.rules);
  rules.push({serviceId:'*',roleIds:[personalRole],familyIds:common.familyIds});
  for(const value of common.unresolvedRoles)unresolved.push({userId:person.userId,serviceId:'*',...value});
  for(const service of selected.services){
   const matches=matchSafetyTrainingRoles(input,service.roleMappings,[]);
   rules.push({serviceId:service.code,roleIds:[personalRole],familyIds:matches.familyIds});
   for(const value of matches.unresolvedRoles)unresolved.push({userId:person.userId,serviceId:service.code,...value});
   for(const additional of trainingCatalog.additional.courses){
    if(!additionalTrainingApplies(additional,service))continue;
    const candidates=additional.roleMappings.filter(rule=>additionalTrainingApplies(rule,service));
    const matched=matchSafetyTrainingRoles(input,candidates,[]);
    if(!matched.matchedRoleRules.length)continue;
    const decision=scopeDecisions.get(`${additional.courseId}:${service.code}`);
    const targeted=!!decision&&(decision.userIds.includes(person.userId)||decision.staffRoleIds.some(id=>positionIds.includes(id)));
    if(targeted&&decision!.applies)rules.push({serviceId:service.code,roleIds:[personalRole],familyIds:matched.familyIds});
    else if(!targeted)for(const match of matched.matchedRoleRules)conditionalCourseGaps.push({userId:person.userId,serviceId:service.code,familyId:additional.courseId,role:match.role,reason:match.trigger??'Confirm the actual material, task and jurisdiction for this person or position in this course Policy before treating this conditional foundation as applicable or complete.'});
   }
  }
  return {userId:person.userId,membershipId:person.membershipId,active:true,roleIds:[personalRole]};
 });
 const curriculum=trainingCatalog.curriculum.map(course=>{const item=trusted.get(course.id);return {familyId:course.id,itemId:item?.record.id??'',contentVersion:item?.metadata.contentVersion??0,sourceSha256:item?.metadata.safetyResource?.sourceSha256??course.sourceSha256,available:!!item};});
 const completionSchema=AssignmentMetadataSchema.pick({status:true,membershipId:true,contentVersion:true,refresherDueAt:true});
 const completions=assigned.flatMap(row=>{const a=completionSchema.safeParse(row.assignment),userId=row.assigneeUserId;if(!userId||!a.success||!row.sourceSha256)return[];const version=trustedVersionFamilies.get(row.templateId),current=version?.compatible&&version.contentVersion===a.data.contentVersion?trusted.get(version.familyId):undefined;return [{userId,membershipId:a.data.membershipId,itemId:current?.record.id??row.templateId,contentVersion:current?.metadata.contentVersion??a.data.contentVersion,sourceSha256:current?.metadata.safetyResource?.sourceSha256??row.sourceSha256,status:a.data.status,refresherDueAt:a.data.refresherDueAt}];});
 const coverage=requiredTrainingCoverage({selectedServiceIds:selected.services.map(s=>s.code),rules,people:coveragePeople,curriculum,completions});
  const scopeIssues=selected.services.filter(s=>s.roleMappings.some(rule=>rule.scopeMustBeConfirmed)||(['scope_unresolved','material_not_service'].includes(s.relation)&&s.resolutionMode!=='dedicated_extension_roles')).map(s=>({serviceId:s.code,reason:s.roleMappings.some(rule=>rule.scopeMustBeConfirmed)?`${s.rationale} Actual legacy component scope remains unconfirmed; reviewed role rules explicitly require scope confirmation.`:s.rationale}));
 const scopeMissing=owner.type==='vendor'&&selected.services.length===0;
 return {...coverage,serviceScopeMissing:scopeMissing,provisional:coverage.unavailable>0||scopeMissing||!!(selected.unmapped.length||unresolved.length||scopeIssues.length||conditionalCourseGaps.length),services:selected.services.map(({existingCanonicalId,code,name,masterServiceIds,relation,rationale})=>({id:existingCanonicalId,code,name,masterServiceIds,relation,rationale})),unmappedServiceIds:selected.unmapped,unresolvedRoles:unresolved,scopeIssues,conditionalCourseGaps,people:coveragePeople,audience:people,curriculum,items:trusted,rules};
}


