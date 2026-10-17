import express from "express";
import request from "supertest";
import { it, expect, vi } from "vitest";
import { FleetError } from "../services/fleet-repository";
it("reads reviewed requirements and typed operational facts through current company authority without caching",async()=>{
 const module=await import("./fleet-compliance"),actor={userId:7,companyId:2},service={readFleetComplianceRequirements:vi.fn(async()=>({requirements:[],canAdopt:false,mode:"warn_only"})),readFleetComplianceFacts:vi.fn(async()=>null)};
 const app=express();app.use(module.createFleetComplianceRouter(service as never,()=>actor));
 const rules=await request(app).get("/fleet/compliance/requirements");expect(rules.status).toBe(200);expect(rules.headers["cache-control"]).toContain("no-store");expect(service.readFleetComplianceRequirements).toHaveBeenCalledWith(actor);
 expect((await request(app).get("/fleet/compliance/facts/driver/7")).status).toBe(200);expect(service.readFleetComplianceFacts).toHaveBeenLastCalledWith(actor,{kind:"driver",id:7});
 const id="11111111-1111-4111-8111-111111111111";expect((await request(app).get(`/fleet/compliance/facts/vehicle/${id}`)).status).toBe(200);expect(service.readFleetComplianceFacts).toHaveBeenLastCalledWith(actor,{kind:"vehicle",id});
 expect((await request(app).get("/fleet/compliance/facts/driver/not-a-number")).status).toBe(400);service.readFleetComplianceFacts.mockRejectedValueOnce(new FleetError("fleet.compliance_subject_required",403));expect((await request(app).get("/fleet/compliance/facts/driver/8")).status).toBe(403);
 expect((await request(app).get("/fleet/compliance/facts/driver/7?revision=1")).status).toBe(200);expect(service.readFleetComplianceFacts).toHaveBeenLastCalledWith(actor,{kind:"driver",id:7},1);
});
it("uses canonical requirement adoption, classification and assessment operations", async () => {
  const module = await import("./fleet-compliance"),
    actor = { userId: 7, companyId: 2 };
  const service = {
    adoptFleetRequirement: vi.fn(async () => ({ version: 1 })),
    recordFleetComplianceFacts: vi.fn(async () => ({ version: 1 })),
    assessFleetComplianceSubjects: vi.fn(async () => ({ assessments: [] })),
  };
  const app = express();
  app.use(express.json());
  app.use(module.createFleetComplianceRouter(service as never, () => actor));
  for (const [path, method] of [
    ["requirements", "adoptFleetRequirement"],
    ["facts", "recordFleetComplianceFacts"],
    ["assessments", "assessFleetComplianceSubjects"],
  ] as const) {
    const input = { operationId: "synthetic" };
    expect(
      (await request(app).post(`/fleet/compliance/${path}`).send(input)).status,
    ).toBe(200);
    expect(service[method]).toHaveBeenCalledWith(actor, input);
  }
});
it("routes reviewer files through current canonical authorization and never caches them", async () => {
  const module = await import("./fleet-compliance").catch(() => null);
  expect(module).not.toBeNull();
  const actor = { userId: 7, companyId: 2 };
  const service = {
    readComplianceDocument: vi.fn(async () => ({
      body: Buffer.from("%PDF-private"),
      contentType: "application/pdf",
      size: 12,
    })),
    readFleetComplianceRegister: vi.fn(async () => ({
      entries: [],
      mode: "warn_only",
    })),
  };
  const app = express();
  app.use(express.json());
  app.use(module!.createFleetComplianceRouter(service as never, () => actor));
  const id = "11111111-1111-4111-8111-111111111111";
  const response = await request(app).get(
    `/fleet/compliance/${id}/document?revision=3`,
  );
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["content-disposition"]).toContain("attachment");
  expect(service.readComplianceDocument).toHaveBeenCalledWith(actor, id, 3);
  service.readComplianceDocument.mockRejectedValueOnce(
    new FleetError("fleet.compliance_reviewer_required", 403),
  );
  expect(
    (await request(app).get(`/fleet/compliance/${id}/document`)).status,
  ).toBe(403);
  expect((await request(app).get("/fleet/compliance")).body).toMatchObject({
    mode: "warn_only",
  });
});
