import { expect, it } from 'vitest';
import { canonicalSiteVisitPeople } from './site-visit-people';
const legacy = { role: 'lead' as const, sessionId: null, employeeId: 973, travelMinutes: 20, onSiteMinutes: 60, source: 'ticket' };
const recorded = { role: 'crew' as const, sessionId: 12, employeeId: 973, travelMinutes: null, onSiteMinutes: 60, source: 'gps', checkInLatitude: 35.5 };
it('counts one recorded lead visit once instead of doubling its time', () => {
 const result=canonicalSiteVisitPeople([legacy,recorded]);
 expect(result).toHaveLength(1); expect(result.reduce((total,person)=>total+person.onSiteMinutes,0)).toBe(60);
 expect(result[0]).toMatchObject({sessionId:12,role:'lead',travelMinutes:20,source:'gps',checkInLatitude:35.5});
 expect(recorded.role).toBe('crew');
});
it('preserves separate repeated visits and other employees without repeating travel', () => {
 const result=canonicalSiteVisitPeople([legacy,recorded,{...recorded,sessionId:13,onSiteMinutes:30},{...recorded,sessionId:14,employeeId:974,onSiteMinutes:45}]);
 expect(result).toHaveLength(3); expect(result.reduce((total,person)=>total+person.onSiteMinutes,0)).toBe(135);
 expect(result.map(person=>person.role)).toEqual(['lead','lead','crew']); expect(result.map(person=>person.travelMinutes)).toEqual([20,null,null]);
});
it('retains legacy evidence when no structured lead session exists', () => {
 const other={...recorded,employeeId:974}; expect(canonicalSiteVisitPeople([legacy,other])).toEqual([legacy,other]);
 expect(canonicalSiteVisitPeople([other])).toEqual([other]);
});
