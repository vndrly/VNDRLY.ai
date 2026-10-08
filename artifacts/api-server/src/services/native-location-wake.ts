import { pool } from "@workspace/db";
export type NativeLocationWakeRequest = { id:string;workerUserId:number;vendorId:number;deviceId:string|null;bindingVersion:number;expiresAt:string };
type WakeDependencies = { authorize:(request:NativeLocationWakeRequest)=>Promise<boolean>; query:typeof pool.query; send:typeof fetch; now:()=>number };
/** Expo provider acceptance is not phone delivery or a saved location. No alert or work content. */
export async function sendNativeLocationWake(request:NativeLocationWakeRequest, overrides:Partial<WakeDependencies>={}) {
 const deps:WakeDependencies={authorize:async value=>(await import("./native-operations")).recheckNativeLocationWake(value),query:pool.query.bind(pool),send:fetch,now:Date.now,...overrides};
 if(!request.deviceId||Date.parse(request.expiresAt)<=deps.now()||!await deps.authorize(request))return {accepted:false,reason:"current_authority_unavailable",deliveryVerified:false};
 const tokens=await deps.query(`SELECT p.expo_token FROM field_push_tokens p JOIN work_hub_devices d ON d.id=p.native_device_id
   WHERE p.user_id=$1 AND p.native_device_id=$2 AND p.retirement_pending=false
     AND d.user_id=$1 AND d.owner_org_type='vendor' AND d.owner_org_id=$3 AND d.revoked_at IS NULL
     AND d.device_class IN('phone','ios','iphone','mobile')`,[request.workerUserId,request.deviceId,request.vendorId]);
 const ttl=Math.floor((Date.parse(request.expiresAt)-deps.now())/1000);
 if(ttl<=0||!tokens.rows.length)return {accepted:false,reason:"no_current_phone_token",deliveryVerified:false};
 const messages=tokens.rows.map(row=>({to:row.expo_token,contentAvailable:true,data:{type:"native_location_request",nativeRequestId:request.id},ttl,priority:"normal"}));
 try{
  const response=await deps.send("https://exp.host/--/api/v2/push/send",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json",...(process.env.EXPO_ACCESS_TOKEN?{Authorization:`Bearer ${process.env.EXPO_ACCESS_TOKEN}`}:{})},body:JSON.stringify(messages),signal:AbortSignal.timeout(Math.min(8000,ttl*1000))});
  const result=await response.json() as {data?:{status?:string}[]};
  return {accepted:response.ok&&Array.isArray(result.data)&&result.data.length===messages.length&&result.data.every(ticket=>ticket.status==="ok"),deliveryVerified:false};
 }catch{return {accepted:false,reason:"provider_outcome_unverified",deliveryVerified:false};}
}
