/** Additive, resumable publication of the 50 VNDRLY knowledge bundles.
 * No assignments, completion records, policies or existing templates are changed.
 * Default read-only preflight. --apply publishes reviewed prepared content. */
import './load-env-local.mjs';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {LibraryDraftSchema,LibraryMetadataSchema,BundleDefinitionSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
import {safetyTrainingCatalog} from '../artifacts/api-server/src/data/safety-training-catalog.ts';
const args=new Set(process.argv.slice(2));
assert([...args].every(x=>['--apply','--first-company'].includes(x)),'Unsupported publication option');
const apply=args.has('--apply');
const manifest=JSON.parse(readFileSync('research/safety-program/certifications-50/bundle-publication.json'));
assert.equal(manifest.bundles.length,50);assert.equal(manifest.courses.length,50);
for(const c of manifest.courses)assert.equal(safetyTrainingContentHash(LibraryDraftSchema.parse(c.content)),c.contentSha256,`${c.id}: hash mismatch`);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manifestHash=sha(manifest);
const uuid=value=>{const b=createHash('sha256').update(value).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const ownerKey=o=>`${o.owner_org_type}:${o.owner_org_id}`;
const newId=(o,c)=>uuid(`vndrly:certification-50:course:${ownerKey(o)}:${c.id}:${c.sourceSha256}`);
const bundleId=(o,b)=>uuid(`vndrly:certification-50:bundle:${ownerKey(o)}:${b.id}:${sha(b)}`);
const registry=new Map(safetyTrainingCatalog.curriculum.map(c=>[c.id,c]));
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const url=new URL(process.env.DATABASE_URL??'');
assert(url.hostname==='aws-1-us-west-2.pooler.supabase.com'&&decodeURIComponent(url.username)==='postgres.bihjmgbdzbhcnsuhzzwo'&&url.pathname==='/postgres','Unexpected database target');
url.port='5432';
const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000,query_timeout:45000,statement_timeout:40000,application_name:'vndrly-certification-50'});
client.on('error',()=>{});
const report={manifestHash,mode:apply?'apply':'read-only',startedAt:new Date().toISOString(),companies:[],assignmentsCreated:0,existingTemplatesChanged:0};
const databaseContentHashes=new Map();
const checkpoint=`.local/certification-50-${manifestHash.slice(0,16)}.json`;
function save(){mkdirSync('.local',{recursive:true});writeFileSync(`${checkpoint}.tmp`,JSON.stringify(report,null,2));renameSync(`${checkpoint}.tmp`,checkpoint);}
async function summaries(o){
 // Scope with plain indexed columns before inspecting compressed JSON. A global
 // familyId JSON scan previously timed out across 76,000+ template revisions.
 return (await client.query(`WITH scoped AS MATERIALIZED (
  SELECT id,name,current_version,library_metadata,xmin::text AS row_revision FROM work_hub_form_templates
  WHERE owner_org_type=$1 AND owner_org_id=$2 AND campaign_config IS NULL)
  SELECT id,name,current_version,row_revision,library_metadata - 'content' - 'fileSnapshots' - 'trainingPolicy' AS metadata FROM scoped`,[o.owner_org_type,o.owner_org_id])).rows;
}
function makePlan(o,rows){
 const refs=new Map();
 const needed=new Set(manifest.bundles.flatMap(b=>b.courseFamilies));
 for(const family of needed){
  if(manifest.courses.some(c=>c.id===family))continue;
  const trusted=registry.get(family);assert(trusted,`No trusted source for ${family}`);
  const candidates=rows.filter(r=>r.metadata?.kind==='training'&&r.metadata.state==='published'&&r.metadata.safetyResource?.familyId===family&&r.metadata.safetyResource.sourceSha256===trusted.sourceSha256);
  assert(candidates.length,`${ownerKey(o)}: no current trusted ${family}; preserve existing data`);
  candidates.sort((a,b)=>b.current_version-a.current_version||a.id.localeCompare(b.id));
  const selected=candidates[0];
  assert.equal(selected.metadata.contentVersion,selected.current_version,`${family}: inconsistent immutable version`);
  refs.set(family,{templateId:selected.id,contentVersion:selected.current_version,dueHours:720,presentation:'first_entry',requiredBeforeWork:false});
 }
 const payload=[];
 for(const c of manifest.courses){
  const id=newId(o,c);
  const prior=rows.filter(r=>r.metadata?.kind==='training'&&r.metadata.safetyResource?.familyId===c.id);
  assert(prior.every(r=>r.id===id),`${ownerKey(o)}:${c.id} unexpected existing family; preserve it`);
  const metadata=LibraryMetadataSchema.parse({kind:'training',seriesId:uuid(`vndrly:certification-50:course-series:${ownerKey(o)}:${c.id}`),contentVersion:1,version:0,state:'published',publishedAt:new Date().toISOString(),content:c.content,safetyResource:{familyId:c.id,categoryId:'competence',resourceType:'training',sourceVersion:c.sourceVersion,sourceSha256:c.sourceSha256}});
  refs.set(c.id,{templateId:id,contentVersion:1,dueHours:720,presentation:'first_entry',requiredBeforeWork:false});
  payload.push({id,name:c.title,current_version:1,library_metadata:metadata,bundle_definition:null,sourceId:c.id,contentHash:c.contentSha256});
 }
 for(const b of manifest.bundles){
  assert.equal(b.externalCredentialGrantedByOnlineCompletion,false);
  const definition=BundleDefinitionSchema.parse({description:b.description,entries:b.courseFamilies.map(id=>{const ref=refs.get(id);assert(ref);return ref;})});
  payload.push({id:bundleId(o,b),name:b.title,current_version:1,library_metadata:LibraryMetadataSchema.parse({kind:'bundle',seriesId:uuid(`vndrly:certification-50:bundle-series:${ownerKey(o)}:${b.id}`),contentVersion:1,version:0,state:'published',publishedAt:new Date().toISOString()}),bundle_definition:definition,sourceId:b.id,contentHash:sha(definition)});
 }
 return {payload,refs};
}
async function readPayload(o,ids){return (await client.query("SELECT id,name,current_version,library_metadata - 'content' AS library_metadata,md5((library_metadata->'content')::text) AS database_content_hash,bundle_definition FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND id=ANY($3::uuid[])",[o.owner_org_type,o.owner_org_id,ids])).rows;}
function verifyRows(expected,actual,requireAll){
 for(const p of expected){
  const r=actual.find(r=>r.id===p.id);
  if(!r){assert(!requireAll,`${p.sourceId}: missing readback`);continue;}
  const m=LibraryMetadataSchema.parse(r.library_metadata);
  assert.equal(r.name,p.name);assert.equal(r.current_version,1);assert.equal(m.kind,p.library_metadata.kind);assert.equal(m.state,'published');assert.equal(m.seriesId,p.library_metadata.seriesId);
  if(m.kind==='training'){
   assert.equal(m.safetyResource?.sourceSha256,p.library_metadata.safetyResource.sourceSha256);
   // Compare PostgreSQL's canonical JSON representation on both sides. This
   // verifies every stored lesson/question without transferring megabytes
   // repeatedly over a connection that may be intermittent.
   assert.equal(r.database_content_hash,databaseContentHashes.get(p.sourceId),`${p.sourceId}: content differs`);
  }else assert.equal(sha(BundleDefinitionSchema.parse(r.bundle_definition)),p.contentHash,`${p.sourceId}: bundle differs`);
 }
}
try{
 await client.connect();
 const expectedHashes=await client.query("SELECT id,md5(content::text) AS hash FROM jsonb_to_recordset($1::jsonb) AS x(id text,content jsonb)",[JSON.stringify(manifest.courses.map(c=>({id:c.id,content:c.content})))]);
 for(const r of expectedHashes.rows)databaseContentHashes.set(r.id,r.hash);
 let owners=(await client.query(`SELECT DISTINCT ON(t.owner_org_type,t.owner_org_id) t.owner_org_type,t.owner_org_id,t.created_by_id,
 CASE WHEN t.owner_org_type='vendor' AND EXISTS(SELECT 1 FROM vendors v WHERE v.id=t.owner_org_id AND lower(v.name)='gatego') THEN 0 ELSE 1 END AS priority
 FROM work_hub_form_templates t WHERE t.name='VNDRLY Energy Safety Core' ORDER BY t.owner_org_type,t.owner_org_id,t.id`)).rows;
 owners.sort((a,b)=>a.priority-b.priority);
 assert(owners.length>0&&owners.length<=500,'Unexpected owner scope');if(args.has('--first-company'))owners=owners.slice(0,1);
 console.log(JSON.stringify({phase:'scope',mode:report.mode,companies:owners.length,bundlesPerCompany:50,coursesPerCompany:50,manifestHash}));
 for(const o of owners){
  const started=Date.now();
  const rows=await summaries(o),plan=makePlan(o,rows),ids=plan.payload.map(p=>p.id);
  verifyRows(plan.payload,await readPayload(o,ids),false);
  if(!apply){report.companies.push({owner:ownerKey(o),status:'preflight_passed',ms:Date.now()-started});console.log(JSON.stringify({phase:'preflight',completed:report.companies.length,total:owners.length}));continue;}
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try{
   await client.query("SET LOCAL lock_timeout='3s'");
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`certification-50:${ownerKey(o)}`]);
   const existing=await readPayload(o,ids);verifyRows(plan.payload,existing,false);
   const missing=plan.payload.filter(p=>!existing.some(r=>r.id===p.id));
   if(missing.length){
    const records=missing.map(p=>({...p,owner_org_type:o.owner_org_type,owner_org_id:o.owner_org_id,created_by_id:o.created_by_id}));
    const inserted=await client.query(`INSERT INTO work_hub_form_templates(id,owner_org_type,owner_org_id,name,current_version,definition,created_by_id,library_metadata,bundle_definition)
     SELECT id,owner_org_type,owner_org_id,name,current_version,'[]'::jsonb,created_by_id,library_metadata,bundle_definition
     FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,owner_org_type text,owner_org_id integer,name text,current_version integer,created_by_id integer,library_metadata jsonb,bundle_definition jsonb) RETURNING id`,[JSON.stringify(records)]);
    assert.equal(inserted.rowCount,missing.length);
    const audits=missing.map(p=>({subject_id:p.id,operation_id:uuid(`certification-50-audit:${p.id}`),metadata:{manifestHash,sourceId:p.sourceId,contentHash:p.contentHash,assignmentsCreated:0,existingTemplatesChanged:0}}));
    await client.query(`INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,new_version,source,operation_id,metadata)
     SELECT $1,$2,'library.certification_50_published','library',subject_id,1,'system',operation_id,metadata
     FROM jsonb_to_recordset($3::jsonb) AS x(subject_id text,operation_id uuid,metadata jsonb)`,[o.owner_org_type,o.owner_org_id,JSON.stringify(audits)]);
   }
   verifyRows(plan.payload,await readPayload(o,ids),true);
   await client.query('COMMIT');
   verifyRows(plan.payload,await readPayload(o,ids),true);
   const auditRows=(await client.query("SELECT subject_id,metadata FROM work_hub_audit_log WHERE owner_org_type=$1 AND owner_org_id=$2 AND action='library.certification_50_published' AND subject_id=ANY($3::text[])",[o.owner_org_type,o.owner_org_id,ids])).rows;
   for(const p of plan.payload)assert.equal(auditRows.filter(a=>a.subject_id===p.id&&a.metadata?.contentHash===p.contentHash).length,1,`${p.sourceId}: missing or duplicate publication audit`);
   const preserved=(await client.query('SELECT id,xmin::text AS row_revision FROM work_hub_form_templates WHERE id=ANY($1::uuid[])',[rows.map(r=>r.id)])).rows;
   assert.equal(preserved.length,rows.length,'An existing row disappeared during publication');
   assert(rows.every(r=>preserved.some(p=>p.id===r.id&&p.row_revision===r.row_revision)),'An existing row changed during publication; inspect concurrent edits');
   const evidence={owner:ownerKey(o),status:'committed_readback_verified',inserted:missing.length,courses:50,bundles:50,preservedExistingRows:rows.length,ms:Date.now()-started,verifiedAt:new Date().toISOString(),bundleIds:plan.payload.filter(p=>p.library_metadata.kind==='bundle').map(p=>({programId:p.sourceId,id:p.id})),courseIds:plan.payload.filter(p=>p.library_metadata.kind==='training').map(p=>({familyId:p.sourceId,id:p.id}))};
   report.companies.push(evidence);save();
   console.log(JSON.stringify({phase:'verified',completed:report.companies.length,total:owners.length,inserted:missing.length,ms:evidence.ms}));
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 }
 save();console.log(JSON.stringify({phase:'finished',mode:report.mode,companies:report.companies.length,checkpoint}));
}catch(e){save();console.error(e instanceof assert.AssertionError?e.message:JSON.stringify({error:'Publication incomplete',code:e.code??null,timeout:/timeout/i.test(e.message)}));process.exitCode=1;}
finally{await client.end().catch(()=>{});}
