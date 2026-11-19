import express from "express";
import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({session:{userId:1,vendorId:1054,partnerId:null,role:"vendor",membershipRole:"admin"},validate:vi.fn(),read:vi.fn(),save:vi.fn()}));
vi.mock("../lib/session",()=>({getSessionFromRequest:()=>mock.session}));
vi.mock("../work-hub/feature-access",()=>({isWorkHubEnabled:async()=>true}));
vi.mock("../work-hub/task-assignment",()=>({currentTaskAssignmentSession:mock.validate,canManageTaskAssignments:(session:any)=>session.membershipRole==="admin"}));
vi.mock("../work-hub/work-crews",()=>({readWorkCrews:mock.read,saveWorkCrew:mock.save,assignWorkCrew:vi.fn(),announceToWorkCrew:vi.fn()}));
vi.mock("./notifications",()=>({notifyUsers:vi.fn()}));
import router from "./workHubWorkCrews";
const app=express().use(express.json(),router);
beforeEach(()=>{vi.clearAllMocks();mock.validate.mockResolvedValue(mock.session);mock.read.mockResolvedValue({workers:[],crews:[]});mock.save.mockResolvedValue({replayed:false,resource:{id:"saved"}});});
it("reads only the authenticated company's worker pool",async()=>{expect((await request(app).get('/work-hub/work-crews?ownerId=999')).status).toBe(200);expect(mock.read).toHaveBeenCalledWith({type:"vendor",id:1054});});
it("rejects a mismatched company and revoked management role",async()=>{
 const response=await request(app).post('/work-hub/work-crews').send({owner:{type:"vendor",id:999},context:{kind:"organization",id:"999"},operationId:"11111111-1111-4111-8111-111111111111",payloadVersion:1,expectedVersion:null,payload:{name:"Crew",userIds:[1]}});
 expect(response.status).toBe(403);expect(mock.save).not.toHaveBeenCalled();
 mock.validate.mockResolvedValueOnce({...mock.session,membershipRole:"member"});expect((await request(app).get('/work-hub/work-crews')).status).toBe(403);expect(mock.read).not.toHaveBeenCalled();
});
