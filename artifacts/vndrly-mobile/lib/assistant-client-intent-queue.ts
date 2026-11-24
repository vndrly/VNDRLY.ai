/** Run device actions in model order, so navigation finishes before a form action. */
export function createAssistantClientIntentQueue<T>() {
  const pending: Promise<T>[] = [];
  let prior: Promise<unknown> = Promise.resolve();
  return {
    enqueue(run: () => Promise<T>): void {
      const next = prior.then(run);
      void next.catch(() => undefined);
      pending.push(next);
      prior = next;
    },
    results(): Promise<T[]> {
      return Promise.all(pending);
    },
  };
}
