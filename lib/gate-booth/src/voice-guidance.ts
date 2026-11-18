import type { AskVGateGuidance, GateSetupProgressHint, GateWorkflowOffer } from "./guided-workflows";

export type GateVoiceWorkflowResult = { question: string; gateSetupProgress?: GateSetupProgressHint; gateWorkflowOffer?: GateWorkflowOffer };
const readers = new Map<symbol, () => AskVGateGuidance | undefined>();
const listeners = new Set<() => void>();
const results = new Set<(result: GateVoiceWorkflowResult) => void>();
export function notifyGateVoiceGuidanceChanged() { listeners.forEach(listener => listener()); }
export function registerGateVoiceGuidance(read: () => AskVGateGuidance | undefined) {
  const token = Symbol(); readers.set(token, read); notifyGateVoiceGuidanceChanged();
  return () => { readers.delete(token); notifyGateVoiceGuidanceChanged(); };
}
export function readGateVoiceGuidance(): AskVGateGuidance | undefined {
  for (const read of [...readers.values()].reverse()) { const value = read(); if (value) return value; }
}
export function subscribeGateVoiceGuidance(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function publishGateVoiceWorkflowResult(result: GateVoiceWorkflowResult) { results.forEach(listener => listener(result)); }
export function subscribeGateVoiceWorkflowResult(listener: (result: GateVoiceWorkflowResult) => void) { results.add(listener); return () => { results.delete(listener); }; }
