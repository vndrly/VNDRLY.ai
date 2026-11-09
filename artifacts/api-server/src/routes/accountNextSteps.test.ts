import {beforeEach,expect,it,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks=vi.hoisted(()=>({session:null as any,save:vi.fn()}));
vi.mock('../lib/session',()=>({getSessionFromRequest:()=>mocks.session}));
vi.mock('../services/account-next-steps',()=>({readAccountNextSteps:vi.fn(),saveAccountCoi:mocks.save}));
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
