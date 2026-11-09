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
    other.name.startsWith("Warwick ") &&
    (gate.topology?.parentGateId === other.id || other.topology?.parentGateId === gate.id));
  const sanRoman = /^Warwick San Roman Completions ([12])$/;
  const number = gate.name.match(sanRoman)?.[1];
  const peerNumber = peer?.name.match(sanRoman)?.[1];
  if (number && peerNumber) return `Warwick San Roman Completions ${number}>${peerNumber}`;
  return peer ? `${gate.name} > ${peer.name}` : gate.name;
}

export function partnerSiteLabel(site: { name: string; partnerName?: string | null }): string {
  const partner = site.partnerName?.trim().replace(/\s+Energy(?:\s+Group)?$/i, "");
  if (!partner || site.name.toLowerCase().startsWith(partner.toLowerCase() + " ") ||
      site.name.toLowerCase() === partner.toLowerCase()) return site.name;
  return `${partner} ${site.name}`;
}

export function gateLocationLabel(site: { name: string; partnerName?: string | null }, gate: GateLabelSource, gates: readonly GateLabelSource[]): string {
  const warwick = warwickGateLabel(gate, gates);
  if (warwick) return warwick;
  const siteName = partnerSiteLabel(site);
  const peers = gates.filter(other => other.id !== gate.id && other.siteId === gate.siteId &&
    (other.topology?.parentGateId === gate.id || gate.topology?.parentGateId === other.id));
  if (peers.length) return `${siteName} ${[gate, ...peers].map(row => row.name).join(">")}`;
  return gate.name === site.name || gate.name === siteName ||
    !gates.some(other => other.siteId === gate.siteId && other.id !== gate.id && other.active !== false)
    ? siteName : `${siteName} | ${gate.name}`;
}
