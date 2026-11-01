import {db}from'@workspace/db';
import {libraryAuthority,type LibraryActor}from'../work-hub/library-core';
import {companyRequiredTraining,trainingCatalog,type TrainingResidual}from'./company-required-training';
export async function safetyTrainingCatalogView(actor:LibraryActor,input:{search?:string;familyId?:string;offset?:number}){
 const {owner}=await libraryAuthority(db,actor,true);
 const plan=await companyRequiredTraining(db,owner);
 const conditionalRules=(service:typeof trainingCatalog.catalog.services[number])=>(service.conditionalRuleIds??[]).flatMap(id=>{
  const rule=trainingCatalog.catalog.conditionalRules[id];
  return rule?[{id,role:rule.roles.join('; '),familyIds:rule.familyIds,trigger:rule.trigger,rationale:rule.rationale,conditional:true as const,scopeMustBeConfirmed:true}]:[];
 });
 const projectResidual=(group:TrainingResidual,serviceId:string)=>{const {serviceEvidence,...common}=group;const specific=serviceEvidence?.find(row=>row.serviceId===serviceId);return {...common,...(specific?{vendorEvidenceRequired:specific.vendorEvidenceRequired,practicalAssessmentRequired:specific.practicalAssessmentRequired,scopeConfirmation:specific.sourceContext}:{}),trainingItemId:group.courseId?plan.items.get(group.courseId)?.record.id??null:null};};
 const search=(input.search??'').trim().toLowerCase().slice(0,160),familyId=input.familyId??'',offset=Math.max(0,Math.floor(input.offset??0));
 const services=trainingCatalog.catalog.services.filter(service=>{
  if(search&&!`${service.name} ${service.id}`.toLowerCase().includes(search))return false;
  return !familyId||service.roleRuleIds.some(id=>trainingCatalog.catalog.roleRules[id]?.familyIds.includes(familyId))||conditionalRules(service).some(rule=>rule.familyIds.includes(familyId))||trainingCatalog.additional.courses.some(course=>course.courseId===familyId&&course.masterServiceIds.includes(service.id));
 });
  return {catalogServices:trainingCatalog.catalog.services.length,total:services.length,offset,pageSize:20,baselineProvisional:plan.provisional,selectedServices:plan.services,vendorExtrasCountTowardScore:false,extensions:(trainingCatalog.residuals?.extensions??[]).filter(service=>(!search||`${service.name} ${service.id}`.toLowerCase().includes(search))&&(!familyId||service.roleMappings.some(rule=>rule.familyIds.includes(familyId))||service.residualRequirements.some(group=>group.courseId===familyId))).map(service=>({...service,roleMappings:service.roleMappings.filter(rule=>!familyId||rule.familyIds.includes(familyId)),deliveryMode:"site",gapTopics:[],residualRequirements:service.residualRequirements.filter(group=>!familyId||group.courseId===familyId||service.roleMappings.some(rule=>rule.familyIds.includes(familyId)&&rule.role===group.role)).map(group=>projectResidual(group,service.id))})),courses:trainingCatalog.curriculum.map(course=>({id:course.id,title:course.title,purpose:course.purpose,practicalBoundary:course.id==='G99'?'':course.practicalBoundary,trainingItemId:plan.items.get(course.id)?.record.id??null,required:plan.requirements.filter(r=>r.familyId===course.id).length,completed:plan.requirements.filter(r=>r.familyId===course.id&&r.completed).length})),services:services.slice(offset,offset+20).map(service=>({id:service.id,name:service.name,deliveryMode:service.deliveryMode,roleMappings:[...service.roleRuleIds.map(id=>trainingCatalog.catalog.roleRules[id]).filter(rule=>!familyId||rule.familyIds.includes(familyId)),...conditionalRules(service).filter(rule=>!familyId||rule.familyIds.includes(familyId)),...trainingCatalog.additional.courses.filter(course=>!familyId||course.courseId===familyId).flatMap(course=>course.roleMappings.filter(rule=>rule.masterServiceIds.includes(service.id)).map(rule=>({...rule,conditional:true as const})))],sourceUrls:service.sourceUrls,scopeNotes:service.scopeNotes,residualRequirements:(trainingCatalog.residuals?.groups??[]).filter(group=>group.serviceIds.includes(service.id)).map(group=>projectResidual(group,service.id)),gapTopics:service.gapTopicIds.map(id=>trainingCatalog.catalog.gapTopics[id])}))};
}





