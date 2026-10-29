/** John explicitly confirmed each record belongs to its own site's active Main Gate.
 * These constants are a repair boundary, never an inference rule for new records. */
export const repairScope = [
  { siteId:399,name:'Antelope Draw Central Tank Battery',gateId:'44c6bfee-e3a1-4a49-a1f0-b3ff58ffb82c',visitors:492,employees:106 },
  { siteId:400,name:'Coyote Ridge 9 Central Tank Battery',gateId:'976bb725-c2d7-4217-a329-ca441edad33b',visitors:476,employees:102 },
  { siteId:401,name:'GasGo Stanton Field Office & Yard',gateId:'f5ba7544-170d-4453-a942-4127e03bd6bc',visitors:413,employees:67 },
];
export function buildGateAssociationRepair(rows,gates) {
  for(const site of repairScope){
    const main=gates.filter(g=>g.site_id===site.siteId&&g.active===true&&g.name==='Main Gate');
    if(main.length!==1||main[0].id!==site.gateId)throw Error(`Expected active Main Gate at site ${site.siteId}`);
  }
  const changes=[],unchanged=[],seen=new Set();
  for(const row of rows){
    const site=repairScope.find(s=>s.siteId===row.site_id);
    if(!site)throw Error('Record outside authorized repair sites');
    if(!['visitor','employee'].includes(row.kind)||!Number.isSafeInteger(row.id)||seen.has(`${row.kind}:${row.id}`))throw Error('Invalid or duplicate record identity');
    seen.add(`${row.kind}:${row.id}`);
    const existing=[row.gate_station_id,row.evidence_gate_id,row.exit_gate_id].filter(value=>value!==null&&value!==undefined&&value!=='');
    if(existing.some(id=>id!==site.gateId))throw Error(`Unexpected existing association on ${row.kind}:${row.id}; no repair applied`);
    if(row.gate_station_id||row.evidence_gate_id){unchanged.push(row);continue;}
    if(row.gate_association_provenance!==null&&row.gate_association_provenance!==undefined)throw Error('Unexpected existing provenance without association');
    changes.push({...row,target_gate_id:site.gateId});
  }
  return {changes,unchanged};
}
