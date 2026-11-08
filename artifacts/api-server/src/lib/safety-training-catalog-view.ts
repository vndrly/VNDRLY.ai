import {db}from'@workspace/db';
import {libraryAuthority,type LibraryActor}from'../work-hub/library-core';
import {companyRequiredTraining,trainingCatalog,type TrainingResidual}from'./company-required-training';
import type { WorkHubOwner } from '@workspace/api-zod';
import { storedTrainingProjection } from '../work-hub/stored-training-projections';

/** One saved company baseline serves every search/filter combination. */
export async function storedCompanySafetyCatalog(owner: WorkHubOwner) {
 return storedTrainingProjection(`${owner.type}:${owner.id}:catalog`, async () => {
  const plan = await companyRequiredTraining(db, owner);
  return {
   provisional: plan.provisional,
   services: plan.services,
   itemIds: Object.fromEntries([...plan.items].map(([familyId, item]) => [familyId, item.record.id])),
   courses: trainingCatalog.curriculum.map(course => ({
    id: course.id, title: course.title, purpose: course.purpose,
    practicalBoundary: course.id === 'G99' ? '' : course.practicalBoundary,
    trainingItemId: plan.items.get(course.id)?.record.id ?? null,
    required: plan.requirements.filter(r => r.familyId === course.id).length,
    completed: plan.requirements.filter(r => r.familyId === course.id && r.completed).length,
   })),
  };
 });
}
// Search terms only: these do not assign training or change service scope.
const serviceSearchAliases: Record<string, readonly string[]> = {
 'VMS-5D2D3CEB7A': ['gate attendant', 'gate guard', 'site access control', 'visitor check-in', 'vehicle admission'],
 h2s_monitoring_safety_trailer: ['hydrogen sulfide', 'sour gas', 'gas detection', 'personal gas monitor'],
 'VMS-A1652B8D16': ['seismic survey', '2d seismic', '3d seismic', '4d seismic'],
};
const normalizeSearch = (text:string) => text.normalize('NFKC').toLowerCase().replace(/[-‐‑–—]/g,' ').replace(/\s+/g,' ').trim();
export async function safetyTrainingCatalogView(actor:LibraryActor,input:{search?:string;familyId?:string;offset?:number;allServices?:boolean}){
 const {owner}=await libraryAuthority(db,actor,true);
 const plan=await storedCompanySafetyCatalog(owner);
 const conditionalRules=(service:typeof trainingCatalog.catalog.services[number])=>(service.conditionalRuleIds??[]).flatMap(id=>{
  const rule=trainingCatalog.catalog.conditionalRules[id];
  return rule?[{id,role:rule.roles.join('; '),familyIds:rule.familyIds,trigger:rule.trigger,rationale:rule.rationale,conditional:true as const,scopeMustBeConfirmed:true}]:[];
 });
 const projectResidual=(group:TrainingResidual,serviceId:string)=>{const {serviceEvidence,...common}=group;const specific=serviceEvidence?.find(row=>row.serviceId===serviceId);return {...common,...(specific?{vendorEvidenceRequired:specific.vendorEvidenceRequired,practicalAssessmentRequired:specific.practicalAssessmentRequired,scopeConfirmation:specific.sourceContext}:{}),trainingItemId:group.courseId?plan.itemIds[group.courseId]??null:null};};
 const search=normalizeSearch(input.search??'').slice(0,160),familyId=input.familyId??'',offset=Math.max(0,Math.floor(input.offset??0));
 const matches=(value:string)=>normalizeSearch(value).includes(search);
 const matchesName=(service:{id:string;name:string})=>matches(`${service.name} ${service.id}`)||!!serviceSearchAliases[service.id]?.some(matches);
 const reviewedMatches=new Set((trainingCatalog.legacy?.entries??[])
  .filter(entry=>search&&matches(`${entry.name} ${entry.code}`))
  .flatMap(entry=>entry.masterServiceIds));
 const descriptionMatches=new Set((trainingCatalog.legacy?.entries??[])
  .filter(entry=>search&&matches(entry.canonicalDefinition))
  .flatMap(entry=>entry.masterServiceIds));
 const searchRank=(service:typeof trainingCatalog.catalog.services[number])=>
  reviewedMatches.has(service.id)||matchesName(service)?0:
  descriptionMatches.has(service.id)||service.scopeNotes.some(matches)?1:2;
 const services=trainingCatalog.catalog.services.filter(service=>{
  if(search&&searchRank(service)===2)return false;
  return !familyId||service.roleRuleIds.some(id=>trainingCatalog.catalog.roleRules[id]?.familyIds.includes(familyId))||conditionalRules(service).some(rule=>rule.familyIds.includes(familyId))||trainingCatalog.additional.courses.some(course=>course.courseId===familyId&&course.masterServiceIds.includes(service.id));
 });
 if(search)services.sort((a,b)=>searchRank(a)-searchRank(b));
  return {catalogServices:trainingCatalog.catalog.services.length,total:services.length,offset,pageSize:input.allServices?services.length:20,baselineProvisional:plan.provisional,selectedServices:plan.services,vendorExtrasCountTowardScore:false,extensions:(trainingCatalog.residuals?.extensions??[]).filter(service=>(!search||matchesName(service))&&(!familyId||service.roleMappings.some(rule=>rule.familyIds.includes(familyId))||service.residualRequirements.some(group=>group.courseId===familyId))).map(service=>({...service,roleMappings:service.roleMappings.filter(rule=>!familyId||rule.familyIds.includes(familyId)),deliveryMode:"site",gapTopics:[],residualRequirements:service.residualRequirements.filter(group=>!familyId||group.courseId===familyId||service.roleMappings.some(rule=>rule.familyIds.includes(familyId)&&rule.role===group.role)).map(group=>projectResidual(group,service.id))})),courses:plan.courses,services:(input.allServices?services:services.slice(offset,offset+20)).map(service=>({id:service.id,name:service.name,deliveryMode:service.deliveryMode,roleMappings:[...service.roleRuleIds.map(id=>trainingCatalog.catalog.roleRules[id]).filter(rule=>!familyId||rule.familyIds.includes(familyId)),...conditionalRules(service).filter(rule=>!familyId||rule.familyIds.includes(familyId)),...trainingCatalog.additional.courses.filter(course=>!familyId||course.courseId===familyId).flatMap(course=>course.roleMappings.filter(rule=>rule.masterServiceIds.includes(service.id)).map(rule=>({...rule,conditional:true as const})))],sourceUrls:service.sourceUrls,scopeNotes:service.scopeNotes,residualRequirements:(trainingCatalog.residuals?.groups??[]).filter(group=>group.serviceIds.includes(service.id)).map(group=>projectResidual(group,service.id)),gapTopics:service.gapTopicIds.map(id=>trainingCatalog.catalog.gapTopics[id])}))};
}






