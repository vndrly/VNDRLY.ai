import {useEffect,useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Clock3} from "lucide-react";
import {useTranslation} from "react-i18next";
import {useLocation} from "wouter";
import {useAuth} from "@/hooks/use-auth";
import {changeOverRequest} from "@/lib/change-over-api";
import {workHubRequest} from "@/lib/work-hub-client";
import {Popover,PopoverTrigger,PopoverContent} from "@/components/ui/popover";
import "./gate-my-watch-schedule.css";

export type ScheduledWatch={id:string;assignmentId:string;version:number;title:string;startsAt:string;endsAt:string;timezone:string;siteName:string;gateName:string;stationId:string;siteId:number;scheduler:{userId:number;name:string;profileHref:string|null};response:"pending"|"confirmed"|"conflict";escalated:boolean};
type Command={shiftId:string;body:{operationId:string;assignmentId:string;expectedVersion:number;response:"confirm"|"conflict";reason?:string}};

export default function MyWatchSchedule(){
  const {user}=useAuth();
  return <Schedule key={`${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`}/>;
}
function Schedule(){
  const {user}=useAuth(),{i18n}=useTranslation(),[,navigate]=useLocation(),cache=useQueryClient();
  const es=(i18n?.language??"en").startsWith("es"),c=(en:string,spanish:string)=>es?spanish:en;
  const [now,setNow]=useState(Date.now()),[conflict,setConflict]=useState<string|null>(null),[reason,setReason]=useState(""),[pending,setPending]=useState<Command|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;const timer=setInterval(()=>setNow(Date.now()),60000);return()=>{alive.current=false;clearInterval(timer);};},[]);
  const schedule=useQuery({queryKey:["gate-my-scheduled-watches",user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId],queryFn:()=>changeOverRequest<{watches:ScheduledWatch[]}>("/my-scheduled-watches"),retry:false,refetchInterval:30000});
  const watches=schedule.data?.watches??[],next=watches.find(w=>Date.parse(w.startsAt)>=now);
  const time=(watch:ScheduledWatch,value=watch.startsAt)=>`${new Date(value).toLocaleString(es?"es":"en-US",{timeZone:watch.timezone,dateStyle:"medium",timeStyle:"short"})} (${watch.timezone})`;
  async function respond(command:Command){
    if(lock.current)return;lock.current=true;setBusy(true);setPending(command);setMessage("");
    try {
      const receipt=await changeOverRequest<{response:string;escalated:boolean;notifiedCount:number}>(`/my-scheduled-watches/${command.shiftId}/response`,command.body);
      if(!alive.current)return;
      setPending(null);setConflict(null);setReason("");
      setMessage(!receipt.notifiedCount?c("Response saved. No current scheduler recipient was available.","Respuesta guardada. No había un programador actual disponible para notificar."):receipt.response==="confirm"?c("Watch confirmed. Scheduler notified.","Guardia confirmada. Se notificó al programador."):receipt.escalated?c("Conflict recorded. Scheduler and office/admin notified for urgent coverage.","Conflicto registrado. Se notificó al programador y a oficina/administración para cubrir la guardia urgente."):c("Conflict recorded. Scheduler notified; your assignment remains listed.","Conflicto registrado. Se notificó al programador; tu asignación sigue en la lista."));
      await cache.invalidateQueries({queryKey:["gate-my-scheduled-watches"]});
    }catch(error){
      if(!alive.current)return;
      if((error as {status?:number}).status&&Number((error as {status?:number}).status)<500){setPending(null);void schedule.refetch();}
      setMessage(error instanceof Error?error.message:c("Response not confirmed. Retry the saved response.","Respuesta sin confirmar. Reintenta la respuesta guardada."));
    }finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  const commandFor=(w:ScheduledWatch,response:"confirm"|"conflict"):Command=>({shiftId:w.id,body:{operationId:crypto.randomUUID(),assignmentId:w.assignmentId,expectedVersion:w.version,response,...(response==="conflict"?{reason:reason.trim()}:{})}});
  async function contact(w:ScheduledWatch){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const result=await workHubRequest<{channel?:{id:string}}>("/chats",{method:"POST",...(user?.vendorId?{headers:{"X-VNDRLY-Actor-User":String(user.userId),"X-VNDRLY-Vendor":String(user.vendorId),"X-VNDRLY-Membership":String(user.activeMembershipId)}}:{}),body:JSON.stringify({recipientUserId:w.scheduler.userId})});if(alive.current&&result.channel?.id)navigate(`/work-hub/chat?channel=${encodeURIComponent(result.channel.id)}`);}
    catch{if(alive.current)setMessage(c("The supervisor conversation could not be opened.","No se pudo abrir la conversación con el supervisor."));}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <details className="gate-panel-disclosure gate-my-watch-schedule">
    <summary><Clock3 aria-hidden="true"/><span>{c("My Watch","Mi guardia")}</span><small>{schedule.isPending?c("Loading…","Cargando…"):schedule.isError?c("Schedule unavailable","Horario no disponible"):next?time(next):c("No upcoming watches","Sin próximas guardias")}</small></summary>
    <div className="gate-panel-detail gate-scheduled-watch-list">
      {schedule.isError?<p role="alert">{c("Your schedule could not be loaded.","No se pudo cargar tu horario.")}</p>:!watches.length&&!schedule.isPending?<p>{c("No scheduled watches.","Sin guardias programadas.")}</p>:watches.map(w=><article className="gate-scheduled-watch" key={w.assignmentId}>
        <strong>{w.siteName} · {w.gateName}</strong><p><time dateTime={w.startsAt}>{time(w)}</time> — <time dateTime={w.endsAt}>{time(w,w.endsAt)}</time></p>
        <div className="gate-scheduled-watch-actions"><Popover><PopoverTrigger asChild><button type="button" className="gate-watch-text-action">{w.scheduler.name}</button></PopoverTrigger><PopoverContent className="gate-watch-assign-flyout" aria-label={c("Scheduled by","Programado por")}>
          <strong>{w.scheduler.name}</strong>{w.scheduler.profileHref&&<a className="gate-watch-text-action" href={w.scheduler.profileHref}>{c("Open supervisor profile","Abrir perfil del supervisor")}</a>}
          {w.scheduler.userId!==user?.userId&&<button type="button" className="gate-watch-text-action" disabled={busy} onClick={()=>void contact(w)}>{c("Message supervisor","Enviar mensaje al supervisor")}</button>}
        </PopoverContent></Popover><span aria-hidden="true">·</span>
        <button type="button" className="gate-watch-text-action" disabled={busy||!!pending||w.response==="confirmed"} onClick={()=>void respond(commandFor(w,"confirm"))}>{c("Confirm","Confirmar")}</button><span className="gate-watch-divider" aria-hidden="true">|</span>
        <button type="button" className="gate-watch-text-action" disabled={busy||!!pending} onClick={()=>{setConflict(conflict===w.id?null:w.id);setReason("");}}>{c("Conflict","Conflicto")}</button>
        {w.response!=="pending"&&<small className="gate-schedule-response" data-conflict={w.response==="conflict"}>{w.response==="confirmed"?c("Confirmed","Confirmada"):w.escalated?c("Conflict · urgent coverage","Conflicto · cobertura urgente"):c("Conflict · coverage needed","Conflicto · necesita cobertura")}</small>}</div>
        {conflict===w.id&&<form className="gate-watch-conflict-form" onSubmit={event=>{event.preventDefault();if(reason.trim())void respond(commandFor(w,"conflict"));}}>
          <label>{c("Scheduling conflict","Conflicto de horario")}<textarea value={reason} maxLength={1000} disabled={busy||!!pending} onChange={event=>setReason(event.target.value)} placeholder={c("Brief reason; personal medical details are not needed.","Motivo breve; no se necesitan detalles médicos personales.")}/></label>
          <button type="submit" className="gate-watch-text-action" disabled={busy||!!pending||!reason.trim()}>{c("Report conflict","Informar conflicto")}</button>
        </form>}
      </article>)}
      {message&&<p role="status">{message}</p>}{pending&&!busy&&<button type="button" className="gate-watch-text-action" onClick={()=>void respond(pending)}>{c("Retry saved response","Reintentar respuesta guardada")}</button>}
    </div>
  </details>;
}
