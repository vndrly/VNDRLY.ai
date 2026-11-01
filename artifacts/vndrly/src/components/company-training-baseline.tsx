import {Link} from 'wouter';
import {useQuery}from'@tanstack/react-query';
import {CompanySafetyReadinessSchema}from'@workspace/api-zod';
import {useAuth}from'@/hooks/use-auth';
import {useTranslation}from'react-i18next';
import {useState}from'react';
import TrainingServiceConnections from'./work-hub/library/training-service-connections';
export default function CompanyTrainingBaseline(){
 const {user}=useAuth(),{t}=useTranslation();
 const [showTaskEvidence,setShowTaskEvidence]=useState(false);
 const query=useQuery({queryKey:['company-training-baseline',user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId],enabled:!!user,queryFn:async()=>{const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,'')}/api/safety/readiness`,{credentials:'include'});if(!response.ok)throw Error('Training compliance unavailable');return CompanySafetyReadinessSchema.parse((await response.json()).data);},refetchInterval:60000});
 if(query.isError)return <p role="alert">{t('trainingPolicy.baselineUnavailable')}</p>;
 const baseline=query.data?.trainingBaseline,category=query.data?.categories.find(c=>c.id==='training');
 if(!baseline||!category)return null;
 const gaps=[...new Map(baseline.conditionalCourseGaps.map(g=>[`${g.serviceId}:${g.familyId}:${g.role}`,g])).values()];
 return <section className="space-y-3 rounded-xl border-2 border-[var(--brand-primary)] safety-program-card p-5 text-foreground" data-testid="company-training-baseline">
  <h2 className="text-xl font-bold">{t('trainingPolicy.baselineHeading')}</h2>
  <p className="font-semibold">{t('trainingPolicy.baselineCounts',{completed:baseline.completed,required:baseline.required})}</p>
  <p>{t('trainingPolicy.baselinePoints',{points:category.points.toFixed(2)})}</p><p>{t('trainingPolicy.baselinePart')}</p>
  {!!baseline.services.length&&<p>{t('trainingPolicy.selectedServices')}: {baseline.services.map(service=>service.name).join(', ')}</p>}
  <p>{t('trainingPolicy.extrasExcluded')}</p>
  {baseline.provisional&&<p>{t('trainingPolicy.baselineProvisional')}</p>}
  {!!baseline.unavailable&&<p>{t('trainingPolicy.unavailableCourses',{count:baseline.unavailable})}</p>}
  {!!gaps.length&&<div className="space-y-2"><h3 className="font-semibold">{t('trainingPolicy.scopeDecisions')}</h3>{gaps.map(gap=><section key={`${gap.serviceId}:${gap.familyId}:${gap.role}`} className="training-service-card space-y-2 p-3"><h4 className="font-semibold">{gap.courseTitle??gap.familyId}</h4><p>{baseline.services.find(service=>service.code===gap.serviceId)?.name??gap.serviceId} · {gap.role}</p><p>{gap.reason}</p>{gap.trainingItemId&&<Link className="current-theme-mini" href={`/work-hub/library/${gap.trainingItemId}?view=policy`}>{t('trainingPolicy.reviewScope')}</Link>}</section>)}</div>}
  {!!baseline.unmappedServiceIds.length&&<p>{t('trainingPolicy.unmappedServices',{count:baseline.unmappedServiceIds.length})}</p>}
  <details onToggle={event=>setShowTaskEvidence(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">{t('trainingPolicy.taskGapsHeading')}</summary><p>{t('trainingPolicy.taskGapsHelp')}</p>{showTaskEvidence&&<TrainingServiceConnections familyId=""/>}</details>
 </section>;
}
