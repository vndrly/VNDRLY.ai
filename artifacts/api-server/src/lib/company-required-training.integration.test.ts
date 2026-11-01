import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {db,usersTable as users,vendorsTable as vendors,vendorPeopleTable as workers,userOrgMembershipsTable as memberships,canonicalServicesTable as canonical,vendorCapabilitiesTable as capabilities,serviceMappingsTable as mappings,workHubFormTemplatesTable as templates,workHubFormInstancesTable as instances} from '@workspace/db';
import {AssignmentMetadataSchema,LibraryDraftSchema,LibraryMetadataSchema} from '@workspace/api-zod';
import {companyRequiredTraining,trainingCatalog} from './company-required-training';
import {safetyTrainingContentHash} from './safety-training-content-hash';
import {subjectFingerprint} from '../services/service-matching/candidates';
import {ensureRequiredTraining} from '../work-hub/required-training';
import {runOnboardingWork} from '../work-hub/onboarding-worker';
import {getAssignedLibrary,submitGuidedTraining} from '../work-hub/training-service';

// Only fresh, explicitly marked loopback test storage is permitted. No schema
// reset, shared DB fallback, real catalogue IDs or production catalogue writes.
function guard(){
 const url=new URL(process.env.DATABASE_URL??'postgres://invalid/invalid');
 if(process.env.VNDRLY_TEST_DB_MODE!=='fresh-local'||process.env.VNDRLY_ISOLATED_TEST_DB!=='1'||url.hostname!=='127.0.0.1'||!/^vndrly_[a-f0-9]{32}_test$/.test(process.env.VNDRLY_FRESH_TEST_DB_NAME??'')||url.pathname!==`/${process.env.VNDRLY_FRESH_TEST_DB_NAME}`||process.env.TEST_DATABASE_URL!==process.env.DATABASE_URL||process.env.LISTEN_NOTIFY_DATABASE_URL!==process.env.DATABASE_URL||process.env.VNDRLY_LOAD_ENV_LOCAL!=='0')throw Error('Requires the exact fresh-local loopback test database and provenance markers');
}
const familyId='G00';
const content=LibraryDraftSchema.parse({kind:'training',title:'Synthetic required-course control check',description:'Test teaching, not a real curriculum publication',safetyRelated:true,training:{completionMode:'both',passingPercent:100,lessons:[{id:'intro',title:'Start',body:'A task is not ready while a required safeguard is uncertain.'},{id:'check',title:'Recognize the decision',body:'Hold the affected task and ask the responsible authority to verify the missing control. A signature does not create physical protection.'},{id:'finish',title:'Boundary',body:'A written result does not authorize technical work or restart.'}],questions:[{id:'q',prompt:'A required safeguard is uncertain. What should happen?',options:[{id:'a',label:'Hold the affected task and obtain appropriate verification.'},{id:'b',label:'Continue because a form is signed.'}],correctOptionIds:['a']}],guided:{steps:[{lessonId:'intro',questionIds:[]},{lessonId:'check',questionIds:['q']},{lessonId:'finish',questionIds:[]}],explanations:{scope_note:'An authored explanatory scope note remains part of course identity even though only q is assessed.',q:'A required uncertain control needs appropriate verification before exposure; a signature does not establish the actual safeguard.'}}}});
const sourceHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
const curriculumLength=trainingCatalog.curriculum.length,legacyLength=trainingCatalog.legacy.entries.length,additionalLength=trainingCatalog.additional.courses.length;
beforeEach(()=>{guard();expect(trainingCatalog.curriculum.some(c=>c.id===familyId)).toBe(false);trainingCatalog.curriculum.push({id:familyId,title:content.title,purpose:'Synthetic task verification',practicalBoundary:'No practical authority',sourceSha256:sourceHash,contentSha256:safetyTrainingContentHash(content),sourceVersion:'test-1',categoryId:'hazards'});});
afterEach(()=>{trainingCatalog.curriculum.splice(curriculumLength);trainingCatalog.legacy.entries.splice(legacyLength);trainingCatalog.additional.courses.splice(additionalLength);});

