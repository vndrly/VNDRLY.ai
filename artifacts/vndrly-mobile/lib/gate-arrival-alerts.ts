/** A location refresh is not a new incoming leg. Retain seen identities per scope. */
export function createGateArrivalTracker(): (ids: readonly string[]) => Set<string> {
  let seen: Set<string> | null = null;
  return ids => {
    const incoming = new Set(seen ? ids.filter(id => !seen!.has(id)) : []);
    if (!seen) seen = new Set();
    for (const id of ids) seen.add(id);
    return incoming;
  };
}
