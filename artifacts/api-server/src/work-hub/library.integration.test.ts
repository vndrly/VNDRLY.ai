import {it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db,usersTable as users,vendorsTable as vendors,userOrgMembershipsTable as members,workHubFormTemplatesTable as templates} from "@workspace/db";
import {LibraryEntryNoticeSchema} from "@workspace/api-zod";
import {saveLibrary,changeLibraryState} from "./library-service";
import {previewLibraryAssignment,assignLibrary,employeeChecklist} from "./library-assignments";
import {getAssignedLibrary,submitAssignedLibrary} from "./training-service";
import {ensureOnboarding,updateOnboardingRule} from "./onboarding-service";
import {assertRequiredWorkClear} from "./required-work-guard";
it("persists reviewed policy assignment, replay, completion and protected readback in isolated PostgreSQL",async()=>{
 if(process.env.VNDRLY_TEST_DB_MODE!=="fresh-local" || new URL(process.env.DATABASE_URL!).hostname!=="127.0.0.1") throw Error("Requires fresh local test database");
 const suffix=randomUUID();const [v]=await db.insert(vendors).values({name:`Library ${suffix}`,contactName:"Synthetic",contactEmail:`${suffix}@example.invalid`}).returning();
 async function person(role:"admin"|"member") {const [u]=await db.insert(users).values({username:randomUUID(),displayName:"Synthetic user",passwordHash:"test-only",role:"vendor"}).returning();const [m]=await db.insert(members).values({userId:u.id,orgType:"vendor",vendorId:v.id,role}).returning();await db.update(users).set({activeMembershipId:m.id}).where(eq(users.id,u.id));return {userId:u.id,role:"vendor",membershipRole:role,vendorId:v.id,activeMembershipId:m.id,sv:u.sessionVersion,source:"web" as const};}
 const admin=await person("admin"),employee=await person("member"),owner={type:"vendor" as const,id:v.id};
 const command=(payload:any,expectedVersion=0)=>({operationId:randomUUID(),owner,context:{kind:"organization" as const,id:v.id},payloadVersion:1 as const,expectedVersion,payload});
 const created=await saveLibrary(admin,command({kind:"policy",title:"Synthetic security policy",policyText:"Read the supplied company policy."}));const itemId=String(created.resource.itemId);
 await changeLibraryState(admin,itemId,command({},0),"publish");
 const request={itemId,audience:{mode:"selected",userIds:[employee.userId],groupIds:[]},requiredBeforeWork:true};const preview=await previewLibraryAssignment(admin,request);const envelope=command({...request,previewFingerprint:preview.previewFingerprint},preview.version);const assigned=await assignLibrary(admin,envelope);expect((await assignLibrary(admin,envelope)).replayed).toBe(true);
 const checklist=await employeeChecklist(employee);expect(checklist.items).toHaveLength(1);const id=checklist.items[0].instanceId;
 const entry=await ensureOnboarding(employee);expect(LibraryEntryNoticeSchema.parse(entry).present[0].instanceId).toBe(id);
 await expect(db.transaction(tx=>assertRequiredWorkClear(tx,employee.userId,owner))).rejects.toMatchObject({code:"work_hub.required_completion"});
 const before=await getAssignedLibrary(employee,id);await submitAssignedLibrary(employee,id,command({acknowledged:true},before.version),"complete");const after=await getAssignedLibrary(employee,id);expect(after.assignment.status).toBe("completed");expect(after.history[0].values).toMatchObject({acknowledged:true});await expect(db.transaction(tx=>assertRequiredWorkClear(tx,employee.userId,owner))).resolves.toBeUndefined();
 await expect(getAssignedLibrary(admin,id)).rejects.toBeTruthy();expect(assigned.resource).toBeTruthy();
 const training=await saveLibrary(admin,command({kind:"training",title:"Synthetic induction",training:{completionMode:"both",lessons:[{id:"intro",title:"Introduction",body:"Read this fictional lesson."}],questions:[{id:"q",prompt:"Select A",options:[{id:"a",label:"A"},{id:"b",label:"B"}],correctOptionIds:["a"]}]}}));const trainingId=String(training.resource.itemId);await changeLibraryState(admin,trainingId,command({},0),"publish");
 const bundle=await saveLibrary(admin,command({title:"Synthetic onboarding",bundle:{entries:[{templateId:trainingId,contentVersion:1,requiredBeforeWork:true}]}}),undefined,true);const bundleId=String(bundle.resource.itemId);await changeLibraryState(admin,bundleId,command({},0),"publish");await updateOnboardingRule(admin,bundleId,command({enabled:true,roles:["member"],groupIds:[]},1));
 const hire=await person("member");await expect(db.transaction(tx=>assertRequiredWorkClear(tx,hire.userId,owner))).rejects.toMatchObject({code:"work_hub.required_completion"});
 const hired=await ensureOnboarding(hire);expect(hired.items).toHaveLength(1);const trainingInstance=hired.items[0].instanceId;const lesson=await getAssignedLibrary(hire,trainingInstance);expect(JSON.stringify(lesson)).not.toContain("correctOptionIds");
 await submitAssignedLibrary(hire,trainingInstance,command({acknowledged:true,lessonIds:["intro"],answers:{q:["b"]}},lesson.version),"attempt");const failed=await getAssignedLibrary(hire,trainingInstance);expect(failed.assignment.status).toBe("in_progress");
 await submitAssignedLibrary(hire,trainingInstance,command({acknowledged:true,lessonIds:["intro"],answers:{q:["a"]}},failed.version),"attempt");expect((await getAssignedLibrary(hire,trainingInstance)).assignment.status).toBe("completed");await expect(db.transaction(tx=>assertRequiredWorkClear(tx,hire.userId,owner))).resolves.toBeUndefined();

},30000);
