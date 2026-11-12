import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@workspace/db',()=>({pool:{query:mocks.query}}));
vi.mock('./gate-change-over',()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}},changeOverTransaction:async(fn:any)=>fn({query:mocks.query}),requireChangeOverAccess:vi.fn(),requireGateOperatingContext:vi.fn(),requireGateStationManagementAccess:vi.fn()}));
import {recordGateMovement,movementPresence,type GateMovement} from './gate-topology';
let history:GateMovement[]=[];
const gates=[{id:'outer',name:'Warwick Completions 1',topology:null},{id:'inner',name:'Warwick Roman Completions 2',topology:{kind:'series',area:'Secure area',parentGateId:'outer'}}];
const session={userId:8,role:'vendor',vendorId:7} as any;
beforeEach(()=>{
 history=[];vi.clearAllMocks();
 mocks.query.mockImplementation(async(sql:string,args:any[])=>{
  if(sql.startsWith('SELECT id,name,topology'))return {rows:gates.filter(g=>g.id===args[0])};
  if(sql.includes('FROM site_visits'))return {rows:[{id:1,gate_station_id:'outer',gate_movements:history,check_out_time:null}]};
  if(sql.startsWith('SELECT name'))return {rows:gates.filter(g=>g.id===args[0])};
  if(sql.startsWith('UPDATE site_visits')){history.push(...JSON.parse(args[1]));return {rows:[]};}
  return {rows:[]};
 });
});
const act=(gateId:string,kind:'enter'|'leave'|'route',extra={})=>recordGateMovement(session,{siteId:5,visitId:1,gateId,kind,operationId:crypto.randomUUID(),...extra});
it('records inner arrival, checkout, and return on one visit, clearing the pending outer departure',async()=>{
 await act('outer','route',{destinationGateId:'inner'});
 expect(movementPresence(history,'outer',false)).toMatchObject({currentGateId:'outer',expectedGateId:'inner'});
 await act('inner','enter');
 expect(movementPresence(history,'outer',false)).toMatchObject({currentGateId:'inner',expectedGateId:null});
 await act('inner','leave',{destination:'site_exit'});
 expect(movementPresence(history,'outer',false)).toMatchObject({currentGateId:null,expectedSiteExit:true});
 await act('inner','enter');
 expect(movementPresence(history,'outer',false)).toMatchObject({currentGateId:'inner',expectedSiteExit:false});
 expect(history).toHaveLength(4);expect(history.every(m=>m.actorId===8)).toBe(true);
 expect(mocks.query.mock.calls.filter(([sql])=>sql.startsWith('UPDATE')).every(([sql])=>!sql.includes('check_in_time')&&!sql.includes('check_out_time'))).toBe(true);
});
it('requires secure-area checkout before changing destination and preserves all confirmed events',async()=>{
 await act('inner','enter');
 await expect(act('outer','route',{destination:'remain'})).rejects.toMatchObject({status:409});
 expect(history).toHaveLength(1);expect(history[0].kind).toBe('enter');
 await act('inner','leave',{destination:'remain'});
 await act('outer','route',{destinationGateId:'inner'});
 expect(movementPresence(history,'outer',false)).toMatchObject({expectedGateId:'inner',expectedSiteExit:false});
});
it('retries one movement without appending twice and rejects mismatched reuse',async()=>{
 const command={siteId:5,visitId:1,gateId:'inner',kind:'enter' as const,operationId:crypto.randomUUID()};
 await recordGateMovement(session,command);await recordGateMovement(session,command);
 expect(history).toHaveLength(1);
 await expect(recordGateMovement(session,{...command,kind:'leave'})).rejects.toMatchObject({status:409});
});
