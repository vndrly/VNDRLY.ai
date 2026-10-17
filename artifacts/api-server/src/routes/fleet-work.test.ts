import express from "express";import request from "supertest";import {it,expect,vi} from "vitest";import {randomUUID} from "node:crypto";
const scope={owner:{type:"vendor",id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};
it("gates activation and preserves scoped receipt lookup/no-store",async()=>{
 const {createFleetWorkRouter}=await import("./fleet-work");const actor={userId:2,companyId:7},read=vi.fn(async()=>null),provision=vi.fn(async()=>({scope}));const app=express();app.use(express.json());let enabled=false;app.use(createFleetWorkRouter({actor:()=>actor as never,enabled:()=>enabled,repository:{provision},service:{read}} as never));
 expect((await request(app).post("/fleet/work/provision").send({deviceId:scope.deviceId,appVersion:"test"})).status).toBe(409);expect(provision).not.toHaveBeenCalled();enabled=true;expect((await request(app).post("/fleet/work/provision").send({deviceId:scope.deviceId,appVersion:"test"})).status).toBe(200);
 const id=randomUUID(),result=await request(app).post(`/fleet/work/operations/${id}`).send({scope});expect(result.status).toBe(200);expect(result.body.receipt).toBeNull();expect(result.body.checkedAt).toBeTruthy();expect(result.headers["cache-control"]).toContain("no-store");expect(read).toHaveBeenCalledWith(actor,scope,id);
 expect((await request(app).post("/fleet/work/operations/not-id").send({scope})).status).toBe(400);
});
