import {expect,it,vi} from 'vitest';
vi.mock('@workspace/db',()=>({pool:{}}));
vi.mock('./gate-change-over',()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}},changeOverTransaction:vi.fn(),requireChangeOverAccess:vi.fn(),requireGateStationManagementAccess:vi.fn()}));
import {movementPresence,validateGateTopology,type GateMovement,resolveGateDestination,confirmedSecureArea} from './gate-topology';
const movement=(kind:GateMovement['kind'],gateId='area1',destination='remain',destinationGateId:string|null=null):GateMovement=>({operationId:crypto.randomUUID(),kind,gateId,gateName:gateId,area:gateId==='main'?'':'Area '+gateId,destination,destinationGateId,at:new Date().toISOString(),actorId:1});
it('keeps one site visit and clears Main Gate departure when another area admits the person',()=>{
 const entered=movement('enter'),left=movement('leave','area1','site_exit');
 expect(movementPresence([entered],'main',false)).toMatchObject({currentGateId:'area1',expectedSiteExit:false});
 expect(movementPresence([entered,left],'main',false)).toMatchObject({currentGateId:null,expectedSiteExit:true});
 expect(movementPresence([entered,left,movement('enter','area2')],'main',false)).toMatchObject({currentGateId:'area2',expectedGateId:null,expectedSiteExit:false});
 expect(movementPresence([entered,left,movement('site_exit','main')],'main',true)).toMatchObject({currentGateId:null,expectedSiteExit:false,label:'Departed site'});
});
it('routes expected arrivals without inventing physical presence and supports remaining on site',()=>{
 expect(movementPresence([movement('route','main','Area 1','area1')],'main',false)).toMatchObject({currentGateId:'main',expectedGateId:'area1',expectedSiteExit:false});
 expect(movementPresence([movement('enter'),movement('leave','area1','Area 2','area2')],'main',false)).toMatchObject({currentGateId:null,expectedGateId:'area2',expectedSiteExit:false});
 expect(movementPresence([movement('enter'),movement('leave')],'main',false)).toMatchObject({currentGateId:null,expectedGateId:null,expectedSiteExit:false});
});
it('lets multiple entrances serve one secure area and rejects cycles or cross-site references',()=>{
 const topology={kind:'series' as const,area:'Well 1',parentGateId:'main',parallelGateId:null};
 const gates=[{id:'main',topology:null},{id:'one',topology}];
 expect(validateGateTopology(gates,'two',{...topology,kind:'parallel',parallelGateId:'one'})).toMatchObject({area:'Well 1',parentGateId:'main'});
 expect(()=>validateGateTopology(gates,'main',{...topology,parentGateId:'one'})).toThrow('upstream of itself');
 expect(()=>validateGateTopology(gates,'three',{...topology,parentGateId:'outside'})).toThrow('pass through first');
});

it('defaults the sole inner destination and distinguishes an ungated named destination',()=>{
 const gates=[{id:'main',name:'Warwick Completions 1',topology:null},{id:'inner',name:'Warwick Roman Completions 2',topology:{kind:'series' as const,area:'Secure area',parentGateId:'main',parallelGateId:null}}];
 expect(resolveGateDestination(gates,'main')).toMatchObject({gateId:'inner'});
 const configured=[{...gates[0],topology:{kind:'independent' as const,area:'',parentGateId:null,parallelGateId:null,destinations:[{id:'office',name:'Office',gateId:null},{id:'secure',name:'Secure area',gateId:'inner'}],defaultDestinationId:'office'}},gates[1]];
 expect(resolveGateDestination(configured,'main')).toEqual({id:'office',name:'Office',gateId:null});
 expect(resolveGateDestination(configured,'main','secure')).toMatchObject({gateId:'inner'});
 expect(()=>resolveGateDestination(configured,'main','unknown')).toThrow('configured destination');
});
it('preserves confirmed location when a destination changes and clears it only on confirmed departure',()=>{
 const enter=movement('enter'),route=movement('route','main','Office');
 expect(movementPresence([enter,route],'main',false)).toMatchObject({lastConfirmedGateId:'area1',lastConfirmedLocation:'Area area1',intendedDestination:'Office'});
 expect(confirmedSecureArea([enter,route])).toBe('Area area1');
 expect(confirmedSecureArea([enter,movement('leave')])).toBe('');
});
it('cancels pending inner arrival only when the property visit is closed',()=>{
 const route=movement('route','main','Secure area','inner');
 expect(movementPresence([route],'main',false)).toMatchObject({expectedGateId:'inner',label:'On Site · Awaiting inner arrival'});
 expect(movementPresence([route,movement('site_exit','main')],'main',true)).toMatchObject({expectedGateId:null,currentGateId:null,lastConfirmedLocation:'Exited property'});
});
