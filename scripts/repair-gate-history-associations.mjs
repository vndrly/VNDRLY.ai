import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../lib/db/src/index.ts';
import { requireChangeOverAccess } from '../artifacts/api-server/src/services/gate-change-over.ts';
import { repairScope, buildGateAssociationRepair } from './gate-history-association-repair.mjs';
import { migrateGateHistoryAssociations } from './gate-history-association-migration.mjs';

const sites=repairScope.map(s=>s.siteId), vendorId=1115, actorId=1142;
const arg=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const apply=process.argv.includes('--apply'), rollbackFile=arg('--rollback');
if(apply&&rollbackFile)throw Error('Choose apply or rollback, never both');
const backupDir=arg('--backup-dir');
if(apply&&(!backupDir||!path.isAbsolute(backupDir)))throw Error('Apply requires an absolute --backup-dir');
const c=await pool.connect();
let committed=false;
try {
  await c.query(apply||rollbackFile?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN READ ONLY');
  await c.query("SET LOCAL lock_timeout='5s'");
  await c.query("SET LOCAL statement_timeout='30s'");
  const user=(await c.query("SELECT u.session_version,m.role FROM users u JOIN user_org_memberships m ON m.user_id=u.id JOIN vendors v ON v.id=m.vendor_id WHERE u.id=$1 AND m.id=873 AND m.vendor_id=$2 AND m.org_type='vendor' AND lower(v.name)='gatego'",[actorId,vendorId])).rows[0];
  if(!user||user.role!=='admin')throw Error('Verified GateGo administrator membership required');
  const session={userId:actorId,role:'vendor',vendorId,membershipRole:'admin',activeMembershipId:873,sv:user.session_version};
  for(const site of repairScope){const access=await requireChangeOverAccess(c,session,site.siteId);if(access.site.name!==site.name)throw Error('Site identity changed');}
  if(apply||rollbackFile)await c.query("SELECT pg_advisory_xact_lock(hashtextextended('gatego-historical-gate-association',0))");
  if(rollbackFile){
    const originalText=await readFile(rollbackFile,'utf8');
    const expectedHash=(await readFile(path.join(path.dirname(rollbackFile),'before-image.sha256'),'utf8')).trim();
    if(createHash('sha256').update(originalText).digest('hex')!==expectedHash)throw Error('Rollback backup checksum mismatch');
    const original=JSON.parse(originalText);
    if(original.vendorId!==vendorId||original.scope.join(',')!==sites.join(','))throw Error('Rollback scope mismatch');
    const applied=(await c.query("SELECT count(*)::int AS records FROM work_hub_audit_log WHERE owner_org_type='vendor' AND owner_org_id=$1 AND operation_id=$2 AND action='gate.history.association.corrected'",[vendorId,original.correctionId])).rows[0];
    if(applied.records!==original.rows.length)throw Error('Rollback requires matching durable applied audit records');
    for(const row of original.rows){
      const table=row.kind==='visitor'?'site_visits':row.kind==='employee'?'ticket_check_ins':null;
      const target=repairScope.find(site=>site.siteId===row.site_id);
      if(!table||!target||row.target_gate_id!==target.gateId||row.gate_station_id!=null||row.gate_association_provenance!=null)throw Error('Unsupported rollback before-image');
      const changed=row.kind==='visitor'?await c.query(`UPDATE site_visits SET gate_station_id=NULL,gate_association_provenance=NULL WHERE id=$1 AND gate_station_id=$2 AND gate_association_provenance->>'correctionId'=$3 AND site_location_id=$4 RETURNING id`,[row.id,row.target_gate_id,original.correctionId,row.site_id]):await c.query(`UPDATE ticket_check_ins ci SET gate_station_id=NULL,gate_association_provenance=NULL FROM tickets t WHERE ci.ticket_id=t.id AND ci.id=$1 AND ci.gate_station_id=$2 AND ci.gate_association_provenance->>'correctionId'=$3 AND t.site_location_id=$4 RETURNING ci.id`,[row.id,row.target_gate_id,original.correctionId,row.site_id]);
      if(changed.rowCount!==1)throw Error('Rollback stopped: association subsequently changed');
    }
    await c.query("INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,source,operation_id,metadata) VALUES($1,'vendor',$2,'gate.history.association.reverted','gate_history_correction',$3,'codex',$4,$5::jsonb)",[actorId,vendorId,original.correctionId,randomUUID(),JSON.stringify({reverses:original.correctionId,records:original.rows.length,source:'explicit_rollback'})]);
    await c.query('COMMIT');committed=true;console.log(JSON.stringify({rolledBack:original.rows.length,originalCorrectionId:original.correctionId}));
  } else {
    if(apply)await migrateGateHistoryAssociations(c);
    if(apply){await c.query('SELECT id FROM site_visits WHERE site_location_id=ANY($1::int[]) ORDER BY id FOR UPDATE',[sites]);await c.query('SELECT ci.id FROM ticket_check_ins ci JOIN tickets t ON t.id=ci.ticket_id WHERE t.site_location_id=ANY($1::int[]) ORDER BY ci.id FOR UPDATE OF ci,t',[sites]);}
    const gates=(await c.query(`SELECT id,site_id,name,active FROM gate_stations WHERE site_id=ANY($1::int[])${apply?' FOR SHARE':''}`,[sites])).rows;
    const readRows=async()=> (await c.query(`SELECT 'visitor' AS kind,v.id,v.site_location_id AS site_id,to_jsonb(v)->>'gate_station_id' AS gate_station_id,to_jsonb(v)->'gate_association_provenance' AS gate_association_provenance,v.check_in_gps_evidence->>'gateStationId' AS evidence_gate_id,v.check_out_gps_evidence->>'gateStationId' AS exit_gate_id,md5((to_jsonb(v)-'gate_station_id'-'gate_association_provenance')::text) AS immutable_hash FROM site_visits v WHERE v.site_location_id=ANY($1::int[])
      UNION ALL SELECT 'employee',ci.id,t.site_location_id,to_jsonb(ci)->>'gate_station_id',to_jsonb(ci)->'gate_association_provenance',NULL,NULL,md5((to_jsonb(ci)-'gate_station_id'-'gate_association_provenance')::text) FROM ticket_check_ins ci JOIN tickets t ON t.id=ci.ticket_id WHERE t.site_location_id=ANY($1::int[]) ORDER BY kind,id`,[sites])).rows;
    const before=await readRows(),plan=buildGateAssociationRepair(before,gates);
    for(const site of repairScope)for(const [kind,expected]of[['visitor',site.visitors],['employee',site.employees]]){
      const actual=before.filter(r=>r.site_id===site.siteId&&r.kind===kind).length;
      if(actual!==expected)throw Error(`Count drift at site ${site.siteId}: ${kind} expected ${expected}, found ${actual}. Review before mutation.`);
    }
    const correctionId=randomUUID(),correctedAt=new Date().toISOString();
    const provenance={source:'user_supplied_historical_correction',correctionId,correctedAt,instruction:"Each historical entry at sites 399, 400 and 401 belongs to its own site's active Main Gate. User confirmed: They'd all be main gate; Okay, do that."};
    const summary=repairScope.map(site=>({siteId:site.siteId,name:site.name,gateId:site.gateId,visitorsChanged:plan.changes.filter(r=>r.kind==='visitor'&&r.site_id===site.siteId).length,employeesChanged:plan.changes.filter(r=>r.kind==='employee'&&r.site_id===site.siteId).length,unchanged:plan.unchanged.filter(r=>r.site_id===site.siteId).length}));
    if(apply&&plan.changes.length){
      await mkdir(backupDir,{recursive:true});
      const image={correctionId,correctedAt,vendorId,actorId,scope:sites,authorization:provenance.instruction,rows:plan.changes,preserved:plan.unchanged};
      const imageText=JSON.stringify(image,null,2),imagePath=path.join(backupDir,'before-image.json');
      await writeFile(imagePath,imageText,{flag:'wx'});
      await writeFile(path.join(backupDir,'before-image.sha256'),createHash('sha256').update(imageText).digest('hex'),{flag:'wx'});
      let updated=0;
      for(const site of repairScope)for(const kind of ['visitor','employee']){
        const ids=plan.changes.filter(r=>r.site_id===site.siteId&&r.kind===kind).map(r=>r.id);if(!ids.length)continue;
        const result=kind==='visitor'?await c.query(`UPDATE site_visits SET gate_station_id=$1,gate_association_provenance=$2::jsonb WHERE site_location_id=$3 AND id=ANY($4::int[]) AND gate_station_id IS NULL AND gate_association_provenance IS NULL AND nullif(check_in_gps_evidence->>'gateStationId','') IS NULL RETURNING id`,[site.gateId,JSON.stringify(provenance),site.siteId,ids]):await c.query(`UPDATE ticket_check_ins ci SET gate_station_id=$1,gate_association_provenance=$2::jsonb FROM tickets t WHERE t.id=ci.ticket_id AND t.site_location_id=$3 AND ci.id=ANY($4::int[]) AND ci.gate_station_id IS NULL AND ci.gate_association_provenance IS NULL RETURNING ci.id`,[site.gateId,JSON.stringify(provenance),site.siteId,ids]);
        if(result.rowCount!==ids.length)throw Error('Repair write count mismatch; rolling back');updated+=result.rowCount;
      }
      const auditRows=plan.changes.map(r=>({subjectId:`${r.kind}:${r.id}`,siteId:r.site_id,gateId:r.target_gate_id,beforeGateId:r.gate_station_id,beforeProvenance:r.gate_association_provenance}));
      const audits=await c.query(`INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,source,operation_id,metadata)
        SELECT $1,'vendor',$2,'gate.history.association.corrected','gate_record',r."subjectId",'codex',$3,jsonb_build_object('siteId',r."siteId",'beforeGateId',r."beforeGateId",'beforeProvenance',r."beforeProvenance",'gateId',r."gateId",'provenance',$4::jsonb)
        FROM jsonb_to_recordset($5::jsonb) AS r("subjectId" text,"siteId" int,"beforeGateId" text,"beforeProvenance" jsonb,"gateId" text)`,[actorId,vendorId,correctionId,JSON.stringify(provenance),JSON.stringify(auditRows)]);
      if(audits.rowCount!==updated)throw Error('Audit write count mismatch');
      const after=await readRows(),afterPlan=buildGateAssociationRepair(after,gates);
      if(afterPlan.changes.length!==0||after.length!==before.length)throw Error('Post-write association verification failed');
      const prior=new Map(before.map(r=>[`${r.kind}:${r.id}`,r]));
      for(const row of after){const old=prior.get(`${row.kind}:${row.id}`);if(!old||row.immutable_hash!==old.immutable_hash)throw Error('A field outside association/provenance changed');}
      for(const preserved of plan.unchanged){const row=after.find(r=>r.kind===preserved.kind&&r.id===preserved.id);if(JSON.stringify(row)!==JSON.stringify(preserved))throw Error('A preserved association changed');}
      await c.query('COMMIT');committed=true;
      const receipt={correctionId,correctedAt,committed:true,updated,preserved:plan.unchanged.length,verifiedImmutableRecords:after.length,auditRows:audits.rowCount,summary,beforeImage:imagePath};
      let receiptSaved=true;
      try { await writeFile(path.join(backupDir,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'}); }
      catch { receiptSaved=false; console.error(`Database COMMITTED correction ${correctionId}; local receipt could not be saved. Inspect durable audit before any retry.`); }
      console.log(JSON.stringify({...receipt,receiptSaved},null,2));
    } else {
      await c.query('COMMIT');committed=true;console.log(JSON.stringify({apply,changed:0,wouldChange:plan.changes.length,preserved:plan.unchanged.length,summary},null,2));
    }
  }
} catch(error){if(!committed)await c.query('ROLLBACK');throw error;}
finally {c.release();await pool.end();}
