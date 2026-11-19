/** User-authorized reversal of this import only. Default is read-only. */
import './load-env-local.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const apply=process.argv.includes('--apply');
assert(process.argv.slice(2).every(x=>x==='--apply'));
const manifest=JSON.parse(readFileSync('research/safety-program/certifications-115/catalog-publication.json'));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifestHash=hash(manifest);
assert.equal(manifestHash,'9bb37a36dd50a39a23ffc058e0d5e72c4e4fedea8ddd6318a88ca8869af7bb45');
const uuid=value=>{const b=createHash('sha256').update(value).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const url=new URL(process.env.DATABASE_URL??'');
assert(url.hostname==='aws-1-us-west-2.pooler.supabase.com'&&decodeURIComponent(url.username)==='postgres.bihjmgbdzbhcnsuhzzwo'&&url.pathname==='/postgres');url.port='5432';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const db=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000,statement_timeout:40000,application_name:'undo-certification-company-copies'});
const report={mode:apply?'apply':'preflight',manifestHash,companies:[],startedAt:new Date().toISOString()};
const save=()=>writeFileSync('.local/certification-copies-undo.json',JSON.stringify(report,null,2));
try{
 await db.connect();
 const audits=(await db.query("SELECT owner_org_type,owner_org_id,subject_id,metadata FROM work_hub_audit_log WHERE action='library.certification_115_published' AND metadata->>'manifestHash'=$1",[manifestHash])).rows;
 const owners=new Map();
 for(const a of audits){const key=`${a.owner_org_type}:${a.owner_org_id}`;if(!owners.has(key))owners.set(key,[]);owners.get(key).push(a);}
 const fks=(await db.query(`SELECT c.conrelid::regclass::text AS relation,a.attname AS column FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] WHERE c.contype='f' AND c.confrelid='work_hub_form_templates'::regclass`)).rows;
 const expectedHashes=new Map((await db.query("SELECT id,md5(content::text) AS hash FROM jsonb_to_recordset($1::jsonb) x(id text,content jsonb)",[JSON.stringify(manifest.courses.map(c=>({id:c.id,content:c.content})))])).rows.map(r=>[r.id,r.hash]));
 const ownerList=[...owners],retries=new Map();
 for(let ownerIndex=0;ownerIndex<ownerList.length;ownerIndex++){
  const [owner,entries]=ownerList[ownerIndex];
  const type=entries[0].owner_org_type,id=entries[0].owner_org_id;
  const ids=entries.map(a=>{
   const c=manifest.courses.find(c=>c.id===a.metadata.sourceId),b=manifest.bundles.find(b=>b.id===a.metadata.sourceId);
   assert(c||b,'Unknown import source');
   const expected=c?uuid(`vndrly:certification-115:course:${owner}:${c.id}:${c.sourceSha256}`):uuid(`vndrly:certification-115:bundle:${owner}:${b.id}:${hash(b)}`);
   assert.equal(a.subject_id,expected,'Audit ID does not match original import');return expected;
  });
  assert.equal(new Set(ids).size,ids.length);
  await db.query('BEGIN');
  try{
   await db.query("SET LOCAL lock_timeout='10s'");
   const rows=(await db.query(`SELECT id,name,current_version,library_metadata-'content' AS metadata,bundle_definition,md5((library_metadata->'content')::text) AS content_hash FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND id=ANY($3::uuid[]) ${apply?'FOR UPDATE':''}`,[type,id,ids])).rows;
   for(const r of rows){
    const a=entries.find(a=>a.subject_id===r.id),c=manifest.courses.find(c=>c.id===a.metadata.sourceId),b=manifest.bundles.find(b=>b.id===a.metadata.sourceId);
    assert.equal(r.current_version,1);assert.equal(r.metadata.version,0);assert.equal(r.metadata.state,'published');assert.equal(r.name,(c??b).title);
    if(c){assert.equal(r.content_hash,expectedHashes.get(c.id));assert.equal(r.metadata.safetyResource.sourceSha256,c.sourceSha256);}
    else {assert.equal(r.bundle_definition.certificationRequirements.programId,b.id);assert.equal(r.bundle_definition.certificationRequirements.sourceSha256,b.certificationRequirements.sourceSha256);}
   }
   for(const fk of fks){
    assert(/^[a-z_][a-z0-9_.]*$/.test(fk.relation)&&/^[a-z_][a-z0-9_]*$/.test(fk.column));
    const linked=await db.query(`SELECT count(*)::int AS count FROM ${fk.relation} WHERE "${fk.column}"=ANY($1::uuid[])`,[ids]);assert.equal(linked.rows[0].count,0,`${owner}: existing dependent records; preserve them`);
   }
   const otherAudits=await db.query("SELECT count(*)::int AS count FROM work_hub_audit_log WHERE subject_id=ANY($1::text[]) AND action NOT IN ('library.certification_115_published','library.certification_115_copy_removed')",[ids]);assert.equal(otherAudits.rows[0].count,0,'Imported records have subsequent activity');
   const preserved=(await db.query('SELECT id,xmin::text AS revision FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND NOT(id=ANY($3::uuid[]))',[type,id,ids])).rows;
   const links=await db.query(`SELECT count(*)::int AS count FROM work_hub_form_templates t CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.bundle_definition->'entries','[]'::jsonb)) e WHERE t.owner_org_type=$1 AND t.owner_org_id=$2 AND NOT(t.id=ANY($3::uuid[])) AND e->>'templateId'=ANY($4::text[])`,[type,id,ids,ids]);assert.equal(links.rows[0].count,0,'An existing bundle now references an imported course');
   if(apply&&rows.length){
    const removed=await db.query('DELETE FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND id=ANY($3::uuid[]) RETURNING id',[type,id,rows.map(r=>r.id)]);assert.equal(removed.rowCount,rows.length);
    const current=(await db.query(`SELECT id,name,current_version AS "currentVersion",library_metadata-'content'-'fileSnapshots'-'trainingPolicy' AS "libraryMetadata" FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND campaign_config IS NULL ORDER BY created_at DESC`,[type,id])).rows;
    await db.query('UPDATE training_read_projections SET payload=$2::jsonb,computed_at=now() WHERE projection_key=$1',[owner+':library',JSON.stringify({encoding:'gzip-json-v1',data:gzipSync(JSON.stringify(current)).toString('base64')})]);
    const after=(await db.query('SELECT id,xmin::text AS revision FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2',[type,id])).rows;assert.deepEqual(after.sort((a,b)=>a.id.localeCompare(b.id)),preserved.sort((a,b)=>a.id.localeCompare(b.id)),'Existing company records changed');
   }
   await db.query(apply?'COMMIT':'ROLLBACK');
   report.companies.push({owner,copies:rows.length,removed:apply?rows.length:0,preserved:preserved.length,verifiedAt:new Date().toISOString()});save();console.log(JSON.stringify({completed:report.companies.length,total:owners.size,owner,copies:rows.length,apply}));
  }catch(e){await db.query('ROLLBACK');
   if(e.code==='55P03'&&(retries.get(owner)??0)<4){retries.set(owner,(retries.get(owner)??0)+1);console.log(JSON.stringify({owner,retry:retries.get(owner),reason:'Concurrent database lock; transaction rolled back'}));ownerIndex--;continue;}
   throw e;
  }
 }
 report.finishedAt=new Date().toISOString();save();console.log('Completed scoped reversal '+report.mode);
}catch(e){save();console.error(JSON.stringify({code:e.code,message:e.message,context:e.where}));process.exitCode=1;}finally{await db.end();}
