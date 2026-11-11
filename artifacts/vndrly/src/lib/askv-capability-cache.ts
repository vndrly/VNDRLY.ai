/** Coalesce simultaneous checks, cache successes briefly, never retain an outage. */
export function createAskVCapabilityCache<T>(load: () => Promise<T>, usable: (value: T) => boolean, now = Date.now, ttlMs = 30_000) {
  let pending: Promise<T> | undefined;
  let expiresAt = 0;
  return () => {
    if (pending && now() < expiresAt) return pending;
    expiresAt = Infinity;
    pending = load().then(value => {
      expiresAt = usable(value) ? now() + ttlMs : 0;
      return value;
    }, error => { expiresAt = 0; throw error; });
    return pending;
  };
}
