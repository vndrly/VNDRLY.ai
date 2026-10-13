/** Public synthetic demo readback. Cookies and public map tokens are never logged. */
import assert from 'node:assert/strict';
const base=process.env.DEMO_VERIFY_BASE??'https://vndrly.ai/api';
const results=[];
for(const persona of ['partner','field','fleet','gate']){
 const entry=await fetch(`${base}/auth/demo-entry`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({persona})});assert.equal(entry.status,200);
 const cookie=entry.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const read=async path=>{const response=await fetch(base+path,{headers:{cookie}});assert.equal(response.status,200,`${persona} ${path}`);return response.json();};
 const me=await read('/auth/me');assert.equal(me.realm,'demo');assert.equal(me.publicDemo,true);
 const tickets=await read('/tickets');const rows=Array.isArray(tickets)?tickets:tickets.items??tickets.tickets;assert.equal(rows.length,persona==='partner'?90:30);
 const result={persona,tickets:rows.length};
 if(persona!=='partner'){const operations=await read('/company-operations');assert.deepEqual(operations.categories,[persona]);result.categories=operations.categories;}
 if(persona==='fleet'){
  const fleet=await read('/fleet/overview');assert.equal(fleet.enabled,true);assert.equal(fleet.runs.length,30);assert.ok(fleet.fleets.length);result.runs=fleet.runs.length;
  const commercial=await read('/fleet/commercial');assert.ok(JSON.stringify(commercial).includes('Prairie Transfer Yard'));
  const history=await read(`/fleet/runs/${fleet.runs[0].id}/location-history`);assert.equal(history.points.length,61);assert.ok(history.points.every(point=>point.physicalProofVerified===false));result.routeSamples=history.points.length;
  const foreign=await fetch(`${base}/tickets/100009`,{headers:{cookie}});assert.ok([403,404].includes(foreign.status));
 }
 if(persona==='gate'){const coverage=await read('/gate-change-over/coverage-map?at=2026-10-10T16%3A00%3A00Z');assert.ok(coverage.gates.length);assert.ok(coverage.duties.length);assert.ok(coverage.staff.some(person=>person.fresh));result.historicalDuties=coverage.duties.length;result.recordedStaffPositions=coverage.staff.filter(person=>person.fresh).length;}
 const blocked=await fetch(`${base}/work-hub/tasks`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Must remain blocked'})});assert.equal(blocked.status,403);
 results.push(result);
}
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),results},null,2));
