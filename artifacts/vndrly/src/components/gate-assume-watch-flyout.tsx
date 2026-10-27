import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { AppModalHeader } from "@/components/app-modal-header";
import type { ChangeOverState } from "@workspace/gate-booth";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import "./gate-assume-watch-flyout.css";

type Props={stationId:string;open:boolean;onOpenChange:(open:boolean)=>void;adminWatchId?:string;onSaved?:()=>void|Promise<void>;onPendingChange?:(pending:boolean)=>void};
type Command={path:string;receiptPath:string;body:Record<string,unknown>};
export default function GateAssumeWatchFlyout(props:Props) {
  const {user}=useAuth();
  return <Review key={`${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${props.stationId}:${props.adminWatchId??""}`} {...props}/>;
}
function Review({stationId,open,onOpenChange,adminWatchId,onSaved,onPendingChange}:Props) {
  const {user}=useAuth(),{i18n}=useTranslation(),cache=useQueryClient();
  const es=(i18n?.language??"en").startsWith("es"),c=(en:string,spanish:string)=>es?spanish:en;
  const [pending,setPending]=useState<Command|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const lock=useRef(false);
  const state=useQuery({queryKey:["gate-assume-review",user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId,stationId],queryFn:()=>changeOverRequest<ChangeOverState>(`/${stationId}/state`),enabled:open&&Boolean(stationId),staleTime:0,retry:false,refetchOnWindowFocus:false});
  useEffect(()=>{onPendingChange?.(Boolean(pending));},[Boolean(pending),onPendingChange]);
  const current=state.data,prep=current?.preparation,watch=current?.shift??current?.releasedWatch;
  const own=current?.shift?.operator_id===user?.userId;
  const changed=Boolean(adminWatchId&&current?.shift?.id!==adminWatchId);
  async function saved() {
    setPending(null);setError("");onOpenChange(false);
    await Promise.all(["change-over-state","gate-entry-watch","gate-active-watches","gate-watch-timeline","gate-watch-own-duty","gate-watch-standers","work-hub-workforce"].map(key=>cache.invalidateQueries({queryKey:[key]})));
    await onSaved?.();
  }
  async function send(command:Command) {
    setPending(command);
    try {await changeOverRequest(command.path,command.body);await saved();}
    catch(e) {
      const status=(e as {status?:number}).status;
      if(status&&status>=400&&status<500){setPending(null);void state.refetch();}
      setError(e instanceof Error?e.message:c("The watch change could not be confirmed.","No se pudo confirmar el cambio de guardia."));
    }
  }
  async function assume() {
    if(lock.current||pending||!current||own||changed||state.isFetching||state.isError||!navigator.onLine)return;
    lock.current=true;setBusy(true);setError("");
    const operationId=crypto.randomUUID(),review={preparationId:prep?.id??null,reviewedRevision:current.snapshot?.revision,acknowledged:true,allowUnprepared:!prep};
    const command:Command=adminWatchId?{path:`/${stationId}/watch/admin`,receiptPath:`/${stationId}/watch/admin-operations/${operationId}`,body:{operationId,expectedShiftId:adminWatchId,action:"assume",...review}}:{path:`/${stationId}/watch/assume`,receiptPath:`/${stationId}/watch/operations/${operationId}`,body:{operationId,source:"web",expectedWatchId:watch?.id??null,...review}};
    try {await send(command);}finally{lock.current=false;setBusy(false);}
  }
  async function check() {
    if(lock.current||!pending||!navigator.onLine)return;
    lock.current=true;setBusy(true);setError("");
    try {const result=await changeOverRequest<{receipt:unknown}>(pending.receiptPath);if(result.receipt)await saved();else if(result.receipt===null)await send(pending);else throw Error(c("The result is still unknown.","El resultado aún es desconocido."));}
    catch(e){setError(e instanceof Error?e.message:c("The result could not be checked.","No se pudo comprobar el resultado."));}
    finally{lock.current=false;setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent bare hideClose className="gate-assume-flyout" accentHeaderStyle={{display:"none"}}>
    <AppModalHeader compact title={<DialogTitle>{c("Assume Watch","Asumir vigilancia")}</DialogTitle>} description={<DialogDescription>{c("Review the watch, then select ASSUME to take responsibility.","Revisa la guardia y selecciona ASUMIR para aceptar la responsabilidad.")}</DialogDescription>} closeControl={<button type="button" aria-label={c("Close watch summary","Cerrar resumen de guardia")} onClick={()=>onOpenChange(false)}><X aria-hidden="true"/></button>}/>
    <div className="gate-assume-summary">
      {state.isPending||state.isFetching?<p role="status">{c("Loading watch summary…","Cargando resumen de guardia…")}</p>:state.isError?<><p role="alert">{c("The watch summary could not be loaded.","No se pudo cargar el resumen de guardia.")}</p><button type="button" onClick={()=>void state.refetch()}>{c("Retry","Reintentar")}</button></>:current?<>
        <strong>{current.site.name} · {current.station.name}</strong>
        {watch&&<p>{watch.operator_name} · {new Date(watch.started_at).toLocaleString()}</p>}
        {prep?<><h3>{c("Saved handover","Relevo guardado")}</h3><ul>{prep.summary.facts.map(f=><li key={f.id}>{f.text}</li>)}</ul>{prep.notes&&<p className="whitespace-pre-wrap">{prep.notes}</p>}{prep.snapshot.openItems.filter(item=>item.status==="open").map(item=><p key={item.id}>{item.text}</p>)}</>:<p className="gate-assume-no-handover">{c("No handover prepared","No hay relevo preparado")}</p>}
        {prep&&current.stale&&<><p>{c("Gate activity has changed since this handover was saved.","La actividad cambió desde que se guardó este relevo.")}</p><ul>{current.snapshot?.facts.map(f=><li key={f.id}>{f.text}</li>)}</ul></>}
        {own&&<p>{c("You already hold this watch.","Ya tienes esta guardia.")}</p>}{changed&&<p role="alert">{c("This watch has changed. Close this summary and select the current watch.","Esta guardia cambió. Cierra el resumen y selecciona la guardia actual.")}</p>}
      </>:null}
      {error&&<p role="alert">{error}</p>}
      {pending&&<p role="status">{c("Checking is required before another attempt. Closing this window keeps the original request available.","Debes comprobar el resultado antes de reintentar. Cerrar esta ventana conserva la solicitud original.")}</p>}
    </div>
    <div className="gate-assume-footer">{pending?<button type="button" className="gate-watch-text-action" disabled={busy||!navigator.onLine} onClick={()=>void check()}>{c("Check assumption","Comprobar guardia")}</button>:<button type="button" className="gate-assume-confirm" disabled={busy||!current||state.isFetching||state.isError||own||changed||!navigator.onLine} onClick={()=>void assume()}>{c("ASSUME","ASUMIR")}</button>}</div>
  </DialogContent></Dialog>;
}
