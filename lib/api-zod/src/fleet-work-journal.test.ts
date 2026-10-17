import { describe,it,expect } from "vitest";
import { createDurableFleetWorkJournal, type FleetJournalStore, type FleetJournalTransaction } from "./fleet-work-journal";
import { createHash,randomUUID } from "node:crypto";
import { FleetWorkCommandSchema } from "./fleet-work";
function fixture(){
 const rows=new Map<string,string>();let fail=false;
 // Buffer only transaction writes, like the itemized adapters. Cloning every
 // retained row on each append made this fixture quadratic at 5000 events.
 const storage:FleetJournalStore={async transaction(work){const writes=new Map<string,string>();const tx:FleetJournalTransaction={get:async(kind,key)=>writes.get(`${kind}:${key}`)??rows.get(`${kind}:${key}`)??null,set:async(kind,key,value)=>{writes.set(`${kind}:${key}`,value)},values:async kind=>[...new Map([...rows,...writes])].filter(([key])=>key.startsWith(`${kind}:`)).map(([,value])=>value)};const result=await work(tx);if(fail){fail=false;throw Error("Disk full");}for(const [key,value] of writes)rows.set(key,value);return result;}};
 const scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};
 const options={storage,scope,digest:async(text:string)=>createHash("sha256").update(text).digest("hex"),isCurrent:()=>true};
 const journal=()=>createDurableFleetWorkJournal(options);
 const note=()=>FleetWorkCommandSchema.parse({version:2,operationId:randomUUID(),scope,kind:"activity.note",capturedAt:"2026-10-16T18:00:00Z",timeZone:"America/Chicago",dependencies:[],payload:{activity:{type:"canonical",kind:"activity",id:randomUUID(),version:1},ticket:{type:"canonical",kind:"ticket",id:12,version:1},notes:"Original field report"}});
 return {scope,journal,note,fail:()=>{fail=true}};
}
describe("durable original-scope Fleet journal",()=>{
 it("commits original facts before reporting saved, survives reopen, and preserves unknown outcomes",async()=>{
 const f=fixture(),a=f.note(),j=f.journal();await expect(j.append(a)).resolves.toMatchObject({durability:"durable",canonicalApplied:false});await j.markSending(a.operationId,"2026-10-16T18:01:00Z");const reopened=f.journal();expect((await reopened.readState()).entries[0]).toMatchObject({command:a,delivery:{state:"sending"}});expect(await reopened.nextBatch("2026-10-16T18:02:00Z")).toEqual([]);await reopened.applyReceiptAbsence({operationId:a.operationId,scope:f.scope,fingerprint:(await reopened.readState()).entries[0].fingerprint,found:false,checkedAt:"2026-10-16T18:02:00Z"});expect(await reopened.nextBatch("2026-10-16T18:03:00Z")).toEqual([a]);
 });
 it("keeps 5000 events and 500 evidence metadata identities without eviction or aggregate JSON rewrites",async()=>{
 const f=fixture(),j=f.journal();for(let n=0;n<5000;n++)await j.append(f.note());for(let n=0;n<500;n++)await j.retainEvidence(randomUUID(),{uri:`private-original-${n}`,sha256:"a".repeat(64),byteSize:1024});expect((await f.journal().readState()).entries).toHaveLength(5000);expect(await f.journal().evidence()).toHaveLength(500);
 });
 it("fails honestly on quota and locks originals rather than clearing on signout",async()=>{
 const f=fixture(),j=f.journal(),a=f.note();await j.append(a);await j.lockScope(f.scope);expect((await f.journal().readState()).entries[0].command).toEqual(a);await expect(f.journal().append(f.note())).rejects.toThrow();const g=fixture();g.fail();await expect(g.journal().append(g.note())).rejects.toThrow("Disk full");expect((await g.journal().readState()).entries).toHaveLength(0);
 });
 it("rejects changed operations, cross-account references and forged receipts without losing originals",async()=>{
 const f=fixture(),j=f.journal(),a=f.note();await j.append(a);await expect(j.append({...a,payload:{...a.payload,notes:"changed"}})).rejects.toThrow();await expect(j.append({...a,operationId:randomUUID(),scope:{...f.scope,userId:99}})).rejects.toThrow();await expect(j.applyReceipt(f.scope,{status:"applied",version:2,operationId:a.operationId,scope:f.scope,fingerprint:"0".repeat(64),recordedAt:"2026-10-16T18:01:00Z",mappings:[],canonicalReferences:[]})).rejects.toThrow();expect((await j.readState()).entries[0].command).toEqual(a);
 });
});
