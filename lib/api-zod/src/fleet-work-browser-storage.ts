/// <reference lib="dom" />
import type {FleetJournalTransaction,FleetJournalStore} from "./fleet-work-journal";
const bytes=(value:string)=>new TextEncoder().encode(value);
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,"0")).join("");
function request<T>(value:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error??Error("Fleet browser storage failed"));});}
function completion(value:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{value.oncomplete=()=>resolve();value.onabort=()=>reject(value.error??Error("Fleet browser transaction aborted"));value.onerror=()=>{};});}
/** Secure-context provisioned browser storage. No memory/localStorage fallback
 * may advertise durable work. Every command/evidence metadata value is encrypted. */
export async function openFleetBrowserStorage(identity:string,isCurrent:()=>boolean){
 if(!globalThis.isSecureContext||!globalThis.indexedDB||!globalThis.crypto?.subtle)throw Error("Durable Fleet work requires a secure browser with IndexedDB and Web Crypto");
 const locks=globalThis.navigator?.locks;
 if(!locks?.request)throw Error("Durable Fleet work requires browser support for cross-tab storage locks");
 if(!isCurrent())throw Error("Original work account changed");
 const id=hex(await crypto.subtle.digest("SHA-256",bytes(identity)));
 const opening=indexedDB.open(`vndrly-fleet-work-${id}`,1);
 opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore("keys");db.createObjectStore("rows");};
 const db=await request(opening);db.onversionchange=()=>db.close();
 // Generate outside an IndexedDB transaction, then choose/retain exactly one
 // nonextractable key inside the serialized transaction. Never replace a key.
 const candidate=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 const cryptoKey=await new Promise<CryptoKey>((resolve,reject)=>{const tx=db.transaction("keys","readwrite",{durability:"strict"}),store=tx.objectStore("keys"),read=store.get("key");let selected:CryptoKey;read.onsuccess=()=>{selected=read.result??candidate;if(!read.result)store.add(candidate,"key");};tx.oncomplete=()=>resolve(selected);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error("Fleet browser key storage failed"));});
 let serial:Promise<unknown>=Promise.resolve();
 const transact=async<T>(work:(tx:FleetJournalTransaction)=>Promise<T>)=>{
  if(!isCurrent())throw Error("Original work account changed");
  // Safari may auto-commit an IndexedDB transaction whenever control crosses an
  // async Web Crypto boundary. Read a stable snapshot first, do crypto outside
  // IndexedDB, then enqueue every write synchronously in one atomic commit.
  const readTx=db.transaction("rows","readonly"),readStore=readTx.objectStore("rows"),keysRequest=readStore.getAllKeys(),rowsRequest=readStore.getAll(),readDone=completion(readTx);
  const [keys,encrypted]=await Promise.all([request(keysRequest),request(rowsRequest),readDone]).then(([storedKeys,storedRows])=>[storedKeys,storedRows] as const);
  const decrypted=await Promise.all((encrypted as Array<{iv:Uint8Array;body:ArrayBuffer}>).map(async value=>new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(value.iv)},cryptoKey,value.body))));
  const rows=new Map(keys.map((key,index)=>[String(key),decrypted[index]])),dirty=new Map<string,string>();
  const result=await work({get:async(kind,key)=>rows.get(`${kind}:${key}`)??null,set:async(kind,key,value)=>{const id=`${kind}:${key}`;rows.set(id,value);dirty.set(id,value);},values:async kind=>[...rows].filter(([key])=>key.startsWith(`${kind}:`)).map(([,value])=>value)});
  if(!isCurrent())throw Error("Original work account changed");
  if(dirty.size){
   const prepared=await Promise.all([...dirty].map(async([key,value])=>{const iv=crypto.getRandomValues(new Uint8Array(12)),body=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,bytes(value));return {key,value:{iv,body}};}));
   if(!isCurrent())throw Error("Original work account changed");
   const writeTx=db.transaction("rows","readwrite",{durability:"strict"}),writeStore=writeTx.objectStore("rows"),writeDone=completion(writeTx);
   for(const row of prepared)writeStore.put(row.value,row.key);
   await writeDone;
  }
  return result;
 };
 // Snapshot, crypto and commit must share one origin-wide lock. The per-instance
 // queue alone cannot prevent another tab from overwriting the same sequence or
 // racing scope revocation while encryption runs outside IndexedDB.
 const storage:FleetJournalStore={async transaction<T>(work:(tx:FleetJournalTransaction)=>Promise<T>):Promise<T>{const pending=serial.then(()=>locks.request(`vndrly-fleet-storage:${id}`,()=>transact(work)));serial=pending.then(()=>undefined,()=>undefined);return await pending;}};
 return storage;
}
