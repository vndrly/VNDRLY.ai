import {it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db,usersTable as users,vendorsTable as vendors,userOrgMembershipsTable as members} from "@workspace/db";
import {CompanySafetyReadinessSchema} from "@workspace/api-zod";
import {saveLibrary,changeLibraryState} from "./library-service";
import {previewLibraryAssignment,assignLibrary,employeeChecklist} from "./library-assignments";
import {getAssignedLibrary,submitAssignedLibrary} from "./training-service";
import {companySafetyReadiness} from "../lib/company-safety-readiness";
it("counts company safety requirements and actual completion with tenant isolation",async()=>{
 if(process.env.VNDRLY_TEST_DB_MODE!=="fresh-local"||new URL(process.env.DATABASE_URL!).hostname!=="127.0.0.1")throw Error("Requires fresh local test database");
 const [v]=await db.insert(vendors).values({name:randomUUID(),contactName:"Synthetic",contactEmail:"safety@example.invalid"}).returning();
 async function person(role:"admin"|"member") {const [u]=await db.insert(users).values({username:randomUUID(),displayName:"Synthetic",passwordHash:"test-only",role:"vendor"}).returning();const [m]=await db.insert(members).values({userId:u.id,orgType:"vendor",vendorId:v.id,role}).returning();await db.update(users).set({activeMembershipId:m.id}).where(eq(users.id,u.id));return {userId:u.id,role:"vendor",membershipRole:role,vendorId:v.id,activeMembershipId:m.id,sv:u.sessionVersion};}
 const admin=await person("admin"),employee=await person("member"),owner={type:"vendor" as const,id:v.id};
 const command=(payload:any,expectedVersion=0)=>({operationId:randomUUID(),owner,context:{kind:"organization" as const,id:v.id},payloadVersion:1 as const,expectedVersion,payload});
 const draft=await saveLibrary(admin,command({kind:"policy",title:"Synthetic safety policy",policyText:"Actual fictional policy text",safetyRelated:true}));const id=String(draft.resource.itemId);await changeLibraryState(admin,id,command({},0),"publish");
 const initial=CompanySafetyReadinessSchema.parse(await companySafetyReadiness(admin));expect(initial.categories.find(c=>c.id==="acknowledgements")).toMatchObject({required:2,completed:0,outstanding:2});expect(initial.provisional).toBe(true);
 const request={itemId:id,audience:{mode:"selected",userIds:[employee.userId],groupIds:[]}};const preview=await previewLibraryAssignment(admin,request);await assignLibrary(admin,command({...request,previewFingerprint:preview.previewFingerprint},preview.version));
 const item=(await employeeChecklist(employee)).items[0];const current=await getAssignedLibrary(employee,item.instanceId);await submitAssignedLibrary(employee,item.instanceId,command({acknowledged:true},current.version),"complete");
 const result=await companySafetyReadiness(admin);expect(result.categories.find(c=>c.id==="acknowledgements")).toMatchObject({required:2,completed:1,outstanding:1,points:5});
 const [other]=await db.insert(vendors).values({name:randomUUID(),contactName:"Other",contactEmail:"other@example.invalid"}).returning();await expect(companySafetyReadiness({...admin,vendorId:other.id})).rejects.toBeTruthy();
 expect(JSON.stringify(result)).not.toContain("Synthetic");
},30000);
