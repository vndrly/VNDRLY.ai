import {db}from'@workspace/db';
import {libraryAuthority,type LibraryActor}from'../work-hub/library-core';
import {companyRequiredTraining,trainingCatalog}from'./company-required-training';
export async function safetyTrainingCatalogView(actor:LibraryActor,input:{search?:string;familyId?:string;offset?:number}){
 const {owner}=await libraryAuthority(db,actor,true);
 const plan=await companyRequiredTraining(db,owner);
 const conditionalRules=(service:typeof trainingCatalog.catalog.services[number])=>(service.conditionalRuleIds??[]).flatMap(id=>{
  const rule=trainingCatalog.catalog.conditionalRules[id];
  return rule?[{id,role:rule.roles.join('; '),familyIds:rule.familyIds,trigger:rule.trigger,rationale:rule.rationale,conditional:true as const,scopeMustBeConfirmed:true}]:[];
 });
 const search=(input.search??'').trim().toLowerCase().slice(0,160),familyId=input.familyId??'',offset=Math.max(0,Math.floor(input.offset??0));
 const services=trainingCatalog.catalog.services.filter(service=>{
  if(search&&!`${service.name} ${service.id}`.toLowerCase().includes(search))return false;
  return !familyId||service.roleRuleIds.some(id=>trainingCatalog.catalog.roleRules[id]?.familyIds.includes(familyId))||conditionalRules(service).some(rule=>rule.familyIds.includes(familyId))||trainingCatalog.additional.courses.some(course=>course.courseId===familyId&&course.masterServiceIds.includes(service.id));
 });
  return {catalogServices:trainingCatalog.catalog.services.length,total:services.length,offset,pageSize:20,baselineProvisional:plan.provisional,selectedServices:plan.services,vendorExtrasCountTowardScore:false,courses:trainingCatalog.curriculum.map(course=>({id:course.id,title:course.title,purpose:course.purpose,practicalBoundary:course.practicalBoundary,trainingItemId:plan.items.get(course.id)?.record.id??null,required:plan.requirements.filter(r=>r.familyId===course.id).length,completed:plan.requirements.filter(r=>r.familyId===course.id&&r.completed).length})),services:services.slice(offset,offset+20).map(service=>({id:service.id,name:service.name,deliveryMode:service.deliveryMode,roleMappings:[...service.roleRuleIds.map(id=>trainingCatalog.catalog.roleRules[id]).filter(rule=>!familyId||rule.familyIds.includes(familyId)),...conditionalRules(service).filter(rule=>!familyId||rule.familyIds.includes(familyId)),...trainingCatalog.additional.courses.filter(course=>!familyId||course.courseId===familyId).flatMap(course=>course.roleMappings.filter(rule=>rule.masterServiceIds.includes(service.id)).map(rule=>({...rule,conditional:true as const})))],sourceUrls:service.sourceUrls,scopeNotes:service.scopeNotes,residualRequirements:(trainingCatalog.residuals?.groups??[]).filter(group=>group.serviceIds.includes(service.id)).map(group=>({...group,trainingItemId:group.courseId?plan.items.get(group.courseId)?.record.id??null:null})),gapTopics:service.gapTopicIds.map(id=>trainingCatalog.catalog.gapTopics[id])}))};
}

