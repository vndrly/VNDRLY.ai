import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import {demoLoginIdentity,sessionDatabaseRealm,demoRouteAllowed} from './demo-boundary';
import {DEMO_IDENTITIES} from './demo-identities';
test('only the exact registry selects demo login',()=>{
 assert.equal(demoLoginIdentity(' '+DEMO_IDENTITIES[0].username.toUpperCase()+' ')?.userId,DEMO_IDENTITIES[0].userId);
 assert.equal(demoLoginIdentity('another@example.invalid'),undefined);
});
test('legacy demo and forged cross-realm identities are rejected',()=>{
 const id=DEMO_IDENTITIES[0].userId;
 assert.equal(sessionDatabaseRealm({userId:id}),'invalid');
 assert.equal(sessionDatabaseRealm({userId:id,realm:'production'}),'invalid');
 assert.equal(sessionDatabaseRealm({userId:1,realm:'demo'}),'invalid');
 assert.equal(sessionDatabaseRealm({userId:id,realm:'demo'}),'demo');
 assert.equal(sessionDatabaseRealm({userId:1}),'production');
});
test('demo preserves ordinary reads but blocks providers, shared streams and storage',()=>{
 for(const path of ['/api/tickets','/api/work-hub/calendar','/api/implementation-a/trips','/api/gate-change-over/sites'])assert.equal(demoRouteAllowed('GET',path),true,path);
 for(const [method,path] of [['GET','/api/tickets/events'],['GET','/api/accounting/qb/connect'],['GET','/api/work-hub/file-library/x/download'],['POST','/api/payments'],['POST','/api/work-hub/calls'],['POST','/api/assistant-connection/mcp']])assert.equal(demoRouteAllowed(method,path),false,path);
 assert.equal(demoRouteAllowed('POST','/api/auth/switch-context'),true);
 assert.equal(demoRouteAllowed('POST','/api/work-hub/tasks'),true);
 assert.equal(demoRouteAllowed('GET','/api/new-unreviewed-provider'),false);
});
