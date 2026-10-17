import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { z } from "zod/v4";
import { Platform } from "react-native";
import { createDurableFleetWorkJournal,appendFleetJournalCommand,serializeFleetWorkCommand,type FleetWorkCommand, openFleetBrowserStorage, type FleetWorkScope, type FleetJournalStore } from "@workspace/api-zod";
import type { SQLiteDatabase } from "expo-sqlite";
const opened=new Map<string,Promise<SQLiteDatabase>>();
const sha=(value:string)=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value);
/** Each original account/device/provisioning scope has a separate encrypted DB.
 * A lost/corrupt key never regenerates over retained originals. */
export async function openNativeFleetWorkStorage(identity:string,isCurrent:()=>boolean){
 if(Platform.OS==="web")return {storage:await openFleetBrowserStorage(identity,isCurrent),db:null};
 if(!isCurrent())throw Error("Original work account changed");
 const id=await sha(identity),name=`fleet-work-${id}.db`,keyName=`fleet.work.key.${id}`;
 let ready=opened.get(id);
 if(!ready){ready=(async()=>{
  const SQLite=await import("expo-sqlite");
  let key=await SecureStore.getItemAsync(keyName);
  if(key&&!/^[a-f0-9]{64}$/.test(key))throw Error("Retained Fleet key is invalid; recovery required");
  if(!key){const directory=SQLite.defaultDatabaseDirectory;const file=await FileSystem.getInfoAsync(`${directory}/${name}`);if(file.exists)throw Error("Retained Fleet key is unavailable; recovery required");key=Array.from(await Crypto.getRandomBytesAsync(32),b=>b.toString(16).padStart(2,"0")).join("");await SecureStore.setItemAsync(keyName,key,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});}
  const db=await SQLite.openDatabaseAsync(name);
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher=await db.getFirstAsync<Record<string,string>>("PRAGMA cipher_version");if(!cipher||!Object.values(cipher).some(Boolean)){await db.closeAsync();throw Error("Encrypted Fleet storage is unavailable");}
  await db.execAsync("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS fleet_work_rows(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS fleet_work_evidence(id TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,content_type TEXT NOT NULL,body BLOB NOT NULL);");
  return db;
 })();opened.set(id,ready);ready.catch(()=>opened.delete(id));}
 const db=await ready;
 const storage:FleetJournalStore={async transaction(work){let result:Awaited<ReturnType<typeof work>>;await db.withExclusiveTransactionAsync(async tx=>{
  if(!isCurrent())throw Error("Original work account changed");
  result=await work({get:async(kind,key)=>(await tx.getFirstAsync<{value:string}>("SELECT value FROM fleet_work_rows WHERE kind=? AND id=?",kind,key))?.value??null,set:async(kind,key,value)=>{await tx.runAsync("INSERT INTO fleet_work_rows(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",kind,key,value);},values:async kind=>(await tx.getAllAsync<{value:string}>("SELECT value FROM fleet_work_rows WHERE kind=? ORDER BY rowid",kind)).map(row=>row.value)});
  if(!isCurrent())throw Error("Original work account changed");
 });return result!;}};
 return {storage,db};
}
export async function openNativeFleetWorkJournal(scope:FleetWorkScope,isCurrent:()=>boolean){
 const {storage,db}=await openNativeFleetWorkStorage(`fleet:${JSON.stringify(scope)}`,isCurrent);
 if(!db)throw Error("Use browser-owned evidence storage for this browser preview");
 const journal=createDurableFleetWorkJournal({scope,storage,digest:sha,isCurrent});
 return Object.assign(journal,{
  async stageEvidence(id:string,uri:unknown,contentType:string,makeCommand?:(media:{sha256:string;byteSize:number;contentType:string})=>FleetWorkCommand){
   if(typeof uri!=="string")throw Error("A captured device file is required");
   z.uuid().parse(id);if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(contentType))throw Error("Unsupported evidence type");
   if(!isCurrent())throw Error("Original work account changed");
   const bytes=await new File(uri).bytes();if(!bytes.length||bytes.length>10*1024*1024)throw Error("Evidence must be between 1 byte and 10 MB");
   const hash=Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes)),b=>b.toString(16).padStart(2,"0")).join("");
   const command=makeCommand?.({sha256:hash,byteSize:bytes.length,contentType}),fingerprint=command?await sha(serializeFleetWorkCommand(command)):null;
   await db.withExclusiveTransactionAsync(async tx=>{
    if(!isCurrent()||(await tx.getFirstAsync<{value:string}>("SELECT value FROM fleet_work_rows WHERE kind='meta' AND id='locked'"))?.value==="true")throw Error("Original work scope is locked or changed");
    const prior=await tx.getFirstAsync<{sha256:string;size:number}>("SELECT sha256,size FROM fleet_work_evidence WHERE id=?",id);
    if(prior&&(prior.sha256!==hash||prior.size!==bytes.length))throw Error("Original evidence identity cannot be replaced");
    if(!prior)await tx.runAsync("INSERT INTO fleet_work_evidence(id,sha256,size,content_type,body) VALUES(?,?,?,?,?)",id,hash,bytes.length,contentType,bytes);
    await tx.runAsync("INSERT INTO fleet_work_rows(kind,id,value) VALUES('evidence',?,?) ON CONFLICT(kind,id) DO NOTHING",id,JSON.stringify({id,metadata:{storage:"encrypted_sqlcipher_blob",sha256:hash,byteSize:bytes.length,contentType}}));
    if(command&&fingerprint)await appendFleetJournalCommand({get:async(kind,key)=>(await tx.getFirstAsync<{value:string}>("SELECT value FROM fleet_work_rows WHERE kind=? AND id=?",kind,key))?.value??null,set:async(kind,key,value)=>{await tx.runAsync("INSERT INTO fleet_work_rows(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",kind,key,value);},values:async kind=>(await tx.getAllAsync<{value:string}>("SELECT value FROM fleet_work_rows WHERE kind=? ORDER BY rowid",kind)).map(row=>row.value)},scope,command,fingerprint);
    if(!isCurrent())throw Error("Original work account changed");
   });
   return {id,sha256:hash,byteSize:bytes.length,contentType,durability:"durable" as const};
  },
  async readEvidencePart(id:string,offset:number,length:number){
   z.uuid().parse(id);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>1024*1024)throw Error("Invalid evidence part");
   if(!isCurrent())throw Error("Original work account changed");
   if((await db.getFirstAsync<{value:string}>("SELECT value FROM fleet_work_rows WHERE kind='meta' AND id='locked'"))?.value==="true")throw Error("Original work scope is locked");
   const row=await db.getFirstAsync<{body:Uint8Array}>("SELECT substr(body,?,?) AS body FROM fleet_work_evidence WHERE id=?",offset+1,length,id);
   if(!row)throw Error("Retained evidence is unavailable");if(!isCurrent())throw Error("Original work account changed");return row.body;
  },
 });
}
