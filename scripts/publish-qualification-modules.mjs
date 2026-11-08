/** Add only the two completed coordinator knowledge modules to existing company
 * libraries. Never publishes unfinished certificate bundles, creates assignments,
 * changes scores or rewrites prior content. Default is a read-only preflight. */
import './load-env-local.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {LibraryDraftSchema,LibraryMetadataSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
const args=new Set(process.argv.slice(2));
assert([...args].every(a=>a==='--apply'),'Unknown publication option');
const apply=args.has('--apply');
const courses=JSON.parse(readFileSync('research/safety-program/certifications-50/supplemental-courses.json')).courses;
assert.deepEqual(courses.map(c=>c.id),['C09','C10']);
for(const c of courses)assert.equal(safetyTrainingContentHash(LibraryDraftSchema.parse(c.content)),c.contentSha256);
const uuid=value=>{const b=createHash('sha256').update(value).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const url=new URL(process.env.DATABASE_URL??'');
assert(url.hostname==='aws-1-us-west-2.pooler.supabase.com'&&decodeURIComponent(url.username)==='postgres.bihjmgbdzbhcnsuhzzwo'&&url.pathname==='/postgres','Unexpected database target');
// Use this project's session pool for multi-statement publication transactions.
// The transaction-pool route stalled even on the read-only transaction preflight.
url.port='5432';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000,statement_timeout:90000,query_timeout:95000,application_name:'vndrly-qualification-modules'});
client.on('error',()=>{process.exitCode=1;});
const report={mode:apply?'apply':'read-only',courses:courses.map(c=>({id:c.id,sourceSha256:c.sourceSha256,contentSha256:c.contentSha256})),companies:[],assignmentsCreated:0,existingRowsUpdated:0,certificateBundlesPublished:0};
const ids=courses.map(c=>c.id);
const key=o=>`${o.owner_org_type}:${o.owner_org_id}`;
const identity=(o,c)=>uuid(`vndrly:qualification-module:${key(o)}:${c.id}:${c.sourceSha256}`);
async function existing(o){return (await client.query("SELECT id,current_version,library_metadata FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND library_metadata->'safetyResource'->>'familyId'=ANY($3::text[])",[o.owner_org_type,o.owner_org_id,ids])).rows;}
function verifyRows(o,rows,requireAll){
 for(const c of courses){const family=rows.filter(r=>r.library_metadata?.safetyResource?.familyId===c.id);
  assert(family.length<=1,`${key(o)}:${c.id}: ambiguous family`);
  if(!family.length){assert(!requireAll,`${key(o)}:${c.id}: absent after publication`);continue;}
  const row=family[0],m=LibraryMetadataSchema.parse(row.library_metadata);
  assert(row.id===identity(o,c)&&row.current_version===1&&m.state==='published'&&m.safetyResource?.sourceSha256===c.sourceSha256&&safetyTrainingContentHash(LibraryDraftSchema.parse(m.content))===c.contentSha256,`${key(o)}:${c.id}: existing family differs; preserve it`);
 }
}
try{
 console.log(JSON.stringify({phase:'connecting',mode:report.mode}));
 await client.connect();
 console.log(JSON.stringify({phase:'reading-library-scope'}));
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const owners=(await client.query("WITH flagship AS MATERIALIZED (SELECT id,owner_org_type,owner_org_id,created_by_id,library_metadata FROM work_hub_form_templates WHERE name='VNDRLY Energy Safety Core') SELECT DISTINCT ON(owner_org_type,owner_org_id) owner_org_type,owner_org_id,created_by_id FROM flagship WHERE library_metadata->'safetyResource'->>'familyId'='G99' AND library_metadata->>'state'='published' ORDER BY owner_org_type,owner_org_id,id")).rows;
 assert(owners.length>0&&owners.length<=500,'Unexpected company-library scope');
 console.log(JSON.stringify({phase:'checking-existing-modules',companies:owners.length}));
 // One indexed/scanned read for the preflight rather than one full-table family
 // search per company across a remote connection.
 const priorRows=(await client.query("SELECT id,owner_org_type,owner_org_id,current_version,library_metadata FROM work_hub_form_templates WHERE library_metadata->'safetyResource'->>'familyId'=ANY($1::text[])",[ids])).rows;
 for(const o of owners)verifyRows(o,priorRows.filter(r=>r.owner_org_type===o.owner_org_type&&r.owner_org_id===o.owner_org_id),false);
 await client.query('COMMIT');
 console.log(JSON.stringify({phase:'preflight',companies:owners.length,courses:2,mode:report.mode}));
 for(const o of owners){
  if(!apply){report.companies.push({owner:key(o),status:'preflight_passed'});continue;}
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try{
   await client.query("SET LOCAL lock_timeout='3s'");
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`qualification-modules:${key(o)}`]);
   const before=await existing(o);verifyRows(o,before,false);
   let inserted=0;
   for(const c of courses){
    if(before.some(r=>r.id===identity(o,c)))continue;
    const id=identity(o,c),metadata=LibraryMetadataSchema.parse({kind:'training',seriesId:uuid(`vndrly:qualification-module-series:${key(o)}:${c.id}`),contentVersion:1,version:1,state:'published',publishedAt:new Date().toISOString(),content:c.content,safetyResource:{familyId:c.id,categoryId:'competence',resourceType:'training',sourceVersion:c.sourceVersion,sourceSha256:c.sourceSha256}});
    await client.query("INSERT INTO work_hub_form_templates(id,owner_org_type,owner_org_id,name,current_version,definition,created_by_id,library_metadata) VALUES($1,$2,$3,$4,1,'[]'::jsonb,$5,$6::jsonb)",[id,o.owner_org_type,o.owner_org_id,c.title,o.created_by_id,JSON.stringify(metadata)]);
    await client.query("INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,operation_id,metadata) VALUES($1,$2,'library.qualification_module_published','library',$3,NULL,1,'system',$4,$5::jsonb)",[o.owner_org_type,o.owner_org_id,id,uuid(`qualification-module-audit:${id}`),JSON.stringify({familyId:c.id,sourceSha256:c.sourceSha256,contentSha256:c.contentSha256,assignmentsCreated:0,existingRowsUpdated:0})]);
    inserted++;
   }
   verifyRows(o,await existing(o),true);
   await client.query('COMMIT');
   verifyRows(o,await existing(o),true);
   report.companies.push({owner:key(o),status:'committed_readback_verified',inserted,verifiedAt:new Date().toISOString()});
   mkdirSync('.local',{recursive:true});writeFileSync('.local/qualification-module-publication.json',JSON.stringify(report,null,2));
   if(report.companies.length%25===0)console.log(JSON.stringify({phase:'verified',companies:report.companies.length,total:owners.length}));
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 }
 console.log(JSON.stringify({mode:report.mode,companies:report.companies.length,inserted:report.companies.reduce((n,r)=>n+(r.inserted??0),0),assignmentsCreated:0,existingRowsUpdated:0,certificateBundlesPublished:0}));
}catch(error){console.error(error instanceof assert.AssertionError?error.message:JSON.stringify({error:'Qualification module publication failed; no completion claimed.',code:error.code??null,timeout:/timeout/i.test(error.message??'')}));process.exitCode=1;}
finally{
 // Pool waits can outlive the server statement timeout. Bound cleanup as well.
 await Promise.race([client.end().catch(()=>{}),new Promise(resolve=>{const timer=setTimeout(()=>{client.connection?.stream?.destroy();resolve();},3000);timer.unref();})]);
}
