import {readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {createPool,makeStamp} from '../helpers/db';
import {createVendorActor,createVendorMember} from '../helpers/implementation-a';
import {createPartner,createSiteLocation} from '../helpers/fixtures';
import {loginAsVendor} from '../helpers/auth';
test('My Watch confirms a personal scheduled watch and escalates a short-notice conflict without ending duty',async({page})=>{
  test.setTimeout(120000);const pool=createPool();
  try{
    await pool.query(await readFile(new URL('../../db/drizzle/gate_change_over.sql',import.meta.url),'utf8'));
    const stamp=makeStamp(),scheduler=await createVendorActor(pool,'Watch scheduler'),worker=await createVendorMember(pool,scheduler.vendorId,'Scheduled gatekeeper'),office=await createVendorMember(pool,scheduler.vendorId,'Coverage office');
    for(const [person,role] of [[worker,'gatekeeper'],[office,'office']] as const){
      const vp=(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$3,$3,$4) RETURNING id",[person.vendorId,person.userId,role,person.username])).rows[0].id;
      await pool.query("UPDATE user_org_memberships SET vendor_people_id=$1 WHERE user_id=$2 AND vendor_id=$3",[vp,person.userId,person.vendorId]);
    }
    const partner=await createPartner(pool,{name:`Schedule partner ${stamp}`,contactName:'Fixture',contactEmail:`${stamp}@example.invalid`});
    const site=await createSiteLocation(pool,{partnerId:partner.id,name:`Antelope schedule ${stamp}`,address:'Fixture',latitude:30,longitude:-100,siteCode:stamp,siteRadiusMeters:100});
    const work=(await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",[stamp])).rows[0].id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",[site.id,work,scheduler.vendorId]);
    const gate=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Main Gate') RETURNING id",[site.id])).rows[0].id;
    const shifts=[];
    for(const hours of [6,48]){
      const start=new Date(Date.now()+hours*3600000),end=new Date(+start+12*3600000);
      const id=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Relief watch',$2,$3,'America/Chicago',$4,$5,$6) RETURNING id",[scheduler.vendorId,start,end,scheduler.userId,site.id,gate])).rows[0].id;
      await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id) VALUES($1,$2,$3)",[id,worker.userId,scheduler.userId]);shifts.push(id);
    }
    await loginAsVendor(page,worker);await page.goto(`/gate/change-over?siteId=${site.id}&stationId=${gate}`);
    const panel=page.locator('.gate-my-watch-schedule');await panel.locator('summary').click();
    await expect(panel.locator('article')).toHaveCount(2);
    await panel.getByRole('button',{name:'Confirm',exact:true}).first().click();
    await expect(panel.getByText('Watch confirmed. Scheduler notified.',{exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Conflict',exact:true}).first().click();
    await panel.getByRole('textbox',{name:'Scheduling conflict',exact:true}).fill('Personal schedule conflict');
    await panel.getByRole('button',{name:'Report conflict',exact:true}).click();
    await expect(panel.getByText('Conflict recorded. Scheduler and office/admin notified for urgent coverage.',{exact:true})).toBeVisible();
    expect((await pool.query("SELECT user_id FROM notifications WHERE type='gate_watch_conflict_urgent' AND link=$1 ORDER BY user_id",[`/work-hub/calendar?shift=${shifts[0]}`])).rows.map(r=>r.user_id).sort()).toEqual([scheduler.userId,office.userId].sort());
    expect((await pool.query("SELECT status FROM work_hub_shift_assignments WHERE shift_id=$1 AND user_id=$2",[shifts[0],worker.userId])).rows[0].status).toBe('accepted');
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shifts WHERE station_id=$1",[gate])).rows[0].n).toBe(0);
    await page.screenshot({path:'.local/releases/my-watch-schedule-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.reload();
    await expect(page.locator('aside')).not.toBeInViewport();
    await panel.locator('summary').click();await expect(panel.locator('article')).toHaveCount(2);
    await page.screenshot({path:'.local/releases/my-watch-schedule-phone.png',fullPage:true});
  }finally{await pool.end();}
});
