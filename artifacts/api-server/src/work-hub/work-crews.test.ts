import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({crew:null as any,roster:[] as any[],workers:[] as any[],writes:[] as any[],updates:[] as any[]}));
vi.mock("@workspace/db",()=>({db:{},workHubCrewsTable:{id:"crew",ownerOrgType:"type",ownerOrgId:"owner",status:"status",workCrew:"settings"},workHubCrewMembersTable:{crewId:"crew-id"},workHubTasksTable:{table:"tasks"},workHubTaskEventsTable:{table:"events"},workHubAnnouncementsTable:{table:"announcements"},workHubAnnouncementRecipientsTable:{table:"recipients"}}));
vi.mock("./audit",()=>({appendWorkHubAudit:vi.fn()}));
vi.mock("./commands",()=>({executeWorkHubCommand:async (_actor:unknown,_kind:unknown,_envelope:unknown,apply:any)=>{const resource=await apply({
  execute:async()=>({rows:state.workers}),
  select:()=>({from:(table:any)=>({where:()=>({for:async()=>table.id==="crew"?[state.crew].filter(Boolean):state.roster})})}),
  insert:(table:any)=>({values:(value:any)=>{state.writes.push({table:table.table??"crew-members",value});return {returning:async()=>Array.isArray(value)?value.map((row:any,i:number)=>({id:`task-${i}`,...row})):[{id:"saved",...value}]};}}),
  update:()=>({set:(value:any)=>({where:async()=>{state.updates.push(value);}})})
});return {resource};}}));
import {saveWorkCrew,assignWorkCrew,announceToWorkCrew} from "./work-crews";
import {workCrewExpiration} from "./work-crew-policy";
const actor={userId:1,source:"web" as const},owner={type:"vendor" as const,id:1054};
const envelope=(payload:any)=>({owner,payload,operationId:"11111111-1111-4111-8111-111111111111",context:{kind:"organization" as const,id:"1054"},expectedVersion:null,payloadVersion:1 as const});
beforeEach(()=>{state.crew={id:"crew",createdAt:new Date(),workCrew:{purpose:"Travel",noExpiry:false,lastAssignedAt:null}};state.roster=[{userId:1},{userId:2},{userId:3}];state.workers=[{userId:1,name:"John"},{userId:2,name:"Worker two"},{userId:3,name:"Worker three"}];state.writes=[];state.updates=[];});
it("expires after 30 unused days, resets on job assignment, and honors the bypass",()=>{
 const crew={createdAt:"2026-01-01T00:00:00Z",workCrew:{noExpiry:false,lastAssignedAt:null as string|null}};
 expect(workCrewExpiration(crew,new Date("2026-01-30T23:59:59Z")).expired).toBe(false);
 expect(workCrewExpiration(crew,new Date("2026-01-31T00:00:00Z")).expired).toBe(true);
 crew.workCrew.lastAssignedAt="2026-01-20T00:00:00Z";
 expect(workCrewExpiration(crew,new Date("2026-02-01T00:00:00Z"))).toEqual({expired:false,expiresAt:"2026-02-19T00:00:00.000Z"});
 crew.workCrew.noExpiry=true;expect(workCrewExpiration(crew,new Date("2027-01-01T00:00:00Z"))).toEqual({expired:false,expiresAt:null});
});
it("saves exactly the selected company workers without automatically enrolling the creator",async()=>{
 await saveWorkCrew(actor,envelope({name:"Out of town",userIds:[2,3,3]}));
 expect(state.writes[0].value.workCrew).toMatchObject({noExpiry:false,lastAssignedAt:null});
 expect(state.writes[1].value.map((member:any)=>member.userId)).toEqual([2,3]);
});
it("rejects an outside worker before creating any crew or membership",async()=>{
 await expect(saveWorkCrew(actor,envelope({name:"Travel",userIds:[2,99]}))).rejects.toThrow("forbidden");expect(state.writes).toEqual([]);
});
it("assigns one job to every saved member and resets the timer in the same command",async()=>{
 const result=await assignWorkCrew(actor,envelope({title:"Out-of-town job"}),"crew");
 expect(result.resource.tasks.map((task:any)=>task.assigneeUserId)).toEqual([1,2,3]);
 expect(state.writes.find(write=>write.table==="events").value.every((event:any)=>event.detail.crewId==="crew")).toBe(true);
 expect(state.updates[0].workCrew.lastAssignedAt).toBe(result.resource.assignedAt);
});
it("rejects an expired crew and an unavailable member before assigning anything",async()=>{
 state.crew.createdAt=new Date("2020-01-01");await expect(assignWorkCrew(actor,envelope({title:"Job"}),"crew")).rejects.toThrow("expired");expect(state.writes).toEqual([]);
 state.crew.createdAt=new Date();state.workers=state.workers.slice(0,2);await expect(assignWorkCrew(actor,envelope({title:"Job"}),"crew")).rejects.toThrow("no longer available");expect(state.writes).toEqual([]);
});
it("resolves announcement recipients from the roster without resetting inactivity",async()=>{
 await announceToWorkCrew(actor,envelope({title:"Travel update",body:"Meet at the office.",acknowledgementRequired:true}),"crew");
 expect(state.writes.find(write=>write.table==="announcements").value.workCrewId).toBe("crew");
 expect(state.writes.find(write=>write.table==="recipients").value.map((recipient:any)=>recipient.userId)).toEqual([1,2,3]);
 expect(state.updates).toEqual([]);
});
