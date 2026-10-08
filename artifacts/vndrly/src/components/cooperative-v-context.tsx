import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PngPillButton } from "@/components/png-pill-rollover";
import type { AssistantMessage, VConnectionSelection } from "@/hooks/use-assistant";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
type Connection = { id: string; provider: string; scope: "company" | "personal" };
type Recovery = { taskId: string; completed: { id: string }[]; remaining: { id: string; state: string }[]; needed: string };
type Props = { identity: string; revision: number; disabled: boolean; selectConnection?: (value: VConnectionSelection | null) => void; selectSavedTask?: (id: string | null) => void; messages?: AssistantMessage[] };
export function CooperativeVContext({ identity, revision, disabled, selectConnection, selectSavedTask, messages = [] }: Props) {
  const { i18n } = useTranslation(), es = i18n.language.startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [enabled,setEnabled] = useState<boolean|null>(null);
  const [connections,setConnections] = useState<Connection[]>([]), [providers,setProviders] = useState<string[]>([]);
  const [selected,setSelected] = useState(""), [permission,setPermission] = useState(false), [save,setSave] = useState(false), [applied,setApplied] = useState(false);
  const [taskId,setTaskId] = useState(""), [recovery,setRecovery] = useState<Recovery|null>(null), [error,setError] = useState("");
  const [usage,setUsage] = useState<{ tokens:number;estimatedCostUsd:number;alert?:boolean }|null>(null), [loading,setLoading] = useState(false);
  const generation = useRef(0);
  const callbacks = useRef({selectConnection,selectSavedTask}); callbacks.current = {selectConnection,selectSavedTask};
  async function read<T>(path:string,signal?:AbortSignal):Promise<T> {
    const response=await fetch(`${BASE}/api/assistant/${path}`,{credentials:"include",signal});
    if(!response.ok)throw Error(c("Current permission or connection is unavailable. Saved work remains intact.","El permiso o la conexión actual no está disponible. El trabajo guardado se conserva."));
    return response.json();
  }
  useEffect(()=>{
    const current=++generation.current,controller=new AbortController();
    setEnabled(null);setConnections([]);setProviders([]);setSelected("");setPermission(false);setSave(false);setApplied(false);setTaskId("");setRecovery(null);setUsage(null);setError("");setLoading(false);
    callbacks.current.selectConnection?.(null);callbacks.current.selectSavedTask?.(null);
    void Promise.allSettled([read<{enabled?:boolean;approvedProviders:string[];providers:Record<string,{configured:boolean}>}>("cooperation",controller.signal),read<{connections:Connection[]}>("connections",controller.signal),read<NonNullable<typeof usage>>("usage",controller.signal)]).then(results=>{
      if(current!==generation.current||controller.signal.aborted)return;
      if(results[0].status==="fulfilled"){const ready=results[0].value;setEnabled(ready.enabled??null);setProviders(ready.approvedProviders.filter(provider=>ready.providers[provider]?.configured));}
      if(results[1].status==="fulfilled")setConnections(results[1].value.connections);
      if(results[2].status==="fulfilled")setUsage(results[2].value);
    });
    return()=>{++generation.current;controller.abort();callbacks.current.selectConnection?.(null);callbacks.current.selectSavedTask?.(null);};
  },[identity,revision]);
  const connection=connections.find(row=>row.id===selected);
  const latest=messages.filter(message=>message.recovery||message.usageAlert).at(-1);
  async function recover(){
    const current=generation.current;setError("");setLoading(true);setRecovery(null);callbacks.current.selectSavedTask?.(null);
    try{const result=await read<Recovery>(`tasks/${encodeURIComponent(taskId)}/recovery`);if(current!==generation.current)return;
      if(result.taskId!==taskId||!Array.isArray(result.completed)||!Array.isArray(result.remaining))throw Error(c("Saved task could not be verified.","No se pudo verificar la tarea guardada."));
      setRecovery(result);callbacks.current.selectSavedTask?.(result.taskId);
    }catch(e){if(current===generation.current)setError(e instanceof Error?e.message:c("Task unavailable","Tarea no disponible"));}
    finally{if(current===generation.current)setLoading(false);}
  }
  return <details className="mb-2 rounded-lg border border-white/30 p-2 text-sm text-white">
    <summary>{c("V connections and saved work","Conexiones de V y trabajo guardado")}</summary>
    <div className="grid gap-2 pt-2">
      <p>{c("Available V engines","Motores de V disponibles")}: {providers.join(", ")||c("Unverified","Sin verificar")}. {c("V chooses the engine automatically. Private ChatGPT chats and apps are not inherited.","V elige el motor automáticamente. No se heredan chats privados ni aplicaciones de ChatGPT.")}</p>
      {enabled===false&&<p role="status">{c("Company cooperation is off. V uses only the remaining approved engine; external connections are unavailable.","La cooperación de la empresa está desactivada. V usa solo el motor aún aprobado; las conexiones externas no están disponibles.")}</p>}
      <label>{c("Connection","Conexión")}<select aria-label={c("Connection","Conexión")} className="ml-2 rounded border bg-white p-1 text-gray-900" disabled={disabled} value={selected} onChange={e=>{setSelected(e.target.value);setPermission(false);setSave(false);setApplied(false);selectConnection?.(null);}}><option value="">{c("None selected","Ninguna seleccionada")}</option>{connections.map(row=><option key={row.id} value={row.id}>{row.provider} · {row.scope==="personal"?c("Personal","Personal"):c("Company","Empresa")}</option>)}</select></label>
      {connection?.scope==="personal"&&<><label><input type="checkbox" disabled={disabled} checked={permission} onChange={e=>{setPermission(e.target.checked);if(!e.target.checked)setSave(false);setApplied(false);selectConnection?.(null);}}/> {c("Allow this personal connection for this task","Permitir esta conexión personal para esta tarea")}</label><label><input type="checkbox" disabled={disabled||!permission} checked={save&&permission} onChange={e=>{setSave(e.target.checked);setApplied(false);selectConnection?.(null);}}/> {c("Allow selected personal content to be saved in company records","Permitir guardar contenido personal seleccionado en registros de la empresa")}</label><p>{c("Without company-save permission, imported content stays out of saved company answers and writes are withheld for this turn.","Sin permiso para guardar en la empresa, el contenido importado queda fuera de respuestas guardadas y se retienen los cambios en este turno.")}</p></>}
      <PngPillButton disabled={disabled||!connection||(connection.scope==="personal"&&!permission)} onClick={()=>{if(connection){selectConnection?.({connectionId:connection.id,scope:connection.scope,personalPermission:connection.scope==="personal",savePersonalContentToCompany:connection.scope==="personal"&&permission&&save});setApplied(true);}}}>{applied?c("Connection selected for this task","Conexión seleccionada para esta tarea"):c("Use selected connection","Usar conexión seleccionada")}</PngPillButton>
      <label>{c("Saved task ID","ID de tarea guardada")}<input aria-label={c("Saved task ID","ID de tarea guardada")} className="ml-2 rounded border bg-white p-1 text-gray-900" disabled={disabled||loading} value={taskId} onChange={e=>{setTaskId(e.target.value.trim());setRecovery(null);selectSavedTask?.(null);}}/></label>
      <PngPillButton disabled={disabled||loading||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId))} onClick={()=>void recover()}>{c("Read saved task","Leer tarea guardada")}</PngPillButton>
      {recovery&&<><p>{c("Completed","Completado")}: {recovery.completed.map(step=>step.id).join(", ")||"—"}</p><p>{c("Remaining","Pendiente")}: {recovery.remaining.map(step=>`${step.id} · ${step.state}`).join(", ")||"—"}</p><p>{recovery.needed}</p><p>{c("Reading this ledger does not execute work. Next messages use this saved task context.","Leer este registro no ejecuta trabajo. Los siguientes mensajes usan esta tarea guardada.")}</p></>}
      {latest?.recovery&&<><p>{c("Completed","Completado")}: {latest.recovery.completed.join(", ")||"—"}</p><p>{c("Remaining","Pendiente")}: {latest.recovery.remaining.join(", ")||"—"}</p><p>{latest.recovery.needed}</p></>}
      {usage&&<p>{c("Company usage this month","Uso de la empresa este mes")}: {Number(usage.tokens ?? 0).toLocaleString()} {c("tokens","tokens")} · ${Number(usage.estimatedCostUsd ?? 0).toFixed(2)} {c("estimated; alerts do not stop work","estimado; las alertas no detienen el trabajo")}</p>}
      {latest?.usageAlert&&<p role="status">{latest.usageAlert}</p>}{error&&<p role="alert">{error}</p>}
    </div>
  </details>;
}
