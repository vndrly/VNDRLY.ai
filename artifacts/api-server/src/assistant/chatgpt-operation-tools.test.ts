import { describe, expect, it } from 'vitest';
import { chatGptActionTools, chatGptReadableTools } from './chatgpt-tool-access';
import { exposedOperationTools, resolveOperationTool, planOperationTools, operationToolAnnotations, canonicalOperationToolName } from './chatgpt-operation-tools';
import { prepareWorkPlan } from './chatgpt-coordinated-plan';
import { specialistDirectory } from './chatgpt-specialists';
describe('role-bound operation exposure', () => {
  const worker = { userId: 1073, role: 'field_employee' as const, vendorId: 1107, vendorPeopleId: 969 };
  const tools = chatGptActionTools(worker, ['tickets:write','gate:write']);
  it('never exposes a partner approval operation to a worker', () => {
    expect(exposedOperationTools(tools).some(t => t.name === 'manage_ticket_record_approve')).toBe(false);
    expect(resolveOperationTool('manage_ticket_record_approve',{},tools).name).toBe('manage_ticket_record_approve');
  });
  it('binds the selected operation and rejects action substitution', () => {
    expect(resolveOperationTool('manage_ticket_record_submit',{ticketId:1,payload:{}},tools)).toEqual({name:'manage_ticket_record',input:{ticketId:1,payload:{},action:'submit'}});
    expect(()=>resolveOperationTool('manage_ticket_record_submit',{action:'approve'},tools)).toThrow('fixed');
  });
  it('retains canonical input fields but removes the operation selector', () => {
    const submit=exposedOperationTools(tools).find(t=>t.name==='manage_ticket_record_submit')!;
    expect(submit.inputSchema.properties).not.toHaveProperty('action');
    expect(submit.inputSchema.required).not.toContain('action');
    expect(submit.inputSchema.properties).toHaveProperty('ticketId');
  });
  it('supports exposed operations in coordinated plans without granting partner approval', () => {
    const available = new Set(planOperationTools(tools).map(t=>t.name));
    const request={planId:'bb2f2b98-e128-4e75-b59f-f40ae6228dd2',title:'Synthetic plan',steps:[{id:'submit',specialist:'Field Operations',toolNames:['manage_ticket_record_submit'],dependsOn:[]}]};
    const identity={userId:1073,organizationKey:'vendor:1107'};
    expect(()=>prepareWorkPlan(request,identity,{type:'vendor',id:1107},available)).not.toThrow();
    expect(()=>prepareWorkPlan({...request,steps:[{...request.steps[0],toolNames:['manage_ticket_record_approve']}]},identity,{type:'vendor',id:1107},available)).toThrow();
    expect(available.has('manage_ticket_record')).toBe(true);
    const directory=specialistDirectory([],exposedOperationTools(tools));
    expect(directory.specialists.find(s=>s.id==='field_operations')?.prepareTools).toContain('manage_ticket_record_submit');
    expect(directory.specialists.find(s=>s.id==='field_operations')?.prepareTools).not.toContain('manage_ticket_record');
  });
});

it('exposes only current permitted away/display/workforce operations with fixed canonical bindings', () => {
  const session={userId:17,role:'vendor',vendorId:4,membershipRole:'admin',activeMembershipId:8,sv:2};
  const actions=chatGptActionTools(session,['work_hub:write','operations:write','workforce:write']);
  const exposed=exposedOperationTools(actions);
  for(const [family,operations] of [['manage_work_hub_away_responder',['configure','pause','revoke']],['confirm_operations_displays_action',['route','join_room','revoke']],['confirm_workforce_coverage_action',['assign','acknowledge','evaluate','escalate']]] as const) {
    expect(exposed.some(tool=>tool.name===family)).toBe(false);
    for(const action of operations){
      const tool=exposed.find(tool=>tool.name===family+'_'+action)!;
      expect(tool).toBeDefined();expect(tool.inputSchema.properties).not.toHaveProperty('action');
      expect(resolveOperationTool(tool.name,{expectedVersion:2},actions)).toEqual({name:family,input:{expectedVersion:2,action}});
      expect(()=>resolveOperationTool(tool.name,{action:'other'},actions)).toThrow('fixed');
      expect(operationToolAnnotations(tool)).toMatchObject({readOnlyHint:false,destructiveHint:true,openWorldHint:false});
      expect(canonicalOperationToolName(tool.name)).toBe(family);
      expect(resolveOperationTool(tool.name,{},[]).name).toBe(tool.name);
    }
  }
  const reads=chatGptReadableTools(session,['workforce:read']);
  const prepared=exposedOperationTools(reads).filter(tool=>tool.name.startsWith('prepare_workforce_coverage_action_'));
  expect(prepared).toHaveLength(4);
  for(const tool of prepared)expect(operationToolAnnotations(tool)).toEqual({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
  const away=exposed.find(tool=>tool.name==='manage_work_hub_away_responder_pause')!;
  expect(away.inputSchema.required).toEqual(['expectedVersion','ruleId']);expect(away.inputSchema.properties).not.toHaveProperty('replyText');
  const display=exposed.find(tool=>tool.name==='confirm_operations_displays_action_revoke')!;
  expect(display.inputSchema.required).toEqual(['displayId','expectedUpdatedAt','reason']);expect(display.inputSchema.properties).not.toHaveProperty('view');
  expect(exposedOperationTools(chatGptActionTools({...session,membershipRole:'member'},['operations:write'])).some(tool=>tool.name.startsWith('confirm_operations_displays_action'))).toBe(false);
});
