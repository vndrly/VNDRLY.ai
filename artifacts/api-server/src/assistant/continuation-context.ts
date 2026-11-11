/** Bounded, persisted observations. Never approvals or authority. */
export function continuationContext(rows: Array<{ id: number; createdAt: Date; toolCalls: unknown }>, allowedNames: ReadonlySet<string>, organizationKey: string): string {
  const observations: unknown[] = [];
  for (const row of rows.slice(-24)) {
    if (!Array.isArray(row.toolCalls)) continue;
    for (const call of row.toolCalls) {
      if (!call || call.organizationKey !== organizationKey || !allowedNames.has(call.name) || typeof call.output !== "string") continue;
      try {
        const result = JSON.parse(call.output);
        if (result?.privatePersonalResult) continue;
        const entry = { messageId: row.id, observedAt: row.createdAt, tool: call.name, arguments: call.input, result, clientReceipt: call.clientReceipt };
        // Do not truncate JSON, which could lose cursor/filter relationships.
        if (JSON.stringify(entry).length <= 12_000) observations.push(entry);
      } catch { /* Unreadable receipts are not continuation state. */ }
    }
  }
  let selected = observations.slice(-8);
  while (JSON.stringify(selected).length > 24_000) selected = selected.slice(1);
  return JSON.stringify(selected);
}
