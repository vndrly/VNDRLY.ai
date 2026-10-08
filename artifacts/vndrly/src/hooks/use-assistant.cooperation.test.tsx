import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAssistant } from "./use-assistant";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("sends only explicit connection/task selection, surfaces recovery, and clears a new chat",async()=>{
 const bodies:Record<string,unknown>[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
  if(String(url).endsWith("/conversations"))return new Response('{"id":8}',{status:200});
  bodies.push(JSON.parse(String(options?.body)));
  return new Response('event: usage_alert\ndata: {"message":"Usage alert; work continues."}\n\nevent: recovery\ndata: {"completed":["saved"],"remaining":["photo"],"needed":"Wait for saved evidence","taskId":"35c34a3c-ef90-459d-9a4b-e980ec0c8a12"}\n\nevent: done\ndata: {"content":"Pending photo"}\n\n',{status:200});
 }));
 const {result}=renderHook(()=>useAssistant());
 const selected={connectionId:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12",scope:"personal" as const,personalPermission:true,savePersonalContentToCompany:false};
 act(()=>{result.current.selectConnection(selected);result.current.selectSavedTask(selected.connectionId);});
 await act(async()=>{await result.current.send("Summarize selected calendar");});
 expect(bodies[0]).toMatchObject({selectedConnection:selected,taskId:selected.connectionId});
 expect(result.current.messages.at(-1)).toMatchObject({recovery:{completed:["saved"],remaining:["photo"],needed:"Wait for saved evidence"},usageAlert:"Usage alert; work continues."});
 act(()=>result.current.startNew());
 await act(async()=>{await result.current.send("Show work");});
 expect(bodies[1]).not.toHaveProperty("selectedConnection");expect(bodies[1]).not.toHaveProperty("taskId");
});
