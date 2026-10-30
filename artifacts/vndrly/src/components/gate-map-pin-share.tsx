import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { changeOverRequest } from "@/lib/change-over-api";
import { PngPillButton } from "./png-pill-rollover";

type Options = { people: {userId:number;name:string}[]; groups:{id:string;name:string;userIds:number[]}[] };
export function GateMapPinShare({pinId, es}:{pinId:string;es:boolean}) {
  const t=(en:string,spanish:string)=>es?spanish:en;
  const [open,setOpen]=useState(false),[audience,setAudience]=useState("");
  const [groupId,setGroupId]=useState(""),[userIds,setUserIds]=useState<number[]>([]);
  const [operationId,setOperationId]=useState(()=>crypto.randomUUID());
  const [sending,setSending]=useState(false),[error,setError]=useState(""),[sent,setSent]=useState<number|null>(null);
  const options=useQuery({queryKey:["gate-map-pin-share",pinId],queryFn:()=>changeOverRequest<Options>(`/map-pins/${pinId}/share-options`),enabled:open,retry:false});
  function changed(){setOperationId(crypto.randomUUID());setSent(null);setError("");}
  async function share(){
    if(sending||sent!==null)return;setSending(true);setError("");
    try{const result=await changeOverRequest<{notifiedCount:number}>(`/map-pins/${pinId}/share`,{operationId,audience,...(audience==="group"?{groupId}:{}),userIds:audience==="individuals"?userIds:[]});setSent(result.notifiedCount);}
    catch(err){setError(err instanceof Error?err.message:t("Could not share pin","No se pudo compartir el pin"));}
    finally{setSending(false);}
  }
  return <details className="gate-map-pin-share" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><Share2 aria-hidden="true" />{t("Share Pin","Compartir pin")}</summary>
    {open&&<div className="gate-map-pin-share-body">
      <div className="gate-map-share-audiences" role="group" aria-label={t("Share with","Compartir con")}>
        {[["all",t("All","Todos")],["group",t("Group","Grupo")],["individuals",t("Individuals","Personas")]].map(([value,label])=><div key={value}>
          <button type="button" disabled={sending} aria-expanded={audience===value} onClick={()=>{setAudience(audience===value?"":value);changed();}}>{label}</button>
          {audience===value&&<div className="gate-map-pin-share-body">
      {options.isPending?<p role="status">{t("Loading recipients…","Cargando destinatarios…")}</p>:options.isError?<><p role="alert">{t("Recipients could not be loaded.","No se pudieron cargar los destinatarios.")}</p><button type="button" onClick={()=>void options.refetch()}>{t("Retry","Reintentar")}</button></>:<>
        {audience==="all"&&<><p>{options.data.people.length} {t("company members","miembros de la empresa")}</p><ul className="gate-map-pin-recipients">{[...options.data.people].sort((a,b)=>a.name.localeCompare(b.name)).map(person=><li key={person.userId}>{person.name}</li>)}</ul></>}
        {audience==="group"&&<div className="gate-map-pin-recipients">{options.data.groups.map(group=><label key={group.id}><input type="radio" name={`pin-share-group-${pinId}`} checked={groupId===group.id} disabled={sending} onChange={()=>{setGroupId(group.id);changed();}} />{group.name}</label>)}</div>}
        {audience==="group"&&!options.data.groups.length&&<p>{t("No available groups","No hay grupos disponibles")}</p>}
        {audience==="individuals"&&<div className="gate-map-pin-recipients">{[...options.data.people].sort((a,b)=>a.name.localeCompare(b.name)).map(person=><label key={person.userId}><input type="checkbox" checked={userIds.includes(person.userId)} disabled={sending} onChange={event=>{setUserIds(ids=>event.target.checked?[...ids,person.userId]:ids.filter(id=>id!==person.userId));changed();}} />{person.name}</label>)}</div>}
        {audience&&<PngPillButton color="brand" type="button" onClick={()=>void share()} disabled={sending||sent!==null||!options.data.people.length||(audience==="group"&&!groupId)||(audience==="individuals"&&!userIds.length)}>{sending?t("Sharing…","Compartiendo…"):t("Share","Compartir")}</PngPillButton>}
      </>}
          </div>}
        </div>)}
      </div>
      {error&&<p role="alert">{error}</p>}{sent!==null&&<p role="status">{t(`Notified ${sent} people.`,`Se notificó a ${sent} personas.`)}</p>}
    </div>}
  </details>;
}
