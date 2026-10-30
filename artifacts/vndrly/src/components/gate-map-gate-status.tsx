import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Gate = { id:string; siteId:number; name:string; latitude:number|null; longitude:number|null; geofenceRadiusM:number; active:boolean; version:number };
async function request<T>(path:string, body?:unknown):Promise<T> {
  const response=await fetch(`/api/gate-locations${path}`, {credentials:"include",signal:AbortSignal.timeout(30000),...(body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  const result=await response.json();
  if(!response.ok) throw new Error(result.message??result.code??"Gate status could not be saved.");
  return result;
}

/** Reuses the authorized, versioned Gate Locations review/save contract. */
export function GateMapGateStatus({stationId,siteId,userId,membershipId,active,historical,es,onConfirmingChange}:{stationId:string;siteId:number;userId:number;membershipId?:number|null;active?:boolean;historical:boolean;es:boolean;onConfirmingChange?:(confirming:boolean)=>void}) {
  const cache=useQueryClient(),c=(en:string,spanish:string)=>es?spanish:en;
  const [confirming,setConfirming]=useState<Gate|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const operation=useRef<{gate:Gate;confirmation:string;idempotencyKey:string}|null>(null),lock=useRef(false);
  const queryKey=["gate-map-status-gates",userId,membershipId,siteId];
  const gates=useQuery({queryKey,queryFn:()=>request<{gates:Gate[]}>(`?siteId=${siteId}`),enabled:!historical,retry:false});
  const gate=gates.data?.gates.find(row=>row.id===stationId&&row.siteId===siteId);
  const isActive=gate?.active??active!==false;
  const status=c(isActive?"Active":"Inactive",isActive?"Activo":"Inactivo");
  const editable=gate&&gate.latitude!==null&&gate.longitude!==null&&!historical;
  async function save() {
    if(!confirming||lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try {
      if(!operation.current){
        const values={...confirming,active:!confirming.active};
        const review=await request<{values:Gate;confirmation:string}>("/preview",values);
        operation.current={gate:review.values,confirmation:review.confirmation,idempotencyKey:crypto.randomUUID()};
      }
      const receipt=operation.current;
      const updated=await request<Gate>("",{...receipt.gate,confirmation:receipt.confirmation,idempotencyKey:receipt.idempotencyKey});
      cache.setQueryData<{gates:Gate[]}>(queryKey,current=>current?{gates:current.gates.map(row=>row.id===updated.id?updated:row)}:current);
      setConfirming(null);operation.current=null;onConfirmingChange?.(false);
      await Promise.all(["gate-map-status-gates","gate-coverage-map","gate-locations","gate-station-management-gates","gate-station-management-sites","change-over-stations","gate-site-gate-options","coverage-board","linked-gates"].map(key=>cache.invalidateQueries({queryKey:[key]})));
    } catch(failure){setError(failure instanceof Error?failure.message:c("Gate status could not be saved.","No se pudo guardar el estado."));}
    finally{lock.current=false;setBusy(false);}
  }
  return <>
    {editable?<button type="button" className="gate-map-gate-status" data-active={isActive} disabled={busy} aria-label={c(`${isActive?"Deactivate":"Activate"} ${gate.name}`,`${isActive?"Desactivar":"Activar"} ${gate.name}`)} onClick={()=>{setConfirming({...gate});operation.current=null;setError("");onConfirmingChange?.(true);}}>{status}</button>:<span className="gate-map-gate-status" data-active={isActive}>{status}</span>}
    {confirming&&<span className="gate-map-status-confirm" role="group" aria-label={c("Confirm gate status change","Confirmar cambio de estado")}>
      <span>{confirming.active?c(`Are you sure you want to deactivate ${confirming.name}? It will no longer require coverage. Its history is retained.`,`¿Desactivar ${confirming.name}? Ya no requerirá cobertura. Su historial se conserva.`):c(`Are you sure you want to activate ${confirming.name}? It may now appear in coverage gaps and need staffing.`,`¿Activar ${confirming.name}? Puede aparecer en brechas de cobertura y necesitar personal.`)}</span>
      <span className="gate-map-status-actions"><button type="button" className="gate-history-filter" disabled={busy} onClick={()=>void save()}>{busy?c("Saving…","Guardando…"):c(confirming.active?"Deactivate Gate":"Activate Gate",confirming.active?"Desactivar acceso":"Activar acceso")}</button><button type="button" className="gate-history-filter" disabled={busy} onClick={()=>{setConfirming(null);operation.current=null;setError("");onConfirmingChange?.(false);}}>{c("Cancel","Cancelar")}</button></span>
      {error&&<span role="alert">{error}</span>}
    </span>}
  </>;
}
