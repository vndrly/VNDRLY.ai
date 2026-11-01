import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {z} from 'zod/v4';
import {ClipboardList,ShieldCheck,Paperclip,Type,FileText,Target} from 'lucide-react';
import {TrainingPolicyDetailsSchema} from '@workspace/api-zod';
import {useTranslation} from 'react-i18next';
import TogglePillButton from '@/components/brand-pill-button';
import {Textarea} from '@/components/ui/textarea';
import {useAuth} from '@/hooks/use-auth';
import {BrandedSelect} from '../chrome';
import {Switch} from '@/components/ui/switch';
import {useLibrary} from './use-library';
import AssignmentReview from './assignment-review';
import TrainingServiceConnections from './training-service-connections';
import TrainingExposureAudience from './training-exposure-audience';
import TrainingCourseGuide from './training-course-guide';
import {groupTrainingPositions,toggleTrainingPosition} from './training-position-options';
const readSchema=z.object({itemId:z.uuid(),version:z.number(),familyId:z.string(),trainingItemId:z.uuid().nullable(),policy:TrainingPolicyDetailsSchema,requiredPeopleIds:z.array(z.number()),applicabilityOptions:z.array(z.object({serviceId:z.string(),label:z.string(),roleDescriptions:z.array(z.string())})).default([]),people:z.array(z.object({userId:z.number(),name:z.string().nullable(),email:z.string().nullable()})),groups:z.array(z.object({id:z.string(),name:z.string()})),positions:z.array(z.object({id:z.string(),label:z.string()})),files:z.array(z.object({id:z.uuid(),fileName:z.string()}))});
type Policy=z.infer<typeof TrainingPolicyDetailsSchema>;
function PolicyTextField(props:React.ComponentProps<typeof Textarea>){
 const ref=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{
  const element=ref.current;if(!element)return;
  const fit=()=>{element.style.height='auto';element.style.height=`${element.scrollHeight+2}px`;};
  fit();
  if(typeof ResizeObserver==='undefined'){window.addEventListener('resize',fit);return()=>window.removeEventListener('resize',fit);}
  let width=element.getBoundingClientRect().width;
  const observer=new ResizeObserver(entries=>{const next=entries[0]?.contentRect.width;if(next!==undefined&&next!==width){width=next;fit();}});
  observer.observe(element);return()=>observer.disconnect();
 },[props.value]);
 return <Textarea {...props} ref={ref} rows={1} className={`training-policy-card-field training-policy-auto-field ${props.className??''}`}/>;
}
export default function TrainingPolicy({itemId,onSaved}:{itemId:string;onSaved:()=>Promise<unknown>}){
 const {user}=useAuth();
 const {t}=useTranslation(),api=useLibrary(`/api/work-hub/library/${itemId}/training-policy`,v=>readSchema.parse(v));
 const [draft,setDraft]=useState<Policy|null>(null),[notice,setNotice]=useState(''),[assign,setAssign]=useState(false),[linksText,setLinksText]=useState(''),[showServices,setShowServices]=useState(false);
 useEffect(()=>{if(api.data){setDraft(api.data.policy);setLinksText(api.data.policy.links.map(link=>`${link.title} | ${link.url}`).join('\n'));}},[api.data?.version,itemId]);
 if(!api.data||!draft)return <p role="status">{api.error||t('trainingPolicy.loading')}</p>;
 const data=api.data,disabled=api.busy||api.uncertain;
 const toggle=<K extends 'requiredUserIds'|'requiredStaffRoleIds'|'requiredGroupIds'|'attachmentFileIds'>(key:K,id:Policy[K][number])=>setDraft({...draft,[key]:(draft[key] as (number|string)[]).includes(id)?draft[key].filter(value=>value!==id):[...draft[key],id]});
 const save=async()=>{try{const payload=TrainingPolicyDetailsSchema.parse({...draft,links:linksText.split('\n').filter(line=>line.trim()).map(line=>{const [title,...url]=line.split('|');return {title:title.trim(),url:url.join('|').trim()};})});await api.send(`/api/work-hub/library/${itemId}/training-policy`,payload,data.version);await api.reload();await onSaved();setNotice(t('trainingPolicy.saved'));return true;}catch(error){setNotice(error instanceof z.ZodError?t('trainingPolicy.invalid'):error instanceof Error?error.message:t('trainingPolicy.failed'));return false;}};
 return <section className="training-policy-typography space-y-4 rounded-xl border-2 border-[var(--brand-primary)] p-5 text-foreground" data-library-card="" data-testid="training-policy-details">
  <h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]"/>{t('trainingPolicy.heading')}</h2>
  <button type="button" className="library-action" aria-expanded={showServices} onClick={()=>setShowServices(!showServices)}>{t('trainingPolicy.showServices')}</button>
  {showServices&&<TrainingServiceConnections familyId={data.familyId}/>}
  <label className="block space-y-1"><span className="training-policy-field-label flex items-center gap-2"><Type aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand-primary)]"/>{t('trainingPolicy.title')}</span><PolicyTextField value={draft.title} readOnly={user?.role!=='admin'} disabled={disabled} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
  <label className="block space-y-1"><span className="training-policy-field-label flex items-center gap-2"><FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand-primary)]"/>{t('trainingPolicy.description')}</span><PolicyTextField value={draft.description} readOnly={user?.role!=='admin'} disabled={disabled} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
  <label className="block space-y-1"><span className="training-policy-field-label flex items-center gap-2"><Target aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand-primary)]"/>{t('trainingPolicy.purpose')}</span><PolicyTextField value={draft.purpose} readOnly={user?.role!=='admin'} disabled={disabled} onChange={e=>setDraft({...draft,purpose:e.target.value})}/></label>
  {data.trainingItemId&&<TrainingCourseGuide itemId={data.trainingItemId}/>}
  {!!data.applicabilityOptions.length&&<fieldset className="space-y-3"><legend className="font-semibold">{t('trainingPolicy.applicability')}</legend><p>{t('trainingPolicy.applicabilityHelp')}</p>{data.applicabilityOptions.map(option=>{const decision=draft.serviceApplicability.find(item=>item.serviceId===option.serviceId);return <div key={option.serviceId} className="space-y-2 rounded-lg border p-3"><label className="block space-y-1"><span>{option.label}</span><BrandedSelect style={{backgroundColor:"#303236",color:"#ececec",colorScheme:"dark"}} className="w-full text-foreground" disabled={disabled} value={decision?(decision.applies?'yes':'no'):''} onChange={event=>setDraft({...draft,serviceApplicability:[...draft.serviceApplicability.filter(item=>item.serviceId!==option.serviceId),...(event.target.value?[{serviceId:option.serviceId,applies:event.target.value==='yes',reason:decision?.reason??'',userIds:decision?.userIds??[],staffRoleIds:decision?.staffRoleIds??[]}]:[])]})}><option value="">{t('trainingPolicy.notReviewed')}</option><option value="yes">{t('trainingPolicy.applies')}</option><option value="no">{t('trainingPolicy.doesNotApply')}</option></BrandedSelect></label>{option.roleDescriptions.map((description,i)=><p key={i}>{description}</p>)}{decision&&<TrainingExposureAudience decision={decision} people={data.people} positions={data.positions} disabled={disabled} onChange={value=>setDraft({...draft,serviceApplicability:draft.serviceApplicability.map(item=>item.serviceId===option.serviceId?{...item,...value}:item)})}/>}{decision&&<label className="block space-y-1"><span>{t('trainingPolicy.applicabilityReason')}</span><Textarea disabled={disabled} value={decision.reason} onChange={event=>setDraft({...draft,serviceApplicability:draft.serviceApplicability.map(item=>item.serviceId===option.serviceId?{...item,reason:event.target.value}:item)})}/></label>}</div>;})}</fieldset>}
  <section aria-label="Assignments" data-library-card="" className="training-service-card space-y-2 p-3">
  <h3 className="flex items-center gap-2"><ClipboardList aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand-primary)]"/>Assignments</h3>
  <details className="space-y-2"><summary className="cursor-pointer font-semibold">{t('trainingPolicy.people')}</summary><div className="grid grid-cols-1 gap-2">{data.people.map(person=><label key={person.userId} className="flex items-start gap-2"><Switch aria-label={person.name||person.email||String(person.userId)} disabled={disabled} checked={draft.requiredUserIds.includes(person.userId)} onCheckedChange={()=>toggle('requiredUserIds',person.userId)}/><span>{person.name||person.email}</span></label>)}</div></details>
  {draft.requiredUserIds.filter(id=>!data.people.some(p=>p.userId===id)).map((id,i)=><label key={`missing-person-${id}`} className="flex items-start gap-2"><input type="checkbox" disabled={disabled} checked onChange={()=>toggle('requiredUserIds',id)}/><span>{t('trainingPolicy.unavailablePerson',{number:i+1})}</span></label>)}
  {draft.requiredStaffRoleIds.filter(id=>!data.positions.some(p=>p.id===id)).map((id,i)=><label key={`missing-position-${id}`} className="flex items-start gap-2"><input type="checkbox" disabled={disabled} checked onChange={()=>toggle('requiredStaffRoleIds',id)}/><span>{t('trainingPolicy.unavailablePosition',{number:i+1})}</span></label>)}
  <details className="space-y-2"><summary className="cursor-pointer font-semibold">{t('trainingPolicy.groups')}</summary>{[true,false].map(automatic=>{const groups=data.groups.filter(group=>group.id.startsWith('audience:')===automatic);return <div key={String(automatic)} className="space-y-2"><p className="font-semibold">{t(automatic?'trainingPolicy.automaticAudiences':'trainingPolicy.definedGroups')}</p><div className="grid grid-cols-1 gap-2">{groups.map(group=><label key={group.id} className="flex items-start gap-2"><Switch aria-label={group.name} disabled={disabled} checked={draft.requiredGroupIds.includes(group.id)} onCheckedChange={()=>toggle('requiredGroupIds',group.id)}/><span>{group.name}</span></label>)}</div>{!automatic&&!groups.length&&<p>{t('trainingPolicy.noGroups')}</p>}</div>;})}</details>
  <details className="space-y-2"><summary className="cursor-pointer font-semibold">{t('trainingPolicy.positions')}</summary><p>{t('trainingPolicy.positionsHelp')}</p><div className="grid grid-cols-1 gap-2">{groupTrainingPositions(data.positions).map(position=><label key={position.id} className="flex items-start gap-2"><Switch aria-label={position.label} disabled={disabled} checked={position.ids.some(id=>draft.requiredStaffRoleIds.includes(id))} onCheckedChange={()=>setDraft({...draft,requiredStaffRoleIds:toggleTrainingPosition(draft.requiredStaffRoleIds,position.ids)})}/><span>{position.label}</span></label>)}</div>{!data.positions.length&&<p>{t('trainingPolicy.noPositions')}</p>}</details>
  {draft.requiredGroupIds.filter(id=>!data.groups.some(g=>g.id===id)).map((id,i)=><label key={`missing-group-${id}`} className="flex items-start gap-2"><input type="checkbox" disabled={disabled} checked onChange={()=>toggle('requiredGroupIds',id)}/><span>{t('trainingPolicy.unavailableGroup',{number:i+1})}</span></label>)}
  <label className="flex items-start gap-2"><Switch aria-label={t('trainingPolicy.newHire')} disabled={disabled} checked={draft.newHireRequired} onCheckedChange={checked=>setDraft({...draft,newHireRequired:checked})}/><span>{t('trainingPolicy.newHire')}</span></label>
  <label className="flex items-start gap-2"><Switch aria-label={t('trainingPolicy.roleChange')} disabled={disabled} checked={draft.roleChangeRequired} onCheckedChange={checked=>setDraft({...draft,roleChangeRequired:checked})}/><span>{t('trainingPolicy.roleChange')}</span></label>
  <p>{t('trainingPolicy.rulesHelp')}</p>
  </section>
  <section aria-label="Supporting documents and links" data-library-card="" className="training-service-card space-y-2 p-3">
  <h3 className="flex items-center gap-2"><Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand-primary)]"/>{t('trainingPolicy.attachments')}</h3>
  <fieldset className="space-y-2"><p>{t('trainingPolicy.attachmentsHelp')}</p>{data.files.map(file=><label key={file.id} className="flex items-start gap-2"><input type="checkbox" disabled={disabled} checked={draft.attachmentFileIds.includes(file.id)} onChange={()=>toggle('attachmentFileIds',file.id)}/><a className="underline" href={`/api/work-hub/file-library/legacy/${file.id}/download`} target="_blank" rel="noreferrer">{file.fileName}</a></label>)}</fieldset>
  {draft.attachmentFileIds.filter(id=>!data.files.some(f=>f.id===id)).map((id,i)=><label key={`missing-file-${id}`} className="flex items-start gap-2"><input type="checkbox" disabled={disabled} checked onChange={()=>toggle('attachmentFileIds',id)}/><span>{t('trainingPolicy.unavailableFile',{number:i+1})}</span></label>)}
  <label className="block space-y-1"><span>{t('trainingPolicy.links')}</span><PolicyTextField disabled={disabled} value={linksText} onChange={e=>setLinksText(e.target.value)}/><span className="text-sm">{t('trainingPolicy.linksHelp')}</span></label>
  {!!data.policy.links.length&&<ul className="list-disc pl-5">{data.policy.links.map(link=><li key={link.url}><a className="underline" href={link.url} target="_blank" rel="noreferrer">{link.title}</a></li>)}</ul>}
  </section>
  <div className="flex flex-wrap gap-3"><button type="button" className="library-action" disabled={disabled||!draft.title.trim()} onClick={()=>void save()}>{t('trainingPolicy.save')}</button><button type="button" className="library-action" disabled={disabled||!data.trainingItemId} onClick={()=>void save().then(saved=>{if(saved)setAssign(true);})}>{t('trainingPolicy.assignNow')}</button></div>
  {!!notice&&<p role="status">{notice}</p>}{api.uncertain&&<TogglePillButton tone="blue" onClick={()=>void api.retryOriginal().then(()=>api.reload()).catch(error=>setNotice(String(error)))}>{t('workHubLibrary.retry')}</TogglePillButton>}
  {assign&&data.trainingItemId&&<AssignmentReview kind="training" initialItemId={data.trainingItemId} initialUserIds={data.requiredPeopleIds} initialGroupIds={data.policy.requiredGroupIds} onSaved={async()=>{setAssign(false);await api.reload();}}/>}
 </section>;
}

