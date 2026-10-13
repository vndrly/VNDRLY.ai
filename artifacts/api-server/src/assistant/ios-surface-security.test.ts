import {describe,it,expect} from "vitest";
import {chatGptActionTools,chatGptReadableTools} from "./chatgpt-tool-access";
import {validateChatGptActionInput} from "./chatgpt-write-capabilities";
import {bindWorkHubToolScope,resolveExecutableWorkHubToolRequest} from "./work-hub-tool-runtime";
import {fieldAssistantProofPacket} from "./field-proof-projection";
import {buildTicketProofPacket} from "../lib/ticket-proof-packet";
import {runClientTool} from "./client-tools";
const actor={userId:1,role:"vendor",vendorId:3,membershipRole:"admin"},op="00000000-0000-4000-8000-000000000001";
const names=(tools:{name:string}[])=>tools.map(t=>t.name);
describe("new assistant approval and scope boundaries",()=>{
 it("opens only advertised native aliases without granting mutations or prototype keys",()=>{
  expect(JSON.parse(runClientTool("open_screen",{screen:"fleet-map"},actor))).toMatchObject({ok:true,intent:{arguments:{mobilePath:"/fleet-map"}}});
  expect(JSON.parse(runClientTool("open_screen",{screen:"constructor"},actor))).toHaveProperty("ok",false);
  expect(JSON.parse(runClientTool("open_screen",{screen:"company-operations"},{...actor,role:"partner"}))).toHaveProperty("ok",false);
 });
 it("requires separate explicit location consent even on Gate and Work Hub connections",()=>{
  for(const scopes of [["gate:read"],["work_hub:read"],["gate:read","work_hub:read"]]) expect(names(chatGptReadableTools(actor,scopes))).not.toContain("query_gate_coverage_map");
  expect(names(chatGptReadableTools(actor,["gate:read","crew:read"]))).toContain("query_gate_coverage_map");
 });
 it("does not silently expand company settings from Work Hub write consent",()=>{
  expect(names(chatGptActionTools(actor,["work_hub:write"]))).not.toContain("set_company_operations");
  expect(names(chatGptActionTools(actor,["company:settings"]))).toContain("set_company_operations");
  expect(names(chatGptActionTools({...actor,membershipRole:"employee"},["company:settings","work_hub:write"]))).not.toContain("set_company_operations");
  expect(names(chatGptActionTools({...actor,vendorId:undefined},["company:settings"]))).not.toContain("set_company_operations");
  expect(()=>validateChatGptActionInput("set_company_operations",{categories:["gate","gate"]})).toThrow();
  expect(()=>validateChatGptActionInput("set_company_operations",{categories:[]})).toThrow();
 });
 it("executes exact company replacement with the trusted approval envelope",()=>{
  const input={categories:["gate"],operationId:op,confirmed:true,idempotencyKey:"server-key",voiceSessionId:"conversation:1"};
  expect(resolveExecutableWorkHubToolRequest("set_company_operations",input,true,actor)).toMatchObject({method:"PATCH",body:{categories:["gate"]}});
  expect(resolveExecutableWorkHubToolRequest("set_company_operations",input,false,actor)).toHaveProperty("requiresConfirmation",true);
  expect(resolveExecutableWorkHubToolRequest("set_company_operations",{...input,vendorId:999},true,actor)).toHaveProperty("error");
  expect(resolveExecutableWorkHubToolRequest("set_my_shift_status",{action:"start",operationId:op,confirmed:true,idempotencyKey:"server-key",voiceSessionId:"conversation:1"},true,actor)).toMatchObject({method:"POST",body:{action:"start",mode:"manual"}});
  expect(resolveExecutableWorkHubToolRequest("set_my_on_call_status",{active:true,operationId:op,confirmed:true,idempotencyKey:"server-key",voiceSessionId:"conversation:1"},true,actor)).toMatchObject({method:"PUT",body:{active:true,consent:true}});
 });
 it("retains strict Fleet commands through real scope binding and trusted confirmation metadata",()=>{
  const input={ticketId:42,operationId:op,expectedVersion:0,mode:"batch",rateCents:2500,closure:"manual",closesAt:null,destinationIds:[op],confirmed:true,idempotencyKey:"server-key",voiceSessionId:"conversation:1"};
  const bound=bindWorkHubToolScope(input,actor,"save_fleet_ticket_plan");
  expect(resolveExecutableWorkHubToolRequest("save_fleet_ticket_plan",bound,true,actor)).toMatchObject({method:"POST",path:"/fleet/tickets/42/plan",body:{operationId:op}});
  expect(resolveExecutableWorkHubToolRequest("save_fleet_ticket_plan",{...input,owner:{id:999,type:"vendor"}},true,actor)).toHaveProperty("error");
  const {confirmed,idempotencyKey,voiceSessionId,...business}=input;
  expect(()=>validateChatGptActionInput("save_fleet_ticket_plan",{...business,rateCents:-1})).toThrow();
  const destination={expectedVersion:1,operationId:op,destination:{name:"Synthetic yard",kind:"yard",address:"Synthetic address",latitude:35,longitude:-97,materials:[],hours:"",instructions:"",active:true}};
  expect(()=>validateChatGptActionInput("save_fleet_destination",destination)).not.toThrow();
  expect(resolveExecutableWorkHubToolRequest("save_fleet_destination",bindWorkHubToolScope({...destination,confirmed,idempotencyKey,voiceSessionId},actor,"save_fleet_destination"),true,actor)).toMatchObject({method:"POST",path:"/fleet/destinations"});
  expect(()=>validateChatGptActionInput("save_fleet_destination",{...destination,destination:{...destination.destination,ownerId:999}})).toThrow();
 });
 it("keeps field evidence and submission while omitting money, approval and payment",()=>{
  const packet=buildTicketProofPacket({status:"approved",notes:"Synthetic field notes",approvedAt:new Date(),paymentReference:"private payment"},[{quantity:1,unitPrice:12345,type:"other"}],[]);
  const field=fieldAssistantProofPacket(packet,"submitted");
  expect(field.sections.map(s=>s.id)).toContain("submission");
  expect(field.sections.map(s=>s.id)).not.toContain("approval");
  expect(field.sections.map(s=>s.id)).not.toContain("payment");
  expect(field).not.toHaveProperty("lineItemTotal");
  expect(JSON.stringify(field)).not.toMatch(/12345|12,345|private payment/);
 });
});
