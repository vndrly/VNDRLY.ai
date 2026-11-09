import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {assertFreshLocalTestDatabaseEnvironment} from '../../../../scripts/fresh-test-database.mjs';
import {resolveStaffingSmsAdmin} from './gate-staffing-sms';
import {smsConsentFingerprint} from './gate-alert-delivery';
const isolated=process.env.VNDRLY_TEST_DB_MODE==='fresh-local'&&process.env.VNDRLY_ISOLATED_TEST_DB==='1';
let c:Client;
const phone='+14055551212';
describe.skipIf(!isolated)('real saved admin identity behind staffing SMS acknowledgment',()=>{
 beforeAll(async()=>{assertFreshLocalTestDatabaseEnvironment(process.env);const target=new URL(process.env.DATABASE_URL!),maintenance=new URL(target);maintenance.pathname='/postgres';const admin=new Client({connectionString:maintenance.href});await admin.connect();const name=`vndrly_${randomUUID().replaceAll('-','')}_test`;try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}target.pathname='/'+name;c=new Client({connectionString:target.href});await c.connect();await c.query(`CREATE TABLE users(id integer PRIMARY KEY,session_version integer,display_name text,active_membership_id integer,suspended_at timestamptz,must_change_password boolean);CREATE TABLE user_org_memberships(id integer,user_id integer,vendor_id integer,vendor_people_id integer,partner_id integer,org_type text,role text);CREATE TABLE vendor_people(id integer,user_id integer,vendor_id integer,phone text,vendor_role text,deleted_at timestamptz,is_active boolean);CREATE TABLE notification_preferences(user_id integer,alerts_sms_enabled boolean,alerts_sms_opted_in_at timestamptz,alerts_sms_consent_fingerprint text);INSERT INTO users VALUES(1,3,'Admin',11,NULL,false);INSERT INTO user_org_memberships VALUES(11,1,22,33,NULL,'vendor','admin');INSERT INTO vendor_people VALUES(33,1,22,'${phone}','office',NULL,true);`);await c.query('INSERT INTO notification_preferences VALUES(1,true,now(),$1)',[smsConsentFingerprint(1,11,33,phone)]);});
 afterAll(async()=>{await c?.end();});
 it('binds phone to the saved active company admin and session version',async()=>{expect(await resolveStaffingSmsAdmin(phone,c)).toMatchObject({userId:1,activeMembershipId:11,vendorId:22,sv:3,membershipRole:'admin',vendorRole:'office'});});
 it('does not infer phone identities or accept an unknown sender',async()=>{expect(await resolveStaffingSmsAdmin('405-555-1212',c)).toBeNull();expect(await resolveStaffingSmsAdmin('+14055559999',c)).toBeNull();});
 it('does not accept revoked admin role, suspended identity, inactive employee or changed phone consent',async()=>{
  await c.query("UPDATE user_org_memberships SET role='member'");expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();await c.query("UPDATE user_org_memberships SET role='admin'");
  await c.query('UPDATE users SET suspended_at=now()');expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();await c.query('UPDATE users SET suspended_at=NULL');
  await c.query('UPDATE vendor_people SET is_active=false');expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();await c.query('UPDATE vendor_people SET is_active=true');
  await c.query("UPDATE notification_preferences SET alerts_sms_consent_fingerprint='stale'");expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();await c.query('UPDATE notification_preferences SET alerts_sms_consent_fingerprint=$1',[smsConsentFingerprint(1,11,33,phone)]);
 });
 it('rechecks a consent or phone revocation under the acknowledgment transaction lock',async()=>{
  expect(await resolveStaffingSmsAdmin(phone,c)).not.toBeNull();
  await c.query('UPDATE notification_preferences SET alerts_sms_enabled=false');
  await c.query('BEGIN');try{expect(await resolveStaffingSmsAdmin(phone,c,true)).toBeNull();}finally{await c.query('ROLLBACK');}
  await c.query('UPDATE notification_preferences SET alerts_sms_enabled=true');
  await c.query("UPDATE vendor_people SET phone='+14055559999'");
  await c.query('BEGIN');try{expect(await resolveStaffingSmsAdmin(phone,c,true)).toBeNull();}finally{await c.query('ROLLBACK');}
  await c.query('UPDATE vendor_people SET phone=$1',[phone]);
 });
 it('SMS opt-out, changed active membership and ambiguous shared numbers cannot acknowledge',async()=>{
  await c.query('UPDATE notification_preferences SET alerts_sms_enabled=false');expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();await c.query('UPDATE notification_preferences SET alerts_sms_enabled=true');
  await c.query('UPDATE users SET active_membership_id=99');expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();await c.query('UPDATE users SET active_membership_id=11');
  await c.query("INSERT INTO users VALUES(2,1,'Other admin',12,NULL,false);INSERT INTO user_org_memberships VALUES(12,2,22,34,NULL,'vendor','admin');INSERT INTO vendor_people VALUES(34,2,22,'+14055551212','office',NULL,true)");await c.query('INSERT INTO notification_preferences VALUES(2,true,now(),$1)',[smsConsentFingerprint(2,12,34,phone)]);expect(await resolveStaffingSmsAdmin(phone,c)).toBeNull();
 });
});
