type GateLabelSource = {
  id: string;
  siteId: number;
  name: string;
  active?: boolean;
  topology?: { parentGateId?: string | null } | null;
};

/** Warwick labels start with the current post and show its saved series peer. */
export function warwickGateLabel(gate: GateLabelSource, gates: readonly GateLabelSource[]): string | undefined {
  if (!gate.name.startsWith("Warwick ")) return undefined;
  const peer = gates.find(other => other.id !== gate.id && other.siteId === gate.siteId &&
    other.active !== false && other.name.startsWith("Warwick ") &&
    (gate.topology?.parentGateId === other.id || other.topology?.parentGateId === gate.id));
  return peer ? `${gate.name} > ${peer.name}` : gate.name;
}
