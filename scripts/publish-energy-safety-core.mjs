/** Additive G99 publication. Default is a READ ONLY production preflight. */
import './load-env-local.mjs';import fs from'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{LibraryDraftSchema,LibraryMetadataSchema}from'../lib/api-zod/src/work-hub-library.ts';
import{safetyTrainingContentHash}from'../artifacts/api-server/src/lib/safety-training-content-hash.ts';
const args=new Set(process.argv.slice(2)),apply=args.has('--apply'),validateOnly=args.has('--validate-only');
const root='research/safety-program/energy-safety-core',course=JSON.parse(fs.readFileSync(`${root}/course.json`)),content=LibraryDraftSchema.parse(course.content);
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
ensure([...args].every(x=>['--apply','--validate-only'].includes(x))&&!(apply&&validateOnly),'Invalid publication mode');
ensure(course.id==='G99'&&content.title==='VNDRLY Energy Safety Core'&&content.training.lessons.length===14&&content.training.questions.length===48&&content.training.certificationExam.questions.length===74,'Incomplete flagship course');
ensure(safetyTrainingContentHash(content)===course.contentSha256&&createHash('sha256').update(JSON.stringify(content)).digest('hex')===course.sourceSha256,'Course hash mismatch');
const prior=JSON.parse(fs.readFileSync('research/safety-program/2026-11-02/prepared-course-publication.json')).courses;
ensure(prior.length===116,'Preserved curriculum missing');
const uuid=name=>{const b=createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8','hex')).update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const key=o=>`${o.owner_org_type}:${o.owner_org_id}`,id=o=>uuid(`vndrly.ai:safety-course:${key(o)}:G99:${course.sourceSha256}`),series=o=>uuid(`vndrly.ai:safety-course-series:${key(o)}:G99`);
const checkpointPath=`.local/energy-safety-core-publication-${course.sourceSha256.slice(0,16)}.json`;
let client,stage='validate';
async function preservation(o){return(await client.query(`SELECT md5(COALESCE(string_agg(id::text||md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash,count(*)::int AS count FROM work_hub_form_templates t WHERE owner_org_type=$1 AND owner_org_id=$2 AND COALESCE(library_metadata->'safetyResource'->>'familyId','')<>'G99'`,[o.owner_org_type,o.owner_org_id])).rows[0];}
async function verify(o){const rows=(await client.query('SELECT id,current_version,library_metadata FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND id=$3',[o.owner_org_type,o.owner_org_id,id(o)])).rows;ensure(rows.length===1,`${key(o)}: missing published course`);const row=rows[0],m=LibraryMetadataSchema.parse(row.library_metadata);ensure(row.current_version===1&&m.state==='published'&&m.safetyResource?.sourceSha256===course.sourceSha256&&safetyTrainingContentHash(LibraryDraftSchema.parse(m.content))===course.contentSha256,`${key(o)}: published course differs`);const a=(await client.query("SELECT count(*)::int AS count FROM work_hub_audit_log WHERE owner_org_type=$1 AND owner_org_id=$2 AND action='library.energy_safety_core_published' AND subject_id=$3 AND metadata->>'sourceSha256'=$4",[o.owner_org_type,o.owner_org_id,id(o),course.sourceSha256])).rows[0];ensure(a.count===1,`${key(o)}: missing or duplicate publication audit`);}
try{
 if(validateOnly){console.log(JSON.stringify({mode:'validate-only',course:course.id,sourceSha256:course.sourceSha256,sections:14,learningChecks:48,examBank:74,examQuestions:40}));}
 else{
  stage='target-guard';const url=new URL(process.env.DATABASE_URL??'');ensure(url.hostname==='aws-1-us-west-2.pooler.supabase.com'&&decodeURIComponent(url.username)==='postgres.bihjmgbdzbhcnsuhzzwo'&&url.pathname==='/postgres','Unexpected production target');
  const{Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');client=new Client({connectionString:url.toString(),application_name:apply?'vndrly-energy-core-publish':'vndrly-energy-core-read-only',connectionTimeoutMillis:15000});await client.connect();
  stage='read-only-preflight';await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const owners=(await client.query("SELECT DISTINCT ON(owner_org_type,owner_org_id)owner_org_type,owner_org_id,created_by_id FROM work_hub_form_templates WHERE library_metadata->'safetyResource'->>'familyId'='H03' AND library_metadata->>'state'='published' ORDER BY owner_org_type,owner_org_id,id")).rows;
  ensure(owners.length===155,'Expected155existingcompanyLibraries');
  for(const o of owners){const rows=(await client.query("SELECT library_metadata->'safetyResource'->>'familyId' AS family,library_metadata->'safetyResource'->>'sourceSha256' AS sha FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND library_metadata->>'state'='published' AND library_metadata->'safetyResource'->>'resourceType'='training'",[o.owner_org_type,o.owner_org_id])).rows;ensure(prior.every(c=>rows.some(r=>r.family===c.id&&r.sha===c.sourceSha256)),`${key(o)}: prior116identitymismatch`);const existing=(await client.query("SELECT id FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND library_metadata->'safetyResource'->>'familyId'='G99'",[o.owner_org_type,o.owner_org_id])).rows;ensure(!existing.length||(existing.length===1&&existing[0].id===id(o)),`${key(o)}: unexpectedexistingG99requiresreview`);}
  await client.query('COMMIT');console.log(JSON.stringify({mode:apply?'apply':'read-only',preflightCompanies:owners.length,priorCoursesPerCompany:116,courseId:'G99',newRowsMaximum:owners.length,existingTemplatesUpdated:0,assignmentsCreated:0,scoringRulesChanged:0}));
  if(apply){
   const checkpoint=fs.existsSync(checkpointPath)?JSON.parse(fs.readFileSync(checkpointPath)):{courseId:'G99',sourceSha256:course.sourceSha256,companies:{}};ensure(checkpoint.sourceSha256===course.sourceSha256,'Checkpoint hash differs');
   for(const o of owners){stage=`publish:${key(o)}`;await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');try{
    await client.query("SET LOCAL lock_timeout='3s'");await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`energy-core:${key(o)}`]);const before=await preservation(o);
    const existing=(await client.query('SELECT id FROM work_hub_form_templates WHERE id=$1',[id(o)])).rows;
    if(!existing.length){const m=LibraryMetadataSchema.parse({kind:'training',seriesId:series(o),contentVersion:1,version:1,state:'published',publishedAt:new Date().toISOString(),archivedAt:null,pollClosesAt:null,fileSnapshots:{},content,safetyResource:{familyId:'G99',categoryId:'competence',resourceType:'training',sourceVersion:course.sourceVersion,sourceSha256:course.sourceSha256}});
     await client.query("INSERT INTO work_hub_form_templates(id,owner_org_type,owner_org_id,name,current_version,definition,created_by_id,library_metadata) VALUES($1,$2,$3,$4,1,'[]'::jsonb,$5,$6::jsonb)",[id(o),o.owner_org_type,o.owner_org_id,course.title,o.created_by_id,JSON.stringify(m)]);
     await client.query("INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,new_version,source,operation_id,metadata) VALUES($1,$2,'library.energy_safety_core_published','library',$3,1,'system',$4,$5::jsonb)",[o.owner_org_type,o.owner_org_id,id(o),uuid(`energy-core-publication:${key(o)}:${course.sourceSha256}`),JSON.stringify({familyId:'G99',sourceSha256:course.sourceSha256,contentSha256:course.contentSha256,learningChecks:48,examBank:74,examQuestions:40,prior116preserved:true,assignmentsCreated:0,existingRowsChanged:0})]);
    }
    await verify(o);const after=await preservation(o);ensure(before.hash===after.hash&&before.count===after.count,`${key(o)}: priorLibrarychanged`);await client.query('COMMIT');await verify(o);
    checkpoint.companies[key(o)]={state:'committed_verified',itemId:id(o),priorTemplates:before.count,priorTemplatesHash:before.hash,inserted:!existing.length,verifiedAt:new Date().toISOString()};fs.writeFileSync(checkpointPath,JSON.stringify(checkpoint,null,2));
    console.log(JSON.stringify({company:key(o),verified:Object.keys(checkpoint.companies).length,total:owners.length,inserted:!existing.length}));
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}}
   console.log(JSON.stringify({status:'committed_verified',companies:owners.length,courseId:'G99',sourceSha256:course.sourceSha256,checkpointPath}));
  }
 }
}catch(e){console.error(JSON.stringify({stage,error:e.message?.includes('postgres')?'Database request failed':e.message,code:e.code}));process.exitCode=1;}finally{if(client)await client.end().catch(()=>{});}
