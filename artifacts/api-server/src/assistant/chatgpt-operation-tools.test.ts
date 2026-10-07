import { describe, expect, it } from 'vitest';
import { chatGptActionTools } from './chatgpt-tool-access';
import { exposedOperationTools, resolveOperationTool } from './chatgpt-operation-tools';
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
});
