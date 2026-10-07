import { afterEach, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async () => ({...await import("../../../../lib/db/src/schema/index"),db:{select:()=>({from:()=>({where:async()=>[{token:"ExponentPushToken[synthetic]"}]})})}}));
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