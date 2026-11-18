/** One visible task; related steps suspend their parent without destroying its draft. */
export function createOverlayQueue() {
  const tasks = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const current = (): string | null => {
    let id = [...tasks].find(([, parent]) => !parent || !tasks.has(parent))?.[0];
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const child = [...tasks].find(([, parent]) => parent === id)?.[0];
      if (!child) return id;
      id = child;
    }
    return null;
  };
  return {
    current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    register(id: string, parent: string | null) { tasks.set(id, parent); notify(); return () => { tasks.delete(id); notify(); }; },
  };
}
