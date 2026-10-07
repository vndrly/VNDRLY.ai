import { expect,it,vi } from "vitest";
vi.mock("./askv-idempotency",async()=>({...await vi.importActual("./askv-idempotency"),runPersistentAskVMutation:async(_scope:unknown,execute:()=>Promise<string>)=>({hit:false,value:await execute()})}));
vi.mock("./device-context",()=>({publishAskVDeviceEvent:vi.fn(async()=>{})}));
import {runBoundTypedAskVTool} from "./askv-pending-confirmation";
import {bindWorkHubToolScope,resolveExecutableWorkHubToolRequest} from "./work-hub-tool-runtime";
import {sanitizeChatGptActionInput,validateChatGptActionInput} from "./chatgpt-write-capabilities";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const cases=[
 {name:"respond_work_hub_meeting_invitation",args:{occurrenceId:id(1),expectedFingerprint:"a".repeat(64),response:"accepted"},path:"/work-hub/calendar-response/execute"},
 {name:"reschedule_work_hub_meeting",args:{occurrenceId:id(1),expectedFingerprint:"a".repeat(64),startsAt:"2026-10-08T10:00:00Z",endsAt:"2026-10-08T11:00:00Z",timezone:"UTC"},path:"/work-hub/calendar-reschedule/execute"},
 {name:"prepare_ticket_invoices",args:{basis:"recorded_invoice_activity",tickets:[{ticketId:42,expectedUpdatedAt:"2026-10-07T09:00:00Z"}]},path:"/invoices/ticket-preparation/execute"},
 {name:"manage_work_hub_away_responder",args:{action:"configure",expectedVersion:0,startsAt:"2026-10-08T10:00:00Z",endsAt:"2026-10-08T11:00:00Z",replyText:"I will review this when I return.",channelIds:[id(2)]},path:"/work-hub/away-responder"},
];
it.each(cases)("separates actual trusted confirmation envelope from $name business input",async({name,args,path})=>{
 const session={userId:9,role:"vendor",vendorId:4,membershipRole:"admin",activeMembershipId:5,sv:1};
 const model=sanitizeChatGptActionInput(name,{...args,operationId:id(99),confirmed:true});validateChatGptActionInput(name,model);expect(model).not.toHaveProperty("operationId");expect(model).not.toHaveProperty("confirmed");
 const input={...model,operationId:id(3)},execute=vi.fn(async(raw:unknown)=>{const bound=bindWorkHubToolScope(raw,session,name);return JSON.stringify(resolveExecutableWorkHubToolRequest(name,bound,true,session));});
 const index=cases.findIndex(value=>value.name===name),base={name,input,session,conversationId:99000+index,turnId:1,contextKey:`strict:${name}`,phrase:"prepare",execute};
 expect(JSON.parse(await runBoundTypedAskVTool(base))).toMatchObject({requiresConfirmation:true});expect(execute).not.toHaveBeenCalled();
 const result=JSON.parse(await runBoundTypedAskVTool({...base,turnId:2,phrase:"confirm"}));
 expect(execute).toHaveBeenCalledOnce();expect(execute.mock.calls[0][0]).toMatchObject({idempotencyKey:expect.any(String),voiceSessionId:expect.any(String),confirmed:true});
 expect(result).toEqual({method:"POST",path,body:{...args,operationId:id(3)}});
});
it.each(cases)("rejects caller authority and invalid business input for $name before canonical dispatch",({name,args})=>{
 const session={userId:9,role:"vendor",vendorId:4,membershipRole:"admin"};
 for(const extra of [{owner:{type:"vendor",id:999}},{context:{kind:"organization",id:999}},{companyId:999},{unexpected:true}])expect(resolveExecutableWorkHubToolRequest(name,bindWorkHubToolScope({...args,operationId:id(3),...extra},session,name),true,session)).toHaveProperty("error");
 expect(resolveExecutableWorkHubToolRequest(name,bindWorkHubToolScope({...args,operationId:"invalid"},session,name),true,session)).toHaveProperty("error");
});
