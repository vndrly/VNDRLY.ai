import {describe,it,expect} from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {applyStaffBearerSession} from "./staff-bearer-session";
import {getSessionFromRequest,decodeSession} from "./session";
import {signTestSession} from "../test-utils/session";
const office=signTestSession({userId:1103,role:"vendor",vendorId:1112,sv:1}),driver=signTestSession({userId:1102,role:"vendor",vendorId:1112,sv:2}),guest=signTestSession({userId:9,role:"guest"});
const app=express();app.use(cookieParser(),applyStaffBearerSession);app.get("/who",(req,res)=>res.json({staff:getSessionFromRequest(req),guest:decodeSession(req.cookies.vndrly_guest),cookies:req.cookies,rawCookie:req.headers.cookie}));
describe("explicit native bearer account selection",()=>{
 it("selects the driver's explicit token over a retained office cookie in parsed and raw-cookie consumers",async()=>{
  const r=await request(app).get("/who").set("Cookie",`vndrly_session=${office}; preference=keep`).set("Authorization",`Bearer ${driver}`);
  expect(r.body.staff.userId).toBe(1102);expect(r.body.guest).toBeNull();expect(r.body.rawCookie).not.toContain(office);expect(r.body.cookies.preference).toBe("keep");
  const raw=await request(app).get("/who").set("Cookie",r.body.rawCookie);expect(raw.body.staff.userId).toBe(1102);
 });
 it("does not fall back to a privileged cookie when the explicit bearer is invalid or empty",async()=>{
  for(const auth of ["Bearer invalid-token","Bearer "]){const r=await request(app).get("/who").set("Cookie",`vndrly_session=${office}; vndrly_guest=${guest}`).set("Authorization",auth);expect(r.body.staff).toBeNull();expect(r.body.guest).toBeNull();}
 });
 it("routes an explicit guest token without retaining old staff privileges",async()=>{
  const r=await request(app).get("/who").set("Cookie",`vndrly_session=${office}`).set("Authorization",`Bearer ${guest}`);expect(r.body.staff).toBeNull();expect(r.body.guest.role).toBe("guest");expect(r.body.rawCookie).not.toContain("vndrly_session=");
 });
 it("retains ordinary browser-cookie authentication when no Bearer header is supplied",async()=>{
  const r=await request(app).get("/who").set("Cookie",`vndrly_session=${office}`);expect(r.body.staff.userId).toBe(1103);
 });
});
