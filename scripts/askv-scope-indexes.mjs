export async function ensureAskVScopeIndexes(client) {
  const statements = [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS assistant_action_audit_conversation_action_idx ON public.assistant_action_audit (conversation_id, action_type)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS assistant_action_audit_user_action_idx ON public.assistant_action_audit (user_id, action_type)',
  ];
  for (const statement of statements) await client.query(statement);
  const result = await client.query(
    "SELECT indexrelid::regclass::text AS name, indisvalid FROM pg_index WHERE indexrelid IN (to_regclass('public.assistant_action_audit_conversation_action_idx'), to_regclass('public.assistant_action_audit_user_action_idx'))",
  );
  if (result.rows.length !== 2 || result.rows.some(row => !row.indisvalid)) {
    throw new Error("Ask V scope indexes are incomplete. Inspect the index build before retrying.");
  }
  return { indexes: result.rows.length, valid: true };
}
