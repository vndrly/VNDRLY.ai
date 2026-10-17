import {it,expect} from "vitest";
import {randomUUID,webcrypto} from "node:crypto";
import {createFleetBrowserJournal} from "./fleet-work-browser-journal";
import type {FleetJournalStore} from "./fleet-work-journal";
it("retains multiple browser photo parts and their original intents atomically without replacing another capture",async()=>{
 const rows=new Map<string,string>(),scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};let current=true;
 Object.defineProperty(globalThis,"crypto",{value:webcrypto,configurable:true});
 const storage:FleetJournalStore={transaction:async work=>{const copy=new Map(rows);const result=await work({get:async(k,id)=>copy.get(`${k}:${id}`)??null,set:async(k,id,v)=>{copy.set(`${k}:${id}`,v)},values:async k=>[...copy].filter(([key])=>key.startsWith(`${k}:`)).map(([,v])=>v)});rows.clear();for(const [key,value] of copy)rows.set(key,value);return result;}};
 const journal=createFleetBrowserJournal(scope,storage,()=>current),id=randomUUID(),operationId=randomUUID(),body=new Uint8Array(300000).fill(127);
 await journal.stageEvidence(id,new Blob([body]),"image/jpeg",media=>({version:2,scope,operationId,capturedAt:new Date().toISOString(),timeZone:"UTC",dependencies:[],kind:"compliance.document.stage",payload:{recordId:randomUUID(),subject:{kind:"driver",id:2},expectedRecordVersion:0,evidence:{type:"local",kind:"evidence",id},byteSize:media.byteSize,sha256:media.sha256,contentType:"image/jpeg"}}));
 const reopened=createFleetBrowserJournal(scope,storage,()=>current);expect((await reopened.readState()).entries[0].command.operationId).toBe(operationId);expect(await reopened.readEvidencePart(id,262140,12)).toEqual(body.slice(262140,262152));
 await expect(journal.stageEvidence(id,new Blob([new Uint8Array([1])]),"image/jpeg")).rejects.toThrow("replaced");expect((await reopened.evidence())).toHaveLength(1);
 current=false;await expect(reopened.readEvidencePart(id,0,3)).rejects.toThrow("changed");
});
