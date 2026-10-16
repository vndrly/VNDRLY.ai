import { expect, it, vi } from 'vitest';
import { readFleetBillingAction, recoverFleetBillingAction, readFleetRunCreation, recoverFleetRunCreation } from './fleet-billing-action-recovery';
const actor={userId:1,role:'vendor' as const,vendorId:609,membershipRole:'admin' as const};
const op='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const saved={ticketId:77,status:'submitted',afeNumber:'AFE',workDate:'2026-10-16',plan:{version:4},finalizationOperationId:op};
it('independently reads exact finalized ticket and rejects another operation or stale version',async()=>{
 const request=vi.fn().mockResolvedValue(saved);
 expect(await readFleetBillingAction({ticketId:77,expectedVersion:3},op,actor,request)).toMatchObject({verified:true,readback:saved});
 expect(request.mock.calls[0].slice(0,3)).toEqual(['/fleet/tickets/77/plan','GET',{}]);
 await expect(readFleetBillingAction({ticketId:77,expectedVersion:3},op,actor,vi.fn().mockResolvedValue({...saved,finalizationOperationId:'wrong'}))).rejects.toThrow();
 await expect(readFleetBillingAction({ticketId:77,expectedVersion:4},op,actor,request)).rejects.toThrow();
 expect(await recoverFleetBillingAction({toolName:'finalize_fleet_ticket',tokenHash:'a'.repeat(64),arguments:{ticketId:77,expectedVersion:3}},actor,['fleet:review'],request)).toBeNull();
 expect(await recoverFleetBillingAction({toolName:'finalize_fleet_ticket',tokenHash:'a'.repeat(64),arguments:{ticketId:77,expectedVersion:3}},actor,['fleet:billing'],request)).toMatchObject({verified:true});
});

it('recovers an uncertain create by exact operation across authorized pages and independently reads its billing',async()=>{
 const id='20000000-0000-4000-8000-000000000001',billing={mode:'new_ticket',workTypeId:8,afeNumber:'AFE-SYN',workDate:'2026-10-16'};
 const run={id,companyId:609,linkedTicketId:77,billing:{afeNumber:'AFE-SYN',workDate:'2026-10-16'},events:[{operationId:op}]};
 const request=vi.fn().mockResolvedValueOnce({runs:[],page:{nextCursor:'1:50'}}).mockResolvedValueOnce({runs:[run],page:{nextCursor:null}}).mockResolvedValueOnce(run);
 expect(await recoverFleetRunCreation({toolName:'manage_fleet_run',tokenHash:'a'.repeat(64),arguments:{action:'create',billing}},actor,['fleet:read','fleet:dispatch'],request)).toMatchObject({id,linkedTicketId:77,verified:true});
 expect(request.mock.calls.map(c=>c[1])).toEqual(['GET','GET','GET']);
 await expect(readFleetRunCreation({billing},op,id,actor,vi.fn().mockResolvedValue({...run,events:[]}))).rejects.toThrow();
 await expect(readFleetRunCreation({billing:{mode:'existing_ticket',ticketId:88,afeNumber:'AFE-SYN',workDate:'2026-10-16'}},op,id,actor,vi.fn().mockResolvedValue(run))).rejects.toThrow();
});
