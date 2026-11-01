/** Additive publication only. Default: read-only dry run; --validate-only: no DB.
 * Run with Node 24: node scripts/publish-task-training.mjs [--apply]
 * --apply is reserved for the root release after deployment/checks are ready.
 * Existing templates/policies, assignments, submissions and completions are never
 * updated or deleted. A company commits its changed courses and audits together.
 */
import '../scripts/load-env-local.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {LibraryDraftSchema,LibraryMetadataSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
import {safetyTrainingCatalog} from '../artifacts/api-server/src/data/safety-training-catalog.ts';
import {course as originalH03} from '../research/safety-program/2026-10-31/course-review/H03-permit-to-work-simops/guided-course.mjs';

const args=new Set(process.argv.slice(2));
const APPLY=args.has('--apply'),VALIDATE_ONLY=args.has('--validate-only');
const EXPECTED_COMPANIES=155;
const ACTION='library.task_specific_course_published';
const manifestPath=new URL('../research/safety-program/2026-11-02/prepared-course-publication.json',import.meta.url);
const rawManifest=readFileSync(manifestPath);
const manifestSha256=createHash('sha256').update(rawManifest).digest('hex');
const checkpointPath=fileURLToPath(new URL(`../.local/task-specific-course-publication-${manifestSha256.slice(0,16)}.checkpoint.json`,import.meta.url));
const uuidNamespace=Buffer.from('6ba7b8109dad11d180b400c04fd430c8','hex');
class PublicationError extends Error {}
function ensure(condition,message){if(!condition)throw new PublicationError(message);}
function uuid(name){
 const b=createHash('sha1').update(uuidNamespace).update(name).digest().subarray(0,16);
 b[6]=(b[6]&15)|0x50;b[8]=(b[8]&63)|0x80;
 const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const ownerKey=o=>`${o.owner_org_type}:${o.owner_org_id}`;
const itemId=(o,c)=>uuid(`vndrly.ai:safety-course:${ownerKey(o)}:${c.id}:${c.sourceSha256}`);
const newSeriesId=(o,c)=>uuid(`vndrly.ai:safety-course-series:${ownerKey(o)}:${c.id}`);
const fingerprint=rows=>safetyTrainingContentHash([...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>({
 id:r.id,currentVersion:r.current_version,createdById:r.created_by_id,name:r.name,
 metadata:r.library_metadata,definition:r.definition,recurrence:r.recurrence,
 bundleDefinition:r.bundle_definition,campaignConfig:r.campaign_config,campaignState:r.campaign_state,
})));
function atomicCheckpoint(value){
 // A crash after COMMIT but before this rename is recovered from deterministic
 // DB identities and verified audits, never by trusting the local checkpoint.
 const temporary=`${checkpointPath}.${process.pid}.tmp`;
 const fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,checkpointPath);
}
function validateManifest(){
 ensure([...args].every(a=>['--apply','--validate-only'].includes(a)),'Unknown argument');
 ensure(!(APPLY&&VALIDATE_ONLY),'Choose --apply or --validate-only');
 const manifest=JSON.parse(rawManifest.toString('utf8'));
 ensure(manifest.version===1&&Array.isArray(manifest.courses)&&manifest.courses.length===116,'Expected69preserved+47task courses');
 const courses=manifest.courses.map(c=>{
  ensure(/^[LHCEIRG][0-9]{2}$/.test(c.id)&&/^[a-f0-9]{64}$/.test(c.sourceSha256),'Invalid course identity/source hash');
  const content=LibraryDraftSchema.parse(c.content),training=content.training;
  ensure(content.kind==='training'&&training?.lessons.length===10&&training.questions.length===26,`${c.id}: expected10sections/26questions`);
  ensure(training.guided?.steps.length===10&&training.guided.steps.flatMap(s=>s.questionIds).length===26,`${c.id}: incomplete guided mapping`);
  const contentSha256=safetyTrainingContentHash(content);
  const trusted=safetyTrainingCatalog.curriculum.find(x=>x.id===c.id);
  ensure(trusted&&trusted.sourceSha256===c.sourceSha256&&trusted.contentSha256===contentSha256&&trusted.sourceVersion===c.sourceVersion,`${c.id}: prepared content does not match the API trusted curriculum`);
  return {...c,content,contentSha256};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 ensure(new Set(courses.map(c=>c.id)).size===116,'Duplicate prepared course');
 ensure(courses.filter(c=>!c.id.startsWith('G')&&c.id!=='H03').length===58,'Expected58revised core courses');
 const previous=JSON.parse(readFileSync(new URL('../research/safety-program/2026-11-02/preserved-course-identities.json',import.meta.url)));
 for(const prior of previous){const course=courses.find(c=>c.id===prior.id);ensure(course&&course.sourceSha256===prior.sourceSha256&&safetyTrainingContentHash(course.content)===prior.contentSha256,prior.id+':existingcoursewouldchange');}
 const expected=Array.from({length:49},(_,i)=>'G'+(50+i)).filter(id=>!['G66','G94'].includes(id));
 ensure(isDeepStrictEqual(courses.filter(c=>Number(c.id.slice(1))>=50&&c.id.startsWith('G')).map(c=>c.id),expected),'Unexpected task-course scope');
 const h03=courses.find(c=>c.id==='H03'),original=LibraryDraftSchema.parse(originalH03);
 ensure(isDeepStrictEqual(h03.content,original),'H03 content must remain exactly unchanged');
 ensure(h03.sourceSha256===createHash('sha256').update(JSON.stringify(original)).digest('hex'),'H03 source identity changed');
 return courses;
}
function rowMetadata(row){
 const metadata=LibraryMetadataSchema.parse(row.library_metadata);
 ensure(metadata.contentVersion===row.current_version,`Template ${row.id}: database/metadata version mismatch`);
 return metadata;
}
function isTrusted(row,course){
 const m=rowMetadata(row),s=m.safetyResource;
 return m.kind==='training'&&m.state==='published'&&m.content&&s?.familyId===course.id&&s.resourceType==='training'&&s.categoryId===course.categoryId&&s.sourceVersion===course.sourceVersion&&s.sourceSha256===course.sourceSha256&&safetyTrainingContentHash(LibraryDraftSchema.parse(m.content))===course.contentSha256;
}
function planCompany(owner,rows,courses){
 const parsed=rows.map(row=>({row,m:rowMetadata(row)}));
 const items=[];
 for(const course of courses){
  const family=parsed.filter(x=>x.m.safetyResource?.familyId===course.id&&x.m.safetyResource.resourceType==='training'&&x.m.kind==='training');
  const published=family.filter(x=>x.m.state==='published').sort((a,b)=>b.m.contentVersion-a.m.contentVersion||a.row.id.localeCompare(b.row.id));
  const trusted=published.find(x=>isTrusted(x.row,course));
  if(course.id==='H03'){
   ensure(trusted,`${ownerKey(owner)}: no trusted unchanged H03 version; H03 publication is forbidden here`);
   items.push({course,action:'preserved_h03',id:trusted.row.id,seriesId:trusted.m.seriesId,contentVersion:trusted.m.contentVersion,previousId:trusted.row.id,previousVersion:trusted.m.contentVersion,trainingPolicyCarried:false});continue;
  }
  if(trusted){
   items.push({course,action:'already_trusted',id:trusted.row.id,seriesId:trusted.m.seriesId,contentVersion:trusted.m.contentVersion,previousId:trusted.row.id,previousVersion:trusted.m.contentVersion,trainingPolicyCarried:false});continue;
  }
  if(Number(course.id.slice(1))<50||!course.id.startsWith('G'))ensure(trusted,`${ownerKey(owner)}:${course.id}: prior course must be preserved`);
  if(!course.id.startsWith('G'))ensure(published.length,`${ownerKey(owner)}:${course.id}: missing existing published core series`);
  const series=new Set(family.map(x=>x.m.seriesId));
  ensure(series.size<=1,`${ownerKey(owner)}:${course.id}: ambiguous existing series`);
  const prior=published[0];
  const seriesId=prior?.m.seriesId??[...series][0]??newSeriesId(owner,course);
  const siblings=parsed.filter(x=>x.m.seriesId===seriesId);
  const nextVersion=Math.max(0,...siblings.flatMap(x=>[x.row.current_version,x.m.contentVersion]))+1;
  const id=itemId(owner,course);
  ensure(!rows.some(r=>r.id===id),`${ownerKey(owner)}:${course.id}: deterministic identity exists but is not trusted`);
  const metadata=LibraryMetadataSchema.parse({
   ...(prior?.m??{}),kind:'training',seriesId,contentVersion:nextVersion,version:1,state:'published',
   publishedAt:new Date().toISOString(),archivedAt:null,pollClosesAt:null,
   // Preserve existing training policy and its activation/scan state verbatim.
   // Policy resource rows are never edited or copied over the course settings.
   ...(prior?.m.trainingPolicy?{trainingPolicy:prior.m.trainingPolicy}:{}),
   fileSnapshots:prior?.m.fileSnapshots??{},content:course.content,
   safetyResource:{familyId:course.id,categoryId:course.categoryId,resourceType:'training',sourceVersion:course.sourceVersion,sourceSha256:course.sourceSha256},
  });
  ensure(!prior?.m.trainingPolicy||isDeepStrictEqual(metadata.trainingPolicy,prior.m.trainingPolicy),`${ownerKey(owner)}:${course.id}: policy carry mismatch`);
  items.push({course,action:prior?'revise':'new_series',id,seriesId,contentVersion:nextVersion,
   previousId:prior?.row.id??null,previousVersion:prior?.m.contentVersion??null,
   createdById:prior?.row.created_by_id??owner.created_by_id,metadata,
   trainingPolicyCarried:!!prior?.m.trainingPolicy,
   activeTrainingPolicyCarried:!!(prior?.m.trainingPolicy?.newHireRequired||prior?.m.trainingPolicy?.roleChangeRequired),
  });
 }
 return {owner,baselineSha256:fingerprint(rows),baselineIds:rows.map(r=>r.id),items};
}
function publicItem(item){return {familyId:item.course.id,action:item.action,id:item.id,seriesId:item.seriesId,contentVersion:item.contentVersion,sourceSha256:item.course.sourceSha256,contentSha256:item.course.contentSha256,previousId:item.previousId,previousVersion:item.previousVersion,trainingPolicyCarried:item.trainingPolicyCarried,activeTrainingPolicyCarried:item.activeTrainingPolicyCarried??false};}
function planSignature(plan){return safetyTrainingContentHash(plan.items.map(publicItem));}
async function loadCompany(client,owner,familyIds,seriesIds=[],lock=false){
 return (await client.query(`SELECT id,owner_org_type,owner_org_id,name,current_version,created_by_id,
   definition,recurrence,bundle_definition,campaign_config,campaign_state,library_metadata
  FROM work_hub_form_templates
  WHERE owner_org_type=$1 AND owner_org_id=$2 AND (
   (library_metadata->'safetyResource'->>'resourceType'='training' AND library_metadata->'safetyResource'->>'familyId'=ANY($3::text[]))
   OR library_metadata->>'seriesId'=ANY($4::text[]))
  ORDER BY id${lock?' FOR UPDATE':''}`,[owner.owner_org_type,owner.owner_org_id,familyIds,seriesIds])).rows;
}
async function verifyCompany(client,plan,familyIds,insertedIds){
 const owner=plan.owner,seriesIds=[...new Set(plan.items.map(x=>x.seriesId))];
 const rows=await loadCompany(client,owner,familyIds,seriesIds);
 const original=rows.filter(r=>plan.baselineIds.includes(r.id));
 ensure(original.length===plan.baselineIds.length&&fingerprint(original)===plan.baselineSha256,`${ownerKey(owner)}: existing template history changed`);
 for(const item of plan.items){
  const row=rows.find(r=>r.id===item.id);ensure(row,`${ownerKey(owner)}:${item.course.id}: expected current item missing`);
  const m=rowMetadata(row);
  ensure(row.id===item.id&&row.current_version===item.contentVersion&&m.seriesId===item.seriesId&&isTrusted(row,item.course),`${ownerKey(owner)}:${item.course.id}: ID/version/source/content readback mismatch`);
  if(item.metadata)ensure(safetyTrainingContentHash(m)===safetyTrainingContentHash(item.metadata),`${ownerKey(owner)}:${item.course.id}: metadata readback mismatch`);
  const sameVersion=rows.filter(r=>r.library_metadata?.seriesId===item.seriesId&&r.current_version===item.contentVersion);
  ensure(sameVersion.length===1,`${ownerKey(owner)}:${item.course.id}: duplicate series version`);
 }
 const auditedIds=[...new Set([...insertedIds,...plan.items.filter(x=>x.course.id.startsWith('G')&&Number(x.course.id.slice(1))>=50&&x.id===itemId(owner,x.course)).map(x=>x.id)])];
 if(auditedIds.length){
  const audits=(await client.query(`SELECT subject_id,metadata,new_version FROM work_hub_audit_log WHERE owner_org_type=$1 AND owner_org_id=$2 AND action=$3 AND subject_id=ANY($4::text[])`,[owner.owner_org_type,owner.owner_org_id,ACTION,auditedIds])).rows;
  for(const id of auditedIds){const item=plan.items.find(x=>x.id===id);ensure(audits.filter(a=>a.subject_id===id&&a.new_version===item.contentVersion&&a.metadata?.sourceSha256===item.course.sourceSha256&&a.metadata?.contentSha256===item.course.contentSha256).length===1,`${ownerKey(owner)}: missing or ambiguous publication audit`);}
 }
}
async function publishCompany(client,expected,courses,familyIds){
 const owner=expected.owner,key=ownerKey(owner);
 await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
 try{
  await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='90s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`complete-safety-publication:${key}`]);
  const seriesIds=[...new Set(expected.items.map(x=>x.seriesId))].sort();
  await client.query(`WITH ordered AS MATERIALIZED (SELECT key FROM unnest($1::text[]) AS key ORDER BY key) SELECT pg_advisory_xact_lock(hashtextextended(key,0)) FROM ordered`,[seriesIds.map(id=>`library-series:${key}:${id}`)]);
  const before=await loadCompany(client,owner,familyIds,seriesIds,true);
  ensure(fingerprint(before)===expected.baselineSha256,`${key}: current IDs/versions/metadata changed after preflight; rerun dry-run`);
  const plan=planCompany(owner,before,courses);
  ensure(planSignature(plan)===planSignature(expected),`${key}: publication plan changed after locking`);
  const changed=plan.items.filter(x=>x.metadata);
  const payload=changed.map(x=>({id:x.id,owner_org_type:owner.owner_org_type,owner_org_id:owner.owner_org_id,name:x.course.content.title,current_version:x.contentVersion,created_by_id:x.createdById,library_metadata:x.metadata}));
  let insertedIds=[];
  if(payload.length){
   const inserted=await client.query(`INSERT INTO work_hub_form_templates(id,owner_org_type,owner_org_id,name,current_version,definition,created_by_id,library_metadata)
    SELECT id,owner_org_type,owner_org_id,name,current_version,'[]'::jsonb,created_by_id,library_metadata
    FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,owner_org_type text,owner_org_id integer,name text,current_version integer,created_by_id integer,library_metadata jsonb)
    ON CONFLICT(id) DO NOTHING RETURNING id`,[JSON.stringify(payload)]);
   insertedIds=inserted.rows.map(x=>x.id);
   ensure(insertedIds.length===changed.length,`${key}: unexpected deterministic-ID conflict`);
   const audit=changed.map(x=>({owner_org_type:owner.owner_org_type,owner_org_id:owner.owner_org_id,subject_id:x.id,prior_version:x.previousVersion,new_version:x.contentVersion,operation_id:uuid(`vndrly.ai:safety-publication:${key}:${manifestSha256}`),metadata:{familyId:x.course.id,previousId:x.previousId,seriesId:x.seriesId,sourceVersion:x.course.sourceVersion,sourceSha256:x.course.sourceSha256,contentSha256:x.course.contentSha256,manifestSha256,sections:10,lessonChecks:6,finalQuestions:20,totalQuestions:26,assignmentsCreated:0,existingTemplatesChanged:0,policiesChanged:0,trainingPolicyCarried:x.trainingPolicyCarried}}));
   await client.query(`INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,operation_id,metadata)
    SELECT owner_org_type,owner_org_id,$2,'library',subject_id,prior_version,new_version,'system',operation_id,metadata
    FROM jsonb_to_recordset($1::jsonb) AS x(owner_org_type text,owner_org_id integer,subject_id text,prior_version integer,new_version integer,operation_id uuid,metadata jsonb)`,[JSON.stringify(audit),ACTION]);
  }
  await verifyCompany(client,plan,familyIds,insertedIds);
  await client.query('COMMIT');
  // Fresh read after COMMIT; checkpoint only verified committed company state.
  await verifyCompany(client,{...plan,baselineIds:before.map(r=>r.id)},familyIds,insertedIds);
  return {state:'committed_verified',verifiedAt:new Date().toISOString(),inserted:insertedIds.length,alreadyTrusted:plan.items.filter(x=>x.action==='already_trusted').length,h03Preserved:1,items:plan.items.map(publicItem)};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}

let client,stage='validate',currentCompany=null;
try{
 const courses=validateManifest(),familyIds=courses.map(c=>c.id),coreIds=courses.filter(c=>!c.id.startsWith('G')).map(c=>c.id);
 if(VALIDATE_ONLY){console.log(JSON.stringify({mode:'validate-only',manifestSha256,courses:116,preservedCourses:69,newTaskCourses:47,h03Unchanged:true,canonicalHashesValidated:116}));}
 else{
  stage='database-guard';ensure(process.env.DATABASE_URL,'DATABASE_URL unavailable');
  let url;try{url=new URL(process.env.DATABASE_URL);}catch{throw new PublicationError('Invalid database connection configuration');}
  ensure(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='aws-1-us-west-2.pooler.supabase.com'&&decodeURIComponent(url.username)==='postgres.bihjmgbdzbhcnsuhzzwo'&&url.pathname==='/postgres','Unexpected database target');
  const{Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
  client=new Client({connectionString:url.toString(),application_name:APPLY?'vndrly-complete-safety-publish':'vndrly-complete-safety-dry-run',connectionTimeoutMillis:15000});
  await client.connect();stage='read-only-preflight';
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='90s'");
  const owners=(await client.query(`SELECT DISTINCT ON(owner_org_type,owner_org_id) owner_org_type,owner_org_id,created_by_id
   FROM work_hub_form_templates WHERE library_metadata->'safetyResource'->>'resourceType'='training'
    AND library_metadata->'safetyResource'->>'familyId'=ANY($1::text[]) AND library_metadata->>'state'='published'
   ORDER BY owner_org_type,owner_org_id,CASE WHEN library_metadata->'safetyResource'->>'familyId'='H03' THEN 0 ELSE 1 END,id`,[coreIds])).rows;
  ensure(owners.length===EXPECTED_COMPANIES,`Expected155 existing company Libraries, found${owners.length}`);
  const plans=[];
  for(const owner of owners){currentCompany=ownerKey(owner);ensure(Number.isInteger(owner.created_by_id)&&owner.created_by_id>0,`${currentCompany}: missing existing creator`);
   const rows=await loadCompany(client,owner,familyIds);
   const initial=planCompany(owner,rows,courses),seriesIds=[...new Set(initial.items.map(x=>x.seriesId))];
   // Include all siblings even if a legacy row omitted its family annotation.
   const all=await loadCompany(client,owner,familyIds,seriesIds);
   plans.push(planCompany(owner,all,courses));
   if(plans.length%25===0)console.log(JSON.stringify({phase:'read-only-preflight',companiesChecked:plans.length,total:owners.length}));
  }
  await client.query('COMMIT');currentCompany=null;
  const allItems=plans.flatMap(p=>p.items),changed=allItems.filter(x=>x.metadata);
  const report={mode:APPLY?'apply':'dry-run',manifestSha256,companies:owners.length,coursesPerCompany:116,preservedCourses:69,newTaskCourses:47,h03Preserved:allItems.filter(x=>x.action==='preserved_h03').length,
   revisedCoreInserts:changed.filter(x=>x.action==='revise'&&!x.course.id.startsWith('G')).length,newGapInserts:changed.filter(x=>x.course.id.startsWith('G')).length,totalInserts:changed.length,
   alreadyTrusted:allItems.filter(x=>x.action==='already_trusted').length,trainingPoliciesCarried:changed.filter(x=>x.trainingPolicyCarried).length,activeTrainingPoliciesCarried:changed.filter(x=>x.activeTrainingPolicyCarried).length,
   assignmentsCreated:0,existingTemplatesUpdated:0,existingTemplatesDeleted:0,policyResourcesChanged:0,
   databaseWrites:APPLY?'apply mode only':'none; all database queries ran in READ ONLY transaction',checkpointPath:APPLY?checkpointPath:null,
   companiesPlan:plans.map(p=>({company:ownerKey(p.owner),changes:p.items.filter(x=>x.metadata).length,expectedCurrentStateSha256:p.baselineSha256,planSha256:planSignature(p),h03:publicItem(p.items.find(x=>x.course.id==='H03'))})),
  };
  if(APPLY){
   stage='checkpoint';let checkpoint=existsSync(checkpointPath)?JSON.parse(readFileSync(checkpointPath,'utf8')):{schemaVersion:1,manifestSha256,createdAt:new Date().toISOString(),expectedCompanies:EXPECTED_COMPANIES,companies:{}};
   ensure(checkpoint.schemaVersion===1&&checkpoint.manifestSha256===manifestSha256&&checkpoint.expectedCompanies===EXPECTED_COMPANIES,'Checkpoint does not match prepared publication');
   // Never skip DB verification because a local company checkpoint says done.
   for(const plan of plans){currentCompany=ownerKey(plan.owner);stage='company-transaction';
    checkpoint.companies[currentCompany]=await publishCompany(client,plan,courses,familyIds);checkpoint.updatedAt=new Date().toISOString();atomicCheckpoint(checkpoint);
    console.log(JSON.stringify({phase:'committed_verified',company:currentCompany,inserted:checkpoint.companies[currentCompany].inserted,companiesVerified:Object.keys(checkpoint.companies).length,total:EXPECTED_COMPANIES}));
   }
   report.companiesVerified=owners.length;report.publicationStatus='committed_and_readback_verified';
  }
  console.log(JSON.stringify(report));
 }
}catch(error){
 // Do not emit connection strings, environment values, SQL parameters or raw DB errors.
 console.error(JSON.stringify({mode:APPLY?'apply':VALIDATE_ONLY?'validate-only':'dry-run',stage,company:currentCompany,error:error instanceof PublicationError?error.message:'Validation or database request failed',code:typeof error?.code==='string'?error.code:undefined}));process.exitCode=1;
}finally{if(client)await client.end().catch(()=>{});}


