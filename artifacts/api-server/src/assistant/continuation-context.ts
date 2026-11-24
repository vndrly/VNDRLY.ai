function compactOversizedResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { detailsOmitted: true };
  const source = result as Record<string, unknown>;
  const compact: Record<string, unknown> = { detailsOmitted: true };
  for (const key of ["ok", "status", "nextCursor", "cursor", "hasMore", "total", "count", "page", "error"]) {
    const value = source[key];
    if (typeof value === "boolean" || typeof value === "number" || (typeof value === "string" && value.length <= 512)) compact[key] = value;
  }
  for (const [key, value] of Object.entries(source)) {
    if (!Array.isArray(value)) continue;
    compact[key] = {
      count: value.length,
      references: value.slice(0, 40).flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as Record<string, unknown>;
        const id = row.id ?? row.uuid ?? row.taskId ?? row.stationId;
        return typeof id === "string" || typeof id === "number" ? [id] : [];
      }),
      detailsOmitted: true,
    };
  }
  return compact;
}

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
        let entry = { messageId: row.id, observedAt: row.createdAt, tool: call.name, arguments: call.input, result, clientReceipt: call.clientReceipt };
        // Keep the exact query/cursor and a bounded result summary. Raw string
        // truncation could sever the relationship between list pages.
        if (JSON.stringify(entry).length > 12_000) entry = { ...entry, result: compactOversizedResult(result) };
        if (JSON.stringify(entry).length <= 12_000) observations.push(entry);
      } catch { /* Unreadable receipts are not continuation state. */ }
    }
  }
  let selected = observations.slice(-8);
  while (JSON.stringify(selected).length > 24_000) selected = selected.slice(1);
  return JSON.stringify(selected);
}
