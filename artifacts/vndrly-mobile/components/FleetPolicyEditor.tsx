import React,{useEffect,useRef,useState} from "react";
import {Text,TextInput,View} from "react-native";
import {useTranslation} from "react-i18next";
import * as Crypto from "expo-crypto";
import {z} from "zod/v4";
import {FleetPolicyChangeSchema,FleetPolicyConfigurationSchema,FleetPolicyImpactSchema,FleetPolicyActivationSchema,fleetPolicyCopy} from "@workspace/api-zod";
import {useAuth} from "@/hooks/use-auth";
import {useColors} from "@/hooks/useColors";
import {apiFetch} from "@/lib/api";
import TogglePillButton from "./TogglePillButton";
import FleetCheckbox from "./FleetCheckbox";
import FleetChoiceField from "./FleetChoiceField";
type Props={partnerId:number;vendorId:number;serviceId:number};
export default function FleetPolicyEditor(props:Props){const [open,setOpen]=useState(false),{i18n}=useTranslation(),c=fleetPolicyCopy(i18n.language);return <View><TogglePillButton onPress={()=>setOpen(!open)}>{c.title}</TogglePillButton>{open&&<Editor key={`${props.partnerId}:${props.vendorId}:${props.serviceId}`} {...props}/>}</View>;}
function Editor({partnerId,vendorId,serviceId}:Props){
 const {user,activeMembershipId}=useAuth(),{i18n}=useTranslation(),c=fleetPolicyCopy(i18n.language),colors=useColors(),identity=`${user?.id}:${activeMembershipId}:${partnerId}:${vendorId}:${serviceId}`;
 const live=useRef<string|null>(identity);live.current=identity;useEffect(()=>{live.current=identity;return()=>{live.current=null;};},[identity]);
 const [config,setConfig]=useState<z.infer<typeof FleetPolicyConfigurationSchema>|null>(null),[preview,setPreview]=useState<{input:z.infer<typeof FleetPolicyChangeSchema>;impact:z.infer<typeof FleetPolicyImpactSchema>}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [mode,setMode]=useState<"warn_only"|"enforced">("warn_only"),[effective,setEffective]=useState(""),[notice,setNotice]=useState(""),[treatment,setTreatment]=useState<"preserve_capture_policy"|"review_existing">("preserve_capture_policy"),[checks,setChecks]=useState<Array<z.infer<typeof FleetPolicyChangeSchema>["proposal"]["checkpoints"][number]>>(["dispatch","start","office_submit"]);
 useEffect(()=>{setConfig(null);setPreview(null);setBusy(false);setMessage("");},[identity]);
 const change=(work:()=>void)=>{work();setPreview(null);setMessage("");};
 const request=(path:string,input?:unknown)=>apiFetch(`/api/fleet/compliance-policies/${vendorId}${path}`,input?{method:"POST",body:JSON.stringify(input)}:undefined);
 async function perform(kind:"load"|"preview"|"activate"){
  if(busy)return;setBusy(true);setMessage("");
  try{
   if(kind==="load"){const value=FleetPolicyConfigurationSchema.parse(await request(""));if(live.current===identity){setConfig(value);setPreview(null);}}
   else if(kind==="preview"){
    if(!config)return;const input=FleetPolicyChangeSchema.parse({operationId:Crypto.randomUUID(),expectedVersion:config.version,proposal:{policyId:null,mode,scope:{partnerId,siteId:null,contractId:null,workTypeId:serviceId},effectiveFrom:effective,effectiveUntil:null,checkpoints:checks,notice,existingWorkTreatment:treatment}}),impact=FleetPolicyImpactSchema.parse(await request("/preview",input));if(live.current===identity)setPreview({input,impact});
   }else if(preview){const receipt=FleetPolicyActivationSchema.parse(await request("/activate",preview.input));if(live.current===identity){setConfig({version:receipt.version,policies:[...(config?.policies??[]),receipt.policy]});setPreview(null);setMessage(c.saved);}}
  }catch{if(live.current===identity)setMessage(c.failed);}finally{if(live.current===identity)setBusy(false);}
 }
 const text={color:colors.text},field={color:colors.text,backgroundColor:colors.card,borderWidth:2,borderColor:colors.primary,borderRadius:6,padding:10};
 return <View style={{gap:10,borderWidth:2,borderColor:colors.primary,backgroundColor:colors.card,padding:12,borderRadius:8}}><Text style={text}>{c.title}</Text><Text style={text}>{c.initial}</Text><TogglePillButton disabled={busy} onPress={()=>void perform("load")}>{c.load}</TogglePillButton>
 {config&&<><Text style={text}>{c.revision}: {config.version}</Text>{!config.policies.length&&<Text style={text}>{c.empty}</Text>}{config.policies.map(p=><Text key={`${p.id}:${p.version}`} style={text}>{p.mode} · {p.effectiveFrom} · {p.notice}</Text>)}
 <FleetChoiceField label={c.mode} value={mode} disabled={busy} options={[{id:"warn_only",label:c.warn},{id:"enforced",label:c.enforce}]} onChange={v=>change(()=>setMode(v as typeof mode))}/>
 <Text style={text}>{c.effective}</Text><TextInput accessibilityLabel={c.effective} editable={!busy} style={field} value={effective} placeholder="2026-11-01T06:00:00-06:00" onChangeText={v=>change(()=>setEffective(v))}/>
 <Text style={text}>{c.notice}</Text><TextInput accessibilityLabel={c.notice} editable={!busy} multiline style={field} value={notice} onChangeText={v=>change(()=>setNotice(v))}/>
 <FleetChoiceField label={c.treatment} value={treatment} disabled={busy} options={[{id:"preserve_capture_policy",label:c.preserve},{id:"review_existing",label:c.review}]} onChange={v=>change(()=>setTreatment(v as typeof treatment))}/>
 <Text style={text}>{c.checkpoint}</Text>{(["detail","reservation","dispatch","accept","start","replace","route_change","close","office_submit"] as const).map(key=><FleetCheckbox key={key} label={c[key]} disabled={busy} checked={checks.includes(key)} onChange={checked=>change(()=>setChecks(values=>checked?[...values,key]:values.filter(v=>v!==key)))}/>)}
 <TogglePillButton disabled={busy} onPress={()=>void perform("preview")}>{c.preview}</TogglePillButton>
 {preview&&<><Text style={text}>{c.recorded}: {preview.impact.existingActivities} / {preview.impact.currentlyRed}</Text><Text style={text}>{c.basis}</Text><TogglePillButton disabled={busy} onPress={()=>void perform("activate")}>{c.activate}</TogglePillButton></>}
 </>}{message&&<Text accessibilityRole="alert" style={text}>{message}</Text>}</View>;
}
