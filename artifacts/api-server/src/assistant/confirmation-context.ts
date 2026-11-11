/** Observations are not approval identity. Exact action arguments remain bound separately. */
export function confirmationContext(context: { path?: string | null; entityId?: number | null; gateDraft?: Record<string, unknown> } | null | undefined): string {
  const draft = Object.fromEntries(Object.entries(context?.gateDraft ?? {}).filter(([key]) => !["latitude", "longitude"].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ path: context?.path ?? null, entityId: context?.entityId ?? null, draft });
}
