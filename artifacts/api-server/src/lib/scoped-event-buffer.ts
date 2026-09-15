export function createScopedEventBuffer<T extends { seq?: number }>(capacity: number) {
  const events: Array<T & { seq: number }> = [];
  return {
    push(event: T) {
      if (typeof event.seq !== "number" || !Number.isFinite(event.seq)) return;
      events.push(event as T & { seq: number });
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    poll(after: number, currentSeq: number, visible: (event: T) => boolean) {
      const oldestSeq = events[0]?.seq ?? null;
      const gap = after > 0 && currentSeq > after && (oldestSeq == null || after < oldestSeq - 1);
      const changed = gap || events.some((event) => event.seq > after && visible(event));
      return { currentSeq, changed, gap };
    },
  };
}
