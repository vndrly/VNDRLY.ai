import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { assertFreshLocalTestDatabaseEnvironment } from '../../../../scripts/fresh-test-database.mjs';
const io=vi.hoisted(()=>({client:null as Client|null}));
vi.mock('@workspace/db',async()=>({...await import('../../../../lib/db/src/schema'),pool:{query:(...args:any[])=>(io.client!.query as any)(...args)},db:new Proxy({}, {get(){throw new Error('Held recipient must not reach notification writes/provider token reads');}})}));
import { pausedNotificationUserIds, NOTIFICATION_COMPANY_HOLDS, notificationCompanyHoldApplies, notificationTokenHoldApplies, notificationEmailHoldApplies } from '../lib/notification-company-hold';
import { sendPushToUser, sendExpoPushDestination } from '../lib/expo-push';
import { sendGateAlertPush } from './gate-alert-push';
import { loadGateAlertRecipient } from './gate-alert-repository';
import {notifyUsers} from '../routes/notifications';
import {sendNotificationAlertEmail} from '../lib/sendgrid';
const isolated=process.env.VNDRLY_TEST_DB_MODE==='fresh-local'&&process.env.VNDRLY_ISOLATED_TEST_DB==='1';
describe.skipIf(!isolated)('indefinite company notification hold with real saved recipients',()=>{
 beforeAll(async()=>{
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const url=new URL(process.env.DATABASE_URL!),maintenance=new URL(url);maintenance.pathname='/postgres';const admin=new Client({connectionString:maintenance.href});await admin.connect();const name=`vndrly_${randomUUID().replaceAll('-','')}_test`;try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}url.pathname='/'+name;io.client=new Client({connectionString:url.href});await io.client.connect();
  await io.client.query(`CREATE TABLE users(id integer PRIMARY KEY,email text,username text);CREATE TABLE user_org_memberships(user_id integer,vendor_id integer,org_type text);CREATE TABLE vendor_people(user_id integer,vendor_id integer,deleted_at timestamptz);CREATE TABLE managed_subcontractor_worker_sponsorships(worker_user_id integer,sponsor_vendor_id integer,status text,ended_at timestamptz);CREATE TABLE field_push_tokens(user_id integer,expo_token text);INSERT INTO users VALUES(1,'held@example.invalid','held'),(2,'other@example.invalid','other'),(3,'staff@example.invalid','staff'),(4,'managed@example.invalid','managed'),(5,'future@example.invalid','future');INSERT INTO user_org_memberships VALUES(1,1054,'vendor'),(2,1234,'vendor');INSERT INTO vendor_people VALUES(3,1054,NULL);INSERT INTO managed_subcontractor_worker_sponsorships VALUES(4,1054,'active',NULL);INSERT INTO field_push_tokens VALUES(1,'ExponentPushToken[held]'),(2,'ExponentPushToken[other]');`);
 });
 afterAll(async()=>{await io.client?.end();vi.unstubAllGlobals();});
 it('holds direct members, linked employees and active sponsored workers, leaves unrelated company available',async()=>{
  expect([...await pausedNotificationUserIds([1,2,3,4,5])].sort()).toEqual([1,3,4]);expect(await notificationCompanyHoldApplies(2)).toBe(false);
  expect(await notificationTokenHoldApplies('ExponentPushToken[held]')).toBe(true);expect(await notificationTokenHoldApplies('ExponentPushToken[other]')).toBe(false);expect(await notificationEmailHoldApplies('HELD@example.invalid')).toBe(true);expect(await notificationEmailHoldApplies('other@example.invalid')).toBe(false);
 });
 it('new saved membership takes effect immediately, including another active company, with no cache/restart expiry',async()=>{
  await io.client!.query("INSERT INTO user_org_memberships VALUES(5,1054,'vendor'),(1,1234,'vendor')");expect(await notificationCompanyHoldApplies(5)).toBe(true);expect(await notificationCompanyHoldApplies(1)).toBe(true);expect(NOTIFICATION_COMPANY_HOLDS[0]).toMatchObject({vendorId:1054,expiresAt:null});
 });
 it('fails closed when hold lookup fails',async()=>{expect([...await pausedNotificationUserIds([1,2],{query:async()=>{throw Error('unavailable');}})]).toEqual([1,2]);});
 it('blocks ordinary/urgent forced creation and native sends before any write or provider call',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await notifyUsers([1,3,4],{type:'gate_closed',title:'Never send',forceImmediateDelivery:true})).toBe(0);
  expect(await notifyUsers([1],{type:'work_hub_task_assigned',title:'Never send'})).toBe(0);
  expect(await sendPushToUser(1,{title:'Never send',body:'Test'})).toEqual({delivered:false,recipientCount:0});
  expect(await sendExpoPushDestination('ExponentPushToken[held]',{title:'Never send',body:'Test'})).toMatchObject({status:'failed',errorCode:'company_notification_hold'});
  expect(await sendGateAlertPush({id:1,userId:1,type:'gate_closed',title:'Never send',body:null,link:'/gate'},1)).toMatchObject({status:'skipped',errorCode:'company_notification_hold'});expect(fetch).not.toHaveBeenCalled();
 });
 it('blocks all urgent channel/retry recipients and live notification email without changing opt-ins or tokens',async()=>{
  expect(await loadGateAlertRecipient(1)).toBeNull();await expect(sendNotificationAlertEmail({to:'held@example.invalid',title:'Never send',body:'Test',category:'safety',type:'gate_closed'})).rejects.toThrow('company_notification_hold');expect(Number((await io.client!.query('SELECT count(*) FROM field_push_tokens')).rows[0].count)).toBe(2);
 });
 it('allows only the communications exception for held recipients and known devices',async()=>{
  for(const type of ['work_hub_message','work_hub_mention','work_hub_poll','work_hub_call','work_hub_voicemail','work_hub_meeting_invite','work_hub_meeting_changed','work_hub_meeting_updated']) {
   expect(await notificationCompanyHoldApplies(1,type)).toBe(false);
   expect(await notificationTokenHoldApplies('ExponentPushToken[held]',type)).toBe(false);
   expect(await notificationEmailHoldApplies('HELD@example.invalid',type)).toBe(false);
   expect(await notificationTokenHoldApplies('ExponentPushToken[unknown]',type)).toBe(true);
  }
  for(const type of ['gate_closed','gate_coverage_uncovered','ticket_flagged','work_hub_shift_assigned','work_hub_form_campaign','work_hub_task_assigned','work_hub_announcement','work_hub_unknown']) expect(await notificationCompanyHoldApplies(1,type)).toBe(true);
 });
});
