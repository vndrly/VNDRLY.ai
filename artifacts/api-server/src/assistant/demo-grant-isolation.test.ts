import {describe,it,expect,vi} from 'vitest';
import {DEMO_IDENTITIES} from '../lib/demo-identities';
const {select,connect}=vi.hoisted(()=>({select:vi.fn(),connect:vi.fn()}));
vi.mock('@workspace/db',()=>({db:{select},pool:{connect},usersTable:{id:'id'}}));
vi.mock('../routes/auth',()=>({resolveContext:vi.fn()}));
import {validateAssistantSession,withAssistantGrants} from './chatgpt-grant-store';
describe('unrouted demo connector credentials',()=>{
 it('rejects demo identities before production authority reads',async()=>{
  await expect(validateAssistantSession({userId:DEMO_IDENTITIES[0].userId,sv:1})).rejects.toMatchObject({code:'access_denied'});
  expect(select).not.toHaveBeenCalled();
 });
 it('rejects demo grants before acquiring a production connection',async()=>{
  await expect(withAssistantGrants(DEMO_IDENTITIES[0].userId,vi.fn())).rejects.toMatchObject({code:'access_denied'});
  expect(connect).not.toHaveBeenCalled();
 });
});
