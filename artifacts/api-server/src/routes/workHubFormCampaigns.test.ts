import express from "express";
import request from "supertest";
import { it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({
  session: null as any,
  list: vi.fn(),
  respond: vi.fn(),
  get: vi.fn(),
}));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => m.session }));
vi.mock("../work-hub/form-campaign-service", () => ({
  listCampaigns: m.list,
  respondCampaign: m.respond,
  getCampaign: m.get,
  campaignOptions: vi.fn(),
  campaignAttachment: vi.fn(),
  createCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  publishCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  getCampaignInstance: vi.fn(),
}));
import router from "./workHubFormCampaigns";
const app = express();
app.use(express.json());
app.use(router);
beforeEach(() => {
  m.session = { userId: 7, vendorId: 9 };
  vi.clearAllMocks();
});
it("requires authentication and disables caching", async () => {
  m.session = null;
  const r = await request(app).get("/work-hub/form-campaigns");
  expect(r.status).toBe(401);
  expect(r.headers["cache-control"]).toContain("no-store");
  expect(m.list).not.toHaveBeenCalled();
});
it("rejects malformed exact identifiers before reading", async () => {
  const r = await request(app).get("/work-hub/form-campaigns/not-id");
  expect(r.status).toBe(400);
  expect(m.get).not.toHaveBeenCalled();
});
it("passes only the signed actor and validated command to submission", async () => {
  const id = "00000000-0000-4000-8000-000000000002",
    body = {
      operationId: "00000000-0000-4000-8000-000000000003",
      owner: { type: "vendor", id: 9 },
      context: { kind: "organization", id: 9 },
      expectedVersion: 0,
      payloadVersion: 1,
      payload: { acknowledged: true },
    };
  m.respond.mockResolvedValue({ saved: true });
  const r = await request(app)
    .post(`/work-hub/form-campaigns/instances/${id}/respond`)
    .send(body);
  expect(r.status).toBe(200);
  expect(m.respond).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 7, vendorId: 9 }),
    id,
    body,
  );
});
