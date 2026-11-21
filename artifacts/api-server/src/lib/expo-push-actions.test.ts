import { afterEach, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async () => ({...await import("../../../../lib/db/src/schema/index"),db:{select:()=>({from:()=>({where:async()=>[{token:"ExponentPushToken[synthetic]"}]})})},pool:{query:vi.fn(async(sql:string)=>{if(sql.includes("SELECT DISTINCT recipient.user_id"))return {rows:[]};throw Error("Unexpected push fixture query");})}}));
import { resolvePushCategory, sendPushToUser } from "./expo-push";
afterEach(()=>vi.unstubAllGlobals());
it("adds registered actions only to saved notifications and exact meeting invitation type",async()=>{
 expect(resolvePushCategory({title:"",body:"",data:{type:"work_hub_meeting_invite",notificationId:10}})).toBe("vndrly_meeting");
 expect(resolvePushCategory({title:"",body:"",data:{type:"meeting_fake",notificationId:10}})).toBe("vndrly_record");
 expect(resolvePushCategory({title:"",body:"",data:{type:"work_hub_meeting_invite"}})).toBeUndefined();
 const sender=vi.fn(async(_url: string, _init?: RequestInit)=>new Response(JSON.stringify({data:[{status:"ok"}]})));vi.stubGlobal("fetch",sender);
 await sendPushToUser(9,{title:"Synthetic invitation",body:"Review response",data:{type:"work_hub_meeting_invite",notificationId:10}});
 const sent=JSON.parse(String(sender.mock.calls[0]?.[1]?.body));
 expect(sent[0]).toMatchObject({categoryId:"vndrly_meeting",sound:"vndrly_bell_ring.wav",data:{notificationId:10,type:"work_hub_meeting_invite"}});
});

it("sends incoming calls with the VNDRLY ringtone, Open Call action, and the ringing deadline", async () => {
 const sender = vi.fn(async (_url: string, _init?: RequestInit) =>
   new Response(JSON.stringify({ data: [{ status: "ok" }] })),
 );
 vi.stubGlobal("fetch", sender);
 const callExpiresAt = Math.floor(Date.now() / 1000) + 60;
 const msg = { title: "Incoming internal call", body: "Jordan", data: { type: "work_hub_call", notificationId: 11, callExpiresAt } };
 await sendPushToUser(9, msg);
 await sendPushToUser(9, { ...msg, interruptionLevel: "passive" });
 expect(JSON.parse(String(sender.mock.calls[0]?.[1]?.body))[0]).toMatchObject({
   categoryId: "vndrly_call",
   sound: "vndrly_call_ring.wav",
   interruptionLevel: "active",
   priority: "high",
   expiration: callExpiresAt,
 });
 expect(JSON.parse(String(sender.mock.calls[1]?.[1]?.body))[0]).toMatchObject({ sound: null, interruptionLevel: "passive" });
});
