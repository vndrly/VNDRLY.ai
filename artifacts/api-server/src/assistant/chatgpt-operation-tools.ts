import type { AskVToolDefinition } from './tool-registry';

const families = new Set(['manage_gate_shift', 'manage_ticket_record']);

/** Publish each operation independently while retaining canonical authorization. */
export function exposedOperationTools(tools: AskVToolDefinition[]): AskVToolDefinition[] {
  return tools.flatMap(tool => {
    if (!families.has(tool.name)) return [tool];
    const action = (tool.inputSchema.properties as Record<string, unknown> | undefined)?.action as { enum?: string[] } | undefined;
    return (action?.enum ?? []).map(operation => ({
      ...tool,
      name: `${tool.name}_${operation}`,
      description: `Prepare only the ${operation.replace(/_/g, ' ')} operation. ${tool.description}`,
      inputSchema: {
        ...tool.inputSchema,
        properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).filter(([key]) => key !== 'action')),
        required: (tool.inputSchema.required ?? []).filter(key => key !== 'action'),
      },
    }));
  });
}

export function resolveOperationTool(name: string, input: Record<string, unknown>, permitted: AskVToolDefinition[]) {
  for (const tool of permitted) {
    if (!families.has(tool.name)) continue;
    const action = (tool.inputSchema.properties as Record<string, unknown> | undefined)?.action as { enum?: string[] } | undefined;
    for (const operation of action?.enum ?? []) {
      if (name !== `${tool.name}_${operation}`) continue;
      if ('action' in input) throw new Error('Operation is fixed by the tool name');
      return { name: tool.name, input: { ...input, action: operation } };
    }
  }
  return { name, input };
}
