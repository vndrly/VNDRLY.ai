import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {pool} from '@workspace/db';
import {assertFreshLocalTestDatabaseEnvironment} from '../../../../scripts/fresh-test-database.mjs';
import {notifyGateCrossingException} from './gate-notification-events';
import {currentNotificationRecipients} from '../work-hub/notification-recipients';
it.skipIf(process.env.VNDRLY_ISOLATED_TEST_DB!=='1')('notifies current supervisors and assigned admins once, excludes ordinary gatekeepers and respects the held company',async()=>{
 assertFreshLocalTestDatabaseEnvironment(process.env);
 const tag=randomUUID();
 const partner=(await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",[tag])).rows[0].id;
 const vendor=(await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",[tag])).rows[0].id;
 const workType=(await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",[tag])).rows[0].id;
 const site=(await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Fixture',31,-102,$2) RETURNING id",[partner,tag])).rows[0].id;
 const gate=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Outer') RETURNING id",[site])).rows[0].id;
 await pool.query('INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)',[site,workType,vendor]);
 const users:number[]=[];
 for(const role of ['admin','gate_supervisor','gatekeeper']){
  const user=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture','vendor',$2) RETURNING id",[role+tag,role])).rows[0].id;users.push(user);
  const person=role==='admin'?null:(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$3,'Test',$4) RETURNING id",[vendor,user,role,role+tag+'@example.invalid'])).rows[0].id;
  await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,$3,$4)",[user,vendor,role==='admin'?'admin':'member',person]);
  await pool.query('INSERT INTO notification_preferences(user_id,push_enabled,system_email_enabled,gate_alerts_enabled) VALUES($1,false,false,true)',[user]);
 }
 const link=`/gate?siteId=${site}&stationId=${gate}`;
 expect((await currentNotificationRecipients({type:'vendor',id:vendor},users,link,'supervisor')).sort()).toEqual(users.slice(0,2).sort());
 const operation=randomUUID();
 await notifyGateCrossingException(site,gate,123,operation,'Inner secure-area checkout missed');
 await notifyGateCrossingException(site,gate,123,operation,'Inner secure-area checkout missed');
 const rows=(await pool.query("SELECT user_id FROM notifications WHERE dedupe_key=$1 ORDER BY user_id",[`gate_crossing_exception:123:${operation}`])).rows;
 expect(rows.map(r=>r.user_id).sort()).toEqual(users.slice(0,2).sort());
 await pool.query("INSERT INTO vendors(id,name,contact_name,contact_email) VALUES(1054,'Synthetic held','Test','test@example.invalid') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',1054,'admin')",[users[0]]);
 const heldOperation=randomUUID();await notifyGateCrossingException(site,gate,124,heldOperation,'Outer perimeter check-in missed');
 expect((await pool.query('SELECT user_id FROM notifications WHERE dedupe_key=$1',[`gate_crossing_exception:124:${heldOperation}`])).rows.map(r=>r.user_id)).toEqual([users[1]]);
});
