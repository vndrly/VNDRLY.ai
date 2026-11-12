import { useEffect, useId, useRef, useState } from "react";
import { useNextSteps } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
import type { NextStepWorkflow } from "@/lib/next-steps-model";

export function cardPromptKey(scope: string, card: string, task: string) {
  return `vndrly:card-next-steps:v1:${JSON.stringify([scope, card, task])}`;
}
export function cardPromptCount(key: string): number {
  try { const n = Number(localStorage.getItem(key) ?? 0); return Number.isInteger(n) && n >= 0 ? n : 3; }
  catch { return 3; } // Storage unavailable: manual guidance remains available without repeat popups.
}

/** A card owns its current step. Help never executes business actions or claims completion. */
export function useCardNextSteps({ card, task, enabled, title, steps, target, prompt, scope, choices }: {
  card: string; task: string; enabled: boolean; title: string; steps: readonly string[];
  target: string | null; prompt: string; scope?: string;
  choices?: { id: string; title: string; prepare: () => void }[];
}) {
  const helper = useNextSteps(), owner = useId(), ownerScope = `card-guide:${owner}`, scopeId = scope ?? ownerScope;
  const id = `${ownerScope}:${task}`;
  const choiceRef = useRef(choices); choiceRef.current = choices;
  const [manualRequest, requestManual] = useState(0);
  const choicesKey = JSON.stringify(choices?.map(({ id, title }) => ({ id, title })));
  useEffect(() => {
    if (!enabled || !helper?.registerPageHelp || !choices?.length) return;
    return helper.registerPageHelp(ownerScope, choices.map(choice => ({ id: `${ownerScope}:${choice.id}`, title: choice.title, start: () => {
      choiceRef.current?.find(item => item.id === choice.id)?.prepare(); requestManual(n => n + 1);
    } })));
  }, [enabled, helper?.registerPageHelp, choicesKey, ownerScope]);
  const [engaged, setEngaged] = useState(false);
  const attempted = useRef(new Set<string>());
  const latest = useRef(helper); latest.current = helper;
  const workflow: NextStepWorkflow = { id, kind: "card-guide", title, steps, message: prompt, priority: 30, action: null };
  const serialized = JSON.stringify(workflow);
  const active = enabled && helper?.selected?.id === id;
  function begin(manual = false) {
    if (!enabled || !helper?.showCardGuide) return;
    setEngaged(true);
    const key = cardPromptKey(helper.scope, card, task);
    if (!manual && (attempted.current.has(key) || cardPromptCount(key) >= 3)) return;
    if (helper.selected?.id === id) return;
    if (!helper.showCardGuide(workflow)) return;
    attempted.current.add(key);
    if (!manual) try { localStorage.setItem(key, String(Math.min(3, cardPromptCount(key) + 1))); } catch { /* no credentials or business data stored */ }
  }
  useEffect(() => {
    if (!manualRequest) return;
    begin(true);
    document.querySelector(`[data-guidance-scope="${scopeId}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [manualRequest]);
  useEffect(() => {
    // A guide for a closed menu or previous form mode must not remain on screen.
    if (helper?.selected?.id.startsWith(`${ownerScope}:`) && helper.selected.id !== id) helper.stopHelper();
    if (engaged) begin();
  }, [task, helper?.scope, enabled]);
  useEffect(() => {
    if (active && JSON.stringify(helper?.selected) !== serialized) helper?.showCardGuide(workflow);
    if (!enabled && helper?.selected?.id.startsWith(`${ownerScope}:`)) helper.stopHelper();
  }, [serialized, active, enabled]);
  useEffect(() => () => {
    if (latest.current?.selected?.id.startsWith(`${ownerScope}:`)) latest.current.stopHelper();
  }, [ownerScope]);
  useGuidedTarget(target ? { scopeId, targetId: target, prompt } : null, Boolean(active), 50);
  return { scopeId, begin, active };
}
