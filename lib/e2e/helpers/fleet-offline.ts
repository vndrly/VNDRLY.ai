import {randomUUID} from "node:crypto";
import {createPool,hashPassword} from "./db";

/** New synthetic records in the wrapper-owned retained loopback DB only.
 * No canonical demo identity, password, existing row or shared DB is changed. */
export async function provisionFleetOfflineFixture(){
 const db=createPool(),tag=randomUUID(),username=`fleet-browser-${tag}@example.invalid`,password="Synthetic-local-fleet-only";
 try{
  await db.query("INSERT INTO platform_settings(id,work_hub_enabled) VALUES(1,true) ON CONFLICT(id) DO UPDATE SET work_hub_enabled=true");
  const insert=async(sql:string,values:unknown[]) => (await db.query(sql,values)).rows[0];
  const vendor=(await insert("INSERT INTO vendors(name,contact_name,contact_email,operations_categories) VALUES($1,'Synthetic',$2,ARRAY['fleet_ops']) RETURNING id",[`Offline Fleet ${tag}`,username])).id;
  const partner=(await insert("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",[`Offline partner ${tag}`,`partner-${username}`])).id;
  const user=await insert("INSERT INTO users(username,email,password_hash,display_name,role) VALUES($1,$1,$2,'Synthetic Fleet Driver','vendor') RETURNING id",[username,hashPassword(password)]);
  const member=await insert("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",[user.id,vendor]);
  await db.query("UPDATE users SET active_membership_id=$2 WHERE id=$1",[user.id,member.id]);
  await db.query("INSERT INTO vendor_people(user_id,vendor_id,first_name,email) VALUES($1,$2,'Synthetic Fleet Driver',$3)",[user.id,vendor,username]);
  const site=(await insert("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code,afe) VALUES($1,'Synthetic Billing Site','Synthetic OK',35,-97,$2,'AFE1') RETURNING id",[partner,tag])).id;
  const service=(await insert("INSERT INTO work_types(name,category,partner_id) VALUES('Synthetic crude transport','Synthetic',$1) RETURNING id",[partner])).id;
  await db.query("INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,precise_unit_price,unit,currency) VALUES($1,$2,'0.02','0.02','per_barrel','USD')",[vendor,service]);
  await db.query("INSERT INTO site_work_assignments(vendor_id,work_type_id,site_location_id,afe) VALUES($1,$2,$3,'AFE1')",[vendor,service,site]);
  await db.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status,approved_at,approved_by_user_id) VALUES($1,$2,'approved','2026-10-01T00:00:00Z',$3)",[partner,vendor,user.id]);
  await db.query("INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_unit_price,precise_unit_price,approved_unit,approved_currency,approved_by_user_id,approved_at) VALUES($1,$2,$3,'0.01','0.0125','per_barrel','USD',$4,'2026-10-01T00:00:00Z')",[partner,vendor,service,user.id]);
  const truck=(await insert("INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id) VALUES('Synthetic Browser Truck','truck','Synthetic','vendor',$1) RETURNING id",[vendor])).id;
  await db.query("INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)",[truck,String(vendor),user.id]);
  const group=randomUUID(),detail=randomUUID(),place=(name:string,kind:string)=>({id:randomUUID(),revision:1,name,kind,address:`${name}, Synthetic OK`,latitude:null,longitude:null,materials:[],hours:"",instructions:"",active:true,ownerType:"vendor",ownerId:vendor}),origin=place("Synthetic Origin","pickup"),destination=place("Synthetic Destination","delivery");
  await db.query("UPDATE vendors SET fleet_ops_state=$2::jsonb,fleet_resources=$3::jsonb,fleet_commercial_settings=$4::jsonb WHERE id=$1",[vendor,JSON.stringify({version:1,enabled:true,fleets:[{id:group,name:"Synthetic Resource Pool",siteIds:[site],equipmentAssetIds:[truck],requiredCertifications:[]}],grants:[{userId:user.id,fleetIds:[group],siteIds:[site],roles:["fleet_manager","driver"],safetyRelease:false,financeRead:true}],supportGrants:[],runs:[],operations:[],preferences:[]}),JSON.stringify({version:1,details:[{id:detail,companyId:vendor,version:1,name:"Synthetic Browser Detail",vehicleAssetId:truck,rigPackageId:null,rigPackageVersion:null,driverUserId:user.id,accessGroupIds:[group],effectiveFrom:"2026-01-01T00:00:00Z",effectiveUntil:null,archivedAt:null}],rigPackages:[],reservations:[]}),JSON.stringify({version:1,defaultMode:"batch",destinations:[origin,destination],operations:[]})]);
  return {username,password,vendor,site,service,group,detail,origin:origin.id,destination:destination.id};
 }finally{await db.end();}
}
