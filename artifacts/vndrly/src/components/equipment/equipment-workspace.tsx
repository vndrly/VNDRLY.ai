import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package, Plus, RefreshCw } from "lucide-react";
import { EquipmentListResponseSchema, type EquipmentItem } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { CardHeading } from "@/components/ui/card-heading";
import { EquipmentForm, type EquipmentAction } from "./equipment-form";
import { equipmentPhoto, equipmentRequest } from "./client";
import { equipmentTypes, equipmentActivities, equipmentSource } from "./labels";
import "./equipment.css";
export function EquipmentWorkspace(){
 const {user}=useAuth(),{i18n}=useTranslation(),es=i18n.language.startsWith("es"),t=(a:string,b:string)=>es?b:a,qc=useQueryClient();
 const identity=JSON.stringify([user?.userId,user?.vendorId,user?.partnerId,user?.activeMembershipId]);
 const [form,setForm]=useState<{item?:EquipmentItem;action:EquipmentAction}|null>(null),[search,setSearch]=useState("");
 const query=useQuery({queryKey:["equipment",identity],queryFn:async({signal})=>EquipmentListResponseSchema.parse(await equipmentRequest("",{signal})),enabled:!!user,retry:false});
 useEffect(()=>{setForm(null);setSearch("");},[identity]);
 const selectedId=new URLSearchParams(window.location.search).get("equipmentId"),items=query.data?.equipment??[];
 const saved=async()=>{await qc.invalidateQueries({queryKey:["equipment"]});await qc.invalidateQueries({queryKey:["implementation-a","assets"]});};
 return <section className="equipment-workspace" aria-label={t("Equipment","Equipo")}>
 <header className="equipment-heading"><CardHeading as="h2"><Package aria-hidden="true"/>{t("Equipment","Equipo")}</CardHeading><div className="equipment-actions"><button type="button" className="equipment-mini" onClick={()=>setForm({action:"add"})}><Plus size={14}/>{t("Add Equipment","Agregar equipo")}</button><button type="button" className="equipment-mini" aria-label={t("Refresh equipment","Actualizar equipos")} onClick={()=>void query.refetch()}><RefreshCw size={14}/></button></div></header>
 <label className="equipment-form">{t("Find equipment","Buscar equipo")}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("Name, type or identifier","Nombre, tipo o identificador")}/></label>
 {query.isPending&&<p role="status">{t("Loading equipment…","Cargando equipos…")}</p>}{query.isError&&<p role="alert">{query.error.message}</p>}
 {query.isSuccess&&!items.length&&<p>{t("No equipment recorded yet.","Todavía no hay equipos registrados.")}</p>}
 {items.filter(item=>[item.name,item.category,...item.aliases.map(a=>a.value)].join(" ").toLowerCase().includes(search.toLowerCase())).map(item=><details className="equipment-record" key={item.id} open={item.id===selectedId||undefined}>
 <summary><span><strong>{item.name}</strong><small>{equipmentTypes[item.profile.equipmentType][es?1:0]} · {equipmentActivities[item.profile.activity][es?1:0]}</small></span><span>{item.profile.trackOnMap?t("Tracked","En mapa"):t("Not mapped","Sin mapa")} ›</span></summary>
 <div className="equipment-record-body">
 <div className="equipment-photos">{item.profile.photoUrls.map(url=><img key={url} src={equipmentPhoto(url)} alt={item.name}/>)}</div>
 {item.aliases.length>0&&<p>{item.aliases.map(a=>`${a.jurisdiction?a.jurisdiction+".":""}${a.value}`).join(" · ")}</p>}
 <p>{t("Custody","Custodia")}: {item.currentHolderDisplayName??t("Checked in","Devuelto")} · {item.status}</p>
 {item.profile.assignedUserId&&<p>{t("Assigned to","Asignado a")}: #{item.profile.assignedUserId}</p>}
 {item.profile.ticketId&&<a href={`/tickets/${item.profile.ticketId}`}>Ticket #{item.profile.ticketId}</a>}{item.profile.taskId&&<a href={`/work-hub/tasks?taskId=${item.profile.taskId}`}>{t("Open task","Abrir tarea")}</a>}
 {item.profile.parentAssetId&&<p>{t("Connected to","Conectado a")}: {items.find(row=>row.id===item.profile.parentAssetId)?.name??item.profile.parentAssetId}</p>}
 <p>{item.location?<>{item.location.freshness==="last_known"?t("Last known","Última conocida"):t("Current report","Informe actual")}: {item.location.label??`${item.location.latitude.toFixed(5)}, ${item.location.longitude.toFixed(5)}`} · {equipmentSource(item.location.source,es)} · {new Date(item.location.observedAt).toLocaleString()}</>:t("Location unavailable","Ubicación no disponible")}</p>
 {item.holds.map(hold=><p key={hold.id} role="status">{t("Hold","Retención")}: {hold.reason}</p>)}
 <a href={`/gate/map?equipmentId=${item.id}`}>{t("View on map","Ver en mapa")}</a>
 <div className="equipment-actions">{item.capabilities.canManage&&<><button className="equipment-mini" onClick={()=>setForm({item,action:"edit"})}>{t("Edit / Track","Editar / Mapa")}</button><button className="equipment-mini" onClick={()=>setForm({item,action:"assign"})}>{t("(Re)Assign","(Re)Asignar")}</button></>}{item.capabilities.canCheckout&&<button className="equipment-mini" onClick={()=>setForm({item,action:"checkout"})}>{t("Check Out","Retirar")}</button>}{item.capabilities.canReturn&&<button className="equipment-mini" onClick={()=>setForm({item,action:"return"})}>{t("Check In","Devolver")}</button>}{item.capabilities.canOperate&&<><button className="equipment-mini" onClick={()=>setForm({item,action:item.profile.parentAssetId?"disconnect":"connect"})}>{item.profile.parentAssetId?t("Disconnect / Drop","Desconectar / Dejar"):t("Connect","Conectar")}</button><button className="equipment-mini" onClick={()=>setForm({item,action:"location"})}>{t("Location / Activity","Ubicación / Actividad")}</button></>}</div>
 <details><summary>{t("Equipment history","Historial del equipo")} ({item.profile.history.length})</summary><ol className="equipment-history">{[...item.profile.history].reverse().map(event=><li key={event.operationId}><strong>{event.action}</strong> · {new Date(event.occurredAt).toLocaleString()}{event.ticketId&&<> · Ticket #{event.ticketId}</>}{event.taskId&&<> · {t("Task","Tarea")}</>}{event.note&&<p>{event.note}</p>}{event.location&&<small>{event.location.latitude.toFixed(5)}, {event.location.longitude.toFixed(5)}</small>}</li>)}</ol></details>
 </div></details>)}
 {form&&<EquipmentForm key={`${identity}:${form.item?.id??"new"}:${form.action}`} {...form} items={items} identity={identity} onClose={()=>setForm(null)} onSaved={saved}/>}
 </section>;
}
