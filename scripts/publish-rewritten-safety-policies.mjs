/** Replace only the59 original authored policy documents. Preserve settings, assignments and all other resources. */
import './load-env-local.mjs';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {LibraryDraftSchema,LibraryMetadataSchema} from '../lib/api-zod/src/work-hub-library.ts';
const apply=process.argv.includes('--apply'),validateOnly=process.argv.includes('--validate-only');
const root='research/safety-program/policy-rewrite',manifest=JSON.parse(fs.readFileSync(`${root}/publication.json`));
const hash=s=>createHash('sha256').update(s).digest('hex'),ensure=(x,m)=>{if(!x)throw Error(m);};
const sources=new Map(manifest.policies.map(p=>[p.id,p]));
ensure(sources.size===59&&manifest.sourceVersion==='2.0','Incomplete replacement set');
for(const p of sources.values())ensure(hash(p.policyText)===p.sourceSha256,'Changed manifest text:'+p.id);
if(validateOnly){console.log(JSON.stringify({policies:59,validated:true,databaseWrites:0}));process.exit(0);}
const target=new URL(process.env.DATABASE_URL??'');
ensure(target.hostname==='aws-1-us-west-2.pooler.supabase.com'&&decodeURIComponent(target.username)==='postgres.bihjmgbdzbhcnsuhzzwo'&&target.pathname==='/postgres','Unexpected database target');
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const client=new Client({connectionString:target.toString(),application_name:'vndrly-policy-rewrite',connectionTimeoutMillis:15000});
const action='library.original_policies_rewritten',report={mode:apply?'apply':'dry-run',policies:59,companies:0,verified:0,changed:0,assignmentsCreated:0,trainingRecordsChanged:0,companySettingsChanged:0,results:[]};
const stableId=value=>{const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
function nativeOriginal(owner,family){
 return fs.readFileSync(`research/safety-program/2026-10-31/library-resources/${family}/policy.md`,'utf8').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_all,label,target)=>{
  if(/^https?:\/\//.test(target))return `${label}\n${target}`;
  const m=target.match(/^(?:(?:\.\.\/)?([LHCEIR]\d{2})\/)?(policy|form|training|evidence-examples)\.md$/);
  return m?`${label}\nhttps://vndrly.ai/work-hub/library/${stableId(`safety-library-v2:${owner.owner_org_type}:${owner.owner_org_id}:${m[1]??family}:${m[2]}`)}`:label;
 });
}
try{
 await client.connect();
 const owners=(await client.query(`SELECT DISTINCT org_type AS owner_org_type,COALESCE(vendor_id,partner_id) AS owner_org_id FROM user_org_memberships WHERE role='admin' AND org_type IN ('vendor','partner') ORDER BY owner_org_type,owner_org_id`)).rows;
 ensure(owners.length===155,'Expected155 existing company Libraries');report.companies=owners.length;
 for(const owner of owners){
  if(apply){await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='30s'");}
  try{
   const ids=[...sources.keys()].map(id=>stableId(`safety-library-v2:${owner.owner_org_type}:${owner.owner_org_id}:${id}:policy`));
   const rows=(await client.query(`SELECT id,name,current_version,library_metadata FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND id=ANY($3::uuid[]) ORDER BY id${apply?' FOR UPDATE':''}`,[owner.owner_org_type,owner.owner_org_id,ids])).rows;
   ensure(rows.length===59,'Incomplete original policy set for company '+owner.owner_org_id);
   let changed=0;const audits=[],updates=[];
   for(const row of rows){
    const old=LibraryMetadataSchema.parse(row.library_metadata),p=sources.get(old.safetyResource?.familyId);
    ensure(p&&old.kind==='policy'&&old.safetyResource.resourceType==='policy'&&old.state==='published','Unexpected policy identity');
    if(old.safetyResource.sourceSha256===p.sourceSha256){ensure(old.content?.policyText===p.policyText&&old.content.description===p.description,'Published policy differs');continue;}
    ensure(old.safetyResource.sourceSha256===p.previousSourceSha256&&old.content?.policyText===nativeOriginal(owner,p.id),'Existing policy document has changed:'+row.id);
    ensure(old.contentVersion===row.current_version,'Policy version mismatch');
    const content=LibraryDraftSchema.parse({...old.content,title:`${p.id} — ${p.title}`,description:p.description,policyText:p.policyText});
    const metadata=LibraryMetadataSchema.parse({...old,version:old.version+1,contentVersion:old.contentVersion+1,publishedAt:new Date().toISOString(),content,safetyResource:{...old.safetyResource,sourceVersion:'2.0',sourceSha256:p.sourceSha256}});
    ensure(JSON.stringify(metadata.trainingPolicy)===JSON.stringify(old.trainingPolicy),'Company policy settings changed');
    if(apply){
     updates.push({id:row.id,metadata,current_version:metadata.contentVersion,name:old.trainingPolicy?.title??content.title,previous:row.library_metadata});
     audits.push({id:row.id,oldVersion:old.contentVersion,newVersion:metadata.contentVersion,family:p.id,oldHash:hash(old.content.policyText),newHash:p.sourceSha256});
    }
    changed++;
   }
   if(apply){
    if(updates.length){
     const result=await client.query(`UPDATE work_hub_form_templates t SET library_metadata=x.metadata,current_version=x.current_version,name=x.name FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,metadata jsonb,current_version integer,name text,previous jsonb) WHERE t.id=x.id AND t.owner_org_type=$2 AND t.owner_org_id=$3 AND t.library_metadata=x.previous`,[JSON.stringify(updates),owner.owner_org_type,owner.owner_org_id]);
     ensure(result.rowCount===updates.length,'Policy changed during publication');
     const auditRows=audits.map(a=>({id:a.id,old_version:a.oldVersion,new_version:a.newVersion,operation_id:randomUUID(),metadata:{familyId:a.family,previousPolicySha256:a.oldHash,sourceSha256:a.newHash,authorization:'Rewrite all policies without unasked-for requirements and clutter; deploy and verify live',assignmentsChanged:0,companySettingsChanged:0}}));
     await client.query(`INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,operation_id,metadata) SELECT $2,$3,$4,'library',id,old_version,new_version,'system',operation_id,metadata FROM jsonb_to_recordset($1::jsonb) AS x(id text,old_version integer,new_version integer,operation_id uuid,metadata jsonb)`,[JSON.stringify(auditRows),owner.owner_org_type,owner.owner_org_id,action]);
    }
    const check=(await client.query(`SELECT library_metadata FROM work_hub_form_templates WHERE id=ANY($1::uuid[])`,[ids])).rows;
    ensure(check.length===59&&check.every(r=>{const m=r.library_metadata,p=sources.get(m.safetyResource.familyId);return m.content.policyText===p.policyText&&m.content.description===p.description&&m.safetyResource.sourceSha256===p.sourceSha256;}),'Policy readback mismatch');
    await client.query('COMMIT');
   }
   report.verified+=59;report.changed+=changed;report.results.push({company:`${owner.owner_org_type}:${owner.owner_org_id}`,policies:59,changed});
   if(report.results.length%25===0)console.log(JSON.stringify({mode:report.mode,companies:report.results.length,total:155}));
  }catch(error){if(apply)await client.query('ROLLBACK');throw error;}
 }
 report.verifiedAt=new Date().toISOString();fs.writeFileSync(`${root}/${apply?'live-publication':'dry-run'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));
}finally{await client.end();}

