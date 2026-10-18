import {it,expect,vi} from "vitest";
import {randomUUID,createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {tmpdir} from "node:os";import {join} from "node:path";
const disk=vi.hoisted(()=>({free:512*1024*1024,failEntry:false}));
vi.setConfig({testTimeout:20000});
vi.mock("react-native",()=>({Platform:{OS:"ios"}}));
vi.mock("expo-crypto",async()=>{const c=await import("node:crypto");return {CryptoDigestAlgorithm:{SHA256:"SHA-256"},digestStringAsync:async(_a:string,v:string)=>c.createHash("sha256").update(v).digest("hex"),getRandomBytesAsync:async(n:number)=>c.randomBytes(n),digest:async(_a:string,v:Uint8Array)=>Uint8Array.from(c.createHash("sha256").update(v).digest()).buffer};});
vi.mock("expo-secure-store",()=>{const rows=new Map<string,string>();return {WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async(k:string)=>rows.get(k)??null,setItemAsync:async(k:string,v:string)=>{rows.set(k,v)}};});
vi.mock("expo-file-system/legacy",()=>({getInfoAsync:async()=>({exists:false}),getFreeDiskStorageAsync:async()=>disk.free}));
vi.mock("expo-file-system",()=>({File:class{constructor(private uri:string){}async bytes(){return this.uri==="capacity"?new Uint8Array(1024).fill(77):new Uint8Array([255,216,255,12,13,14]);}}}));
vi.mock("expo-sqlite",async()=>{
 const {DatabaseSync}=await import("node:sqlite"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
 return {defaultDatabaseDirectory:tmpdir(),openDatabaseAsync:async(name:string)=>{
  const db=new DatabaseSync(join(tmpdir(),`fleet-port-test-${name}`));
  const tx={getFirstAsync:async(sql:string,...args:any[])=>sql==="PRAGMA cipher_version"?{cipher_version:"test-port-not-encryption-proof"}:db.prepare(sql).get(...args),getAllAsync:async(sql:string,...args:any[])=>db.prepare(sql).all(...args),runAsync:async(sql:string,...args:any[])=>{if(disk.failEntry&&args[0]==="entry"){disk.failEntry=false;throw Error("Synthetic interrupted original write");}return db.prepare(sql).run(...args);}};
  return {...tx,execAsync:async(sql:string)=>{if(!sql.startsWith("PRAGMA key"))db.exec(sql);},closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async(work:any)=>{db.exec("BEGIN IMMEDIATE");try{await work(tx);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}}};
 }};
});
it("persists multiple encrypted-storage photo BLOB identities and original commands through reopen without replacement",async()=>{
 const {openNativeFleetWorkJournal}=await import("./fleet-work-journal-native"),scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};let current=true;
 const j=await openNativeFleetWorkJournal(scope,()=>current),id=randomUUID(),other=randomUUID();
 const saved=await j.stageEvidence(id,"synthetic-camera-uri","image/jpeg");await j.stageEvidence(other,"synthetic-library-uri","image/jpeg");expect(saved.durability).toBe("durable");expect(await j.evidence()).toHaveLength(2);expect(Array.from(await j.readEvidencePart(id,0,3))).toEqual([255,216,255]);
 const reopened=await openNativeFleetWorkJournal(scope,()=>current);expect(await reopened.evidence()).toHaveLength(2);await j.lockScope(scope);await expect(j.stageEvidence(randomUUID(),"synthetic","image/jpeg")).rejects.toThrow("locked");await expect(reopened.readEvidencePart(id,0,3)).rejects.toThrow("locked");current=false;await expect(reopened.readEvidencePart(id,0,3)).rejects.toThrow("changed");
});
it("commits original evidence intent with its bytes so a crash cannot strand a photo without its original account and activity context",async()=>{
 const {openNativeFleetWorkJournal}=await import("./fleet-work-journal-native"),scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},id=randomUUID(),operationId=randomUUID();
 const j=await openNativeFleetWorkJournal(scope,()=>true);
 await j.stageEvidence(id,"synthetic-camera-uri","image/jpeg",media=>({version:2,scope,operationId,capturedAt:new Date().toISOString(),timeZone:"UTC",dependencies:[],kind:"compliance.document.stage",payload:{recordId:randomUUID(),subject:{kind:"driver",id:2},expectedRecordVersion:0,evidence:{type:"local",kind:"evidence",id},byteSize:media.byteSize,sha256:media.sha256,contentType:"image/jpeg"}}));
 const reopened=await openNativeFleetWorkJournal(scope,()=>true);expect((await reopened.readState()).entries[0].command.operationId).toBe(operationId);expect(await reopened.evidence()).toHaveLength(1);expect(Array.from(await reopened.readEvidencePart(id,0,3))).toEqual([255,216,255]);
});
it("warns at the storage reserve without blocking structured facts, refuses unsaved photo claims and rolls back interrupted photo originals",async()=>{
 const {openNativeFleetWorkJournal}=await import("./fleet-work-journal-native"),scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},j=await openNativeFleetWorkJournal(scope,()=>true);
 disk.free=1024;expect(await j.readStorageHealth()).toMatchObject({state:"low",availableBytes:1024,retainedEvidenceBytes:0,evidenceCount:0});
 const note={version:2 as const,scope,operationId:randomUUID(),kind:"activity.note" as const,capturedAt:"2026-10-17T12:00:00Z",timeZone:"UTC",dependencies:[],payload:{activity:{type:"canonical" as const,kind:"activity" as const,id:randomUUID(),version:1},ticket:{type:"canonical" as const,kind:"ticket" as const,id:123,version:1},notes:"Synthetic low-space fact"}};await j.append(note);expect((await j.readState()).entries).toHaveLength(1);
 disk.free=0;await expect(j.stageEvidence(randomUUID(),"capacity","image/jpeg")).rejects.toThrow("space");expect(await j.evidence()).toHaveLength(0);
 disk.free=512*1024*1024;disk.failEntry=true;const id=randomUUID();await expect(j.stageEvidence(id,"capacity","image/jpeg",media=>({version:2,scope,operationId:randomUUID(),kind:"compliance.document.stage",capturedAt:note.capturedAt,timeZone:"UTC",dependencies:[],payload:{recordId:randomUUID(),subject:{kind:"driver",id:2},expectedRecordVersion:0,evidence:{type:"local",kind:"evidence",id},...media,contentType:"image/jpeg"}}))).rejects.toThrow("interrupted");
 const reopened=await openNativeFleetWorkJournal(scope,()=>true);expect(await reopened.evidence()).toHaveLength(0);expect((await reopened.readState()).entries).toHaveLength(1);expect(await reopened.readStorageHealth()).toMatchObject({state:"ready",retainedEvidenceBytes:0,evidenceCount:0});disk.free=Number.NaN;expect(await reopened.readStorageHealth()).toMatchObject({state:"unknown",availableBytes:null});disk.free=512*1024*1024;
});
it("retains seven days, one hundred activities, five thousand originals and five hundred owned photo byte sets through reopen",async()=>{
 const {openNativeFleetWorkJournal}=await import("./fleet-work-journal-native"),scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},ids=Array.from({length:100},()=>randomUUID()),j=await openNativeFleetWorkJournal(scope,()=>true,{reserveBytes:1024});disk.free=512*1024*1024;
 const originals=[];for(let n=0;n<5000;n++){const command={version:2 as const,scope,operationId:randomUUID(),kind:"activity.note" as const,capturedAt:new Date(Date.UTC(2026,9,10+n%7,12,0,n%60)).toISOString(),timeZone:"America/Chicago",dependencies:[],payload:{activity:{type:"canonical" as const,kind:"activity" as const,id:ids[n%100],version:1},ticket:{type:"canonical" as const,kind:"ticket" as const,id:123,version:1},notes:`Synthetic day ${n%7} original ${n}`}};await j.append(command);originals.push(command);}
 const photos=[];for(let n=0;n<500;n++){const id=randomUUID();photos.push(id);await j.stageEvidence(id,"capacity","image/jpeg");}
 const reopened=await openNativeFleetWorkJournal(scope,()=>true,{reserveBytes:1024}),state=await reopened.readState();expect(state.entries.map(row=>row.command)).toEqual(originals);expect(new Set(state.entries.map(row=>(row.command.payload as any).activity.id)).size).toBe(100);expect(await reopened.readStorageHealth()).toMatchObject({state:"ready",evidenceCount:500,retainedEvidenceBytes:500*1024,reserveBytes:1024});
 for(const id of photos)expect(Array.from(await reopened.readEvidencePart(id,0,1024))).toEqual(Array(1024).fill(77));
 const file=join(tmpdir(),`fleet-port-test-fleet-work-${createHash("sha256").update(`fleet:${JSON.stringify(scope)}`).digest("hex")}.db`),independent=new DatabaseSync(file,{readOnly:true});try{expect(independent.prepare("SELECT count(*) AS count FROM fleet_work_rows WHERE kind='entry'").get()).toEqual({count:5000});expect(independent.prepare("SELECT count(*) AS count,sum(size) AS size,sum(length(body)) AS actual FROM fleet_work_evidence").get()).toEqual({count:500,size:500*1024,actual:500*1024});}finally{independent.close();}
},120000);
