/** GateGo-only static sales examples. No phone telemetry, consent, assignments or credentials are changed. */
import '../load-env-local.mjs';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
const {Client}=createRequire(new URL('../../lib/db/package.json',import.meta.url))('pg');
const batch='gatego-static-map-2026-10-30',vendor=1115,apply=process.argv.includes('--apply');
const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
try{
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[batch]);
 if((await c.query('SELECT name FROM vendors WHERE id=$1',[vendor])).rows[0]?.name!=='GateGo')throw Error('Expected GateGo demonstration company');
 const people=(await c.query("SELECT DISTINCT u.id,u.display_name,vp.vendor_role FROM users u JOIN user_org_memberships m ON m.user_id=u.id LEFT JOIN vendor_people vp ON vp.id=m.vendor_people_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND u.suspended_at IS NULL AND u.display_name<>'Go Reviewer' ORDER BY u.id",[vendor])).rows;
 const gates=(await c.query("SELECT g.id,g.name,g.latitude,g.longitude,s.name AS site_name FROM gate_stations g JOIN site_locations s ON s.id=g.site_id WHERE g.site_id IN(399,400,401) AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL AND g.active=true ORDER BY g.site_id,g.name")).rows;
 if(gates.length<4||people.length<18)throw Error('Expected the existing linked-gate demonstration roster');
 const duties=(await c.query("SELECT DISTINCT ON(d.user_id) d.user_id,d.station_id FROM gate_duty_sessions d JOIN gate_stations g ON g.id=d.station_id WHERE g.site_id IN(399,400,401) AND d.started_at<=now() AND d.ended_at IS NULL ORDER BY d.user_id,d.started_at DESC")).rows;
 const capturedAt=new Date().toISOString(),results=[];
 for(const [i,person]of people.entries()){
  const duty=duties.find(d=>d.user_id===person.id),gate=gates.find(g=>g.id===duty?.station_id)??gates[i%gates.length];
  const office=person.vendor_role==='office',road=!office&&!duty&&i%3===0;
  const latitude=office?32.1802+(i%3)*.0003:road?32.258+(i%4)*.005:Number(gate.latitude)+(i%4-1.5)*.00065;
  const longitude=office?-101.8353+(i%3)*.0003:road?-101.938+(i%4)*.006:Number(gate.longitude)+(i%3-1)*.0007;
  const label=office?'GateGo office · Web terminal':road?'On the road · Stanton to Antelope Draw':`${gate.site_name} | ${gate.name} · ${duty?'Booth terminal':'Site patrol'}`;
  const value={userId:person.id,synthetic:true,sampleBatch:batch,label,location:{latitude,longitude,accuracy:0,capturedAt},source:'static_demonstration',physicalProofVerified:false};
  const exists=(await c.query("SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='gate-map-demonstration' AND target_id=$2 AND tool_input->>'sampleBatch'=$3",[vendor,String(person.id),batch])).rows[0];
  if(!exists)await c.query("INSERT INTO assistant_action_audit(user_id,actor_role,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status,created_at) VALUES($1,'vendor',$2,'work-hub','typed','synthetic','gate_map_demonstration','sample-location','gate-map-demonstration',$3,$4::jsonb,$5::jsonb,'completed',now())",[1144,vendor,String(person.id),JSON.stringify({sampleBatch:batch,synthetic:true}),JSON.stringify(value)]);
  results.push({userId:person.id,name:person.display_name,label,latitude,longitude,alreadyPresent:!!exists});
 }
 await c.query(apply?'COMMIT':'ROLLBACK');
 const proof={batch,applied:apply,observedAt:new Date().toISOString(),employees:results.length,results};
 await mkdir('.local',{recursive:true});await writeFile(`.local/map-staff-demo-${apply?'applied':'dry-run'}.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}
