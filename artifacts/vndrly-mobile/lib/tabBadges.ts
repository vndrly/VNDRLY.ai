import { useSyncExternalStore } from "react";

type Counts = { home: number; schedule: number };

let state: Counts = { home: 0, schedule: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): Counts {
  return state;
}

export function setHomeBadge(n: number) {
  const next = Math.max(0, Math.floor(n));
  if (state.home === next) return;
  state = { ...state, home: next };
  emit();
}

export function setScheduleBadge(n: number) {
  const next = Math.max(0, Math.floor(n));
  if (state.schedule === next) return;
  state = { ...state, schedule: next };
  emit();
}

export function useTabBadges(): Counts {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
