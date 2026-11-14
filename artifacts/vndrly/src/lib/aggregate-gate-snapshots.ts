import type { ChangeOverSnapshot, ChangeOverState } from "@workspace/gate-booth";

export function aggregateGateSnapshots(states: ChangeOverState[]): ChangeOverSnapshot | null {
  if (!states.length || states.some(state => !state.snapshot)) return null;
  if (states.length === 1) return states[0].snapshot;
  const groups = new Map<string, ChangeOverSnapshot>();
  for (const state of states) {
    const snapshot = state.snapshot!;
    const key = snapshot.linkedScope?.groupId ?? `site:${state.site.id}`;
    if (!groups.has(key) || snapshot.generatedAt > groups.get(key)!.generatedAt) groups.set(key, snapshot);
  }
  const snapshots = [...groups.values()], first = snapshots[0];
  const keys = Object.keys(first.metrics) as (keyof ChangeOverSnapshot["metrics"])[];
  const ids = Object.fromEntries(keys.map(key => [key, [...new Set(snapshots.flatMap(s => s.metricRecordIds?.[key] ?? []))]]));
  return { ...first, linkedScope: undefined,
    generatedAt: snapshots.map(s => s.generatedAt).sort()[0],
    metrics: Object.fromEntries(keys.map(key => [key, snapshots.every(s => s.metricRecordIds?.[key] !== undefined)
      ? ids[key].length : snapshots.reduce((n,s) => n+s.metrics[key],0)])) as ChangeOverSnapshot["metrics"],
    metricRecordIds: Object.fromEntries(keys.filter(key => snapshots.every(s => s.metricRecordIds?.[key] !== undefined)).map(key => [key, ids[key]])),
    records: [...new Map(snapshots.flatMap(s => s.records ?? []).map(r => [r.id,r])).values()],
    outstanding: [...new Map(snapshots.flatMap(s => s.outstanding).map(r => [r.id,r])).values()],
    exceptions: [...new Map(snapshots.flatMap(s => s.exceptions).map(r => [`${r.sourceId}:${r.code}`,r])).values()],
  };
}
