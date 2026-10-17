import React,{useEffect,useRef,useState} from "react";
import {View,Text,TextInput,AppState} from "react-native";
import {useTranslation} from "react-i18next";
import {createWorkdayController,WorkdayScopeSchema} from "@workspace/api-zod";
import {useAuth} from "@/hooks/use-auth";import {useBrand} from "@/hooks/use-brand";
import {captureAuthScope,isAuthScopeCurrent} from "@/lib/auth";import {apiFetch} from "@/lib/api";
import {openNativeFleetWorkStorage} from "@/lib/fleet-work-journal-native";
import {changeNativeDuty} from "@/lib/native-operations";
import * as Crypto from "expo-crypto";
import ShiftPill from "@/components/ShiftPill";
type Controller=ReturnType<typeof createWorkdayController>;
export default function WorkdayControls(){const {user,activeMembership}=useAuth();if(!user||!activeMembership)return null;const identity=JSON.stringify([activeMembership.orgType,activeMembership.orgId,user.id,activeMembership.id]);return <Controls key={identity} identity={identity} userId={user.id} memberId={activeMembership.id} orgType={activeMembership.orgType} orgId={activeMembership.orgId}/>;}
function Controls({identity,userId,memberId,orgType,orgId}:{identity:string;userId:number;memberId:number;orgType:"vendor"|"partner";orgId:number}){
 const {i18n}=useTranslation(),es=(i18n?.language??"en").startsWith("es"),brand=useBrand(),alive=useRef(true),auth=useRef(captureAuthScope()),controller=useRef<Controller|null>(null),lock=useRef(false);
 const [state,setState]=useState<Awaited<ReturnType<Controller["read"]>>|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[recoveryReason,setRecoveryReason]=useState("");
 const current=()=>alive.current&&isAuthScopeCurrent(auth.current);
 const http=(path:string,body?:unknown)=>apiFetch(`/api/work-hub/workday${path}`,body?{method:"POST",body:JSON.stringify(body)}:{},auth.current);
 const refresh=async()=>{if(!current()||!controller.current||lock.current)return;lock.current=true;try{const next=await controller.current.sync({read:id=>http(`/operations/${id}`),send:command=>http("/events",command),current:()=>http("")});if(current())setState(next);}finally{lock.current=false;}};
 useEffect(()=>{alive.current=true;auth.current=captureAuthScope();void(async()=>{try{
  const {storage}=await openNativeFleetWorkStorage(`workday-account:${identity}`,current);let value:unknown,online=true;
  try{value=await http("");}catch{online=false;const prior=await storage.transaction(tx=>tx.get("workday-index","last-scope"));if(!prior)throw Error("Verify your employer online before your first shift");value={scope:JSON.parse(prior),workday:null};}
  const scope=WorkdayScopeSchema.parse((value as {scope:unknown}).scope);if(scope.userId!==userId||scope.membershipId!==memberId||scope.owner.type!==orgType||scope.owner.id!==orgId)throw Error("Original workday employer changed");
  const active=createWorkdayController({scope,storage,isCurrent:current,uuid:()=>Crypto.randomUUID()});controller.current=active;const cached=await active.read();if(online||!cached.cached)await active.cacheCurrent(value);if(current())setState(await active.read());await refresh();
 }catch(error){if(current())setMessage(error instanceof Error?error.message:"Workday unavailable");}})();const subscription=AppState.addEventListener("change",value=>{if(value==="active")void refresh()});return()=>{alive.current=false;subscription.remove();};},[identity]);
 async function recover(){if(!controller.current||busy||!recoveryReason.trim())return;setBusy(true);try{await controller.current.recoverPrior({read:id=>http(`/operations/${id}`),send:command=>http("/events",command),authorize:(scope,reason)=>http("/reauthorize",{scope,reason})},recoveryReason);await refresh();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function record(){if(!controller.current||lock.current||busy)return;setBusy(true);let ending=false;try{await refresh();ending=(await controller.current.read()).onShift;
  await controller.current.record(ending?"end_shift":"start_shift",new Date(),Intl.DateTimeFormat().resolvedOptions().timeZone);if(current()){setState(await controller.current.read());setMessage(es?"Guardado; sincronizando":"Saved; synchronizing");}
  // Local End of Day stops shift collection promptly even while its canonical
  // clock intent waits offline. Existing separate On Call consent is preserved.
  if(orgType==="vendor")void changeNativeDuty(ending?"end":"start").then(()=>import("@/lib/duty-background-location")).then(module=>module.synchronizeDutyBackgroundLocation()).catch(()=>undefined);
  await refresh();
 }catch(error){if(current())setMessage(error instanceof Error?error.message:"Workday unavailable");}finally{if(current())setBusy(false);}}
 return <View accessibilityLabel={es?"Jornada laboral":"Workday"} style={{margin:10,padding:10,borderWidth:2,borderColor:brand.primary,borderRadius:10,backgroundColor:"#373b40",gap:8}}>
 <View style={{flexDirection:"row",alignItems:"center",gap:12}}><Text style={{color:"#f8fafc",fontWeight:"600"}}>{state?.onShift?(es?"En turno":"On Shift"):(es?"Fuera de turno":"Off Shift")}</Text><ShiftPill active={state?.onShift===true} disabled={busy||!state||state.held} label={state?.onShift?(es?"Fin del día":"End of Day"):(es?"Iniciar turno":"Start Shift")} onPress={()=>void record()}/></View>
 {state?.priorPending?<View><Text style={{color:"#ffffff"}}>{state.priorPending} {es?"originales de sesiones anteriores":"originals from earlier sign-ins"}</Text><TextInput accessibilityLabel={es?"Motivo de recuperación":"Recovery reason"} value={recoveryReason} onChangeText={setRecoveryReason} style={{color:"#ffffff"}}/><ShiftPill active={false} disabled={busy||!recoveryReason.trim()} label={es?"Recuperar originales":"Recover originals"} onPress={()=>void recover()}/></View>:null}
 {state?.pending?<Text style={{color:"#f8fafc"}}>{state.pending} {es?"pendientes de sincronizar":"pending sync"}</Text>:null}{state?.held?<Text accessibilityRole="alert" style={{color:"#ffffff"}}>{es?"Revisión necesaria; originales conservados":"Review needed; originals retained"}</Text>:null}{message&&!state?.pending?<Text style={{color:"#e2e8f0",fontSize:12}}>{message}</Text>:null}
 </View>;
}
