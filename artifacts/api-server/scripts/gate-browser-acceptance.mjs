import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {pool,db,usersTable} from '@workspace/db';
import {eq} from 'drizzle-orm';
import {resolveContext} from '../src/routes/auth.ts';
import {buildTestCookie} from '../src/test-utils/session.ts';
import {createRequire} from 'node:module';
const {chromium,expect:rawExpect}=createRequire(new URL('../../../lib/e2e/package.json',import.meta.url))('@playwright/test');
import {assertFreshLocalTestDatabaseEnvironment} from '../../../scripts/fresh-test-database.mjs';
assertFreshLocalTestDatabaseEnvironment(process.env);
const expect=rawExpect.configure({timeout:30000});
const base='http://127.0.0.1:15173';
const out=new URL('../.local/gate-browser',import.meta.url).pathname;await mkdir(out,{recursive:true});
console.log('browser fixture query');
const source=(await pool.query("SELECT s.id,s.partner_id,a.vendor_id,a.work_type_id FROM site_locations s JOIN site_work_assignments a ON a.site_location_id=s.id WHERE s.name LIKE 'MidCon %' ORDER BY s.id DESC LIMIT 1")).rows[0];
const tag=randomUUID();
const fixture=(await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Isolated browser acceptance',31,-102,$3) RETURNING id,site_code",[source.partner_id,`Browser MidCon ${tag}`,tag])).rows[0];
await pool.query('INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)',[fixture.id,source.work_type_id,source.vendor_id]);
const outer={id:randomUUID(),name:'Warwick Completions 1'},inner={id:randomUUID(),name:'Warwick Roman Completions 2'};
for(const gate of [outer,inner])await pool.query('INSERT INTO gate_stations(id,site_id,name,latitude,longitude,topology) VALUES($1,$2,$3,31,-102,$4)',[gate.id,fixture.id,gate.name,JSON.stringify(gate===outer?{kind:'independent',area:'',parentGateId:null,parallelGateId:null}:{kind:'series',area:'Roman Completions',parentGateId:outer.id,parallelGateId:null})]);
const people=(await pool.query("SELECT u.id,p.id AS person_id FROM users u JOIN vendor_people p ON p.user_id=u.id WHERE p.vendor_id=$1 AND p.vendor_role='gatekeeper' ORDER BY u.id LIMIT 2",[source.vendor_id])).rows;
for(const person of people)await pool.query('INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id) VALUES($1,$2)',[person.person_id,fixture.id]);
console.log('fixture selected',fixture.id);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const pages=[];const errors=[];
for(const person of people){
 console.log('actor context',person.id);
 const [user]=await db.select().from(usersTable).where(eq(usersTable.id,person.id));const context=await resolveContext(user);const cookie=buildTestCookie({...context,userId:person.id,sv:1}).slice('vndrly_session='.length);
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},geolocation:{latitude:31,longitude:-102},permissions:['geolocation']});await ctx.addCookies([{name:'vndrly_session',value:cookie,url:base}]);
 const page=await ctx.newPage();page.on('pageerror',(e)=>errors.push(e.message));console.log('opening gate',person.id);await page.goto(base+'/gate');console.log('gate loaded',await page.title());await page.getByTestId('gatekeeper-page').waitFor({timeout:30000});pages.push(page);
}
await pages[0].getByTestId('select-gate-current-location').focus();await pages[0].getByTestId('select-gate-current-location').selectOption(outer.id);await pages[1].getByTestId('select-gate-current-location').focus();await pages[1].getByTestId('select-gate-current-location').selectOption(inner.id);
process.on('uncaughtException',async error=>{console.error(error);for(const [index,page] of pages.entries()){await page.screenshot({path:out+`/failure-${index}.png`,fullPage:true}).catch(()=>{});await writeFile(out+`/failure-${index}.txt`,await page.locator('body').innerText()).catch(()=>{});}await browser.close();await pool.end();process.exit(1);});
const [outside,inside]=pages;
const records=[];
async function capture(name,page){await page.screenshot({path:out+'/'+name+'.png',fullPage:true});records.push({step:name,text:await page.locator('body').innerText()});}
async function refresh(page){await page.getByTestId('button-gate-refresh').click();}
async function tab(page,name){await page.getByRole('button',{name:new RegExp('^'+name+'(?: \\(\\d+\\))?$')}).click();await refresh(page);}
const article=(page,name)=>page.locator('article').filter({has:page.locator('strong',{hasText:name})});
async function checkIn(label){
 await tab(outside,'On Site');await outside.getByTestId('input-gate-plate').fill('B'+randomUUID().replaceAll('-','').slice(0,6).toUpperCase());await outside.getByTestId('input-gate-first-name').fill(label);await outside.getByTestId('input-gate-last-name').fill('Browser');
 await expect(outside.getByText('Expected destination',{exact:true})).toHaveCount(0);
 const saved=outside.waitForResponse((r)=>r.url().endsWith('/api/visits/gate/check-in')&&r.request().method()==='POST');await outside.getByTestId('button-gate-check-in').click();const response=await saved;expect(response.status(),await response.text()).toBe(201);return (await response.json()).id;
}
async function confirm(name){await tab(inside,'Arrivals');const row=article(inside,name);await expect(row).toBeVisible();await expect(row).toHaveClass(/gate-movement-pending/);const arrivals=inside.getByRole('button',{name:/^Arrivals/});await expect(arrivals).toHaveClass(/gate-arrivals-alert/);expect(await arrivals.evaluate((el)=>getComputedStyle(el).animationIterationCount)).toBe('infinite');await row.getByRole('button',{name:'Confirm arrival',exact:true}).click();await expect(row).not.toHaveClass(/gate-movement-pending/);await expect(arrivals).not.toHaveClass(/gate-arrivals-alert/);}
async function innerCheckout(name){await tab(inside,'On Site');const row=article(inside,name);await expect(row).toBeVisible();await row.getByRole('button',{name:'Check out',exact:true}).click();await expect(row).toHaveCount(0);await tab(inside,'Departures');await expect(article(inside,name)).not.toHaveClass(/gate-movement-pending/);}
async function outerCheckout(name,pending=true){await tab(outside,pending?'Departures':'On Site');const row=article(outside,name);await expect(row).toBeVisible();if(pending)await expect(row).toHaveClass(/gate-movement-pending/);await row.getByRole('button',{name:'Check out',exact:true}).click();await tab(outside,'Departures');await expect(article(outside,name)).not.toHaveClass(/gate-movement-pending/);await expect(outside.getByRole('button',{name:/^Departures/})).not.toHaveClass(/gate-arrivals-alert/);}
const normal='Normal'+tag.slice(0,6);const normalId=await checkIn(normal);await capture('01-outer-checked-in',outside);
const map=await outside.context().newPage();await map.goto(base+'/gate/map');await map.getByTestId('select-gate-map-location').selectOption(inner.id);await expect(map.getByText('Gate-confirmed locations · not live GPS')).toBeVisible();await expect(map.getByText('Last confirmed location: Warwick Completions 1')).toBeVisible();await expect(map.getByText('Intended destination: Roman Completions')).toBeVisible();await map.getByText('Gate-confirmed locations · not live GPS').scrollIntoViewIfNeeded();await capture('02-map-intended-arrival',map);
await confirm(normal);await capture('03-inner-arrival-confirmed',inside);await innerCheckout(normal);await capture('04-inner-departure-neutral',inside);await outerCheckout(normal);await capture('05-outer-departure-completed',outside);
const turnaround='Turnaround'+tag.slice(0,6);const turnaroundId=await checkIn(turnaround);await outerCheckout(turnaround,false);await capture('06-early-turnaround',outside);
const returning='Return'+tag.slice(0,6);const returnId=await checkIn(returning);await confirm(returning);await innerCheckout(returning);await tab(outside,'Departures');await expect(article(outside,returning)).toHaveClass(/gate-movement-pending/);
await tab(inside,'Arrivals');await inside.getByRole('button',{name:/Find someone already on site/}).click();await article(inside,returning).getByRole('button',{name:'Confirm arrival',exact:true}).click();await tab(inside,'On Site');await expect(article(inside,returning)).toBeVisible();await tab(outside,'Departures');await expect(article(outside,returning)).toHaveCount(0);await expect(outside.getByRole('button',{name:/^Departures/})).not.toHaveClass(/gate-arrivals-alert/);await capture('07-return-cancels-outer-pending',outside);
for(const [index,page] of pages.entries()){
 const log=await page.context().newPage();await log.goto(base+`/gate/history?siteId=${fixture.id}&stationId=${index?inner.id:outer.id}&recordType=all`);const normalRow=article(log,normal);await expect(normalRow).toBeVisible();await expect(normalRow.getByText(/Acceptance Gatekeeper 0/).first()).toBeVisible();await expect(normalRow.getByText(/Acceptance Gatekeeper 1/).first()).toBeVisible();await expect(normalRow.getByText(/Warwick Roman Completions 2/).first()).toBeVisible();if(!index)await expect(article(log,turnaround).getByText(/Exited before inner arrival/)).toBeVisible();await capture(`08-log-gatekeeper-${index}`,log);
}
await writeFile(out+'/evidence.json',JSON.stringify({fixture,outer,inner,actors:people,visitIds:{normalId,turnaroundId,returnId},records,errors},null,2));expect(errors).toEqual([]);console.log('PASS actual two-gatekeeper browser normal/turnaround/return, pulse, map and log',fixture.id);
await browser.close();await pool.end();
