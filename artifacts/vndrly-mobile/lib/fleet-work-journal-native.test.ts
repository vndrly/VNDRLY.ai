import {it,expect,vi} from "vitest";
import {randomUUID,createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {tmpdir} from "node:os";import {join} from "node:path";
vi.mock("react-native",()=>({Platform:{OS:"ios"}}));
vi.mock("expo-crypto",async()=>{const c=await import("node:crypto");return {CryptoDigestAlgorithm:{SHA256:"SHA-256"},digestStringAsync:async(_a:string,v:string)=>c.createHash("sha256").update(v).digest("hex"),getRandomBytesAsync:async(n:number)=>c.randomBytes(n),digest:async(_a:string,v:Uint8Array)=>Uint8Array.from(c.createHash("sha256").update(v).digest()).buffer};});
vi.mock("expo-secure-store",()=>{const rows=new Map<string,string>();return {WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async(k:string)=>rows.get(k)??null,setItemAsync:async(k:string,v:string)=>{rows.set(k,v)}};});
vi.mock("expo-file-system/legacy",()=>({getInfoAsync:async()=>({exists:false})}));
vi.mock("expo-file-system",()=>({File:class{async bytes(){return new Uint8Array([255,216,255,12,13,14]);}}}));
vi.mock("expo-sqlite",async()=>{
 const {DatabaseSync}=await import("node:sqlite"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
 return {defaultDatabaseDirectory:tmpdir(),openDatabaseAsync:async(name:string)=>{
  const db=new DatabaseSync(join(tmpdir(),`fleet-port-test-${name}`));
  const tx={getFirstAsync:async(sql:string,...args:any[])=>sql==="PRAGMA cipher_version"?{cipher_version:"test-port-not-encryption-proof"}:db.prepare(sql).get(...args),getAllAsync:async(sql:string,...args:any[])=>db.prepare(sql).all(...args),runAsync:async(sql:string,...args:any[])=>db.prepare(sql).run(...args)};
  return {...tx,execAsync:async(sql:string)=>{if(!sql.startsWith("PRAGMA key"))db.exec(sql);},closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async(work:any)=>{db.exec("BEGIN IMMEDIATE");try{await work(tx);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}}};
 }};
});
it("persists multiple encrypted-storage photo BLOB identities and original commands through reopen without replacement",async()=>{
 const {openNativeFleetWorkJournal}=await import("./fleet-work-journal-native"),scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};let current=true;
 const j=await openNativeFleetWorkJournal(scope,()=>current),id=randomUUID(),other=randomUUID();
 const saved=await j.stageEvidence(id,"synthetic-camera-uri","image/jpeg");await j.stageEvidence(other,"synthetic-library-uri","image/jpeg");expect(saved.durability).toBe("durable");expect(await j.evidence()).toHaveLength(2);expect(Array.from(await j.readEvidencePart(id,0,3))).toEqual([255,216,255]);
 const reopened=await openNativeFleetWorkJournal(scope,()=>current);expect(await reopened.evidence()).toHaveLength(2);await j.lockScope(scope);await expect(j.stageEvidence(randomUUID(),"synthetic","image/jpeg")).rejects.toThrow("locked");current=false;await expect(reopened.readEvidencePart(id,0,3)).rejects.toThrow("changed");
});