async function company(){
 const key=randomUUID();const[vendor]=await db.insert(vendors).values({name:`Synthetic required training ${key}`,contactName:'Synthetic',contactEmail:`${key}@example.invalid`}).returning();
 const owner={type:'vendor' as const,id:vendor.id};
 async function person(jobTitle:string,role:'admin'|'member'='member'){
  const[user]=await db.insert(users).values({username:randomUUID(),displayName:'Synthetic required learner',passwordHash:'test-only',role:'vendor'}).returning();
  const[worker]=await db.insert(workers).values({vendorId:vendor.id,userId:user.id,firstName:'Synthetic',email:`${randomUUID()}@example.invalid`,vendorRole:jobTitle==='Office Staff'?'office':'field',jobTitle}).returning();
  const[member]=await db.insert(memberships).values({userId:user.id,orgType:'vendor',vendorId:vendor.id,vendorPeopleId:worker.id,role}).returning();
  await db.update(users).set({activeMembershipId:member.id}).where(eq(users.id,user.id));
  return {user,worker,member,actor:{userId:user.id,role:'vendor',vendorId:vendor.id,activeMembershipId:member.id,membershipRole:role,sv:user.sessionVersion,source:'web' as const}};
 }
 const admin=await person('Office Staff','admin');return {vendor,owner,person,admin};
}
type Company=Awaited<ReturnType<typeof company>>;
type Person=Awaited<ReturnType<Company['person']>>;
async function selectService(c:Company){
 const code=`test_required_${randomUUID()}`;const[service]=await db.insert(canonical).values({code,name:`Synthetic scoped service ${randomUUID()}`,category:'Synthetic integration fixture',definition:'Synthetic staffed gate admission; never a production catalogue service.'}).returning();
 const[capability]=await db.insert(capabilities).values({vendorId:c.vendor.id,name:`Synthetic gate capability ${randomUUID()}`,description:'Synthetic staffed entrance duties',createdById:c.admin.user.id}).returning();
 const fingerprint=subjectFingerprint({subjectType:'vendor_capability',subjectId:capability.id,name:capability.name,description:capability.description,category:null});
 const[mapping]=await db.insert(mappings).values({subjectType:'vendor_capability',subjectId:capability.id,vendorCapabilityId:capability.id,canonicalServiceId:service.id,status:'active',confidence:'1.00000',explanation:'Synthetic test-only reviewed scope',evidence:{serviceMatching:{subjectFingerprint:fingerprint}},modelVersion:'test-only',mappingVersion:1,actorUserId:c.admin.user.id}).returning();
 trainingCatalog.legacy.entries.push({existingCanonicalId:service.id,code,name:service.name,canonicalDefinition:service.definition,relation:'exact',rationale:'Synthetic explicit gate role',roleMappings:[{role:'Gate attendant / staffed admission worker',familyIds:[familyId],rationale:'Synthetic role-specific requirement',trigger:'Actual gate duty'},{role:'Gate attendant / staffed admission worker',familyIds:[familyId],rationale:'Deliberate duplicate to exercise person/course dedup'}],masterServiceIds:[]});
 return {service,capability,mapping};
}
async function publish(c:Company,version=1,metadataOverrides:Record<string,unknown>={}){
 const id=randomUUID();const metadata=LibraryMetadataSchema.parse({kind:'training',seriesId:id,contentVersion:version,state:'published',content,safetyResource:{familyId,categoryId:'hazards',resourceType:'training',sourceVersion:'test-1',sourceSha256:sourceHash},...metadataOverrides});
 const[row]=await db.insert(templates).values({id,ownerOrgType:'vendor',ownerOrgId:c.vendor.id,name:content.title,currentVersion:version,definition:[],createdById:c.admin.user.id,libraryMetadata:metadata}).returning();return {row,metadata};
}
const synthetic=(plan:Awaited<ReturnType<typeof companyRequiredTraining>>)=>plan.requirements.filter(r=>r.familyId===familyId);
async function assigned(itemId:string){return db.select().from(instances).where(eq(instances.templateId,itemId));}
async function complete(c:Company,p:Person,id:string,wrong=false){
 const action=async(payload:unknown)=>{const read=await getAssignedLibrary(p.actor,id);return submitGuidedTraining(p.actor,id,{operationId:randomUUID(),owner:c.owner,context:{kind:'organization',id:c.vendor.id},payloadVersion:1,expectedVersion:read.version,payload});};
 await action({action:'advance',acknowledged:true});await action({action:'answer',questionId:'q',optionIds:[wrong?'b':'a']});
 if(wrong)await action({action:'remediate',questionId:'q',acknowledged:true});
 await action({action:'advance',acknowledged:true});return getAssignedLibrary(p.actor,id);
}

