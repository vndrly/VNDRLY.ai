import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const env=vi.hoisted(()=>({session:{userId:1,role:"vendor",vendorId:1054,membershipRole:"admin"},validate:vi.fn(),invite:vi.fn(),activate:vi.fn()}));
vi.mock("@workspace/db",()=>({db:{},managedSubcontractorWorkerSponsorshipsTable:{},workerSubscriptionsTable:{}}));
vi.mock("../lib/session",()=>({getSessionFromRequest:()=>env.session}));
vi.mock("../assistant/chatgpt-grant-store",()=>({validateAssistantSession:env.validate}));
vi.mock("../services/account-invitations",()=>({issueAccountInvitation:env.invite}));
vi.mock("../services/worker-subscriptions",async original=>({...await original<any>(),createWorkerSubscriptionService:()=>({activateSeat:env.activate})}));
import router from "./implementationAWorkerSubscriptions";
const app=express().use(express.json(),router).post("/implementation-a/subscriptions",(_req,res)=>res.status(202).json({employeeSubscription:true}));
const input={email:"worker@example.invalid",displayName:"Example Worker",managedOrganizationId:"11111111-1111-4111-8111-111111111111",authorizationVersion:"work-participation-2026-09",plan:"gate_only",monthlyPriceCents:999,renewalAt:"2027-01-01T00:00:00.000Z",previewAccess:false,confirmed:true};
beforeEach(()=>{vi.clearAllMocks();env.validate.mockResolvedValue(env.session);env.invite.mockResolvedValue({userId:8,invitationId:"22222222-2222-4222-8222-222222222222",expiresAt:"2027-01-01T00:00:00.000Z"});env.activate.mockResolvedValue({status:"applied",seat:{id:"seat",workerUserId:8,state:"active"}});});
it.each(["/implementation-a/subscriptions","/implementation-a/worker-subscriptions"])("preserves managed-worker activation through %s",async path=>{
 const response=await request(app).post(path).send(input);
 expect(response.status).toBe(201);expect(response.body.seat.workerUserId).toBe(8);
 expect(env.activate).toHaveBeenCalledWith(expect.objectContaining({payor:{type:"vendor",id:1054},workerUserId:8}));
});
it("passes ordinary employee subscriptions to their existing handler",async()=>{
 const response=await request(app).post("/implementation-a/subscriptions").send({name:"Workshop reference",employeeKey:"person:5",amountCents:1900,billingInterval:"year"});
 expect(response.status).toBe(202);expect(env.invite).not.toHaveBeenCalled();expect(env.activate).not.toHaveBeenCalled();
});
it("checks the current vendor administrator membership before creating a managed worker",async()=>{
 env.validate.mockResolvedValueOnce({...env.session,membershipRole:"member"});
 expect((await request(app).post("/implementation-a/subscriptions").send(input)).status).toBe(403);
 expect(env.invite).not.toHaveBeenCalled();
});
