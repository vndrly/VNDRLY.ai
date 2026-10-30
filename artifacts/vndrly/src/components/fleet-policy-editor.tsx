import { CardHeading } from "@/components/ui/card-heading";
import React,{useState,useRef,useEffect} from "react";
import {useTranslation} from "react-i18next";
import {z} from "zod/v4";
import {FleetPolicyChangeSchema,FleetPolicyConfigurationSchema,FleetPolicyImpactSchema,FleetPolicyActivationSchema,fleetPolicyCopy} from "@workspace/api-zod";
import {useAuth} from "@/hooks/use-auth";
import {PngPillButton} from "./png-pill-rollover";
import {BrandedCheckbox} from "./branded-checkbox";
type Props={partnerId:number;vendorId:number;serviceId:number};
export default function FleetPolicyEditor(props:Props){const [open,setOpen]=useState(false),{i18n}=useTranslation(),c=fleetPolicyCopy(i18n.language);return <div><PngPillButton onClick={()=>setOpen(!open)}>{c.title}</PngPillButton>{open&&<Editor key={`${props.partnerId}:${props.vendorId}:${props.serviceId}`} {...props}/>}</div>;}
function Editor({partnerId,vendorId,serviceId}:Props){
 const {user}=useAuth(),{i18n}=useTranslation(),c=fleetPolicyCopy(i18n.language),identity=`${user?.userId}:${user?.activeMembershipId}:${partnerId}:${vendorId}:${serviceId}`;
 const live=useRef<string|null>(identity);live.current=identity;useEffect(()=>{live.current=identity;return()=>{live.current=null;};},[identity]);
 const [config,setConfig]=useState<z.infer<typeof FleetPolicyConfigurationSchema>|null>(null),[preview,setPreview]=useState<{input:z.infer<typeof FleetPolicyChangeSchema>;impact:z.infer<typeof FleetPolicyImpactSchema>}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [mode,setMode]=useState<"warn_only"|"enforced">("warn_only"),[effective,setEffective]=useState(""),[notice,setNotice]=useState(""),[treatment,setTreatment]=useState<"preserve_capture_policy"|"review_existing">("preserve_capture_policy"),[checks,setChecks]=useState<Array<z.infer<typeof FleetPolicyChangeSchema>["proposal"]["checkpoints"][number]>>(["dispatch","start","office_submit"]);
 useEffect(()=>{setConfig(null);setPreview(null);setBusy(false);setMessage("");},[identity]);
 const change=(work:()=>void)=>{work();setPreview(null);setMessage("");};
 async function request(path:string,input?:unknown){const response=await fetch(`/api/fleet/compliance-policies/${vendorId}${path}`,{method:input?"POST":"GET",credentials:"include",...(input?{headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}:{})});if(!response.ok)throw Error(c.failed);return response.json();}
 async function perform(kind:"load"|"preview"|"activate"){
  if(busy)return;setBusy(true);setMessage("");
  try{
   if(kind==="load"){const value=FleetPolicyConfigurationSchema.parse(await request(""));if(live.current===identity){setConfig(value);setPreview(null);}}
   else if(kind==="preview"){
    if(!config)return;const input=FleetPolicyChangeSchema.parse({operationId:crypto.randomUUID(),expectedVersion:config.version,proposal:{policyId:null,mode,scope:{partnerId,siteId:null,contractId:null,workTypeId:serviceId},effectiveFrom:effective,effectiveUntil:null,checkpoints:checks,notice,existingWorkTreatment:treatment}}),impact=FleetPolicyImpactSchema.parse(await request("/preview",input));if(live.current===identity)setPreview({input,impact});
   }else if(preview){const receipt=FleetPolicyActivationSchema.parse(await request("/activate",preview.input));if(live.current===identity){setConfig({version:receipt.version,policies:[...(config?.policies??[]),receipt.policy]});setPreview(null);setMessage(c.saved);}}
  }catch{if(live.current===identity)setMessage(c.failed);}finally{if(live.current===identity)setBusy(false);}
 }
 const inputClass="rounded border-2 border-[color:var(--brand-primary)] bg-[#3a3d42] p-2 text-white";
 return <section data-card-layout className="space-y-3 rounded border-2 border-[color:var(--brand-primary)] bg-[#3a3d42] p-3 text-white"><CardHeading as="h3">{c.title}</CardHeading><p>{c.initial}</p><PngPillButton disabled={busy} onClick={()=>void perform("load")}>{c.load}</PngPillButton>
 {config&&<><p>{c.revision}: {config.version}</p>{!config.policies.length&&<p>{c.empty}</p>}{config.policies.map(p=><p key={`${p.id}:${p.version}`}>{p.mode} · {p.effectiveFrom} · {p.notice}</p>)}
 <label>{c.mode}<select className={inputClass} aria-label={c.mode} disabled={busy} value={mode} onChange={e=>change(()=>setMode(e.target.value as typeof mode))}><option value="warn_only">{c.warn}</option><option value="enforced">{c.enforce}</option></select></label>
 <label>{c.effective}<input className={inputClass} aria-label={c.effective} disabled={busy} value={effective} placeholder="2026-11-01T06:00:00-06:00" onChange={e=>change(()=>setEffective(e.target.value))}/></label>
 <label>{c.notice}<textarea className={inputClass} aria-label={c.notice} disabled={busy} value={notice} onChange={e=>change(()=>setNotice(e.target.value))}/></label>
 <label>{c.treatment}<select className={inputClass} aria-label={c.treatment} disabled={busy} value={treatment} onChange={e=>change(()=>setTreatment(e.target.value as typeof treatment))}><option value="preserve_capture_policy">{c.preserve}</option><option value="review_existing">{c.review}</option></select></label>
 <fieldset disabled={busy}><legend>{c.checkpoint}</legend>{(["detail","reservation","dispatch","accept","start","replace","route_change","close","office_submit"] as const).map(key=><label key={key} className="flex items-center gap-2"><BrandedCheckbox aria-label={c[key]} checked={checks.includes(key)} onCheckedChange={checked=>change(()=>setChecks(values=>checked?[...values,key]:values.filter(v=>v!==key)))}/>{c[key]}</label>)}</fieldset>
 <PngPillButton disabled={busy} onClick={()=>void perform("preview")}>{c.preview}</PngPillButton>
 {preview&&<><p>{c.recorded}: {preview.impact.existingActivities} / {preview.impact.currentlyRed}</p><p>{c.basis}</p><PngPillButton disabled={busy} onClick={()=>void perform("activate")}>{c.activate}</PngPillButton></>}
 </>}{message&&<p role="status">{message}</p>}</section>;
}
