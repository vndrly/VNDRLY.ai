import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import {demoLoginIdentity,sessionDatabaseRealm,demoRouteAllowed} from './demo-boundary';
import {DEMO_IDENTITIES} from './demo-identities';
test('only the exact registry selects demo login',()=>{
 assert.equal(demoLoginIdentity(' '+DEMO_IDENTITIES[0].username.toUpperCase()+' ')?.userId,DEMO_IDENTITIES[0].userId);
 assert.equal(demoLoginIdentity('another@example.invalid'),undefined);
});
test('demo can inspect scoped Fleet billing choices while run and ticket writes stay blocked',()=>{
 assert.equal(demoRouteAllowed('GET','/api/fleet/billing-options'),true);
 for(const [method,path] of [['POST','/api/fleet/billing-options'],['POST','/api/fleet/runs'],['POST','/api/fleet/tickets/12/finalize']])assert.equal(demoRouteAllowed(method,path),false,path);
});
test('new demo map and fleet reads remain separate from mutations and provider access',()=>{
 for(const path of ['/api/public-config','/api/native-operations/status','/api/tickets/12/site-visit-summary','/api/company-operations','/api/fleet/overview','/api/fleet/map-context','/api/fleet/runs/example/location-history','/api/fleet/tickets/12/plan','/api/gate-change-over/coverage-map']){
  assert.equal(demoRouteAllowed('GET',path),true,path);
  assert.equal(demoRouteAllowed('POST',path),false,path);
 }
 for(const path of ['/api/fleet/events','/api/fleet/runs/example/evidence/file','/api/gate-change-over/work-location','/api/fleet/unreviewed'])assert.equal(demoRouteAllowed('GET',path),false,path);
});
test('legacy demo and forged cross-realm identities are rejected',()=>{
 const id=DEMO_IDENTITIES[0].userId;
 assert.equal(sessionDatabaseRealm({userId:id}),'invalid');
 assert.equal(sessionDatabaseRealm({userId:id,realm:'production'}),'invalid');
 assert.equal(sessionDatabaseRealm({userId:1,realm:'demo'}),'invalid');
 assert.equal(sessionDatabaseRealm({userId:id,realm:'demo'}),'demo');
 assert.equal(sessionDatabaseRealm({userId:1}),'production');
});

test('native Field reviewer reads are allowed without opening work mutations',()=>{
 for(const path of ['/api/field/me','/api/field/open-tickets','/api/field/open-tickets/100009','/api/field/history','/api/field/sites','/api/field/sites/12/work-types','/api/safety/events','/api/safety/events/12']){
  assert.equal(demoRouteAllowed('GET',path),true,path);
  assert.equal(demoRouteAllowed('POST',path),false,path);
 }
 for(const path of ['/api/field/location','/api/field/change-password','/api/field/unreviewed','/api/field/open-tickets/12/check-in'])assert.equal(demoRouteAllowed('GET',path),false,path);
});

test('native ticket detail evidence reads keep the ticket mutation boundary',()=>{
 for(const path of ['/api/tickets/100096/note-logs','/api/tickets/100096/gps-logs','/api/tickets/100096/crew-sessions','/api/tickets/100096/comments']){
  assert.equal(demoRouteAllowed('GET',path),true,path);
  assert.equal(demoRouteAllowed('POST',path),false,path);
 }
 assert.equal(demoRouteAllowed('GET','/api/tickets/100096/note-logs/file/download'),false);
});
test('demo preserves ordinary reads but blocks providers, shared streams and storage',()=>{
 for(const path of ['/api/tickets','/api/work-hub/calendar','/api/implementation-a/trips','/api/gate-change-over/sites'])assert.equal(demoRouteAllowed('GET',path),true,path);
 for(const [method,path] of [['GET','/api/tickets/events'],['GET','/api/accounting/qb/connect'],['GET','/api/work-hub/file-library/x/download'],['POST','/api/payments'],['POST','/api/work-hub/calls'],['POST','/api/assistant-connection/mcp']])assert.equal(demoRouteAllowed(method,path),false,path);
 assert.equal(demoRouteAllowed('POST','/api/auth/switch-context'),true);
 assert.equal(demoRouteAllowed('POST','/api/work-hub/tasks'),true);
 assert.equal(demoRouteAllowed('GET','/api/new-unreviewed-provider'),false);
});
