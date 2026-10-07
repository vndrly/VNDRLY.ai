/** Preserve pg's callback acquisition path (including Pool.query) while instrumenting promise transactions. */
export function instrumentPoolConnect(
  connect: (...args: unknown[]) => unknown,
  instrument: (client: unknown) => unknown,
) {
  return (...args: unknown[]) => {
    if (typeof args[0] === "function") return connect(...args);
    return Promise.resolve(connect(...args)).then(instrument);
  };
}
