import React from 'react';
import {useTranslation} from 'react-i18next';
import {Switch} from '@/components/ui/switch';
import {groupTrainingPositions,toggleTrainingPosition} from './training-position-options';
export default function TrainingExposureAudience({decision,people,positions,disabled,onChange}:{decision:{userIds:number[];staffRoleIds:string[]};people:{userId:number;name:string|null;email:string|null}[];positions:{id:string;label:string}[];disabled:boolean;onChange:(value:{userIds:number[];staffRoleIds:string[]})=>void}){
 const {t}=useTranslation();
 const grouped=groupTrainingPositions(positions.filter(p=>!p.id.startsWith("operation:")&&!p.id.startsWith("account:")));
 const jobRoles=grouped;
 const accountTypes=[{id:"account:admin",label:"Admin",ids:["account:admin"]},{id:"account:office_staff",label:"Office Staff",ids:["account:office_staff"]},{id:"account:gate_supervisor",label:"Gate Supervisor",ids:["account:gate_supervisor"]},{id:"account:gatekeeper",label:"Gatekeeper",ids:["account:gatekeeper"]}];
 const renderRoles=(rows:typeof grouped)=>rows.map(p=><label key={p.id} className="flex items-start gap-2"><Switch aria-label={p.label} disabled={disabled} checked={p.ids.some(id=>decision.staffRoleIds.includes(id))} onCheckedChange={()=>onChange({...decision,staffRoleIds:toggleTrainingPosition(decision.staffRoleIds,p.ids)})}/><span>{p.label}</span></label>);
 return <fieldset className="space-y-2"><legend className="font-semibold">{t('trainingPolicy.exposureAudience')}</legend><p>{t('trainingPolicy.exposureAudienceHelp')}</p>
 <details><summary className="cursor-pointer font-semibold">{t('trainingPolicy.people')}</summary><div className="grid grid-cols-1 gap-2">{[...new Map(people.map(p=>[p.userId,p])).values()].map(p=><label key={p.userId} className="flex items-start gap-2"><Switch aria-label={p.name||p.email||String(p.userId)} disabled={disabled} checked={decision.userIds.includes(p.userId)} onCheckedChange={()=>onChange({...decision,userIds:decision.userIds.includes(p.userId)?decision.userIds.filter(id=>id!==p.userId):[...decision.userIds,p.userId]})}/><span>{p.name||p.email}</span></label>)}</div></details>
 <details><summary className="cursor-pointer font-semibold">{t('trainingPolicy.accountTypes')}</summary><div className="grid grid-cols-1 gap-2">{renderRoles(accountTypes)}</div></details>
 <details><summary className="cursor-pointer font-semibold">{t('trainingPolicy.jobRoles')}</summary><div className="grid grid-cols-1 gap-2">{renderRoles(jobRoles)}</div></details>
 </fieldset>;
}