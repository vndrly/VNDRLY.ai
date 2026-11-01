import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium,request}=createRequire(new URL('../lib/e2e/package.json',import.meta.url))('@playwright/test');
const dir=new URL('../research/safety-program/2026-10-31/library-publication/',import.meta.url);
mkdirSync(dir,{recursive:true});
// Publication verification uses authenticated Library endpoints, not browser/PIN setup.
const username='vendor_admin@fleetgo.com';
const password=readFileSync(new URL('./src/smoke-companygo-live.ts',import.meta.url),'utf8').match(/const PASSWORD = "([^"]+)"/)[1];
const browser=process.argv.includes('--ui')?await chromium.launch({channel:'chrome',headless:true}):null;
const reportName=browser?'rendered-verification.json':'api-verification.json';
const report={inspectedAt:new Date().toISOString(),environments:[]};
try{
 for(const origin of (process.argv.includes('--local-only')?['http://localhost:5173']:process.argv.includes('--live-only')?['https://vndrly.ai']:['http://localhost:5173','https://vndrly.ai'])){
  const context=browser?await browser.newContext():await request.newContext();
  const api=browser?context.request:context;
  const login=await api.post(origin+'/api/auth/login',{data:{username,password}});
  if(!login.ok())throw Error(`Authentication failed at ${origin}: ${login.status()}`);
  const listResponse=await api.get(origin+'/api/work-hub/library');
  if(!listResponse.ok())throw Error(`Library request failed at ${origin}: ${listResponse.status()}`);
  const listBody=await listResponse.json();const list=listBody.data?.items??listBody.items;
  if(!Array.isArray(list))throw Error('Unexpected Library list');
  const familyItems=list.filter(x=>/^[LHCEIR]\d{2} — /.test(x.title));
  if(familyItems.length!==236)throw Error(`${origin}: expected 236 resources, found ${familyItems.length}`);
  console.log(JSON.stringify({origin,libraryResources:familyItems.length}));
  const checked=[];
  for(const prefix of ['L01','H04','H21','C06','E02','I03','R03','R07']){
    const item=familyItems.find(x=>x.title.startsWith(prefix+' — ')&&x.title.endsWith(' — Policy'));
    const detail=await api.get(origin+'/api/work-hub/library/'+item.itemId);
    if(!detail.ok())throw Error(`${prefix} resource unavailable`);
    const b=await detail.json();const d=b.data??b;
    if(!d.metadata.content.policyText.includes('## Required practice'))throw Error(`${prefix} authored policy missing`);
    checked.push({family:prefix,id:item.itemId,kind:d.metadata.kind,authoredBody:true});
  }
  const allLinkedIds=new Set();
  for(const hub of list.filter(x=>x.title.endsWith(' — Program template'))){
    const response=await api.get(origin+'/api/work-hub/library/'+hub.itemId);
    const body=await response.json();const data=body.data??body;
    for(const match of data.metadata.content.policyText.matchAll(/https:\/\/vndrly\.ai\/work-hub\/library\/([a-f0-9-]{36})/g))allLinkedIds.add(match[1]);
  }
  if(allLinkedIds.size!==236||familyItems.some(item=>!allLinkedIds.has(item.itemId)))throw Error(`${origin}: requirement directory links incomplete`);
  const maturityResponse=await api.get(origin+'/api/safety/maturity');
  const maturityBody=maturityResponse.headers()['content-type']?.includes('application/json')?await maturityResponse.json():{};
  const maturity=maturityBody.data??maturityBody;
  const requirements=(maturity.categories??[]).flatMap(c=>c.requirements??[]);
  const links=requirements.flatMap(r=>r.resources);
  if(requirements.length!==59||links.length!==236||new Set(links.map(r=>r.id)).size!==236)throw Error(`${origin}: live requirement links incomplete`);
  const expectedTypes=['policy','form','training','evidence-examples'];
  for(const requirement of requirements)if(JSON.stringify(requirement.resources.map(r=>r.type))!==JSON.stringify(expectedTypes))throw Error(`${requirement.id}: four resource types missing`);
  const targets=requirements.flatMap(requirement=>requirement.resources.map(resource=>({requirement,resource})));
  const targetResults=[];
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<targets.length){
      const {requirement,resource}=targets[cursor++];
      const response=await api.get(origin+'/api/work-hub/library/'+resource.id);
      if(!response.ok())throw Error(`${requirement.id}/${resource.type}: HTTP ${response.status()}`);
      const b=await response.json();const detail=b.data??b;
      if(detail.metadata.safetyResource?.familyId!==requirement.id||detail.metadata.safetyResource?.resourceType!==resource.type)throw Error(`${requirement.id}/${resource.type}: resource identity mismatch`);
      if(resource.type==='form'&&!detail.metadata.content.fields.length)throw Error(`${requirement.id}: form fields missing`);
      if(resource.type==='training'&&!detail.metadata.content.training?.lessons.length)throw Error(`${requirement.id}: training lessons missing`);
      if(resource.type==='evidence-examples'&&!detail.metadata.content.policyText.includes('SYNTHETIC TRAINING EXAMPLES ONLY'))throw Error(`${requirement.id}: example label missing`);
      targetResults.push({family:requirement.id,type:resource.type,id:resource.id,status:response.status()});
    }
  }));
  const environment={origin,libraryResources:familyItems.length,linkedFamilies:59,verifiedDirectoryLinks:allLinkedIds.size,safetyPageRequirements:requirements.length,safetyPageDirectLinks:links.length,score:maturity.score,policiesRead:checked,allTargetsVerified:targetResults.sort((a,b)=>(a.family+a.type).localeCompare(b.family+b.type)),renderedPolicy:false};
  report.environments.push(environment);
  writeFileSync(new URL(reportName,dir),JSON.stringify(report,null,2));
  if(!browser){await context.dispose();continue;}
  // Optional rendered-page evidence is separate from the completed API verification.
  const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.setViewportSize({width:1440,height:1050});
  await page.goto(origin+'/safety-score');
  try { await page.getByText(`${maturity.score} / 100`,{exact:true}).first().waitFor({timeout:30000}); }
  catch(error){
    writeFileSync(new URL('browser-diagnostic.json',dir),JSON.stringify({origin,url:page.url(),body:(await page.locator('body').innerText()).slice(0,12000),pageErrors},null,2));
    await page.screenshot({path:new URL('browser-diagnostic.png',dir).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    throw error;
  }
  await page.getByRole('heading',{name:'H04 — Hazardous energy isolation / LOTO',exact:true}).waitFor();
  const hrefs=new Set(await page.locator('a[href*="/work-hub/library/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))));
  if(links.some(link=>!hrefs.has('/work-hub/library/'+link.id)))throw Error('Rendered safety page is missing requirement resource links');
  environment.renderedRequirementLinks=236;
  await page.screenshot({path:new URL(origin.includes('localhost')?'local-safety-requirements.png':'live-safety-library-links.png',dir).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:false});
  const policy=familyItems.find(x=>x.title.startsWith('H04 — ')&&x.title.endsWith(' — Policy'));
  await page.goto(origin+'/work-hub/library/'+policy.itemId);
  await page.getByText('Use an approved equipment-specific isolation plan',{exact:false}).first().waitFor({timeout:30000});
  await page.screenshot({path:new URL(origin.includes('localhost')?'local-H04-policy.png':'live-H04-policy.png',dir).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:false});
  environment.renderedPolicy=true;
  writeFileSync(new URL(reportName,dir),JSON.stringify(report,null,2));
  await context.close();
 }
 writeFileSync(new URL(reportName,dir),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();}