describe('platform-owned required training against isolated persistence',()=>{
 it('retains earned credit for an explicitly compatible simplified version, rejects mismatched versions and edited old content, and creates no repeat assignment',async()=>{
  const c=await company(),gate=await c.person('Gate attendant');await selectService(c);const old=await publish(c);
  await db.transaction(tx=>ensureRequiredTraining(tx,c.owner));const[assignment]=await assigned(old.row.id);await complete(c,gate,assignment.id);
  const revised=structuredClone(content);revised.training!.lessons[0].body+=' No extra assessor sign-off is required for online completion.';
  const sha=createHash('sha256').update(JSON.stringify(revised)).digest('hex'),course=trainingCatalog.curriculum.find(x=>x.id===familyId)!;
  course.compatibleVersions=[{sourceSha256:sourceHash,contentSha256:safetyTrainingContentHash(content)}];course.sourceSha256=sha;course.contentSha256=safetyTrainingContentHash(revised);
  const current=await publish(c,2,{content:revised,safetyResource:{familyId,categoryId:'hazards',resourceType:'training',sourceVersion:'test-2',sourceSha256:sha}});
  const plan=await companyRequiredTraining(db,c.owner);expect(synthetic(plan)).toEqual([expect.objectContaining({itemId:current.row.id,completed:true})]);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(0);expect(await assigned(current.row.id)).toHaveLength(0);
  const[retained]=await assigned(old.row.id);expect(AssignmentMetadataSchema.parse(retained.assignmentMetadata).status).toBe('completed');
  const wrongVersion=AssignmentMetadataSchema.parse(retained.assignmentMetadata);wrongVersion.contentVersion=999;await db.update(instances).set({assignmentMetadata:wrongVersion}).where(eq(instances.id,retained.id));
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0].completed).toBe(false);
  await db.update(instances).set({assignmentMetadata:retained.assignmentMetadata}).where(eq(instances.id,retained.id));
  const edited=structuredClone(old.metadata);edited.content!.training!.lessons[0].body+=' Unregistered edit';await db.update(templates).set({libraryMetadata:edited}).where(eq(templates.id,old.row.id));
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0].completed).toBe(false);
 });
 it('requires a supplemental exposure decision, adds only the matched role when true, and excludes false despite retained completion history',async()=>{
  const c=await company(),gate=await c.person('Gate attendant'),untargeted=await c.person('Gate supervisor'),office=await c.person('Office Staff');
  const selected=await selectService(c),masterServiceId=`TEST-MASTER-${randomUUID()}`;
  const legacy=trainingCatalog.legacy.entries.find(e=>e.existingCanonicalId===selected.service.id&&e.code===selected.service.code)!;
  // G00 is exclusively supplemental in this test, not already required through
  // the ordinary service-role baseline. All altered entries are synthetic.
  legacy.roleMappings=[];legacy.masterServiceIds=[masterServiceId];
  trainingCatalog.additional.courses.push({courseId:familyId,title:content.title,masterServiceIds:[masterServiceId],roleMappings:[{role:'Gate attendant / staffed admission worker',familyIds:[familyId],rationale:'Synthetic exposure-dependent gate knowledge',trigger:'Confirm the synthetic actual exposure before requiring the course',masterServiceIds:[masterServiceId],requiresExposureConfirmation:true,sourceUrls:['https://example.invalid/synthetic-test-scope']}]});
  const course=await publish(c);
  const missing=await companyRequiredTraining(db,c.owner);
  expect(missing.provisional).toBe(true);
  expect(missing.conditionalCourseGaps).toHaveLength(2);
  expect(missing.conditionalCourseGaps).toEqual(expect.arrayContaining([gate,untargeted].map(person=>expect.objectContaining({userId:person.user.id,serviceId:selected.service.code,familyId,role:'Gate attendant / staffed admission worker'}))));
  expect(synthetic(missing)).toHaveLength(0);expect(missing.completed).toBe(0);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(0);expect(await assigned(course.row.id)).toHaveLength(0);

  const decide=async(applies:boolean,userIds:number[]=[gate.user.id],staffRoleIds:string[]=[])=>{
   const metadata=LibraryMetadataSchema.parse({...course.metadata,trainingPolicy:{title:'Synthetic applicability decision',serviceApplicability:[{serviceId:selected.service.code,applies,userIds,staffRoleIds,reason:applies?'Actual synthetic gate exposure confirmed':'Actual synthetic gate exposure reviewed and absent'}]}});
   await db.update(templates).set({libraryMetadata:metadata}).where(eq(templates.id,course.row.id));
  };
  await decide(true,[]);
  const noTargets=await companyRequiredTraining(db,c.owner);
  expect(noTargets.conditionalCourseGaps).toHaveLength(2);expect(synthetic(noTargets)).toHaveLength(0);
  await decide(true);
  const applicable=await companyRequiredTraining(db,c.owner);
  expect(applicable.conditionalCourseGaps).toEqual([expect.objectContaining({userId:untargeted.user.id,serviceId:selected.service.code,familyId})]);
  expect(synthetic(applicable)).toEqual([expect.objectContaining({userId:gate.user.id,membershipId:gate.member.id,serviceIds:[selected.service.code],itemId:course.row.id,completed:false,unavailable:false})]);
  expect(synthetic(applicable).some(r=>r.userId===office.user.id)).toBe(false);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(1);
  const[assignment]=await assigned(course.row.id);expect(assignment.assigneeUserId).toBe(gate.user.id);
  await complete(c,gate,assignment.id);
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0].completed).toBe(true);

  await decide(false);
  const excluded=await companyRequiredTraining(db,c.owner);
  expect(excluded.conditionalCourseGaps).toEqual([expect.objectContaining({userId:untargeted.user.id,serviceId:selected.service.code,familyId})]);expect(synthetic(excluded)).toHaveLength(0);expect(excluded.completed).toBe(0);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(0);
  const retained=await assigned(course.row.id);expect(retained).toHaveLength(1);expect(retained[0].id).toBe(assignment.id);expect(AssignmentMetadataSchema.parse(retained[0].assignmentMetadata).status).toBe('completed');
  await decide(true,[],['title:gate supervisor']);
  const positionScoped=await companyRequiredTraining(db,c.owner);
  expect(synthetic(positionScoped)).toEqual([expect.objectContaining({userId:untargeted.user.id,membershipId:untargeted.member.id,completed:false})]);
  expect(positionScoped.conditionalCourseGaps).toEqual([expect.objectContaining({userId:gate.user.id,serviceId:selected.service.code,familyId})]);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(1);
  expect((await assigned(course.row.id)).map(row=>row.assigneeUserId).sort()).toEqual([gate.user.id,untargeted.user.id].sort());
 });

 it('exposes a required service-scope confirmation explicitly rather than hiding it behind common-course unavailability',async()=>{
  const c=await company();await c.person('Gate attendant');const selected=await selectService(c);await publish(c);
  const legacy=trainingCatalog.legacy.entries.find(entry=>entry.existingCanonicalId===selected.service.id&&entry.code===selected.service.code)!;
  legacy.relation='related_scope';legacy.rationale='Synthetic related component requires confirmation of the actual accepted job scope';
  legacy.roleMappings=legacy.roleMappings.map(rule=>({...rule,scopeMustBeConfirmed:true}));
  const plan=await companyRequiredTraining(db,c.owner);
  expect(plan.scopeIssues).toEqual(expect.arrayContaining([expect.objectContaining({serviceId:selected.service.code})]));
  expect(plan.provisional).toBe(true);
 });

 it('uses current service fingerprints and actual roles, excludes vendor extras and unavailable people, and scopes publication to the company',async()=>{
  const c=await company(),gate=await c.person('Gate attendant'),office=await c.person('Office Staff'),inactive=await c.person('Gate attendant'),suspended=await c.person('Gate attendant');
  await db.update(workers).set({isActive:false}).where(eq(workers.id,inactive.worker.id));await db.update(users).set({suspendedAt:new Date()}).where(eq(users.id,suspended.user.id));
  const selected=await selectService(c),course=await publish(c);const before=await companyRequiredTraining(db,c.owner);
  expect(synthetic(before)).toEqual([expect.objectContaining({userId:gate.user.id,membershipId:gate.member.id,itemId:course.row.id,completed:false,unavailable:false})]);
  expect(before.audience.map(p=>p.userId)).not.toContain(inactive.user.id);expect(before.audience.map(p=>p.userId)).not.toContain(suspended.user.id);expect(synthetic(before).some(r=>r.userId===office.user.id)).toBe(false);
  const extraId=randomUUID();await db.insert(templates).values({id:extraId,ownerOrgType:'vendor',ownerOrgId:c.vendor.id,name:'Vendor extra not platform baseline',definition:[],createdById:c.admin.user.id,libraryMetadata:LibraryMetadataSchema.parse({kind:'training',seriesId:extraId,contentVersion:1,state:'published',content:{...content,title:'Vendor extra not platform baseline'}})});
  const extra=AssignmentMetadataSchema.parse({assignmentId:randomUUID(),sourceItemId:extraId,contentVersion:1,membershipId:gate.member.id,status:'completed',assignedAt:new Date().toISOString(),dueAt:new Date(Date.now()+86400000).toISOString()});await db.insert(instances).values({templateId:extraId,templateVersion:1,assigneeUserId:gate.user.id,definitionSnapshot:[],assignmentMetadata:extra});
  const after=await companyRequiredTraining(db,c.owner);expect(after.required).toBe(before.required);expect(after.completed).toBe(before.completed);expect(after.items.has(familyId)).toBe(true);expect([...after.items.values()].some(i=>i.record.id===extraId)).toBe(false);
  const other=await company();await selectService(other);await other.person('Gate attendant');expect(synthetic(await companyRequiredTraining(db,other.owner))).toEqual([expect.objectContaining({unavailable:true,itemId:''})]);
  await db.update(capabilities).set({description:'Changed scope after classification'}).where(eq(capabilities.id,selected.capability.id));const stale=await companyRequiredTraining(db,c.owner);expect(synthetic(stale)).toHaveLength(0);expect(stale.unmappedServiceIds).toContain(`capability:${selected.capability.id}`);
 });

 it('requires both the platform source hash and genuinely matching authored content, then chooses the newest trusted content version',async()=>{
  const c=await company();await c.person('Gate attendant');await selectService(c);const course=await publish(c);
  const check=()=>companyRequiredTraining(db,c.owner);expect(synthetic(await check())[0].unavailable).toBe(false);
  await db.update(templates).set({libraryMetadata:{...course.metadata,safetyResource:{...course.metadata.safetyResource!,sourceSha256:'f'.repeat(64)}}}).where(eq(templates.id,course.row.id));expect(synthetic(await check())[0].unavailable).toBe(true);
  await db.update(templates).set({libraryMetadata:{...course.metadata,content:{...content,title:'Altered while retaining the platform hash'}}}).where(eq(templates.id,course.row.id));expect(synthetic(await check())[0].unavailable).toBe(true);
  await db.update(templates).set({libraryMetadata:{...course.metadata,state:'draft'}}).where(eq(templates.id,course.row.id));expect(synthetic(await check())[0].unavailable).toBe(true);
  await db.update(templates).set({libraryMetadata:course.metadata}).where(eq(templates.id,course.row.id));const newer=await publish(c,2);expect(synthetic(await check())[0]).toMatchObject({itemId:newer.row.id,contentVersion:2,unavailable:false});
 });

 it('credits the exact course after jsonb explanation-key reordering but rejects changed lesson teaching',async()=>{
  const c=await company(),learner=await c.person('Gate attendant');await selectService(c);
  const explanationEntries=Object.entries(content.training!.guided!.explanations);
  expect(explanationEntries).toHaveLength(2);
  const reordered=LibraryDraftSchema.parse({...content,training:{...content.training!,guided:{...content.training!.guided!,explanations:Object.fromEntries([...explanationEntries].reverse())}}});
  // This reproduces the failure of raw JSON.stringify identity without changing
  // an authored word, question, lesson or explanation value.
  expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(content));
  expect(createHash('sha256').update(JSON.stringify(reordered)).digest('hex')).not.toBe(sourceHash);
  expect(safetyTrainingContentHash(reordered)).toBe(safetyTrainingContentHash(content));
  const course=await publish(c,1,{content:reordered});
  const[stored]=await db.select().from(templates).where(eq(templates.id,course.row.id));
  const readback=LibraryMetadataSchema.parse(stored.libraryMetadata);
  expect(safetyTrainingContentHash(readback.content)).toBe(safetyTrainingContentHash(content));
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0]).toMatchObject({itemId:course.row.id,unavailable:false});
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(1);
  const[assignment]=await assigned(course.row.id);await complete(c,learner,assignment.id);
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0]).toMatchObject({completed:true,unavailable:false});
  const changed=LibraryDraftSchema.parse({...reordered,training:{...reordered.training!,lessons:reordered.training!.lessons.map((lesson,index)=>index===1?{...lesson,body:'Changed teaching: continue without verifying the safeguard.'}:lesson)}});
  expect(safetyTrainingContentHash(changed)).not.toBe(safetyTrainingContentHash(content));
  await db.update(templates).set({libraryMetadata:{...readback,content:changed}}).where(eq(templates.id,course.row.id));
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0]).toMatchObject({completed:false,unavailable:true});
 });

 it('counts original-correct and explicitly remediated completion equally without rewriting scores, and gates version, membership and refresher evidence',async()=>{
  const c=await company(),first=await c.person('Gate attendant'),remediated=await c.person('Gate attendant');await selectService(c);const course=await publish(c);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(2);const rows=await assigned(course.row.id);expect(rows).toHaveLength(2);
  const a=rows.find(r=>r.assigneeUserId===first.user.id)!,b=rows.find(r=>r.assigneeUserId===remediated.user.id)!;
  const original=await complete(c,first,a.id),corrected=await complete(c,remediated,b.id,true);
  expect(original.assignment.progress.guided?.scores).toMatchObject({originalPercent:100,remediatedPercent:100,remediationCount:0});expect(corrected.assignment.progress.guided?.scores).toMatchObject({originalPercent:0,remediatedPercent:100,remediationCount:1});expect(corrected.assignment.progress.guided?.responses.q.originalOptionIds).toEqual(['b']);
  const coverage=await companyRequiredTraining(db,c.owner);expect(synthetic(coverage).filter(r=>r.completed)).toHaveLength(2);expect(coverage.completed).toBe(2);
  const foreign=await company();await db.update(instances).set({assignmentMetadata:{...corrected.assignment,membershipId:foreign.admin.member.id}}).where(eq(instances.id,b.id));expect(synthetic(await companyRequiredTraining(db,c.owner)).filter(r=>r.completed)).toHaveLength(1);
  await db.update(instances).set({assignmentMetadata:{...corrected.assignment,refresherDueAt:'2020-01-01T00:00:00Z'}}).where(eq(instances.id,b.id));expect(synthetic(await companyRequiredTraining(db,c.owner)).filter(r=>r.completed)).toHaveLength(1);
  await db.update(instances).set({assignmentMetadata:corrected.assignment}).where(eq(instances.id,b.id));await publish(c,2);expect(synthetic(await companyRequiredTraining(db,c.owner)).filter(r=>r.completed)).toHaveLength(0);
 });

 it('schedules an expired refresher once without reviving historical completion credit or removing its due date',async()=>{
  const c=await company(),learner=await c.person('Gate attendant');await selectService(c);const course=await publish(c);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(1);
  const[original]=await assigned(course.row.id);const completed=await complete(c,learner,original.id);
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0].completed).toBe(true);
  const expiredDueAt='2020-01-01T00:00:00Z';
  await db.update(instances).set({assignmentMetadata:{...completed.assignment,refresherDueAt:expiredDueAt,refresherScheduledAt:null}}).where(eq(instances.id,original.id));
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0].completed).toBe(false);

  const scanAt=new Date();await runOnboardingWork(scanAt);
  let rows=await assigned(course.row.id);expect(rows).toHaveLength(2);
  const history=AssignmentMetadataSchema.parse(rows.find(r=>r.id===original.id)!.assignmentMetadata);
  expect(history.status).toBe('completed');expect(history.refresherDueAt).toBe(expiredDueAt);
  expect(history.refresherScheduledAt).toBe(scanAt.toISOString());
  const renewal=rows.find(r=>r.id!==original.id)!;
  expect(AssignmentMetadataSchema.parse(renewal.assignmentMetadata)).toMatchObject({status:'assigned',membershipId:learner.member.id});
  const waiting=await companyRequiredTraining(db,c.owner);expect(synthetic(waiting)[0].completed).toBe(false);expect(waiting.completed).toBe(0);

  await runOnboardingWork(new Date(scanAt.getTime()+60000));
  await db.transaction(tx=>ensureRequiredTraining(tx,c.owner));
  rows=await assigned(course.row.id);expect(rows).toHaveLength(2);expect(rows.some(r=>r.id===renewal.id)).toBe(true);
  expect(AssignmentMetadataSchema.parse(rows.find(r=>r.id===original.id)!.assignmentMetadata).refresherDueAt).toBe(expiredDueAt);
  expect(synthetic(await companyRequiredTraining(db,c.owner))[0].completed).toBe(false);
 });

 it('does not let 25 expired suspended-user or vanished-membership records consume the active renewal batch',async()=>{
  const c=await company(),learner=await c.person('Gate attendant'),suspended=await c.person('Gate attendant');await selectService(c);const course=await publish(c);
  const missingMembershipId=1000000000+c.admin.member.id;
  expect(await db.select({id:memberships.id}).from(memberships).where(eq(memberships.id,missingMembershipId))).toHaveLength(0);
  const expiredDueAt='2020-01-01T00:00:00Z';
  // Insert the invalid histories before the valid candidate: these are the
  // records which previously occupied LIMIT 25 indefinitely. The nonexistent
  // membership is JSON history only; no actual membership is deleted.
  const blocked=await db.insert(instances).values(Array.from({length:25},(_,index)=>({templateId:course.row.id,templateVersion:1,assigneeUserId:index<13?suspended.user.id:learner.user.id,definitionSnapshot:[],createdAt:new Date('2020-01-01T00:00:00Z'),assignmentMetadata:AssignmentMetadataSchema.parse({assignmentId:randomUUID(),sourceItemId:course.row.id,contentVersion:1,membershipId:index<13?suspended.member.id:missingMembershipId,status:'completed',assignedAt:'2019-01-01T00:00:00Z',dueAt:'2019-02-01T00:00:00Z',refresherDueAt:expiredDueAt,refresherScheduledAt:null})}))).returning();
  await db.update(users).set({suspendedAt:new Date()}).where(eq(users.id,suspended.user.id));
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner,learner.user.id))).toBe(1);
  const active=(await assigned(course.row.id)).find(row=>!blocked.some(old=>old.id===row.id))!;
  const completed=await complete(c,learner,active.id);
  await db.update(instances).set({assignmentMetadata:{...completed.assignment,refresherDueAt:expiredDueAt,refresherScheduledAt:null}}).where(eq(instances.id,active.id));

  const scanAt=new Date();await runOnboardingWork(scanAt);
  let rows=await assigned(course.row.id);expect(rows).toHaveLength(27);
  const renewed=rows.find(row=>row.id!==active.id&&!blocked.some(old=>old.id===row.id))!;
  expect(renewed.assigneeUserId).toBe(learner.user.id);
  expect(AssignmentMetadataSchema.parse(renewed.assignmentMetadata)).toMatchObject({status:'assigned',membershipId:learner.member.id});
  expect(AssignmentMetadataSchema.parse(rows.find(row=>row.id===active.id)!.assignmentMetadata)).toMatchObject({refresherDueAt:expiredDueAt,refresherScheduledAt:scanAt.toISOString()});
  for(const invalid of blocked)expect(AssignmentMetadataSchema.parse(rows.find(row=>row.id===invalid.id)!.assignmentMetadata)).toMatchObject({refresherDueAt:expiredDueAt,refresherScheduledAt:null});
  expect(synthetic(await companyRequiredTraining(db,c.owner))).toEqual([expect.objectContaining({userId:learner.user.id,completed:false})]);
  await runOnboardingWork(new Date(scanAt.getTime()+60000));rows=await assigned(course.row.id);expect(rows).toHaveLength(27);
 });

 it('recomputes new hires and changed roles, deduplicates overlapping services/rules and safely reuses assignments on repeated scans',async()=>{
  const c=await company(),gate=await c.person('Gate attendant'),office=await c.person('Office Staff');await selectService(c);await selectService(c);const course=await publish(c);
  expect(synthetic(await companyRequiredTraining(db,c.owner))).toHaveLength(1);expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(1);expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(0);
  const original=(await assigned(course.row.id))[0];const hire=await c.person('Gate attendant');expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner,hire.user.id))).toBe(1);
  expect((await assigned(course.row.id)).some(r=>r.assigneeUserId===office.user.id)).toBe(false);await db.update(workers).set({jobTitle:'Gate attendant',vendorRole:'field'}).where(eq(workers.id,office.worker.id));expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner,office.user.id))).toBe(1);
  expect(await db.transaction(tx=>ensureRequiredTraining(tx,c.owner))).toBe(0);const final=await assigned(course.row.id);expect(final).toHaveLength(3);expect(new Set(final.map(r=>r.assigneeUserId)).size).toBe(3);expect(final.find(r=>r.assigneeUserId===gate.user.id)?.id).toBe(original.id);
  const plan=await companyRequiredTraining(db,c.owner);expect(synthetic(plan)).toHaveLength(3);expect(synthetic(plan).every(r=>r.serviceIds.length===2)).toBe(true);
 });
});
