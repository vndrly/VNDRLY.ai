export function ensureAskVScopeIndexes(client: {
  query(statement: string): Promise<{ rows: Array<{ indisvalid: boolean }> }>;
}): Promise<{ indexes: number; valid: boolean }>;
