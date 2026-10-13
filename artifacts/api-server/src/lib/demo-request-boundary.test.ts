import {it,expect,vi,beforeEach} from 'vitest';
import {DEMO_IDENTITIES} from './demo-identities';
const {init,run}=vi.hoisted(()=>({init:vi.fn(async()=>{}),run:vi.fn((_realm,action)=>action())}));
vi.mock('@workspace/db',()=>({initializeDemoDatabase:init,runInDatabaseRealm:run}));
vi.mock('./session',()=>({getSessionFromRequest:(req:any)=>req.cookies?.session??null,decodeSession:()=>null}));
import {demoRequestBoundary} from './demo-request-boundary';
beforeEach(()=>vi.clearAllMocks());
const legacy={userId:DEMO_IDENTITIES[0].userId};
function response(){const res:any={status:vi.fn(()=>res),json:vi.fn(()=>res),clearCookie:vi.fn(()=>res)};return res;}
it('a stale demo cookie cannot prevent a new demo login',async()=>{
 const next=vi.fn(),res=response();
 await demoRequestBoundary({method:'POST',path:'/api/auth/login',headers:{},cookies:{session:legacy},body:{username:DEMO_IDENTITIES[0].username}} as any,res,next);
 expect(next).toHaveBeenCalledOnce();expect(run).toHaveBeenCalledWith('demo',next);
});
it('real login selects production even while a demo session is present',async()=>{
 const next=vi.fn(),res=response();
 await demoRequestBoundary({method:'POST',path:'/api/auth/login',headers:{},cookies:{session:{...legacy,realm:'demo'}},body:{username:'real@example.com'}} as any,res,next);
 expect(run).toHaveBeenCalledWith('production',next);expect(init).not.toHaveBeenCalled();
});
it('legacy demo logout clears its unusable cookie without a production query',async()=>{
 const next=vi.fn(),res=response();
 await demoRequestBoundary({method:'POST',path:'/api/auth/logout',headers:{},cookies:{session:legacy}} as any,res,next);
 expect(res.clearCookie).toHaveBeenCalledWith('vndrly_session',{path:'/'});expect(res.json).toHaveBeenCalled();expect(run).not.toHaveBeenCalled();
});
it('public entry always initializes demo despite stale real or demo cookies',async()=>{
 const next=vi.fn(),res=response();
 await demoRequestBoundary({method:'POST',path:'/api/auth/demo-entry',headers:{},cookies:{session:legacy},body:{persona:'field'}} as any,res,next);
 expect(init).toHaveBeenCalledOnce();expect(run).toHaveBeenCalledWith('demo',next);
});
it('public demo cannot write an otherwise permitted Work Hub task',async()=>{
 const next=vi.fn(),res=response();
 await demoRequestBoundary({method:'POST',path:'/api/work-hub/tasks',headers:{},cookies:{session:{...legacy,realm:'demo',publicDemo:true}}} as any,res,next);
 expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
});
it('public logout clears only this browser and does not invalidate other visitors',async()=>{
 const next=vi.fn(),res=response();
 await demoRequestBoundary({method:'POST',path:'/api/auth/logout',headers:{},cookies:{session:{...legacy,realm:'demo',publicDemo:true}}} as any,res,next);
 expect(res.clearCookie).toHaveBeenCalled();expect(run).not.toHaveBeenCalled();
});
