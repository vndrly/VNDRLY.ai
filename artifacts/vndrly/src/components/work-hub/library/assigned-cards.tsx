import React from "react";
import {ProfileActionButton} from "@/components/gate-profile-chrome";
import {useLocation} from "wouter";
import {z} from "zod/v4";
import {AssignmentMetadataSchema} from "@workspace/api-zod";
import {useTranslation} from "react-i18next";
import {VndrlyUWordmark} from "../vndrly-u-wordmark";

import {useLibrary as useFormCampaigns} from "./use-library";

const schema=z.object({items:z.array(z.object({instanceId:z.uuid(),title:z.string(),description:z.string().nullable().optional(),kind:z.string(),assignment:AssignmentMetadataSchema,href:z.string(),examPending:z.boolean().optional(),certifications:z.array(z.object({id:z.uuid(),title:z.string()})).optional(),individuallyAssigned:z.boolean().optional()}))});
type Item=z.infer<typeof schema>["items"][number];
export default function AssignedCards({completed=false}:{completed?:boolean}) {
 const [,navigate]=useLocation();const router={push:(path:string)=>navigate(path)};
 const {t,i18n}=useTranslation(),api=useFormCampaigns("/api/work-hub/library/to-complete",v=>schema.parse(v));
 const c=(en:string,es:string)=>i18n?.language?.startsWith("es")?es:en;
 const isComplete=(item:Item)=>item.assignment.status==="completed"&&!item.examPending;
 const matches=(item:Item)=>completed?isComplete(item):!!item.examPending||["assigned","in_progress"].includes(item.assignment.status);
 const links=(item:Item)=>item.certifications??(item.assignment.bundleId?[{id:item.assignment.bundleId,title:c("Assigned certification","Certificación asignada")}]:[]);
 const training=[...new Map((api.data?.items??[]).filter(item=>item.kind==="training"&&!["cancelled","exempted"].includes(item.assignment.status)).map(item=>[item.instanceId,item])).values()];
 const groups=new Map<string,{title:string;courses:Item[]}>();
 for(const item of training)for(const link of links(item)){
  const group=groups.get(link.id)??{title:link.title,courses:[]};
  if(!group.courses.some(course=>course.instanceId===item.instanceId))group.courses.push(item);
  groups.set(link.id,group);
 }
 const certifications=[...groups].filter(([,group])=>completed?group.courses.every(isComplete):!group.courses.every(isComplete));
 const additional=training.filter(item=>((item.individuallyAssigned??item.assignment.individuallyAssigned)===true||links(item).length===0)&&matches(item));
 function card(x:Item,scope:string){
  if(x.kind==="training"){
   const progress=x.assignment.progress;
   const started=x.assignment.status==="in_progress"||x.assignment.status==="completed"||progress.lessonIds.length>0||Object.keys(progress.answers).length>0||(progress.guided?.step??0)>0||Object.keys(progress.guided?.responses??{}).length>0||(progress.certificationExam?.attempts.length??0)>0;
   const description=x.description?.trim().replace(/\s+/g," ")??"";
   return <article key={x.instanceId} data-assignment-card style={{borderRadius:16}} className="flex min-w-0 items-center gap-3 rounded-2xl border border-[var(--brand-primary)] bg-[#242426] px-3 py-2 text-[#ececec]" aria-labelledby={`assignment-${scope}-${x.instanceId}`}>
    <div className="min-w-0 flex-1">
     <h3 id={`assignment-${scope}-${x.instanceId}`} className="truncate text-sm font-semibold leading-5" title={x.title}>{x.title}</h3>
     <p className="mt-1 truncate text-xs leading-4 text-[#b3b3b3]" title={description}>{description||"\u00a0"}</p>
    </div>
    <ProfileActionButton className="ml-auto shrink-0" style={{minWidth:84,fontSize:14}} onClick={()=>router.push(x.href)}>{isComplete(x)?t("workHubLibrary.viewResponse"):started?c("Continue","Continuar"):c("Start","Iniciar")}</ProfileActionButton>
   </article>;
  }
  return <article key={x.instanceId} data-assignment-card className="grid min-w-0 gap-2 rounded-2xl border border-[var(--brand-primary)] bg-[#242426] p-4 text-[#ececec]" aria-labelledby={`assignment-${scope}-${x.instanceId}`}>
    <p className="text-xs text-[#b3b3b3]">{t(`workHubLibrary.kind_${x.kind}`)}</p>
    <h3 id={`assignment-${scope}-${x.instanceId}`} className="text-base font-semibold leading-6 text-[#ececec]">{x.title}</h3>
    {x.assignment.dueAt&&<time className="text-xs text-[#b3b3b3]" dateTime={x.assignment.dueAt}>{new Date(x.assignment.dueAt).toLocaleString()}</time>}
    <ProfileActionButton className="w-fit" onClick={()=>router.push(x.href)}>{t(isComplete(x)?"workHubLibrary.viewResponse":"workHubLibrary.open")}</ProfileActionButton>
   </article>;}
 const panel="min-w-0 rounded-2xl border border-[var(--brand-primary)] bg-[#242426] p-4 text-[#ececec]";
 return <div className="grid gap-3">
  <section aria-label={c("Training","Formación")} className={`${panel} grid gap-3`}>
   <h2 className="text-lg font-semibold text-[#ececec]"><VndrlyUWordmark/></h2>
   <details className="min-w-0">
    <summary className="cursor-pointer text-sm font-semibold">{c("Assigned certifications","Certificaciones asignadas")}</summary>
    <div className="grid gap-3 pt-3">{certifications.length?certifications.map(([id,group])=><section key={id} aria-label={group.title} className="grid gap-3"><h3 className="text-base font-semibold">{group.title}</h3>{group.courses.map(item=>card(item,id))}</section>):<p className="text-sm text-[#b3b3b3]">{c("No assigned certifications.","No hay certificaciones asignadas.")}</p>}</div>
   </details>
   <details className="min-w-0 border-t border-white/10 pt-3">
    <summary className="cursor-pointer text-sm font-semibold">{c("Additional training","Formación adicional")}</summary>
    <div className="grid gap-3 pt-3">{additional.length?additional.map(item=>card(item,"additional")):<p className="text-sm text-[#b3b3b3]">{c("No additional training.","No hay formación adicional.")}</p>}</div>
   </details>
  </section>
  {api.data?.items.filter(item=>item.kind!=="training"&&matches(item)).map(item=>card(item,"personal"))}
  {api.error&&<p role="alert" className="text-sm text-[#ececec]">{api.error}</p>}
 </div>;
}
