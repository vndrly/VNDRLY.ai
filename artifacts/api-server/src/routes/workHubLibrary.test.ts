import express from "express";
import request from "supertest";
import {it,expect,vi,beforeEach} from "vitest";
const m=vi.hoisted(()=>({session:null as any,list:vi.fn(),get:vi.fn(),respond:vi.fn(),assign:vi.fn(),entry:vi.fn()}));
vi.mock("../lib/session",()=>({getSessionFromRequest:()=>m.session}));
vi.mock("../work-hub/library-service",()=>({listLibrary:m.list,getLibrary:m.get,saveLibrary:vi.fn(),reviseLibrary:vi.fn(),changeLibraryState:vi.fn()}));
vi.mock("../work-hub/library-audience",()=>({libraryOptions:vi.fn()}));
vi.mock("../work-hub/library-assignments",()=>({previewLibraryAssignment:vi.fn(),assignLibrary:m.assign,employeeChecklist:vi.fn(),ownerLibraryAssignments:vi.fn(),cancelLibraryAssignment:vi.fn(),ownerAssignmentDetail:vi.fn(),libraryPollResults:vi.fn()}));
vi.mock("../work-hub/training-service",()=>({getAssignedLibrary:m.get,submitAssignedLibrary:m.respond,resetTrainingAttempts:vi.fn(),assignedLibraryFile:vi.fn()}));
vi.mock("../work-hub/onboarding-service",()=>({ensureOnboarding:m.entry,updateOnboardingRule:vi.fn(),markLibraryPresented:vi.fn()}));
import router from "./workHubLibrary";
const app=express();app.use(express.json());app.use(router);
const id="10000000-0000-4000-8000-000000000001";
const envelope={operationId:"10000000-0000-4000-8000-000000000002",owner:{type:"vendor",id:12},context:{kind:"organization",id:12},payloadVersion:1,expectedVersion:0,payload:{acknowledged:true}};
beforeEach(()=>{vi.clearAllMocks();m.session={userId:7,vendorId:12};});
it("requires signed authentication and disables caching",async()=>{
 m.session=null;const r=await request(app).get('/work-hub/library');expect(r.status).toBe(401);expect(r.headers['cache-control']).toContain('no-store');expect(m.list).not.toHaveBeenCalled();
});
it("rejects malformed IDs before any assigned data read",async()=>{
 const r=await request(app).get('/work-hub/library/instances/not-a-uuid');expect(r.status).toBe(400);expect(m.get).not.toHaveBeenCalled();
});
it("passes only the signed caller to explicit quiz attempts",async()=>{
 m.respond.mockResolvedValue({instanceId:id,status:'in_progress'});const r=await request(app).post(`/work-hub/library/instances/${id}/attempt`).set('x-vndrly-client','ios').send({...envelope,userId:999});expect(r.status).toBe(200);expect(m.respond).toHaveBeenCalledWith(expect.objectContaining({userId:7,vendorId:12,source:'ios'}),id,envelope,'attempt');
});
it("uses enrollment rather than completion when opening the employee entry checklist",async()=>{
 m.entry.mockResolvedValue({items:[],present:[]});const r=await request(app).post('/work-hub/library/entry').send({userId:999});expect(r.status).toBe(200);expect(m.entry).toHaveBeenCalledWith(expect.objectContaining({userId:7}));expect(m.respond).not.toHaveBeenCalled();
});
it("reports a current-version conflict without inventing a successful receipt",async()=>{
 m.respond.mockRejectedValue(Object.assign(Error('Assignment changed; refresh'),{status:409}));const r=await request(app).post(`/work-hub/library/instances/${id}/complete`).send(envelope);expect(r.status).toBe(409);expect(r.body).toEqual({error:'Assignment changed; refresh'});
});
