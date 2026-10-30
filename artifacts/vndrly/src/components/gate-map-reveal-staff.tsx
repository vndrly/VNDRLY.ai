import { useEffect, useRef } from "react";
import { Crosshair, Users, X } from "lucide-react";
import { CardHeading } from "./ui/card-heading";

export type RevealStaffPerson={userId:number;name:string;role?:string;roles?:string[];membershipRole?:string|null;vendorManaged?:boolean;groups?:{id:string;name:string}[];fresh:boolean;demonstration?:boolean;location:{latitude:number;longitude:number;capturedAt:string}|null};
export const hasMapLocation=(person:Pick<RevealStaffPerson,"fresh"|"location"|"demonstration">)=>Boolean((person.fresh||person.demonstration)&&person.location);
export function GateMapRevealStaff({people,es,onReveal,onClose}:{people:RevealStaffPerson[];es:boolean;onReveal:(people:RevealStaffPerson[])=>void;onClose:()=>void}) {
  const ref=useRef<HTMLElement>(null),c=(en:string,spanish:string)=>es?spanish:en;
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!ref.current?.contains(event.target)&&!event.target.closest('[data-map-reveal-toggle]'))onClose();};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.stopPropagation();onClose();}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  },[onClose]);
  const available=(rows:RevealStaffPerson[])=>rows.filter(hasMapLocation);
  const admin=(person:RevealStaffPerson)=>person.membershipRole==="admin"||person.roles?.includes("Administrative Team");
  const categories=[
    {key:"all",title:c("All","Todos"),rows:people},
    {key:"admin",title:c("Administrative Team","Equipo administrativo"),rows:people.filter(person=>admin(person)&&!person.vendorManaged)},
    {key:"office",title:c("Office Staff","Personal de oficina"),rows:people.filter(person=>!admin(person)&&!person.vendorManaged&&["office","both"].includes(person.role??""))},
    {key:"gate",title:c("Gatekeepers","Guardias"),rows:people.filter(person=>!person.vendorManaged&&["gatekeeper","gate_supervisor"].includes(person.role??""))},
  ];
  const groups=[...new Map(people.flatMap(person=>person.groups??[]).map(group=>[group.id,group])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const personList=(rows:RevealStaffPerson[])=> <ul>{rows.map(person=><li key={person.userId}><button type="button" disabled={!hasMapLocation(person)} onClick={()=>onReveal([person])}>{person.name}{(!hasMapLocation(person))&&<small>{c("Location unavailable","Ubicación no disponible")}</small>}</button></li>)}{!rows.length&&<li className="gate-map-reveal-empty">{c("No staff in this category","Sin personal en esta categoría")}</li>}</ul>;
  const category=(key:string,title:string,rows:RevealStaffPerson[])=><details key={key} className="gate-map-reveal-group"><summary><span>{title} ({rows.length})</span><button type="button" aria-label={c(`Reveal ${title}`,`Mostrar ${title}`)} title={c("Show shared locations","Mostrar ubicaciones compartidas")} disabled={!available(rows).length} onClick={event=>{event.preventDefault();event.stopPropagation();onReveal(available(rows));}}><Crosshair aria-hidden="true"/></button></summary>{personList(rows)}</details>;
  return <section ref={ref} className="gate-map-reveal-card" aria-label={c("Reveal Staff","Mostrar personal")}>
    <CardHeading as="h3"><Users aria-hidden="true"/>{c("Reveal Staff","Mostrar personal")}</CardHeading><button className="gate-map-reveal-close" type="button" aria-label={c("Close Reveal Staff","Cerrar Mostrar personal")} onClick={onClose}><X aria-hidden="true"/></button>
    {categories.map(item=>category(item.key,item.title,item.rows))}
    <details className="gate-map-reveal-group"><summary>{c("Groups","Grupos")} ({groups.length})</summary>{groups.map(group=>category(group.id,group.name,people.filter(person=>person.groups?.some(row=>row.id===group.id))))}{!groups.length&&<p className="gate-map-reveal-empty">{c("No groups available","No hay grupos disponibles")}</p>}</details>
    {category("individuals",c("Individuals","Personas"),people)}
    {category("managed",c("Vendor Managed","Administrados por proveedor"),people.filter(person=>person.vendorManaged))}
  </section>;
}
