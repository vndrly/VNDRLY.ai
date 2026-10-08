import {expect,it,vi} from "vitest";
vi.mock("@workspace/db",()=>({pool:{query:vi.fn()}}));
import {sendNativeLocationWake} from "./native-location-wake";
const now=Date.parse("2026-10-08T03:00:00Z"),request={id:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12",workerUserId:7,vendorId:10,deviceId:"35c34a3c-ef90-459d-9a4b-e980ec0c8a13",bindingVersion:2,expiresAt:new Date(now+60000).toISOString()};
it("sends data-only exactphone wake with deadline TTL and never claims delivery",async()=>{
 const query=vi.fn().mockResolvedValue({rows:[{expo_token:"ExpoPushToken[synthetic]"}]}),send=vi.fn().mockResolvedValue(new Response('{"data":[{"status":"ok"}]}',{status:200}));
 const result=await sendNativeLocationWake(request,{authorize:async()=>true,query:query as any,send,now:()=>now});
 expect(query.mock.calls[0][0]).toContain("p.native_device_id=$2 AND p.retirement_pending=false");expect(query.mock.calls[0][1]).toEqual([7,request.deviceId,10]);
 const payload=JSON.parse(send.mock.calls[0][1].body);expect(payload).toEqual([{to:"ExpoPushToken[synthetic]",contentAvailable:true,data:{type:"native_location_request",nativeRequestId:request.id},ttl:60,priority:"normal"}]);
 expect(result).toEqual({accepted:true,deliveryVerified:false});
});
it("does not send an expired or denied request or fan out to unbound tokens",async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]}),send=vi.fn();
 await sendNativeLocationWake(request,{authorize:async()=>false,query:query as any,send,now:()=>now});expect(query).not.toHaveBeenCalled();
 await sendNativeLocationWake(request,{authorize:async()=>true,query:query as any,send,now:()=>now+61000});expect(query).not.toHaveBeenCalled();
 await sendNativeLocationWake(request,{authorize:async()=>true,query:query as any,send,now:()=>now});expect(send).not.toHaveBeenCalled();
});
