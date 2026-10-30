import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess } from "./gate-change-over";
import type { GateMapPin } from "./gate-map-pins";
import { publishNotificationCreated } from "../lib/notification-events";

type Client=Pick<PoolClient,"query">;
const fail=(status:number,message:string):never=>{throw new ChangeOverError(status,"gate_map.pin_share",message);};
export async function readSharedGateMapPin(session:SessionPayload,pinId:string,client:Client=pool,lock=false){
  if(!session.userId||!session.vendorId) return fail(403,"Current company sign-in required");
  const pins:GateMapPin[]=(await client.query(`SELECT gate_map_pins FROM vendors WHERE id=$1${lock?" FOR UPDATE":""}`,[session.vendorId])).rows[0]?.gate_map_pins??[];
  const pin=pins.find(value=>value.id===pinId&&!value.removedAt);
  if(!pin)return fail(404,"Pin unavailable");
  await requireChangeOverAccess(client,session,pin.siteId);return pin;
}
async function audienceOptions(client:Client,session:SessionPayload){
  const people=(await client.query(`SELECT DISTINCT ON(u.id) u.id AS "userId",u.display_name AS name FROM user_org_memberships m JOIN users u ON u.id=m.user_id
    LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.vendor_id=m.vendor_id
    WHERE m.org_type='vendor' AND m.vendor_id=$1 AND u.suspended_at IS NULL AND (m.vendor_people_id IS NULL OR (p.is_active=true AND p.deleted_at IS NULL)) ORDER BY u.id,m.id`,[session.vendorId])).rows;
  const groups=(await client.query(`SELECT g.id::text AS id,g.name,COALESCE(array_agg(DISTINCT gm.user_id) FILTER(WHERE gm.user_id IS NOT NULL),'{}') AS "userIds"
    FROM work_hub_crews g LEFT JOIN work_hub_crew_members gm ON gm.crew_id=g.id
    WHERE g.owner_org_type='vendor' AND g.owner_org_id=$1 AND g.status='active' AND (g.created_by_id=$2 OR EXISTS(SELECT 1 FROM work_hub_crew_members mine WHERE mine.crew_id=g.id AND mine.user_id=$2) OR EXISTS(SELECT 1 FROM user_org_memberships admin WHERE admin.vendor_id=$1 AND admin.user_id=$2 AND admin.id=$3 AND admin.role='admin' AND admin.org_type='vendor')) GROUP BY g.id,g.name ORDER BY g.name`,[session.vendorId,session.userId,session.activeMembershipId])).rows;
  const companyIds=new Set<number>(people.map(person=>person.userId));
  return {people,groups:groups.map(group=>({...group,userIds:group.userIds.filter((id:number)=>companyIds.has(id))}))};
}
export async function gateMapPinShareOptions(session:SessionPayload,pinId:string){
  const client=await pool.connect();try{await readSharedGateMapPin(session,pinId,client);return await audienceOptions(client,session);}finally{client.release();}
}
const ShareInput=z.object({operationId:z.string().uuid(),audience:z.enum(["all","group","individuals"]),groupId:z.string().uuid().optional(),userIds:z.array(z.number().int().positive()).max(500).default([])}).strict();
export async function shareGateMapPin(session:SessionPayload,pinId:string,value:unknown){
  const input=ShareInput.parse(value);
  if(session.realm==="demo"||session.publicDemo)fail(403,"This session is read only");
  const result=await changeOverTransaction(async client=>{
    const pin=await readSharedGateMapPin(session,pinId,client,true);
    const command=JSON.stringify({pinId,...input,userIds:[...new Set(input.userIds)].sort((a,b)=>a-b)});
    const kind="gate.map.pin.share";
    const prior=(await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind=$2 AND operation_id=$3 AND owner_org_type='vendor' AND owner_org_id=$4",[session.userId,kind,input.operationId,session.vendorId])).rows[0]?.result_json;
    if(prior){if(prior.command!==command)fail(409,"This share was already sent with different recipients");return {...prior,notifications:[]};}
    const options=await audienceOptions(client,session),eligible=new Set<number>(options.people.map(p=>p.userId));
    const group=input.audience==="group"?options.groups.find(g=>g.id===input.groupId):null;
    if(input.audience==="group"&&!group)fail(403,"Choose an available company group");
    const requested:number[]=input.audience==="all"?[...eligible]:input.audience==="group"?group.userIds:input.userIds;
    if(input.audience==="individuals"&&requested.some(id=>!eligible.has(id)))fail(403,"Choose current company members");
    const recipients=[...new Set(requested)].filter(id=>eligible.has(id));
    if(!recipients.length)fail(400,"Choose at least one recipient");
    const link=`/gate/map?pinId=${pin.id}&siteId=${pin.siteId}`;
    const notifications=[];
    for(const userId of recipients){
      const row=(await client.query(`INSERT INTO notifications(user_id,type,category,title,body,link,dedupe_key) VALUES($1,'gate_map_pin_shared','gate_crew',$2,$3,$4,$5) RETURNING id,user_id AS "userId",type,title,body,link,created_at AS "createdAt"`,[userId,"Map pin shared",`${session.displayName||"A colleague"} shared a company map pin with you.`,link,`gate-map-pin:${input.operationId}:${userId}`])).rows[0];
      notifications.push(row);
    }
    const receipt={operationId:input.operationId,command,notifiedCount:notifications.length};
    await client.query("INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at) VALUES($1,$2,$3,'vendor',$4,$5::jsonb,now())",[session.userId,kind,input.operationId,session.vendorId,JSON.stringify(receipt)]);
    return {...receipt,notifications};
  });
  for(const n of result.notifications)publishNotificationCreated({userId:n.userId,notificationId:n.id,notifType:n.type,category:"gate_crew",title:n.title,body:n.body,link:n.link,createdAt:new Date(n.createdAt).toISOString(),audible:false});
  return {operationId:result.operationId,notifiedCount:result.notifiedCount};
}
