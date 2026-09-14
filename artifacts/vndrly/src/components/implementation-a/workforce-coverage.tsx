import { ImplementationSurface } from "./surface";
export function WorkforceCoverage({ gaps = [] }: { gaps?: Array<{ id: string; label: string; startsAt: string; status: string }> }) {
  return <ImplementationSurface module="coverage" title="Workforce Coverage" description="Uncovered shifts, acknowledgements, and escalation status.">{gaps.length ? <ul className="grid gap-3">{gaps.map(gap => <li key={gap.id} className="rounded-lg border p-4"><strong>{gap.label}</strong><p className="text-sm">{new Date(gap.startsAt).toLocaleString()} · {gap.status}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">All required shifts are covered.</p>}</ImplementationSurface>;
}
