import {it,expect}from'vitest';
import {randomUUID}from'node:crypto';
import {eq}from'drizzle-orm';
import {db,usersTable as users,vendorsTable as vendors,vendorPeopleTable as workers,userOrgMembershipsTable as memberships,workHubFormTemplatesTable as templates,workHubCrewsTable as groups}from'@workspace/db';
import {LibraryMetadataSchema}from'@workspace/api-zod';
import {saveLibrary,changeLibraryState}from'./library-service';
import {employeeChecklist}from'./library-assignments';
import {getAssignedLibrary}from'./training-service';
import {readTrainingPolicy,saveTrainingPolicy,ensurePolicyTraining,trainingPositionIds}from'./training-course-policy';
it('recognizes preserved position aliases without changing operational permissions',()=>{
 expect(trainingPositionIds({jobTitle:'Old Technician',roles:['driver'],vendorRole:'field'},[{id:'tech',label:'Gas Technician',aliases:['Old Technician']}])).toEqual(expect.arrayContaining(['staff:tech','operation:driver','operation:field','title:old technician']));
});
it('saves tenant-scoped policy details, assigns new hires and changed roles, and preserves existing assignments',async()=>{
 if(process.env.VNDRLY_TEST_DB_MODE!=='fresh-local'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Fresh isolated database required');
 const key=randomUUID();const[vendor]=await db.insert(vendors).values({name:'Policy test '+key,contactName:'Synthetic',contactEmail:key+'@example.invalid'}).returning();
 const owner={type:'vendor' as const,id:vendor.id};
 async function person(role:'admin'|'member',jobTitle:string,old=false){
  const[user]=await db.insert(users).values({username:randomUUID(),displayName:'Synthetic policy learner',passwordHash:'test-only',role:'vendor'}).returning();
  const[worker]=await db.insert(workers).values({vendorId:vendor.id,userId:user.id,firstName:'Synthetic',email:randomUUID()+'@example.invalid',jobTitle,vendorRole:'field'}).returning();
  const[member]=await db.insert(memberships).values({userId:user.id,orgType:'vendor',vendorId:vendor.id,vendorPeopleId:worker.id,role,...(old?{createdAt:new Date('2020-01-01T00:00:00Z')}:{})}).returning();
  return {actor:{userId:user.id,role:'vendor',vendorId:vendor.id,activeMembershipId:member.id,membershipRole:role,sv:user.sessionVersion,source:'web' as const},worker};
 }
 const admin=await person('admin','Safety Manager',true),existing=await person('member','Office Staff',true);
 const command=(payload:unknown,expectedVersion=0)=>({operationId:randomUUID(),owner,context:{kind:'organization' as const,id:vendor.id},payloadVersion:1 as const,payload,expectedVersion});
 async function item(kind:'training'|'policy'){
  const created=await saveLibrary(admin.actor,command({kind,title:'H13 policy test '+kind,safetyRelated:true,...(kind==='policy'?{policyText:'Assign training to the relevant roles.'}:{training:{completionMode:'checkoff',lessons:[{id:'lesson',title:'Lesson',body:'Learn the actual detector limits.'}]}})}));
  const id=String(created.resource.itemId);await changeLibraryState(admin.actor,id,command({},0),'publish');
  const[row]=await db.select().from(templates).where(eq(templates.id,id));const metadata=LibraryMetadataSchema.parse(row.libraryMetadata);metadata.safetyResource={familyId:'H13',resourceType:kind,categoryId:'hazards',sourceVersion:'4.0',sourceSha256:'b'.repeat(64)};await db.update(templates).set({libraryMetadata:metadata}).where(eq(templates.id,id));return id;
 }
 const trainingId=await item('training'),policyId=await item('policy');
 const initial=await readTrainingPolicy(admin.actor,policyId);expect(initial.trainingItemId).toBe(trainingId);
 // A catalog position can be required before its first employee is hired.
 await db.update(vendors).set({staffRoleCatalog:{version:1,entries:[{id:'gas',label:'Gas Technician',group:'Technical'}]}}).where(eq(vendors.id,vendor.id));
 const[emptyCrew]=await db.insert(groups).values({ownerOrgType:'vendor',ownerOrgId:vendor.id,createdById:admin.actor.userId,name:'Empty synthetic group'}).returning();
 const policy={...initial.policy,requiredStaffRoleIds:['staff:gas'],requiredGroupIds:[emptyCrew.id],requiredUserIds:[existing.actor.userId],newHireRequired:true,roleChangeRequired:false};
 await saveTrainingPolicy(admin.actor,policyId,command(policy,initial.version));
 expect((await readTrainingPolicy(admin.actor,policyId)).policy.purpose).toBe(policy.purpose);
 await expect(readTrainingPolicy(existing.actor,policyId)).rejects.toBeTruthy();
 await expect(saveTrainingPolicy(admin.actor,policyId,command({...policy,requiredUserIds:[2147483000]},initial.version+1))).rejects.toBeTruthy();
 const hired=await person('member','Gas Technician');
 await db.transaction(tx=>ensurePolicyTraining(tx,owner,hired.actor.userId));
 const assigned=(await employeeChecklist(hired.actor)).items;expect(assigned).toHaveLength(1);expect((await getAssignedLibrary(hired.actor,assigned[0].instanceId)).metadata.safetyResource?.familyId).toBe('H13');
 await db.transaction(tx=>ensurePolicyTraining(tx,owner,existing.actor.userId));expect((await employeeChecklist(existing.actor)).items).toHaveLength(0);
 await db.update(workers).set({jobTitle:'Gas Technician'}).where(eq(workers.id,existing.worker.id));
 await db.transaction(tx=>ensurePolicyTraining(tx,owner,existing.actor.userId));expect((await employeeChecklist(existing.actor)).items).toHaveLength(0);
 const saved=await readTrainingPolicy(admin.actor,policyId);await saveTrainingPolicy(admin.actor,policyId,command({...saved.policy,roleChangeRequired:true},saved.version));
 await db.transaction(tx=>ensurePolicyTraining(tx,owner,existing.actor.userId));expect((await employeeChecklist(existing.actor)).items).toHaveLength(1);
 await db.transaction(tx=>ensurePolicyTraining(tx,owner,hired.actor.userId));expect((await employeeChecklist(hired.actor)).items[0].instanceId).toBe(assigned[0].instanceId);
 const concurrent=await person('member','Gas Technician');
 await Promise.all([db.transaction(tx=>ensurePolicyTraining(tx,owner,concurrent.actor.userId)),db.transaction(tx=>ensurePolicyTraining(tx,owner,concurrent.actor.userId))]);
 expect((await employeeChecklist(concurrent.actor)).items).toHaveLength(1);
 await db.update(users).set({suspendedAt:new Date()}).where(eq(users.id,existing.actor.userId));
 const unavailable=await readTrainingPolicy(admin.actor,policyId);expect(unavailable.people.some(p=>p.userId===existing.actor.userId)).toBe(false);
 await saveTrainingPolicy(admin.actor,policyId,command({...unavailable.policy},unavailable.version));
 const retained=await readTrainingPolicy(admin.actor,policyId);expect(retained.policy.requiredUserIds).toContain(existing.actor.userId);
 await saveTrainingPolicy(admin.actor,policyId,command({...retained.policy,requiredUserIds:[]},retained.version));
 expect((await readTrainingPolicy(admin.actor,policyId)).policy.requiredUserIds).toEqual([]);
},30000);
