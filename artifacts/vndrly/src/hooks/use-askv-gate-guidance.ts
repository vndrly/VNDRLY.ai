import { useNextSteps } from "@/components/next-steps";
import { useCurrentGuidanceTarget } from "@/components/guided-target";
import type { AskVGateGuidance } from "@workspace/gate-booth";

/** No extra request: conversation and visual guidance share one scoped saved plan. */
export function useAskVGateGuidance(): AskVGateGuidance | undefined {
  const next = useNextSteps();
  const target = useCurrentGuidanceTarget();
  const guidance = next?.enabled ? next.assistantContext : undefined;
  return guidance ? { ...guidance, ...(guidance.active && target ? { control: { prompt: target.prompt, targetId: target.targetId } } : {}) } : undefined;
}
