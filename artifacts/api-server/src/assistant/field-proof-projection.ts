import {fieldProofPacket, type ProofPacketSummary} from "../lib/ticket-proof-packet";
/** Preserve field evidence readiness without returning office approval or amounts. */
export function fieldAssistantProofPacket(packet: ProofPacketSummary, status?: string | null) {
  const {lineItemTotal:_total,...field}=fieldProofPacket(packet,status);
  return {...field,sections:field.sections.map(section=>section.id === "cost"?{...section,detail:section.complete?"Billable line items recorded":"Needs billable line items"}:section)};
}
