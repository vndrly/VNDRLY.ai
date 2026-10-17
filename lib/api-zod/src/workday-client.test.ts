import {it,expect} from "vitest";import {randomUUID} from "node:crypto";
import {createWorkdayController} from "./workday-client";
import type {FleetJournalStore} from "./fleet-work-journal";
it("keeps an explicit end-of-day intent through restart and never treats logout as a clock event",async()=>{
 const rows=new Map<string,string>(),storage:FleetJournalStore={async transaction(work){const next=new Map(rows),result=await work({get:async(k,id)=>next.get(`${k}:${id}`)??null,set:async(k,id,v)=>{next.set(`${k}:${id}`,v)},values:async k=>[...next].filter(([key])=>key.startsWith(`${k}:`)).map(([,v])=>v)});rows.clear();next.forEach((v,k)=>rows.set(k,v));return result;}};
 const scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1},open=()=>createWorkdayController({scope,storage,isCurrent:()=>true,uuid:randomUUID});let c=open();await c.cacheCurrent({scope,workday:null});await c.record("start_shift",new Date("2026-10-17T12:00:00Z"),"America/Chicago");c=open();let state=await c.read();expect(state.onShift).toBe(true);expect(state.pending).toBe(1);await c.record("end_shift",new Date("2026-10-17T22:00:00Z"),"America/Chicago");state=await open().read();expect(state.onShift).toBe(false);expect(state.pending).toBe(2);expect(state.commands.map(c=>c.command.action)).toEqual(["start_shift","end_shift"]);
 const tomorrow=await c.record("start_shift",new Date("2026-10-18T12:00:00Z"),"America/Denver");expect(tomorrow.timezone).toBe("America/Denver");expect(tomorrow.shiftId).not.toBe(state.commands[0].command.shiftId);
 const sent:string[]=[];const transport={read:async()=>{throw Object.assign(Error("Not found"),{status:404})},send:async(command:{operationId:string})=>{sent.push(command.operationId);throw Error("Response lost")}};
 await c.sync(transport);await c.sync(transport);expect(sent).toEqual([state.commands[0].command.operationId,state.commands[0].command.operationId]);expect((await c.read()).held).toBe(false);
});
