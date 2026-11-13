import {describe,it,expect} from 'vitest';
import {db,pool,vendorPeopleTable} from '@workspace/db';
import {eligibleGateEmployeeCondition,eligibleManagedGateEmployees} from './ticket-staff-eligibility';
import {canReadTicket} from './field-ticket-access';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import ticketsRouter from '../routes/tickets';
import {buildTestCookie} from '../test-utils/session';
import {SESSION_SECRET} from './session';
import {randomUUID} from 'node:crypto';
describe.runIf(process.env.VNDRLY_TEST_DB_MODE==='fresh-local')('ticket gate eligibility',()=>{
 it('includes site-authorized gatekeepers and excludes field-only, inactive and other-site staff',async()=>{
 const tag=randomUUID();
 const vendor=(await pool.query("insert into vendors(name,contact_name,contact_email) values($1,'Test',$2) returning id",[tag,tag+'@example.invalid'])).rows[0].id;
 const partner=(await pool.query("insert into partners(name,contact_name,contact_email) values($1,'Test',$2) returning id",[tag,tag+'@example.invalid'])).rows[0].id;
 const site=(await pool.query("insert into site_locations(partner_id,name,address,latitude,longitude,site_code) values($1,$2,'Test',31,-102,$2) returning id",[partner,tag])).rows[0].id;
 for(const [label,role,active,access] of [['gate','gatekeeper',true,true],['field','field',true,true],['inactive','gatekeeper',false,true],['noAccess','gatekeeper',true,false]] as const){
 const user=(await pool.query("insert into users(username,password_hash,role,display_name) values($1,'test','vendor',$2) returning id",[tag+label,label])).rows[0].id;
 const person=(await pool.query("insert into vendor_people(vendor_id,user_id,vendor_role,first_name,email,is_active) values($1,$2,$3,$4,$5,$6) returning id",[vendor,user,role,label,tag+label+'@example.invalid',active])).rows[0].id;
 if(access)await pool.query('insert into vendor_person_site_access(vendor_people_id,site_location_id) values($1,$2)',[person,site]);
 }
 const rows=await db.select({name:vendorPeopleTable.firstName}).from(vendorPeopleTable).where(eligibleGateEmployeeCondition(vendor,site));
 expect(rows.map(r=>r.name)).toEqual(['gate']);
 });
});

describe.runIf(process.env.VNDRLY_TEST_DB_MODE==='fresh-local')('managed ticket gate eligibility',()=>{
 it('uses active sponsorship and site role without creating a direct employee',async()=>{
 const tag=randomUUID();
 const vendor=(await pool.query("insert into vendors(name,contact_name,contact_email) values($1,'Test',$2) returning id",[tag,tag+'@example.invalid'])).rows[0].id;
 const partner=(await pool.query("insert into partners(name,contact_name,contact_email) values($1,'Test',$2) returning id",[tag,tag+'@example.invalid'])).rows[0].id;
 const site=(await pool.query("insert into site_locations(partner_id,name,address,latitude,longitude,site_code) values($1,$2,'Test',31,-102,$2) returning id",[partner,tag])).rows[0].id;
 const user=(await pool.query("insert into users(username,password_hash,role,display_name) values($1,'test','field_employee','Managed Gatekeeper') returning id",[tag])).rows[0].id;
 const org=(await pool.query("insert into managed_subcontractor_organizations(name,canonical_name,created_by_vendor_id,created_by_user_id) values($1,$1,$2,$3) returning id",[tag,vendor,user])).rows[0].id;
 await pool.query("insert into managed_subcontractor_sponsors(managed_organization_id,sponsor_vendor_id,created_by_user_id) values($1,$2,$3)",[org,vendor,user]);
 const sponsorship=(await pool.query("insert into managed_subcontractor_worker_sponsorships(worker_user_id,sponsor_vendor_id,managed_organization_id,invited_by_user_id) values($1,$2,$3,$1) returning id",[user,vendor,org])).rows[0].id;
 await pool.query("insert into managed_subcontractor_role_grants(sponsorship_id,role,site_id,granted_by_user_id) values($1,'gatekeeper',$2,$3)",[sponsorship,site,user]);
 expect(await eligibleManagedGateEmployees(vendor,site)).toEqual([{userId:user,name:'Managed Gatekeeper'}]);
 const workType=(await pool.query("select id from work_types where lower(name)='gatekeeping' limit 1")).rows[0]?.id ?? (await pool.query("insert into work_types(name,category) values('Gatekeeping','Gate Operations') returning id")).rows[0].id;
 const ticket=(await pool.query("insert into tickets(site_location_id,vendor_id,work_type_id,description) values($1,$2,$3,'TEST ONLY managed assignment') returning id",[site,vendor,workType])).rows[0].id;
 const app=express().use(express.json()).use(cookieParser()).use(ticketsRouter);
 const cookie=buildTestCookie({userId:user,role:'admin'},{secret:SESSION_SECRET});
 const saved=await request(app).patch('/tickets/'+ticket).set('Cookie',cookie).send({gateEmployeeUserId:user,fieldEmployeeId:null});
 expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 expect(saved.body.gateEmployeeUserId).toBe(user);
 expect(saved.body.fieldEmployeeName).toBe('Managed Gatekeeper');
 const managedCookie=buildTestCookie({userId:user,role:'field_employee',vendorId:vendor,managedSubcontractor:{siteGrants:[{siteId:site,role:'gatekeeper'}]}},{secret:SESSION_SECRET});
 const listed=await request(app).get('/tickets?siteLocationId='+site).set('Cookie',managedCookie);
 expect(listed.status,JSON.stringify(listed.body)).toBe(200);
 expect(listed.body.items.map((row:{id:number})=>row.id)).toContain(ticket);

 expect(await canReadTicket({userId:user,role:'field_employee',vendorId:vendor,managedSubcontractor:{siteGrants:[{siteId:site,role:'gatekeeper'}]}},ticket)).toBe(true);
 expect(await canReadTicket({userId:user,role:'field_employee',vendorId:vendor+10000000,managedSubcontractor:{siteGrants:[{siteId:site,role:'gatekeeper'}]}},ticket)).toBe(false);
 expect((await pool.query('select gate_employee_user_id,field_employee_id from tickets where id=$1',[ticket])).rows[0]).toEqual({gate_employee_user_id:user,field_employee_id:null});
 const bad=await request(app).patch('/tickets/'+ticket).set('Cookie',cookie).send({gateEmployeeUserId:user+10000000});
 expect(bad.status).toBe(400);
 const cleared=await request(app).patch('/tickets/'+ticket).set('Cookie',cookie).send({gateEmployeeUserId:null,fieldEmployeeId:null});
 expect(cleared.status).toBe(200);
 expect(cleared.body.gateEmployeeUserId).toBeNull();

 expect(await eligibleManagedGateEmployees(vendor,site+10000000)).toEqual([]);
 expect(await eligibleManagedGateEmployees(vendor+10000000,site)).toEqual([]);
 await pool.query("update managed_subcontractor_worker_sponsorships set status='paused' where id=$1",[sponsorship]);
 expect(await eligibleManagedGateEmployees(vendor,site)).toEqual([]);
 expect((await pool.query('select id from vendor_people where user_id=$1',[user])).rowCount).toBe(0);
 });
});
