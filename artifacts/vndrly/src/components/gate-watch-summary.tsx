import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, NotebookPen, UserCheck } from "lucide-react";
import { WorkspacePanel } from "@/components/work-hub/workspace-panel";
import { useTranslation } from "react-i18next";
import type { ChangeOverState, ShiftNotesResponse } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import MyWatchSchedule from "./gate-my-watch-schedule";
import GateRecentShiftNotes from "./gate-recent-shift-notes";

type Watch = {userId:number;name:string;stationId:string;siteName:string;gateName:string;startedAt:string;watchId?:string|null;canManage?:boolean};
type AdminCommand = {stationId:string;body:{operationId:string;expectedShiftId:string;action:"assume"|"assign";targetMembershipId?:number}};

export default function GateWatchSummary({ stationId, current, onAssume, onHandoff, assumeDisabled }: { stationId: string; current?: ChangeOverState; onAssume?: () => void; onHandoff?: () => void; assumeDisabled?: boolean }) {
  const { user } = useAuth(), { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es");
  const cache=useQueryClient();
  const [assignGate,setAssignGate]=useState<string|null>(null),[pendingAdmin,setPendingAdmin]=useState<AdminCommand|null>(null),[adminBusy,setAdminBusy]=useState(false),[adminMessage,setAdminMessage]=useState("");
  const [assignWatchId,setAssignWatchId]=useState<string|null>(null);
  useEffect(()=>{setAssignGate(null);setPendingAdmin(null);setAdminMessage("");},[user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId]);
  const notes = useQuery({ queryKey: ["gate-watch-previous-notes", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, stationId], queryFn: () => changeOverRequest<ShiftNotesResponse>(`/${stationId}/notes?days=30`), enabled: Boolean(stationId), retry: false, throwOnError: false });
  const watches=useQuery({queryKey:["gate-active-watches",user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId],queryFn:()=>changeOverRequest<{watches:Watch[]}>("/watches"),retry:false,refetchInterval:15000});
  const standers=useQuery({queryKey:["gate-watch-standers",user?.userId,user?.activeMembershipId,assignGate],queryFn:()=>changeOverRequest<{operators:{userId:number;membershipId:number;name:string;companyName:string}[]}>(`/${assignGate}/watch/standers`),enabled:Boolean(assignGate),retry:false,staleTime:0});
  const ownsWatch=current?.shift?.operator_id===user?.userId;
  const previous = notes.data?.rows?.[0];
  const c = (en: string, spanish: string) => es ? spanish : en;
  const saved=async(receipt:{action:string;workerName:string})=>{
    setPendingAdmin(null);setAssignGate(null);setAdminMessage(receipt.action==="assume"?c("You assumed the watch.","Has asumido la vigilancia."):c(`Assigned to ${receipt.workerName}. Notification queued.`,`Asignado a ${receipt.workerName}. Notificación en cola.`));
    await Promise.all(["gate-active-watches","gate-watch-own-duty","gate-watch-previous-notes","change-over-state","gate-recovery-operators","work-hub-workforce","gate-watch-standers"].map(key=>cache.invalidateQueries({queryKey:[key]})));
  };
  const administer=async(command:AdminCommand)=>{
    if(adminBusy)return;setAdminBusy(true);setPendingAdmin(command);setAdminMessage("");
    try{await saved(await changeOverRequest<{action:string;workerName:string}>(`/${command.stationId}/watch/admin`,command.body));}
    catch(error){if((error as {status?:number}).status&&Number((error as {status?:number}).status)<500){setPendingAdmin(null);void watches.refetch();if(assignGate)void standers.refetch();}setAdminMessage(error instanceof Error?error.message:c("Assignment could not be confirmed.","No se pudo confirmar la asignación."));}
    finally{setAdminBusy(false);}
  };
  const checkAssignment=async()=>{
    if(!pendingAdmin||adminBusy)return;setAdminBusy(true);
    try{const result=await changeOverRequest<{receipt:{action:string;workerName:string}|null}>(`/${pendingAdmin.stationId}/watch/admin-operations/${pendingAdmin.body.operationId}`);if(result.receipt)await saved(result.receipt);else{setAdminBusy(false);await administer(pendingAdmin);}}
    catch(error){setAdminMessage(error instanceof Error?error.message:c("Assignment is still unconfirmed.","La asignación sigue sin confirmarse."));}finally{setAdminBusy(false);}
  };
  const commandFor=(w:Watch,action:"assume"|"assign",targetMembershipId?:number):AdminCommand=>({stationId:w.stationId,body:{operationId:crypto.randomUUID(),expectedShiftId:w.watchId!,action,...(targetMembershipId?{targetMembershipId}:{})}});
  const blocked=adminBusy||Boolean(pendingAdmin)||assumeDisabled||!navigator.onLine;
  return <WorkspacePanel title={c("Watch & handover", "Vigilancia y relevo")} subtitle={c("Custody, your watch time, and the last handover", "Custodia, tiempo de vigilancia y último relevo")} icon={Clock3}>
    <MyWatchSchedule />
    {current&&!current.shift&&onAssume&&<button type="button" className="gate-watch-text-action" disabled={assumeDisabled} onClick={onAssume}>{c("Assume Watch","Asumir vigilancia")}</button>}
    <div className="gate-watch-roster-row">
      <details className="gate-panel-disclosure gate-watch-roster">
        <summary><UserCheck aria-hidden="true"/><span>{c("On watch", "En vigilancia")}</span><small>{watches.isSuccess && Array.isArray(watches.data?.watches) ? watches.data.watches.length : c("Unavailable","No disponible")}</small></summary>
        <div className="gate-panel-detail">{watches.isSuccess && Array.isArray(watches.data?.watches) ? watches.data.watches.length ? watches.data.watches.map(w=><div className="gate-current-watch" key={`${w.stationId}:${w.userId}`}>
          <div className="gate-current-watch-heading"><strong>{w.name}</strong>{w.canManage&&w.watchId&&<span className="gate-watch-admin-actions" aria-label={c(`Manage ${w.name}'s watch at ${w.siteName}`,`Gestionar vigilancia de ${w.name} en ${w.siteName}`)}>
            <button type="button" className="gate-watch-text-action" disabled={blocked||w.userId===user?.userId} onClick={()=>void administer(commandFor(w,"assume"))}>{c("Assume","Asumir")}</button><span className="gate-watch-divider" aria-hidden="true">|</span>
            <Popover open={assignGate===w.stationId&&assignWatchId===w.watchId} onOpenChange={open=>{setAssignGate(open?w.stationId:null);setAssignWatchId(open?w.watchId!:null);}}><PopoverTrigger asChild><button type="button" className="gate-watch-text-action" disabled={blocked}>{c("Assign","Asignar")}</button></PopoverTrigger>
              <PopoverContent className="gate-watch-assign-flyout" align="end" aria-label={c(`Assign watch at ${w.siteName}`,`Asignar vigilancia en ${w.siteName}`)}>
                <h3>{c("Available watch standers","Personal disponible")}</h3><p>{w.siteName} · {w.gateName}</p>
                <div className="gate-watch-stander-list">{standers.isPending?<p role="status">{c("Loading…","Cargando…")}</p>:standers.isError?<p role="alert">{c("Available watch standers could not be loaded.","No se pudo cargar el personal disponible.")}</p>:standers.data?.operators.length?standers.data.operators.map(person=><button key={person.membershipId} type="button" aria-label={c(`Assign to ${person.name}`,`Asignar a ${person.name}`)} disabled={blocked} onClick={()=>void administer(commandFor(w,"assign",person.membershipId))}><strong>{person.name}</strong><small>{person.companyName}</small></button>):<p>{c("No available watch standers.","No hay personal disponible.")}</p>}</div>
              </PopoverContent>
            </Popover>
          </span>}</div><p>{w.siteName} · {w.gateName}</p>
        </div>) : <p>{c("No gatekeepers currently on watch.","No hay porteros de vigilancia.")}</p> : <p>{c("Watch roster unavailable.","Lista de vigilancia no disponible.")}</p>}</div>
      </details>
      {current&&ownsWatch&&onHandoff&&<button type="button" className="gate-watch-text-action" data-active="true" disabled={assumeDisabled} onClick={onHandoff}>{c("Handoff","Entregar")}</button>}
    </div>
    {adminMessage&&<p role="status" className="gate-watch-admin-message">{adminMessage}</p>}
    {pendingAdmin&&!adminBusy&&<button type="button" className="gate-watch-text-action" onClick={()=>void checkAssignment()}>{c("Check assignment","Comprobar asignación")}</button>}
    <details className="gate-panel-disclosure">
      <summary><NotebookPen aria-hidden="true" /> <span>{c("Previous watch", "Vigilancia anterior")}</span><small>{previous?.outgoing_name ?? c("Notes", "Notas")}</small></summary>
      <div className="gate-panel-detail">
        {notes.isPending ? <p>{c("Loading handoff notes…", "Cargando notas del relevo…")}</p> : notes.isError ? <p role="status">{c("Handoff notes unavailable.", "Notas del relevo no disponibles.")}</p> : previous ? <>
          <p>{previous.outgoing_name} · {new Date(previous.acknowledged_at).toLocaleString()}</p>
          <p className="whitespace-pre-wrap">{previous.notes || c("No written notes in this handoff.", "Este relevo no tiene notas escritas.")}</p>
        </> : <p>{c("No recorded handoff in the last 30 days.", "No hay relevos registrados en los últimos 30 días.")}</p>}
      </div>
    </details>
    <GateRecentShiftNotes key={`${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${stationId}`} stationId={stationId} siteId={current?.site?.id} />
  </WorkspacePanel>;
}
