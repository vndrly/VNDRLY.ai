import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInDatabaseRealm,currentDatabaseRealm,createRealmDispatcher,assertExternalEffectsAllowed} from './database-realm';
test('parallel requests and connection leases keep their realm',async()=>{
 const prod={name:'production',connect(){return {name:this.name}},query(){return this.name}};
 const demo={name:'demo',connect(){return {name:this.name}},query(){return this.name}};
 const target=createRealmDispatcher(prod,()=>demo);
 const result=await Promise.all(['demo','production'].map(realm=>runInDatabaseRealm(realm as 'demo'|'production',async()=>{
  const lease=target.connect();await new Promise(resolve=>setTimeout(resolve,5));return [target.query(),lease.name,currentDatabaseRealm()];
 })));
 assert.deepEqual(result,[['demo','demo','demo'],['production','production','production']]);
 assert.equal(target.query(),'production');
});
test('demo unavailability never falls back to production',()=>{
 let productionCalls=0;
 const target=createRealmDispatcher<{query():void}>({query(){productionCalls++}},()=>{throw Error('Demo unavailable')});
 assert.throws(()=>runInDatabaseRealm('demo',()=>target.query()),/Demo unavailable/);
 assert.equal(productionCalls,0);
});
test('demo cannot invoke external effects even with production provider credentials',()=>{
 assert.doesNotThrow(()=>assertExternalEffectsAllowed());
 assert.throws(()=>runInDatabaseRealm('demo',()=>assertExternalEffectsAllowed()),/External effects disabled/);
});
