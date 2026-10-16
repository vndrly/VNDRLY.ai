import { expect, it } from 'vitest';
import { FLEET_TOOLS } from './fleet-tools';
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from './work-hub-tool-runtime';
import { chatGptActionTools } from './chatgpt-tool-access';
import { validateChatGptActionInput } from './chatgpt-write-capabilities';
const actor={userId:1,role:'vendor' as const,vendorId:609,membershipRole:'admin' as const};
it('exposes exact eligible billing read and requires separate confirmed office finalization',()=>{
 expect(FLEET_TOOLS.find(t=>t.name==='query_fleet_billing_options')?.mutating).toBe(false);
 expect(resolveExecutableWorkHubToolRequest('query_fleet_billing_options',bindWorkHubToolScope({siteId:4,afeNumber:'SYN AFE',workDate:'2026-10-16'},actor,'query_fleet_billing_options'),false,actor)).toMatchObject({method:'GET',path:'/fleet/billing-options?siteId=4&afeNumber=SYN+AFE&workDate=2026-10-16'});
 const args={ticketId:77,expectedVersion:3,operationId:'10000000-0000-4000-8000-000000000001'};
 expect(resolveExecutableWorkHubToolRequest('finalize_fleet_ticket',args,false,actor)).toHaveProperty('requiresConfirmation',true);
 expect(resolveExecutableWorkHubToolRequest('finalize_fleet_ticket',args,true,actor)).toMatchObject({method:'POST',path:'/fleet/tickets/77/finalize',body:{expectedVersion:3,operationId:args.operationId}});
 expect(chatGptActionTools(actor,['fleet:review']).some(t=>t.name==='finalize_fleet_ticket')).toBe(false);
 expect(chatGptActionTools(actor,['fleet:billing']).some(t=>t.name==='finalize_fleet_ticket')).toBe(true);
 expect(()=>validateChatGptActionInput('finalize_fleet_ticket',{ticketId:77,expectedVersion:3})).not.toThrow();
 expect(()=>validateChatGptActionInput('finalize_fleet_ticket',{ticketId:77,expectedVersion:-1})).toThrow();
});

it('rejects new run preparation without billing and retains explicit billing under confirmation',()=>{
 const fields={action:'create',fleetId:'20000000-0000-4000-8000-000000000001',title:'Synthetic haul',driverUserId:5,vehicleAssetId:'30000000-0000-4000-8000-000000000001',stops:[{id:'40000000-0000-4000-8000-000000000001',siteId:4,kind:'pickup',sequence:0}]};
 expect(()=>validateChatGptActionInput('manage_fleet_run',fields)).toThrow();
 const billing={mode:'new_ticket',workTypeId:8,afeNumber:'AFE-SYN',workDate:'2026-10-16'};
 expect(()=>validateChatGptActionInput('manage_fleet_run',{...fields,billing})).not.toThrow();
 expect(resolveExecutableWorkHubToolRequest('manage_fleet_run',{...fields,billing,operationId:'10000000-0000-4000-8000-000000000001'},true,actor)).toMatchObject({method:'POST',path:'/fleet/runs',body:{billing}});
});
