import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, db, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { assertFreshLocalTestDatabaseEnvironment } from '../../../../scripts/fresh-test-database.mjs';
import { resolveContext } from './auth';
import { buildTestCookie } from '../test-utils/session';
import visits from './visits';
import movements from './gateChangeOver';
import trips from './implementationATrips';
import { databaseFieldTripRepository } from '../services/field-trip-database-repository';
import { finalizeFastPassCrossing } from '../services/fast-pass';

// No authorization, session, database, or movement-service mocks. Every request
// uses a signed session resolved from a distinct real company person.
const app=express().use(express.json()).use(cookieParser()).use('/api',visits).use('/api',movements).use('/api',trips);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??500).json({message:error.message}));
const isolated=process.env.VNDRLY_TEST_DB_MODE==='fresh-local'&&process.env.VNDRLY_ISOLATED_TEST_DB==='1';
describe.skipIf(!isolated)('MidCon authorized gatekeepers · PostgreSQL and HTTP acceptance',()=>{
 let site:number,hostPartner:number,company:number,outer:string,inner:string,parallel:string,cookies:string[],actors:number[];
 const tag=randomUUID();
 beforeAll(async()=>{
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const partner=(await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",[`MidCon acceptance ${tag}`,`${tag}@example.invalid`])).rows[0].id;
  hostPartner=partner;
  const vendor=(await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",[`Gate acceptance ${tag}`,`${tag}@example.invalid`])).rows[0].id;
  company=vendor;
  await pool.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')",[partner,vendor]);
  site=(await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Synthetic local test',31,-102,$3) RETURNING id",[partner,`MidCon ${tag}`,tag])).rows[0].id;
  const work=(await pool.query("INSERT INTO work_types(name,category) VALUES($1,'Gate') RETURNING id",[`Gate ${tag}`])).rows[0].id;
  await pool.query('INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)',[site,work,vendor]);
  cookies=[];actors=[];
  for(let index=0;index<3;index++){
   const id=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'synthetic','vendor',$2) RETURNING id",[`${tag}-${index}`,`Acceptance Gatekeeper ${index}`])).rows[0].id;
   const person=(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$4,'Synthetic',$3) RETURNING id",[vendor,id,`${tag}-${index}@example.invalid`,index<2?'gatekeeper':'office'])).rows[0].id;
   await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3)",[id,vendor,person]);
   if(index<2){
    await pool.query("INSERT INTO vendor_person_operational_roles(vendor_people_id,role) VALUES($1,'gatekeeper')",[person]);
    await pool.query('INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id) VALUES($1,$2)',[person,site]);
   }
   const [user]=await db.select().from(usersTable).where(eq(usersTable.id,id));
   cookies.push(buildTestCookie({...await resolveContext(user!),userId:id,sv:1}));actors.push(id);
  }
  outer=randomUUID();inner=randomUUID();parallel=randomUUID();
  for(const [id,name,topology] of [[outer,'Warwick Completions 1',{kind:'independent',area:'',parentGateId:null,parallelGateId:null}],[inner,'Warwick Roman Completions 2',{kind:'series',area:'Roman Completions',parentGateId:outer,parallelGateId:null}],[parallel,'Warwick Completions alternate',{kind:'parallel',area:'',parentGateId:null,parallelGateId:outer}]] as const){
   await pool.query('INSERT INTO gate_stations(id,site_id,name,topology,latitude,longitude) VALUES($1,$2,$3,$4,31,-102)',[id,site,name,JSON.stringify(topology)]);
  }
  await pool.query('INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2),($3,$4)',[outer,actors[0],inner,actors[1]]);
 });
 const get=async(actor=0)=>{const response=await request(app).get(`/api/gate-change-over/movements?siteId=${site}`).set('Cookie',cookies[actor]);expect(response.status,JSON.stringify(response.body)).toBe(200);return response.body;};
 const checkIn=async(label:string,gate=outer,actor=0)=>{const response=await request(app).post('/api/visits/gate/check-in').set('Cookie',cookies[actor]).send({firstName:label,lastName:tag,vehiclePlate:`T${randomUUID().replaceAll('-','').slice(0,6).toUpperCase()}`,siteLocationId:site,gateStationId:gate,latitude:31,longitude:-102});expect(response.status,JSON.stringify(response.body)).toBe(201);return response.body.id as number;};
 const move=(id:number,gateId:string,kind:string,extra={},actor=1)=>request(app).post('/api/gate-change-over/movements').set('Cookie',cookies[actor]).send({siteId:site,visitId:id,gateId,kind,operationId:randomUUID(),...extra});
 const checkout=(id:number,gate=outer,actor=0)=>request(app).post(`/api/visits/gate/${id}/check-out`).set('Cookie',cookies[actor]).send({gateStationId:gate,latitude:31,longitude:-102});
 const row=async(id:number,actor=0)=>(await get(actor)).visits.find((v:any)=>v.id===id);
 it('normal series journey defaults the sole child and records gate, actor, time and one visit',async()=>{
  const id=await checkIn('Normal');expect((await row(id)).presence).toMatchObject({expectedGateId:inner,currentGateId:outer});
  expect((await move(id,inner,'enter')).status).toBe(200);expect((await row(id,1)).presence).toMatchObject({currentGateId:inner,expectedGateId:null});
  expect((await checkout(id)).status).toBe(409);
  expect((await move(id,inner,'leave',{destination:'site_exit'})).status).toBe(200);expect((await row(id)).presence.expectedSiteExit).toBe(true);
  expect((await checkout(id)).status).toBe(200);const saved=await row(id);expect(saved.checkOutTime).toBeTruthy();expect(saved.presence.expectedSiteExit).toBe(false);
  expect(saved.movements.map((m:any)=>m.kind)).toEqual(['enter','route','enter','leave','site_exit']);
  expect(saved.movements.map((m:any)=>m.actorId)).toEqual([actors[0],actors[0],actors[1],actors[1],actors[0]]);
  for(const m of saved.movements){expect(m.gateId).toBeTruthy();expect(m.gateName).toBeTruthy();expect(m.actorName).toMatch(/Acceptance Gatekeeper/);expect(Number.isFinite(Date.parse(m.at))).toBe(true);}
  expect((await get()).visits.filter((v:any)=>v.id===id)).toHaveLength(1);
 });
 it('browsing another gate never grants crossing authority',async()=>{
  const response=await request(app).post('/api/visits/gate/check-in').set('Cookie',cookies[0]).send({firstName:'Wrong gate',lastName:tag,siteLocationId:site,gateStationId:inner});
  expect(response.status).toBe(403);
 });
 it('early turnaround clears the expected inner arrival and retains its audit note',async()=>{
  const id=await checkIn('Turnaround');expect((await checkout(id)).status).toBe(200);const saved=await row(id);expect(saved.checkOutTime).toBeTruthy();expect(saved.presence.expectedGateId).toBeNull();expect(saved.movements.at(-1).note).toBe('Exited before inner arrival');expect((await move(id,inner,'enter')).status).toBe(409);
 });
 it('serializes simultaneous inner arrival and outer checkout without closing secure presence',async()=>{
  for(let attempt=0;attempt<4;attempt++){
   const id=await checkIn(`Race${attempt}`);const results=await Promise.all([move(id,inner,'enter'),checkout(id)]);
   expect(results.map(r=>r.status).sort(),JSON.stringify(results.map(r=>r.body))).toEqual([200,409]);const saved=await row(id);
   if(results[0].status===200){expect(saved.checkOutTime).toBeNull();expect(saved.presence.currentGateId).toBe(inner);}else{expect(saved.checkOutTime).toBeTruthy();expect(saved.presence.currentGateId).toBeNull();}
  }
 });
 it('returning to the inner gate cancels pending outer departure on the existing visit',async()=>{
  const id=await checkIn('Return');expect((await move(id,inner,'enter')).status).toBe(200);expect((await move(id,inner,'leave',{destination:'site_exit'})).status).toBe(200);expect((await row(id)).presence.expectedSiteExit).toBe(true);
  expect((await move(id,inner,'enter')).status).toBe(200);const saved=await row(id);expect(saved.checkOutTime).toBeNull();expect(saved.presence).toMatchObject({currentGateId:inner,expectedSiteExit:false});expect((await checkout(id)).status).toBe(409);
 });
 it('records a missed outer check-in at the actual inner gate with a review note', async () => {
  const id = await checkIn('Missed outer', inner, 1);
  const saved = await row(id, 1);
  expect(saved.presence).toMatchObject({ currentGateId: inner, expectedGateId: null });
  expect(saved.movements).toEqual([expect.objectContaining({ gateId: inner, kind: 'enter', note: 'Outer perimeter check-in missed' })]);
 });
 it('edits the five Gate details and undoes the recorded checkout with an audit trail', async () => {
  const id = await checkIn('Original');
  const original = await row(id);
  expect((await checkout(id)).status).toBe(200);
  const departure = await row(id);
  const correction = (action: string, fields: object, op = randomUUID()) => request(app)
    .post('/api/gate-change-over/visit-corrections').set('Cookie', cookies[0])
    .send({ siteId: site, gateId: outer, visitId: id, operationId: op, action, ...fields });
  const edit = await correction('edit', { details: { firstName: 'Corrected', lastName: 'Driver', company: 'Test Trucking', vehiclePlate: 'FIX123', plateState: 'Oklahoma' } });
  expect(edit.status, JSON.stringify(edit.body)).toBe(200);
  expect(await row(id)).toMatchObject({ firstName: 'Corrected', vehiclePlate: 'FIX123', plateState: 'OK', checkInTime: original.checkInTime, checkOutTime: departure.checkOutTime });
  expect((await correction('undo-checkout', { expectedCheckoutAt: new Date(0).toISOString() })).status).toBe(409);
  const operationId = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    const undo = await correction('undo-checkout', { expectedCheckoutAt: departure.checkOutTime }, operationId);
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
  }
  const restored = await row(id);
  expect(restored).toMatchObject({ checkInTime: original.checkInTime, checkOutTime: null, presence: { currentGateId: outer, expectedGateId: inner } });
  expect(restored.movements.map((movement: { kind: string }) => movement.kind)).toEqual(['enter', 'route', 'site_exit', 'edit', 'undo_site_exit']);
 });
 it('Fast Pass keeps clearance pending until GPS arrival, then records the visit and exit', async () => {
  const owner = { type: 'vendor' as const, id: company };
  const vehicle = (await pool.query("INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id) VALUES('Truck 18','truck','Test','vendor',$1) RETURNING id", [company])).rows[0].id;
  const vehiclePlate = "F" + randomUUID().slice(0, 7).toUpperCase();
  await pool.query("INSERT INTO asset_aliases(asset_id,kind,jurisdiction,normalized_value,display_value) VALUES($1,'plate','OK',$2,$2)", [vehicle, vehiclePlate]);
  const options = await request(app).get('/api/implementation-a/fast-pass/options').set('Cookie', cookies[0]);
  expect(options.status, JSON.stringify(options.body)).toBe(200);
  expect(options.body.vehicles).toContainEqual(expect.objectContaining({ id: vehicle, vehiclePlate, plateState: 'OK' }));
  expect(options.body.sites).toContainEqual(expect.objectContaining({ id: site }));
  const identity = { firstName: 'John', lastName: 'Test', company: 'Test Trucking', vehiclePlate, plateState: 'Oklahoma' };
  const deviceId = randomUUID(), operationId = randomUUID();
  await pool.query('INSERT INTO location_consents(user_id,device_id) VALUES($1,$2)', [actors[0], deviceId]);
  const start = (device: string, operation = operationId) => request(app)
    .post('/api/implementation-a/trips').set('Cookie', cookies[0]).set('x-vndrly-device-id', device)
    .send({ operationId: operation, owner, driverUserId: actors[0], vehicleAssetId: vehicle,
      siteLocationId: site, destinationSource: 'confirmed', fastPass: { identity, destinationId: null } });
  expect((await start(randomUUID())).status).toBe(403);
  const started = await start(deviceId);
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const trip = started.body;
  expect((await start(deviceId)).body.id).toBe(trip.id);
  expect((await start(deviceId, randomUUID())).status).toBe(409);
  await pool.query(`UPDATE field_trips SET last_recorded_at=now(),last_latitude=31,last_longitude=-102,
    fast_pass=fast_pass || $2::jsonb WHERE id=$1`, [trip.id, JSON.stringify({ etaAt: new Date().toISOString(), arrivalEtaMinutes: 8 })]);
  const gateApi = '/api/implementation-a/fast-pass/gate';
  const pending = await request(app).get(gateApi + '?siteId=' + site).set('Cookie', cookies[0]);
  expect(pending.status, JSON.stringify(pending.body)).toBe(200);
  expect(pending.body.trips).toContainEqual(expect.objectContaining({ id: trip.id, presenceState: 'en_route', fastPass: expect.objectContaining({ identity: { ...identity, plateState: 'OK' } }) }));
  const approval = await request(app).post(gateApi + '/' + trip.id).set('Cookie', cookies[0]).send({ siteId: site, gateId: outer });
  expect(approval.status, JSON.stringify(approval.body)).toBe(200);
  expect(approval.body.clearance).toMatchObject({ gateId: outer, approvedBy: actors[0] });
  const approved = (await databaseFieldTripRepository.get(trip.id))!;
  expect(approved.finalVisitId).toBeNull();
  const crossingAt = new Date(Date.now() + 1000);
  const fixtureSite = { id: site, name: 'Deep Fork', latitude: 31, longitude: -102, siteRadiusMeters: 805 };
  const point = { id: randomUUID(), tripId: trip.id, latitude: 31, longitude: -102, accuracyMeters: 5, speedMps: 3,
    recordedAt: crossingAt, createdAt: crossingAt, distanceToSiteMeters: 800, reliable: true };
  const entry = await finalizeFastPassCrossing(approved, fixtureSite, [point], { kind: 'entry', crossedAt: crossingAt, confirmedAt: crossingAt });
  expect(entry?.visitId).toBeTypeOf('number');
  expect(await row(entry!.visitId!)).toMatchObject({ firstName: 'John', lastName: 'Test', vehiclePlate, plateState: 'OK', checkOutTime: null });
  const exit = await request(app).post('/api/implementation-a/fast-pass/' + trip.id + '/checkout').set('Cookie', cookies[0]);
  expect(exit.status, JSON.stringify(exit.body)).toBe(200);
  expect((await row(entry!.visitId!)).checkOutTime).toBeNull();
  const exitAt = new Date(+crossingAt + 1000);
  const exited = await finalizeFastPassCrossing((await databaseFieldTripRepository.get(trip.id))!, fixtureSite,
    [{ ...point, recordedAt: exitAt }], { kind: 'exit', crossedAt: exitAt, confirmedAt: exitAt });
  expect(exited?.visitId).toBe(entry?.visitId);
  const history = await request(app).get('/api/implementation-a/fast-pass/history').set('Cookie', cookies[0]);
  expect(history.status, JSON.stringify(history.body)).toBe(200);
  expect(history.body.trips).toContainEqual(expect.objectContaining({ id: trip.id, visitId: entry?.visitId, checkInTime: crossingAt.toISOString(), checkOutTime: exitAt.toISOString() }));
 });
 it('parallel outer gates retain one active visit and permit alternate outer checkout',async()=>{
  await pool.query('UPDATE gate_shifts SET station_id=$1 WHERE operator_id=$2 AND ended_at IS NULL',[parallel,actors[1]]);
  const id=await checkIn('Parallel');const saved=await row(id);const plate=(await pool.query('SELECT vehicle_plate FROM site_visits WHERE id=$1',[id])).rows[0].vehicle_plate;
  const duplicate=await request(app).post('/api/visits/gate/check-in').set('Cookie',cookies[1]).send({firstName:'Parallel',lastName:tag,vehiclePlate:plate,siteLocationId:site,gateStationId:parallel,latitude:31,longitude:-102});
  expect([200,409]).toContain(duplicate.status);if(duplicate.status===200)expect(duplicate.body.id).toBe(id);expect((await get(1)).visits.filter((v:any)=>v.vehiclePlate===plate)).toHaveLength(1);expect(saved.id).toBe(id);expect((await checkout(id,parallel,1)).status).toBe(200);expect((await row(id)).movements.at(-1).gateId).toBe(parallel);
 });
 it('keeps series visits open when a geofence exit is observed',async()=>{
  const id=await checkIn('GPS observation');const plate=(await pool.query('SELECT vehicle_plate FROM site_visits WHERE id=$1',[id])).rows[0].vehicle_plate;
  const response=await request(app).post('/api/visits/gate/observations').set('Cookie',cookies[0]).send({siteLocationId:site,direction:'exit',source:'geofence',observedAt:new Date().toISOString(),plate});
  expect(response.status,JSON.stringify(response.body)).toBe(201);const saved=await row(id);expect(saved.checkOutTime).toBeNull();expect(saved.presence.expectedGateId).toBe(inner);
  const facts=(await pool.query('SELECT observed_departure_at,reconciliation_state FROM site_visits WHERE id=$1',[id])).rows[0];expect(facts.observed_departure_at).toBeTruthy();expect(facts.reconciliation_state).toBe('needs_review');
 });
 it('requires outer checkout before a guest can close or replace their series visit',async()=>{
  const jti=randomUUID(),expires=Date.now()+3600000;
  const guest=(await pool.query("INSERT INTO guest_sessions(token_jti,first_name,last_name,expires_at) VALUES($1,'Guest',$2,$3) RETURNING id",[jti,tag,new Date(expires)])).rows[0].id;
  const id=(await pool.query("INSERT INTO site_visits(site_location_id,gate_station_id,guest_session_id,first_name,last_name,host_type,admission_status) VALUES($1,$2,$3,'Guest',$4,'partner','admitted') RETURNING id",[site,outer,guest,tag])).rows[0].id;
  const guestCookie=buildTestCookie({jti,guestSessionId:guest,role:'guest'},{cookieName:'vndrly_guest',exp:expires});
  const exit=await request(app).post(`/api/visits/${id}/check-out`).set('Cookie',guestCookie).send({latitude:31,longitude:-102});expect(exit.status,JSON.stringify(exit.body)).toBe(409);
  const enter=await request(app).post('/api/visits/check-in').set('Cookie',guestCookie).send({siteLocationId:site,hostType:'partner',hostPartnerId:hostPartner,latitude:31,longitude:-102});expect(enter.status,JSON.stringify(enter.body)).toBe(409);
  expect((await row(id)).checkOutTime).toBeNull();expect((await pool.query('SELECT id FROM site_visits WHERE guest_session_id=$1',[guest])).rows).toHaveLength(1);
 });
 it('rejects a real company member without normalized gate/site grants',async()=>{
  const response=await request(app).get(`/api/gate-change-over/movements?siteId=${site}`).set('Cookie',cookies[2]);expect(response.status,JSON.stringify(response.body)).toBe(403);
 });
});
