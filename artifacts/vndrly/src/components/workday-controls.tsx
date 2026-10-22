import {useEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import {createWorkdayController,WorkdayScopeSchema,type WorkdayScope} from "@workspace/api-zod";
import {useAuth} from "@/hooks/use-auth";
import {ownerForUser} from "@/lib/work-hub-client";
import {openWebFleetWorkStorage} from "@/lib/fleet-work-journal-web";
import {PngPillButton as TogglePillButton} from "@/components/png-pill-rollover";
import type { ReactNode } from "react";
import WorkdayStatusText from "./workday-status-text";
import OnCallControl from "./on-call-control";
import "./workday-controls.css";
type Controller=ReturnType<typeof createWorkdayController>;
async function http(path:string,body?:unknown){const response=await fetch(`/api/work-hub/workday${path}`,{credentials:"include",cache:"no-store",...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});if(!response.ok){const error=Object.assign(Error("Workday request could not be verified"),{status:response.status});throw error;}return response.json();}
export default function WorkdayControls({watchControl}:{watchControl?:ReactNode}={}){
 const {user}=useAuth(),owner=ownerForUser(user);if(!user||!owner)return null;
 const identity=JSON.stringify([owner,user.userId,user.activeMembershipId]);return <Controls watchControl={watchControl} key={identity} identity={identity} userId={user.userId} membershipId={user.activeMembershipId} owner={owner}/>;
}
function Controls({identity,userId,membershipId,owner,watchControl}:{watchControl?:ReactNode;identity:string;userId:number;membershipId:number|null|undefined;owner:WorkdayScope["owner"]}){
 const {i18n}=useTranslation(),es=(i18n?.language??"en").startsWith("es"),alive=useRef(true),controller=useRef<Controller|null>(null),lock=useRef(false);
 const [state,setState]=useState<Awaited<ReturnType<Controller["read"]>>|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[recoveryReason,setRecoveryReason]=useState("");
 const current=()=>alive.current;
 const refresh=async()=>{if(!controller.current||lock.current)return;lock.current=true;try{const next=await controller.current.sync({read:id=>http(`/operations/${id}`),send:command=>http("/events",command),current:()=>http("")});if(current())setState(next);}finally{lock.current=false;}};
 useEffect(()=>{alive.current=true;void(async()=>{try{
  const storage=await openWebFleetWorkStorage(`workday-account:${identity}`,current);let value:unknown,online=true;
  try{value=await http("");}catch(error){online=false;const prior=await storage.transaction(tx=>tx.get("workday-index","last-scope"));if(!prior)throw Error((error as {status?:number})?.status===404?(es?"El registro de turnos no está disponible en este entorno.":"Shift tracking is unavailable in this environment."):(es?"No se pudo cargar el estado del turno. Inténtalo de nuevo.":"Shift status could not be loaded. Try again."));value={scope:JSON.parse(prior),workday:null};}
  const scope=WorkdayScopeSchema.parse((value as {scope:unknown}).scope);if(scope.userId!==userId||scope.membershipId!==membershipId||JSON.stringify(scope.owner)!==JSON.stringify(owner))throw Error("Original workday employer changed");
  const active=createWorkdayController({scope,storage,isCurrent:current,uuid:()=>crypto.randomUUID()});controller.current=active;
  // Offline fallback must preserve the last canonical snapshot, not replace it with null.
  const cached=await active.read();
  if(online||!cached.cached)await active.cacheCurrent(value);
  if(current())setState(await active.read());await refresh();
 }catch(error){if(current())setMessage(error instanceof Error?error.message:"Workday unavailable");}})();const online=()=>{void refresh()};window.addEventListener("online",online);window.addEventListener("focus",online);return()=>{alive.current=false;window.removeEventListener("online",online);window.removeEventListener("focus",online);};},[identity]);
 async function recover(){if(!controller.current||busy||!recoveryReason.trim())return;setBusy(true);try{await controller.current.recoverPrior({read:id=>http(`/operations/${id}`),send:command=>http("/events",command),authorize:(scope,reason)=>http("/reauthorize",{scope,reason})},recoveryReason);await refresh();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function record(){if(!controller.current||lock.current||busy)return;setBusy(true);try{await refresh();const live=await controller.current.read();await controller.current.record(live.onShift?"end_shift":"start_shift",new Date(),Intl.DateTimeFormat().resolvedOptions().timeZone);if(current()){setState(await controller.current.read());setMessage(es?"Guardado en este dispositivo; sincronizando":"Saved on this device; synchronizing");}await refresh();}catch(error){if(current())setMessage(error instanceof Error?error.message:"Workday unavailable");}finally{if(current())setBusy(false);}}
 return <section aria-label={es?"Jornada laboral":"Workday"} className="shift-card">
 <div className="shift-card-left"><WorkdayStatusText active={state?.onShift===true} disabled={busy||!state||state.held} label={state?.onShift?(es?"Finalizar turno":"End Shift"):(es?"Iniciar turno":"Start Shift")} onClick={()=>void record()}/></div>
 <div className="shift-card-center">{watchControl}</div>
 <OnCallControl identity={identity}/>
 <div className="shift-card-feedback">
 {state?.priorPending?<div><p>{state.priorPending} {es?"originales de sesiones anteriores":"originals from earlier sign-ins"}</p><input aria-label={es?"Motivo de recuperación":"Recovery reason"} value={recoveryReason} onChange={e=>setRecoveryReason(e.target.value)}/><TogglePillButton disabled={busy||!recoveryReason.trim()} onClick={()=>void recover()}>{es?"Recuperar originales":"Recover originals"}</TogglePillButton></div>:null}
 {state?.pending?<span role="status">{state.pending} {es?"pendientes de sincronizar":"pending sync"}</span>:null}{state?.held?<span role="alert">{es?"Revisión necesaria; registros conservados":"Review needed; originals retained"}</span>:null}
 {message&&!state?.pending?<span role="status" style={{fontSize:12}}>{message}</span>:null}
 </div>
 </section>;
}

