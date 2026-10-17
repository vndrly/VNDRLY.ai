import {useEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import {createWorkdayController,WorkdayScopeSchema,type WorkdayScope} from "@workspace/api-zod";
import {useAuth} from "@/hooks/use-auth";
import {ownerForUser} from "@/lib/work-hub-client";
import {openWebFleetWorkStorage} from "@/lib/fleet-work-journal-web";
import {PngPillButton as TogglePillButton} from "@/components/png-pill-rollover";
import ImagePill from "@/components/image-pill";
type Controller=ReturnType<typeof createWorkdayController>;
async function http(path:string,body?:unknown){const response=await fetch(`/api/work-hub/workday${path}`,{credentials:"include",cache:"no-store",...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});if(!response.ok){const error=Object.assign(Error("Workday request could not be verified"),{status:response.status});throw error;}return response.json();}
export default function WorkdayControls(){
 const {user}=useAuth(),owner=ownerForUser(user);if(!user||!owner)return null;
 const identity=JSON.stringify([owner,user.userId,user.activeMembershipId]);return <Controls key={identity} identity={identity} userId={user.userId} membershipId={user.activeMembershipId} owner={owner}/>;
}
function Controls({identity,userId,membershipId,owner}:{identity:string;userId:number;membershipId:number|null|undefined;owner:WorkdayScope["owner"]}){
 const {i18n}=useTranslation(),es=i18n.language.startsWith("es"),alive=useRef(true),controller=useRef<Controller|null>(null),lock=useRef(false);
 const [state,setState]=useState<Awaited<ReturnType<Controller["read"]>>|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const current=()=>alive.current;
 const refresh=async()=>{if(!controller.current||lock.current)return;lock.current=true;try{const next=await controller.current.sync({read:id=>http(`/operations/${id}`),send:command=>http("/events",command)});if(current())setState(next);}finally{lock.current=false;}};
 useEffect(()=>{alive.current=true;void(async()=>{try{
  const storage=await openWebFleetWorkStorage(`workday-account:${identity}`,current);let value:unknown,online=true;
  try{value=await http("");}catch{online=false;const prior=await storage.transaction(tx=>tx.get("workday-index","last-scope"));if(!prior)throw Error("Verify your employer online before starting your first shift");value={scope:JSON.parse(prior),workday:null};}
  const scope=WorkdayScopeSchema.parse((value as {scope:unknown}).scope);if(scope.userId!==userId||scope.membershipId!==membershipId||JSON.stringify(scope.owner)!==JSON.stringify(owner))throw Error("Original workday employer changed");
  const active=createWorkdayController({scope,storage,isCurrent:current,uuid:()=>crypto.randomUUID()});controller.current=active;
  // Offline fallback must preserve the last canonical snapshot, not replace it with null.
  const cached=await active.read();
  if(online||!cached.cached)await active.cacheCurrent(value);
  if(current())setState(await active.read());await refresh();
 }catch(error){if(current())setMessage(error instanceof Error?error.message:"Workday unavailable");}})();const online=()=>{void refresh()};window.addEventListener("online",online);return()=>{alive.current=false;window.removeEventListener("online",online);};},[identity]);
 async function record(){if(!controller.current||lock.current||busy)return;setBusy(true);try{await controller.current.record(state?.onShift?"end_shift":"start_shift",new Date(),Intl.DateTimeFormat().resolvedOptions().timeZone);if(current()){setState(await controller.current.read());setMessage(es?"Guardado en este dispositivo; sincronizando":"Saved on this device; synchronizing");}await refresh();}catch(error){if(current())setMessage(error instanceof Error?error.message:"Workday unavailable");}finally{if(current())setBusy(false);}}
 return <section aria-label={es?"Jornada laboral":"Workday"} style={{border:"2px solid var(--brand-primary)",borderRadius:10,padding:"8px 12px",marginBottom:12,background:"#373b40",color:"#f8fafc",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
 <ImagePill color={state?.onShift?"green":"grey"}>{state?.onShift?(es?"En turno":"On Shift"):(es?"Fuera de turno":"Off Shift")}</ImagePill>
 <TogglePillButton disabled={busy||!state||state.held} onClick={()=>void record()}>{state?.onShift?(es?"Fin del día":"End of Day"):(es?"Iniciar turno":"Start Shift")}</TogglePillButton>
 {state?.pending?<span role="status">{state.pending} {es?"pendientes de sincronizar":"pending sync"}</span>:null}{state?.held?<span role="alert">{es?"Revisión necesaria; registros conservados":"Review needed; originals retained"}</span>:null}
 {message&&!state?.pending?<span role="status" style={{fontSize:12}}>{message}</span>:null}
 </section>;
}

