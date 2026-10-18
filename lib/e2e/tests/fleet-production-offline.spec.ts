import {test,expect,type Page} from "@playwright/test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {provisionFleetOfflineFixture} from "../helpers/fleet-offline";
import {createPool} from "../helpers/db";
import {login} from "../helpers/auth";

test.skip(!["1","reuse"].includes(process.env.E2E_PRODUCTION_PREVIEW??""),"Requires the isolated production preview for a real offline reload");

test("production Fleet boots offline, captures a new ticket and photo, then reconciles once after a lost response",async({browser,baseURL},testInfo)=>{
 test.setTimeout(120000);
 const profile=await mkdtemp(join(tmpdir(),"vndrly-fleet-production-")),fixture=await provisionFleetOfflineFixture();
 const launch=async()=>{const owned=await browser.browserType().launchPersistentContext(profile,{headless:true,...testInfo.project.use.launchOptions});owned.setDefaultTimeout(15000);return owned;};
 let context=await launch();
 const form=async(page:Page)=>{
  await page.getByRole("combobox",{name:"Resource pool",exact:true}).selectOption(fixture.group);
  await page.getByRole("button",{name:"Create run",exact:true}).click();
  await page.getByLabel("Run title",{exact:true}).fill("Synthetic offline commercial run");
  await page.getByLabel("Saved Detail",{exact:true}).selectOption(fixture.detail);
  const physical=page.getByRole("button",{name:"Use Origins and Destinations",exact:true});if(await physical.count())await physical.click();
  await page.getByLabel("Billing site",{exact:true}).selectOption(String(fixture.site));
  await page.getByLabel("Origin",{exact:true}).selectOption(fixture.origin);
  await page.getByLabel("Destination",{exact:true}).selectOption(fixture.destination);
  await page.getByLabel("AFE",{exact:true}).fill("AFE1");
  await page.getByLabel("Billing service").selectOption(String(fixture.service));
  await expect(page.getByRole("button",{name:"Save exact change",exact:true})).toBeEnabled();
 };
 try{
  let page=await context.newPage();await login(page,fixture);await page.goto(`${baseURL}/fleet`);
  await expect(page.getByRole("heading",{name:"Fleet Dispatch",exact:true})).toBeVisible();
  expect((await context.request.get(`${baseURL}/api/fleet/resources`)).status()).toBe(200);
  await expect(page.getByRole("button",{name:"Prepare this browser for offline Fleet work",exact:true})).toBeVisible();
  expect(await page.locator('script[src^="/assets/"]').count()).toBeGreaterThan(0);
  // Grant the real Chromium durable-storage permission in this synthetic
  // profile; never replace navigator.storage or the application storage APIs.
  const cdp=await context.newCDPSession(page);await cdp.send("Browser.grantPermissions",{origin:baseURL,permissions:["durableStorage"]});
  await form(page);
  await page.getByRole("button",{name:"Prepare this browser for offline Fleet work",exact:true}).click();
  await expect(page.getByText("Fleet offline reload provisioned for this original account. Server permissions are rechecked at synchronization.",{exact:true})).toBeVisible({timeout:45000});
  expect(await page.evaluate(()=>navigator.storage.persisted())).toBe(true);
  await context.close();context=await launch();await context.setOffline(true);page=await context.newPage();await page.goto(`${baseURL}/fleet`,{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("heading",{name:"Fleet Dispatch",exact:true})).toBeVisible();
  await expect(page.getByText(/Offline original workspace/)).toBeVisible();
  await expect(page.getByRole("link",{name:"Fleet Dispatch",exact:true})).toBeVisible();
  await form(page);await page.getByRole("button",{name:"Save exact change",exact:true}).click();
  await expect(page.getByText(/Local ticket.*pending sync/).first()).toBeVisible();
  await page.getByText("Loads, inspections & fuel records",{exact:true}).click();
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=","base64");
  await page.getByLabel("Retain Fleet evidence file").setInputFiles({name:"synthetic-vehicle.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"Save photo on this device",exact:true}).click();
  await expect(page.getByText(/Saved on this device — photo pending sync/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("offline-captured.png"),fullPage:true});
  await context.close();context=await launch();await context.setOffline(true);page=await context.newPage();await page.goto(`${baseURL}/fleet`,{waitUntil:"domcontentloaded"});
  await expect(page.getByText(/1 pending evidence/).first()).toBeVisible();
  let lost=false;
  await context.route("**/api/fleet/work/commands",async route=>{const command=route.request().postDataJSON();if(!lost&&command.kind==="activity.create"){lost=true;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort("failed");}else await route.continue();});
  await context.setOffline(false);
  const settled=page.getByText("0 pending sync · 0 needing office reconciliation · 0 pending evidence",{exact:true});
  await expect.poll(async()=>{await page.getByRole("button",{name:"Verify and synchronize retained work",exact:true}).click();return settled.count();},{timeout:45000,intervals:[1000,2000,4000]}).toBe(1);expect(lost).toBe(true);
  await context.setOffline(true);await context.setOffline(false);await page.getByRole("button",{name:"Verify and synchronize retained work",exact:true}).click();await expect(settled).toBeVisible();
  const db=createPool();try{
   const tickets=await db.query("SELECT id FROM tickets WHERE vendor_id=$1",[fixture.vendor]);expect(tickets.rows).toHaveLength(1);
   const runs=await db.query("SELECT DISTINCT target_id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run'",[fixture.vendor]);expect(runs.rows).toHaveLength(1);
   const evidence=await db.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence'",[fixture.vendor]);expect(evidence.rows).toHaveLength(1);expect(evidence.rows[0].tool_output.record.size).toBe(png.length);expect(evidence.rows[0].tool_output.record.sha256).toBe(createHash("sha256").update(png).digest("hex"));
  }finally{await db.end();}
  const cached=await page.evaluate(async()=>{const names=await caches.keys();return (await Promise.all(names.filter(name=>name.includes("fleet")).map(async name=>(await (await caches.open(name)).keys()).map(request=>new URL(request.url).pathname)))).flat();});
  expect(cached.some(path=>path.startsWith("/api/")||path.startsWith("/objects/"))).toBe(false);
  await page.screenshot({path:testInfo.outputPath("canonical-reconciled.png"),fullPage:true});
 }finally{await context.close();}
});
