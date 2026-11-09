import {beforeEach,expect,it,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks=vi.hoisted(()=>({session:null as any,save:vi.fn(),read:vi.fn()}));
vi.mock('../lib/session',()=>({getSessionFromRequest:()=>mocks.session}));
vi.mock('../services/account-next-steps',()=>({readAccountNextSteps:mocks.read,saveAccountCoi:mocks.save}));
vi.mock('../services/gate-change-over',()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}}}));
import router from './accountNextSteps';
const app=express();app.use(express.json());app.use('/api',router);
beforeEach(()=>{vi.clearAllMocks();mocks.session={userId:7,vendorId:4};mocks.save.mockResolvedValue({uploaded:true});});
it('rejects a company switch during upload before saving',async()=>{
 const result=await request(app).post('/api/account-next-steps/coi').send({vendorId:5,objectPath:'/objects/uploads/saved'});
 expect(result.status).toBe(409);expect(mocks.save).not.toHaveBeenCalled();
});
it('requires sign-in and delegates only the active company upload',async()=>{
 mocks.session=null;
 expect((await request(app).post('/api/account-next-steps/coi').send({vendorId:4})).status).toBe(401);
 mocks.session={userId:7,vendorId:4};
 const result=await request(app).post('/api/account-next-steps/coi').send({vendorId:4,objectPath:'/objects/uploads/saved'});
 expect(result.status).toBe(200);expect(mocks.save).toHaveBeenCalledWith(mocks.session,'/objects/uploads/saved');
});
it('does not resume a different company after another tab replaces the session',async()=>{
 mocks.session={userId:7,vendorId:5,activeMembershipId:9};
 const result=await request(app).get('/api/account-next-steps').set('X-VNDRLY-Actor-User','7').set('X-VNDRLY-Vendor','4').set('X-VNDRLY-Membership','8');
 expect(result.status).toBe(409);expect(mocks.read).not.toHaveBeenCalled();
});
it('keeps the internal askV read compatible and binds the UI read to its exact membership',async()=>{
 mocks.session={userId:7,vendorId:4,activeMembershipId:8};mocks.read.mockResolvedValue({firstWatch:null});
 expect((await request(app).get('/api/account-next-steps')).status).toBe(200);
 expect((await request(app).get('/api/account-next-steps').set('X-VNDRLY-Actor-User','7').set('X-VNDRLY-Vendor','4').set('X-VNDRLY-Membership','8')).status).toBe(200);
 expect(mocks.read).toHaveBeenCalledTimes(2);
});
