import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemoEcosphere} from '../demo-ecosphere-template.mjs';
test('one deterministic 30-day baseline links all service lanes without real identities',()=>{
 const a=makeDemoEcosphere(); assert.deepEqual(a,makeDemoEcosphere());
 assert.equal(a.tickets.length,90);assert.equal(a.runs.length,30);assert.equal(a.visits.length,90);assert.equal(a.shifts.length,30);
 assert.equal(new Set(a.tickets.map(t=>t.createdAt.slice(0,10))).size,30);
 assert.equal(new Set(a.tickets.map(t=>t.key)).size,90);
 for(const t of a.tickets){assert.ok(a.people.some(p=>p.key===t.personKey&&p.vendorKey===t.vendorKey));assert.ok(a.sites.some(s=>s.key===t.siteKey));if(t.status==='in_progress')assert.equal(t.lifecycleState,'on_site');if(t.checkOutAt)assert.ok(t.checkOutAt>t.checkInAt);}
 for(const r of a.runs)assert.ok(a.vehicles.some(v=>v.key===r.vehicleKey&&v.vendorKey===r.vendorKey));
 for(const person of a.people)assert.ok(person.email.endsWith('@example.invalid'));
 for(const org of [a.partner,...a.vendors])assert.ok(org.name.endsWith('— Demo'));
});
test('reject invalid anchors',()=>assert.throws(()=>makeDemoEcosphere('yesterday')));
