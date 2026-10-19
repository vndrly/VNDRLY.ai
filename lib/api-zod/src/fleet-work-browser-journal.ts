/// <reference lib="dom" />
import {openFleetBrowserStorage} from "./fleet-work-browser-storage";
import {createDurableFleetWorkJournal,appendFleetJournalCommand,type FleetJournalStore} from "./fleet-work-journal";
import {serializeFleetWorkCommand} from "./fleet-work-state";
import type {FleetWorkScope,FleetWorkCommand} from "./fleet-work";
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes.slice().buffer)),b=>b.toString(16).padStart(2,"0")).join("");
const encode=(bytes:Uint8Array)=>{let text="";for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);};
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function createFleetBrowserJournal(scope:FleetWorkScope,storage:FleetJournalStore,isCurrent:()=>boolean){
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent,digest:value=>hash(new TextEncoder().encode(value))});
 return Object.assign(journal,{
  async stageEvidence(id:string,source:unknown,contentType:string,makeCommand?:(media:{sha256:string;byteSize:number;contentType:string})=>FleetWorkCommand){
   if(!(source instanceof Blob)||source.size<1||source.size>10*1024*1024||!["image/jpeg","image/png","image/webp","application/pdf"].includes(contentType))throw Error("Choose an evidence file between 1 byte and 10 MB");
   const bytes=new Uint8Array(await source.arrayBuffer()),sha256=await hash(bytes),media={sha256,byteSize:bytes.length,contentType},command=makeCommand?.(media),fingerprint=command?await hash(new TextEncoder().encode(serializeFleetWorkCommand(command))):null;
   if(!isCurrent())throw Error("Original evidence account changed");
   await storage.transaction(async tx=>{
    if(!isCurrent())throw Error("Original evidence account changed");
    const prior=await tx.get("evidence",id),metadata=JSON.stringify({id,metadata:{...media,storage:"encrypted_indexeddb_parts"}});
    if(prior&&prior!==metadata)throw Error("Original evidence identity cannot be replaced");
    if(await tx.get("meta","locked")==="true")throw Error("Original work scope is locked");
    if(!prior){for(let offset=0;offset<bytes.length;offset+=262144)await tx.set("evidence-bytes",`${id}:${offset/262144}`,encode(bytes.slice(offset,offset+262144)));await tx.set("evidence",id,metadata);}
    if(command&&fingerprint)await appendFleetJournalCommand(tx,scope,command,fingerprint);
    if(!isCurrent())throw Error("Original evidence account changed");
   });
   return {id,...media,durability:"durable" as const};
  },
  async readEvidencePart(id:string,offset:number,length:number){
   if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>1048576)throw Error("Invalid evidence part");
   if(!isCurrent())throw Error("Original evidence account changed");
   return storage.transaction(async tx=>{if(!isCurrent()||await tx.get("meta","locked")==="true")throw Error("Original work scope is locked or changed");const raw=await tx.get("evidence",id);if(!raw)throw Error("Original evidence is unavailable");const size=Number(JSON.parse(raw).metadata.byteSize);if(offset+length>size)throw Error("Original evidence range is unavailable");const result=new Uint8Array(length);for(let at=offset;at<offset+length;){const index=Math.floor(at/262144),value=await tx.get("evidence-bytes",`${id}:${index}`);if(!value)throw Error("Original evidence bytes are unavailable");const part=decode(value),start=at%262144,take=Math.min(part.length-start,offset+length-at);if(take<=0)throw Error("Original evidence bytes are incomplete");result.set(part.subarray(start,start+take),at-offset);at+=take;}if(!isCurrent())throw Error("Original evidence account changed");return result;});
  },
 });
}
export async function openFleetBrowserJournal(scope:FleetWorkScope,isCurrent:()=>boolean){return createFleetBrowserJournal(scope,await openFleetBrowserStorage(`fleet:${JSON.stringify(scope)}`,isCurrent),isCurrent);}
