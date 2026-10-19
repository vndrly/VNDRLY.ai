/// <reference lib="dom" />
import type {FleetJournalTransaction,FleetJournalStore} from "./fleet-work-journal";
const bytes=(value:string)=>new TextEncoder().encode(value);
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,"0")).join("");
function request<T>(value:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error??Error("Fleet browser storage failed"));});}
/** Secure-context provisioned browser storage. No memory/localStorage fallback
 * may advertise durable work. Every command/evidence metadata value is encrypted. */
export async function openFleetBrowserStorage(identity:string,isCurrent:()=>boolean){
 if(!globalThis.isSecureContext||!globalThis.indexedDB||!globalThis.crypto?.subtle)throw Error("Durable Fleet work requires a secure browser with IndexedDB and Web Crypto");
 if(!isCurrent())throw Error("Original work account changed");
 const id=hex(await crypto.subtle.digest("SHA-256",bytes(identity)));
 const opening=indexedDB.open(`vndrly-fleet-work-${id}`,1);
 opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore("keys");db.createObjectStore("rows");};
 const db=await request(opening);db.onversionchange=()=>db.close();
 // Generate outside an IndexedDB transaction, then choose/retain exactly one
 // nonextractable key inside the serialized transaction. Never replace a key.
 const candidate=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 const cryptoKey=await new Promise<CryptoKey>((resolve,reject)=>{const tx=db.transaction("keys","readwrite",{durability:"strict"}),store=tx.objectStore("keys"),read=store.get("key");let selected:CryptoKey;read.onsuccess=()=>{selected=read.result??candidate;if(!read.result)store.add(candidate,"key");};tx.oncomplete=()=>resolve(selected);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error("Fleet browser key storage failed"));});
 const storage:FleetJournalStore={transaction<T>(work:(tx:FleetJournalTransaction)=>Promise<T>){return new Promise<T>((resolve,reject)=>{
  if(!isCurrent()){reject(Error("Original work account changed"));return;}
  const tx=db.transaction("rows","readwrite",{durability:"strict"}),store=tx.objectStore("rows");let alive=true,result:T,failure:unknown;
  // Crypto awaits do not keep IndexedDB alive. A same-transaction request pump
  // prevents partial/autocommitted saves while encryption/decryption completes.
  const pump=()=>{if(!alive)return;const pending=store.get("__keepalive");pending.onsuccess=()=>pump();};pump();
  tx.oncomplete=()=>{if(failure)reject(failure);else resolve(result);};tx.onabort=()=>reject(failure??tx.error??Error("Fleet browser transaction aborted"));tx.onerror=()=>{};
  const decrypt=async(value:{iv:Uint8Array;body:ArrayBuffer}|undefined)=>value?new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(value.iv)},cryptoKey,value.body)):null;
  void work({get:async(kind,key)=>decrypt(await request(store.get(`${kind}:${key}`))),set:async(kind,key,value)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),body=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,bytes(value));await request(store.put({iv,body},`${kind}:${key}`));},values:async kind=>{
   const values=await request(store.getAll(IDBKeyRange.bound(`${kind}:`,`${kind}:\uffff`)));return Promise.all(values.map(async value=>(await decrypt(value))!));
  }}).then(value=>{if(!isCurrent())throw Error("Original work account changed");result=value;alive=false;}).catch(error=>{failure=error;alive=false;tx.abort();});
 });}};
 return storage;
}
