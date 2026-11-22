import { useEffect, useId, useRef, useState } from "react";
import { useNextSteps } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
import type { NextStepWorkflow } from "@/lib/next-steps-model";

/** A card owns its current step. Help never executes business actions or claims completion. */
export function useCardNextSteps({ card, task, enabled, title, steps, target, prompt, scope, choices }: {
  card: string; task: string; enabled: boolean; title: string; steps: readonly string[];
  target: string | null; prompt: string; scope?: string;
  choices?: { id: string; title: string; prepare?: () => void }[];
}) {
  const helper = useNextSteps(), owner = useId(), ownerScope = `card-guide:${owner}`, scopeId = scope ?? ownerScope;
  const id = `${ownerScope}:${task}`;
  const choiceRef = useRef(choices); choiceRef.current = choices;
  const [manualRequest, requestManual] = useState(0);
  const choicesKey = JSON.stringify(choices?.map(({ id, title }) => ({ id, title })));
  useEffect(() => {
    if (!enabled || !helper?.registerPageHelp || !choices?.length) return;
    return helper.registerPageHelp(ownerScope, choices.map(choice => ({ id: `${card}:${choice.id}`, title: choice.title, start: () => {
      choiceRef.current?.find(item => item.id === choice.id)?.prepare?.(); requestManual(n => n + 1);
    } })));
  }, [enabled, helper?.registerPageHelp, choicesKey, ownerScope, card]);
  const latest = useRef(helper); latest.current = helper;
  const workflow: NextStepWorkflow = { id, kind: "card-guide", title, steps, message: prompt, priority: 30, action: null };
  const serialized = JSON.stringify(workflow);
  const active = enabled && helper?.selected?.id === id;
  useEffect(() => {
    if (!manualRequest || !enabled) return;
    helper?.showCardGuide(workflow);
    document.querySelector(`[data-guidance-scope="${scopeId}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [manualRequest]);
  useEffect(() => {
    // A guide for a closed menu or previous form mode must not remain on screen.
    if (helper?.selected?.id.startsWith(`${ownerScope}:`) && helper.selected.id !== id) helper.stopHelper();
  }, [id, helper?.selected?.id]);
  useEffect(() => {
    if (active && JSON.stringify(helper?.selected) !== serialized) helper?.showCardGuide(workflow);
    if (!enabled && helper?.selected?.id.startsWith(`${ownerScope}:`)) helper.stopHelper();
  }, [serialized, active, enabled]);
  useEffect(() => () => {
    if (latest.current?.selected?.id.startsWith(`${ownerScope}:`)) latest.current.stopHelper();
  }, [ownerScope]);
  useGuidedTarget(target ? { scopeId, targetId: target, prompt } : null, Boolean(active), 50);
  return { scopeId, active };
}
