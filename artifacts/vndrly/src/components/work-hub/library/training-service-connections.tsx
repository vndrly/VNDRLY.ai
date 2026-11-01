import React,{useState}from'react';
import {useQuery}from'@tanstack/react-query';
import {z}from'zod/v4';
import {useTranslation}from'react-i18next';
import {useAuth}from'@/hooks/use-auth';
import BrandPillButton from'@/components/brand-pill-button';
import {Input}from'@/components/ui/input';
import {TrainingActions} from './training-actions';
import {isWorkHubAdmin} from '@/lib/work-hub-client';
const schema=z.object({catalogServices:z.number(),total:z.number(),offset:z.number(),pageSize:z.number(),baselineProvisional:z.boolean(),services:z.array(z.object({id:z.string(),name:z.string(),deliveryMode:z.string(),roleMappings:z.array(z.object({role:z.string(),familyIds:z.array(z.string()),rationale:z.string(),trigger:z.string().optional(),conditional:z.boolean().optional(),scopeMustBeConfirmed:z.boolean().optional(),requiresExposureConfirmation:z.boolean().optional()})),sourceUrls:z.array(z.string()),scopeNotes:z.array(z.string()),gapTopics:z.array(z.object({topic:z.string()}).passthrough())}))});
const residualSchema=z.object({groupId:z.string(),title:z.string(),courseId:z.string().nullable(),role:z.string(),trainingItemId:z.string().nullable(),vendorEvidenceRequired:z.array(z.string()),practicalAssessmentRequired:z.array(z.string()),scopeConfirmation:z.string()});
const serviceSchema=schema.shape.services.element.extend({residualRequirements:z.array(residualSchema).default([])});
const responseSchema=schema.extend({services:z.array(serviceSchema),extensions:z.array(serviceSchema).default([])});
export default function TrainingServiceConnections({familyId}:{familyId:string}){
 const {t}=useTranslation(),{user}=useAuth();
 const [input,setInput]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
 const result=useQuery({queryKey:['safety-training-catalog',user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId,familyId,search,offset],enabled:!!user,queryFn:async()=>{const response=await fetch(`/api/safety/training-catalog?familyId=${encodeURIComponent(familyId)}&search=${encodeURIComponent(search)}&offset=${offset}`,{credentials:'include'});if(!response.ok)throw Error(t('trainingPolicy.mappingUnavailable'));return responseSchema.parse((await response.json()).data);}});
 return <section className="space-y-3 rounded-xl border p-4" data-testid="training-service-connections">
  <h3 className="font-semibold">{familyId?t('trainingPolicy.serviceConnections',{familyId}):t('trainingPolicy.taskGapsHeading')}</h3>
  <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();setOffset(0);setSearch(input.trim());}}><Input aria-label={t('trainingPolicy.searchServices')} value={input} onChange={event=>setInput(event.target.value)}/><BrandPillButton tone="blue" type="submit">{t('trainingPolicy.search')}</BrandPillButton></form>
  {result.isLoading&&<p>{t('trainingPolicy.loading')}</p>}{result.isError&&<p role="alert">{t('trainingPolicy.mappingUnavailable')}</p>}
  {result.data&&<><p>{t('trainingPolicy.mappingCount',{matched:result.data.total,total:result.data.catalogServices})}</p><p>{t('trainingPolicy.mappingBoundary')}</p>
   {!!result.data.extensions.length&&<p className="font-semibold">{t('trainingPolicy.preservedExtensions')}</p>}{[...result.data.extensions,...result.data.services].map(service=><article key={service.id} className="space-y-2 border-t pt-3"><h4 className="font-semibold">{service.name}</h4>{service.roleMappings.map((rule,i)=><div key={`${service.id}-${i}`} className="space-y-1"><p className="font-medium">{rule.role}</p>{(rule.conditional||rule.scopeMustBeConfirmed||rule.requiresExposureConfirmation)&&<p className="font-medium text-amber-700 dark:text-amber-300">{t('trainingPolicy.conditionalRule')}</p>}{rule.trigger&&<p>{rule.trigger}</p>}<p>{rule.rationale}</p></div>)}{service.scopeNotes.map((note,i)=><p key={i}>{note}</p>)}{!!service.residualRequirements.length&&<div className="space-y-3">{service.residualRequirements.map(gap=><details key={gap.groupId} className="rounded border p-3"><summary className="font-semibold">{gap.title}</summary><p>{gap.role}</p>{gap.trainingItemId&&<div className="space-y-2"><p>{t('trainingPolicy.taskCourse',{courseId:gap.courseId})}</p><TrainingActions itemId={gap.trainingItemId} canManage={isWorkHubAdmin(user)}/></div>}{!!gap.vendorEvidenceRequired.length&&<><h5 className="mt-2 font-semibold">{t('trainingPolicy.vendorEvidence')}</h5><ul className="list-disc pl-5">{gap.vendorEvidenceRequired.map((text,i)=><li key={i}>{text}</li>)}</ul></>}{!!gap.practicalAssessmentRequired.length&&<><h5 className="mt-2 font-semibold">{t('trainingPolicy.practicalEvidence')}</h5><ul className="list-disc pl-5">{gap.practicalAssessmentRequired.map((text,i)=><li key={i}>{text}</li>)}</ul></>}<p className="mt-2">{gap.scopeConfirmation}</p></details>)}</div>}{!!service.gapTopics.length&&<details><summary>{t('trainingPolicy.openQualifications')}</summary><ul className="list-disc pl-5">{service.gapTopics.map((gap,i)=><li key={i}>{gap.topic}</li>)}</ul></details>}<div className="flex flex-wrap gap-3">{service.sourceUrls.map((url,i)=><a key={url} className="underline" target="_blank" rel="noreferrer" href={url}>{t('trainingPolicy.scopeSource',{number:i+1})}</a>)}</div></article>)}
   <div className="flex gap-3"><BrandPillButton tone="blue" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-result.data!.pageSize))}>{t('trainingPolicy.previous')}</BrandPillButton><BrandPillButton tone="blue" disabled={offset+result.data.pageSize>=result.data.total} onClick={()=>setOffset(offset+result.data!.pageSize)}>{t('trainingPolicy.next')}</BrandPillButton></div>
  </>}
 </section>;
}


