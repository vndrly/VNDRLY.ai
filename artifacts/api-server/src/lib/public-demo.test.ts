import {expect,it} from 'vitest';
import {publicDemoAccount,publicDemoRequestAllowed} from './public-demo';
it('exposes exactly four fixed demo identities, never arbitrary accounts',()=>{
  expect(['partner','field','fleet','gate'].map(x=>publicDemoAccount(x)?.userId)).toEqual([1081,1084,1085,1086]);
  for(const x of ['admin','__proto__','constructor',1081,null,{}])expect(publicDemoAccount(x)).toBeUndefined();
});
it('public visitors cannot mutate shared demo history or upgrade context',()=>{
  for(const path of ['/api/work-hub/tasks','/api/auth/switch-context','/api/tickets/1','/api/invoices/1'])expect(publicDemoRequestAllowed('POST',path)).toBe(false);
  expect(publicDemoRequestAllowed('GET','/api/tickets')).toBe(true);
  expect(publicDemoRequestAllowed('POST','/api/auth/logout')).toBe(true);
});
