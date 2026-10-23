import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { it,expect,vi } from "vitest";
vi.mock("@workspace/db",()=>({pool:{connect:()=>{throw new Error("Real database forbidden");}}}));
import { createGateArrivalsRouter } from "./gateArrivals";
import { buildTestCookie } from "../test-utils/session";
import { GateArrivalsError } from "../services/gate-arrivals";
const id="10000000-0000-4000-8000-000000000001",session={userId:3,vendorId:20,role:"vendor",membershipRole:"admin",sv:1};
function fixture() {
  const service={list:vi.fn(async()=>({arrivals:[],truncated:false,generatedAt:new Date().toISOString()})),detail:vi.fn(async()=>({runId:id})),visitLinks:vi.fn(async()=>({runs:[]}))};
  const app=express().use(cookieParser()).use(createGateArrivalsRouter(service as never));
  return {app,service};
}
it("requires login and strict selected-site context before calling Gate projection",async()=>{
  const f=fixture();expect((await request(f.app).get("/gate-arrivals?siteLocationId=9")).status).toBe(401);
  for (const query of ["", "?siteLocationId=-1", "?siteLocationId=9&vendorId=99"])
    expect((await request(f.app).get(`/gate-arrivals${query}`).set("Cookie",buildTestCookie(session))).status).toBe(400);
  expect(f.service.list).not.toHaveBeenCalled();
});
it("routes list, exact run and explicit visit links with no shared caching",async()=>{
  const f=fixture(),cookie=buildTestCookie(session);
  const list=await request(f.app).get("/gate-arrivals?siteLocationId=9").set("Cookie",cookie);
  expect(list.status).toBe(200);expect(list.headers["cache-control"]).toBe("private, no-store");
  expect(f.service.list).toHaveBeenCalledWith(expect.objectContaining({userId:3,vendorId:20}),9);
  expect((await request(f.app).get(`/gate-arrivals/${id}?siteLocationId=9`).set("Cookie",cookie)).body.runId).toBe(id);
  expect((await request(f.app).get("/gate-arrivals/visit/52?siteLocationId=9").set("Cookie",cookie)).body).toEqual({runs:[]});
  expect(f.service.visitLinks).toHaveBeenCalledWith(expect.objectContaining({userId:3}),9,52);
});
it("preserves selected-site denial and missing-run responses",async()=>{
  const f=fixture();f.service.list.mockRejectedValue(new GateArrivalsError("gate.site_no_access",403));
  expect((await request(f.app).get("/gate-arrivals?siteLocationId=88").set("Cookie",buildTestCookie(session))).status).toBe(403);
  f.service.detail.mockRejectedValue(new GateArrivalsError("gate_arrivals.run_unavailable",404));
  expect((await request(f.app).get(`/gate-arrivals/${id}?siteLocationId=9`).set("Cookie",buildTestCookie(session))).status).toBe(404);
});
