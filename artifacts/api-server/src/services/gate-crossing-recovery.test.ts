import {expect,it,vi} from 'vitest';
vi.mock('@workspace/db',()=>({pool:{query:vi.fn()}}));
vi.mock('./gate-notification-events',()=>({notifyGateCrossingException:vi.fn()}));
import * as topology from './gate-topology';
import * as links from './gate-links';
it('outer checkout reconciles the missing inner departure and closes the property visit at the observed outer gate',()=>{
 const recover=(topology as any).siteDepartureMovements;
 expect(recover).toBeTypeOf('function');
 const history=[{kind:'enter',area:'Secure',gateId:'inner',operationId:'arrival'}];
 const result=recover(history,{id:'outer',name:'Outer'},8,'2026-11-22T10:00:00.000Z');
 expect(result.movements.map((m:any)=>m.kind)).toEqual(['leave','site_exit']);
 expect(result.exception).toContain('Inner secure-area checkout missed');
 expect(result.movements[0]).toMatchObject({gateId:'outer',area:'Secure',changes:{actualDepartureTimeUnknown:true}});
 expect(topology.confirmedSecureArea([...history,...result.movements] as any)).toBe('');
 expect(history).toHaveLength(1);
});
it('station sharing follows explicit series and parallel connections and isolates unrelated gates at the same site',()=>{
 const connected=(links as any).connectedGateIds;
 expect(connected).toBeTypeOf('function');
 const gates=[{id:'outer'},{id:'inner',topology:{parentGateId:'outer'}},{id:'alternate',topology:{parallelGateId:'inner'}},{id:'independent'}];
 expect(connected(gates,'outer').sort()).toEqual(['alternate','inner','outer']);
 expect(connected(gates,'independent')).toEqual(['independent']);
});
