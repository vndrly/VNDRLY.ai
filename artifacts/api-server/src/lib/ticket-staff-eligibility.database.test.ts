import {describe,it,expect} from 'vitest';
import {db,pool,vendorPeopleTable} from '@workspace/db';
import {eligibleGateEmployeeCondition} from './ticket-staff-eligibility';
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
