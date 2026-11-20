import { describe, expect, it } from 'vitest';
import { agreementShield, expirationShield, notificationShield } from './profile-status';
describe('profile display status',()=>{
  it('ages unaccepted agreements at exactly 30 and 60 days without affecting accepted agreements',()=>{
    const start='2026-01-01T00:00:00Z', now=Date.parse(start), day=86400000;
    expect(agreementShield(false,start,now+30*day-1)).toBe('grey');
    expect(agreementShield(false,start,now+30*day)).toBe('yellow');
    expect(agreementShield(false,start,now+60*day)).toBe('red');
    expect(agreementShield(true,start,now+90*day)).toBe('green');
    expect(agreementShield(false)).toBe('grey');
  });
  it('warns 60 calendar days before expiry, retaining validity through the date',()=>{
    expect(expirationShield('2026-12-31',false,new Date('2026-11-01T12:00:00'))).toBe('yellow');
    expect(expirationShield('2026-12-31',false,new Date('2026-10-31T23:59:59'))).toBe('green');
    expect(expirationShield('2026-12-31',false,new Date('2026-12-31T12:00:00'))).toBe('yellow');
    expect(expirationShield('2026-12-31',false,new Date('2027-01-01T00:00:00'))).toBe('red');
    expect(expirationShield(null,true)).toBe('green');
    expect(expirationShield(null)).toBe('grey');
  });
  it('distinguishes unknown, no, partial and all notification preferences',()=>{
    expect(notificationShield()).toBe('grey');
    expect(notificationShield({mode:'gate'})).toBe('red');
    expect(notificationShield({mode:'gate',pushEnabled:true})).toBe('yellow');
    const keys=['scheduleEnabled','gateCrewEnabled','messagesEnabled','handoffsEnabled','tasksEnabled','complianceEnabled','alertsEnabled','alertsEmailEnabled','alertsSmsEnabled','pushEnabled'];
    expect(notificationShield({mode:'gate',...Object.fromEntries(keys.map(k=>[k,true]))})).toBe('green');
  });
});
