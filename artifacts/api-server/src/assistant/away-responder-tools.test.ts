import {expect,it} from "vitest";
import {AWAY_RESPONDER_ARGUMENTS,awayResponderRequest} from "./away-responder-tools";
import {chatGptActionTools,chatGptReadableTools} from "./chatgpt-tool-access";
import {resolveExecutableWorkHubToolRequest} from "./work-hub-tool-runtime";
import {sanitizeChatGptActionInput,validateChatGptActionInput} from "./chatgpt-write-capabilities";
const id="00000000-0000-4000-8000-000000000001",channel="00000000-0000-4000-8000-000000000002";
const input={action:"configure",expectedVersion:0,startsAt:"2026-10-08T10:00:00Z",endsAt:"2026-10-09T10:00:00Z",replyText:"I am away. Please contact the office.",channelIds:[channel]};
const user={userId:9,role:"vendor",vendorId:4,activeMembershipId:5,sv:1,membershipRole:"member"};
it("binds exact reviewed away rule to trusted operation and rejects identity or permission overrides",()=>{
 for(const extra of [{userId:99},{owner:{type:"vendor",id:99}},{confirmed:true},{operationId:id},{sms:true}])expect(AWAY_RESPONDER_ARGUMENTS.safeParse({...input,...extra}).success).toBe(false);
 const safe=sanitizeChatGptActionInput("manage_work_hub_away_responder",{...input,operationId:id,confirmed:true});expect(safe).toEqual(input);validateChatGptActionInput("manage_work_hub_away_responder",{...safe,operationId:id});
 expect(resolveExecutableWorkHubToolRequest("manage_work_hub_away_responder",{...safe,operationId:id},false,user)).toMatchObject({requiresConfirmation:true});
 expect(resolveExecutableWorkHubToolRequest("manage_work_hub_away_responder",{...safe,operationId:id},true,user)).toEqual(awayResponderRequest(input,id));
});
it("separates own current-company read/write scopes and reads only exact joined choices",()=>{
 expect(chatGptActionTools(user,["work_hub:write"]).some(t=>t.name==="manage_work_hub_away_responder")).toBe(true);
 expect(chatGptActionTools(user,["work_hub:read"]).some(t=>t.name==="manage_work_hub_away_responder")).toBe(false);
 expect(chatGptActionTools({...user,activeMembershipId:undefined},["work_hub:write"]).some(t=>t.name==="manage_work_hub_away_responder")).toBe(false);
 expect(chatGptReadableTools(user,["work_hub:read"]).filter(t=>t.name.startsWith("query_work_hub_away")).map(t=>t.name)).toEqual(["query_work_hub_away_responder","query_work_hub_away_channels"]);
 expect(resolveExecutableWorkHubToolRequest("query_work_hub_away_channels",{},false,user)).toMatchObject({method:"GET",path:"/work-hub/away-responder/channels"});
 expect(resolveExecutableWorkHubToolRequest("query_work_hub_away_channels",{companyId:99},false,user)).toHaveProperty("error");
});
it("pins pause/revoke to exact rule/revision without configure fields",()=>{
 for(const action of ["pause","revoke"]){const args={action,expectedVersion:2,ruleId:channel};expect(awayResponderRequest(args,id).body).toEqual({...args,operationId:id});expect(AWAY_RESPONDER_ARGUMENTS.safeParse({...args,replyText:"Changed"}).success).toBe(false);}
});

it("advertises provider-compatible object roots across the full catalog and routed packs", async()=>{
 const {TOOLS}=await import("./tools");const {toolsForRealtime}=await import("./tool-packs");
 const check=(schema:Record<string,unknown>)=>{expect(schema.type).toBe("object");for(const key of ["anyOf","oneOf","allOf"])expect(schema).not.toHaveProperty(key);};
 for(const tool of TOOLS)check(tool.input_schema as Record<string,unknown>);
 for(const role of ["vendor","partner","field_employee","admin"])for(const path of ["/work-hub/askv","/work-hub/chat","/work-hub/crews","/work-hub/calendar","/work-hub/files","/work-hub/finance","/gate","/tickets","/profile"])for(const tool of toolsForRealtime({role,path,membershipRole:"admin"}))check(tool.inputSchema as Record<string,unknown>);
 const tool=TOOLS.find(t=>t.name==="manage_work_hub_away_responder")!;
 expect((tool.input_schema.properties as Record<string,unknown>).action).toMatchObject({enum:["configure","pause","revoke"]});
 expect(tool.input_schema.required).toEqual(["action","expectedVersion"]);
});
it("retains strict action requirements despite the provider object envelope",()=>{
 for(const raw of [{action:"configure",expectedVersion:0},{action:"pause",expectedVersion:2},{action:"revoke",expectedVersion:2,ruleId:channel,startsAt:input.startsAt},{...input,ruleId:channel},{...input,action:"anything"}]){
  expect(AWAY_RESPONDER_ARGUMENTS.safeParse(raw).success).toBe(false);
  expect(resolveExecutableWorkHubToolRequest("manage_work_hub_away_responder",{...raw,operationId:id},true,user)).toHaveProperty("error");
 }
});
