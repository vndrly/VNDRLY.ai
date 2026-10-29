import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGateAssociationRepair, repairScope } from '../gate-history-association-repair.mjs';
import { gateHistoryAssociationStatements } from '../gate-history-association-migration.mjs';
const gates = repairScope.map(s => ({ id:s.gateId,site_id:s.siteId,name:'Main Gate',active:true }));
const rows = [
  {kind:'visitor',id:1,site_id:399,gate_station_id:null,evidence_gate_id:null,exit_gate_id:null,gate_association_provenance:null},
  {kind:'employee',id:2,site_id:400,gate_station_id:null,evidence_gate_id:null,exit_gate_id:null,gate_association_provenance:null},
  {kind:'visitor',id:3558,site_id:401,gate_station_id:null,evidence_gate_id:gates[2].id,exit_gate_id:null,gate_association_provenance:null},
];
test('preserves saved associations and assigns only each record own site active gate',()=>{
  const plan=buildGateAssociationRepair(rows,gates);
  assert.equal(plan.unchanged.length,1);assert.equal(plan.changes.length,2);
  assert.equal(plan.changes[0].target_gate_id,gates[0].id);
  assert.equal(plan.changes[1].target_gate_id,gates[1].id);
  assert.equal(rows[2].gate_station_id,null);
});
test('fails closed on unexpected site, gate identity, active state, or existing association',()=>{
  assert.throws(()=>buildGateAssociationRepair([{...rows[0],site_id:999}],gates),/outside/);
  assert.throws(()=>buildGateAssociationRepair(rows,[{...gates[0],active:false},...gates.slice(1)]),/active Main Gate/);
  assert.throws(()=>buildGateAssociationRepair([{...rows[0],evidence_gate_id:gates[1].id}],gates),/existing/);
  assert.throws(()=>buildGateAssociationRepair([{...rows[0],gate_association_provenance:{source:'unrelated'}}],gates),/provenance/);
});
test('a repeat run changes nothing and does not overwrite provenance',()=>{
  const once=buildGateAssociationRepair(rows,gates);
  const repaired=rows.map(row=>({...row,gate_station_id:once.changes.find(r=>r.kind===row.kind&&r.id===row.id)?.target_gate_id??row.gate_station_id}));
  assert.equal(buildGateAssociationRepair(repaired,gates).changes.length,0);
});
test('migration is exclusively guarded additive columns without data rewrites',()=>{
  assert.equal(gateHistoryAssociationStatements.length,4);
  for(const sql of gateHistoryAssociationStatements)assert.match(sql,/^ALTER TABLE (site_visits|ticket_check_ins) ADD COLUMN IF NOT EXISTS /);
});
