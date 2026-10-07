import type { AskVToolDefinition } from './tool-registry';

const families = new Set(['manage_gate_shift', 'manage_ticket_record', 'manage_work_hub_away_responder', 'confirm_operations_displays_action', 'prepare_workforce_coverage_action', 'confirm_workforce_coverage_action']);
const workforceOperations = ['assign', 'acknowledge', 'evaluate', 'escalate'];
function operations(tool: AskVToolDefinition): string[] {
  if (tool.name === 'prepare_workforce_coverage_action' || tool.name === 'confirm_workforce_coverage_action') return workforceOperations;
  const action = (tool.inputSchema.properties as Record<string, unknown> | undefined)?.action as { enum?: string[] } | undefined;
  return action?.enum ?? [];
}
/** Metadata lookup only; callable resolution still requires the current permitted canonical tool. */
export function canonicalOperationToolName(name: string): string {
  for (const family of families) if (name.startsWith(family + '_')) return family;
  return name;
}
export function operationToolAnnotations(tool: AskVToolDefinition) {
  const canonical = canonicalOperationToolName(tool.name);
  return { readOnlyHint: !tool.mutating, destructiveHint: tool.mutating && (
    canonical === 'manage_ticket_record' || canonical === 'confirm_asset_custody_action' || tool.name === 'manage_gate_shift_cancel_handoff' ||
    canonical === 'manage_work_hub_away_responder' || canonical === 'confirm_operations_displays_action' ||
    canonical === 'confirm_workforce_coverage_action' || ['cancel_fleet_cargo_transfer','cancel_fleet_equipment_replacement'].includes(tool.name)
  ), openWorldHint: false };
}
function operationDescription(tool: AskVToolDefinition, operation: string): string {
  if (tool.name === 'manage_work_hub_away_responder') return operation === 'configure'
    ? 'Prepare approval to replace your own current-company away rule at the exact expectedVersion with explicitly reviewed reply text, UTC window and selected currently joined writable channel IDs. Qualifying incoming Work Hub messages may record at most one neutral reply per selected channel/window. No email, SMS or delivery/read claim. Current account/channel authority is rechecked.'
    : `Prepare approval to ${operation} your exact own current-company away rule using ruleId and expectedVersion. This stops future replies and cannot undo previously recorded replies. Current account/channel authority is rechecked; no provider delivery claim.`;
  if (tool.name === 'confirm_operations_displays_action') return `Prepare approval only to ${operation === 'route' ? 'replace the exact saved monitor routing with the selected view/site' : operation === 'join_room' ? 'replace the exact saved monitor view with the selected meeting occurrence' : 'revoke the exact saved display routing'}. Requires current displayId/expectedUpdatedAt and reason. Current company administrator, registered device and exact site/room authority are rechecked. No pairing, media activation or physical-screen proof.`;
  if (tool.name === 'prepare_workforce_coverage_action') return `Read current authorized workforce coverage context for a proposed ${operation} operation. This observation creates no bound action, approval, assignment or escalation; use the separately exposed matching write operation for authenticated approval.`;
  return `Prepare only the ${operation.replace(/_/g, ' ')} operation. ${tool.description}`;
}
function operationSchema(tool: AskVToolDefinition, operation: string) {
  let keys: Set<string> | undefined;
  let required = (tool.inputSchema.required ?? []).filter(key => key !== 'action');
  if (tool.name === 'manage_work_hub_away_responder') {
    const fields = operation === 'configure' ? ['expectedVersion','startsAt','endsAt','replyText','channelIds'] : ['expectedVersion','ruleId'];
    keys = new Set(fields); required = fields;
  }
  if (tool.name === 'confirm_operations_displays_action') {
    const fields = ['displayId','expectedUpdatedAt','reason', ...(operation === 'route' ? ['monitorName','view','siteLocationId'] : operation === 'join_room' ? ['monitorName','meetingOccurrenceId'] : [])];
    keys = new Set([...fields,'operationId','confirmed']); required = fields;
  }
  return { ...tool.inputSchema,
    properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).filter(([key]) => key !== 'action' && (!keys || keys.has(key)))), required,
  };
}

/** Legacy plan records keep canonical names; new plans may select exposed names. */
export function planOperationTools(tools: AskVToolDefinition[]): AskVToolDefinition[] {
  return [...new Map([...tools, ...exposedOperationTools(tools)].map(tool => [tool.name, tool])).values()];
}

/** Publish each operation independently while retaining canonical authorization. */
export function exposedOperationTools(tools: AskVToolDefinition[]): AskVToolDefinition[] {
  return tools.flatMap(tool => {
    if (!families.has(tool.name)) return [tool];
    return operations(tool).map(operation => ({
      ...tool,
      name: `${tool.name}_${operation}`,
      description: operationDescription(tool, operation),
      inputSchema: operationSchema(tool, operation),
    }));
  });
}

export function resolveOperationTool(name: string, input: Record<string, unknown>, permitted: AskVToolDefinition[]) {
  for (const tool of permitted) {
    if (!families.has(tool.name)) continue;
    for (const operation of operations(tool)) {
      if (name !== `${tool.name}_${operation}`) continue;
      if ('action' in input) throw new Error('Operation is fixed by the tool name');
      return { name: tool.name, input: { ...input, action: operation } };
    }
  }
  return { name, input };
}
