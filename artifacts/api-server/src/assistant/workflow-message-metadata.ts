import { parseGateSetupProgressHint, parseGateWorkflowOffer } from "@workspace/gate-booth";

/** Display hints only. They never certify business completion or authorize a tool. */
export function workflowMessageMetadata(raw: unknown, companyId?: number | null) {
  const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  let progress = stored.gateSetupProgress, offer = stored.gateWorkflowOffer;
  if (Array.isArray(raw)) for (const call of raw.slice(-100)) {
    if (!call || typeof call !== "object" || typeof call.output !== "string") continue;
    try {
      if (call.name === "query_gate_setup_progress") progress = JSON.parse(call.output);
      if (call.name === "offer_gate_workflow") offer = JSON.parse(call.output);
    } catch { /* Ordinary text is not workflow metadata. */ }
  }
  const gateSetupProgress = parseGateSetupProgressHint(progress);
  const gateWorkflowOffer = parseGateWorkflowOffer(offer, companyId);
  return { ...(gateSetupProgress ? { gateSetupProgress } : {}), ...(gateWorkflowOffer ? { gateWorkflowOffer } : {}) };
}
