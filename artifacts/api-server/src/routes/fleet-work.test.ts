import express from "express";import request from "supertest";import {it,expect,vi} from "vitest";import {randomUUID} from "node:crypto";
const scope={owner:{type:"vendor",id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};
it("keeps private source deposition separate from canonical commands and disables shared response caching",async()=>{
 const {createFleetWorkRouter}=await import("./fleet-work"),actor={userId:2,companyId:7},raw={operationId:randomUUID()},retained={status:"retained_for_review",canonicalApplied:false},retainOriginal=vi.fn(async()=>retained),apply=vi.fn();
 const app=express().use(express.json()).use(createFleetWorkRouter({actor:()=>actor as never,enabled:()=>true,repository:{retainOriginal} as never,service:{apply} as never}));
 const result=await request(app).post("/fleet/work/originals").send(raw);
 expect(result.status).toBe(200);expect(result.headers["cache-control"]).toContain("no-store");expect(result.body).toEqual(retained);expect(retainOriginal).toHaveBeenCalledWith(actor,raw);expect(apply).not.toHaveBeenCalled();
});
it("returns evidence acceptance only from a persisted complete original upload, with no private source or invented physical proof",async()=>{
 const {createFleetWorkRouter}=await import("./fleet-work"),id=randomUUID(),operationId=randomUUID(),evidenceId=randomUUID(),at=new Date().toISOString();
 const session={version:2,id,operationId,scope,fingerprint:"a".repeat(64),localEvidenceId:randomUUID(),canonicalEvidenceId:evidenceId,capturedAt:at,timeZone:"UTC",createdAt:at,byteSize:4,sha256:"b".repeat(64),contentType:"image/jpeg",partCount:1,partSize:262144,binding:{kind:"compliance",recordId:randomUUID(),subject:{kind:"driver",id:2},expectedRecordVersion:0},completion:null as any};
 const app=express().use(express.json()).use(createFleetWorkRouter({actor:()=>({userId:2,companyId:7}) as never,enabled:()=>true,evidence:{read:async()=>({session,completion:session.completion,parts:[]})} as never}));
 expect((await request(app).post(`/fleet/work/evidence/${id}/receipt`).send({scope})).status).toBe(409);
 session.completion={status:"complete",sessionId:id,operationId,evidenceId,byteSize:4,sha256:session.sha256,contentType:session.contentType,objectPath:"/objects/fleet-compliance-private/7/private",fileUrl:null,completedAt:at,physicalProofVerified:false,signatureIdentityVerified:false};
 const result=await request(app).post(`/fleet/work/evidence/${id}/receipt`).send({scope});expect(result.status).toBe(200);expect(result.body).toMatchObject({status:"applied",operationId,fingerprint:session.fingerprint,canonicalReferences:[{kind:"evidence",id:evidenceId}]});expect(result.body.mappings[0].local.id).toBe(session.localEvidenceId);expect(JSON.stringify(result.body)).not.toContain("private");
});
it("gates activation and preserves scoped receipt lookup/no-store",async()=>{
 const {createFleetWorkRouter}=await import("./fleet-work");const actor={userId:2,companyId:7},read=vi.fn(async()=>null),provision=vi.fn(async()=>({scope}));const app=express();app.use(express.json());let enabled=false;app.use(createFleetWorkRouter({actor:()=>actor as never,enabled:()=>enabled,repository:{provision},service:{read}} as never));
 expect((await request(app).post("/fleet/work/provision").send({deviceId:scope.deviceId,appVersion:"test"})).status).toBe(409);expect(provision).not.toHaveBeenCalled();enabled=true;expect((await request(app).post("/fleet/work/provision").send({deviceId:scope.deviceId,appVersion:"test"})).status).toBe(200);
 const id=randomUUID(),result=await request(app).post(`/fleet/work/operations/${id}`).send({scope});expect(result.status).toBe(200);expect(result.body.receipt).toBeNull();expect(result.body.checkedAt).toBeTruthy();expect(result.headers["cache-control"]).toContain("no-store");expect(read).toHaveBeenCalledWith(actor,scope,id);
 expect((await request(app).post("/fleet/work/operations/not-id").send({scope})).status).toBe(400);
});
