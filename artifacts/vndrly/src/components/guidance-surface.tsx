import { useSyncExternalStore } from "react";
import { PngPillButton as TogglePillButton } from "./png-pill-rollover";

type Mode = "steps" | "askv";
let mode: Mode = "steps";
const listeners = new Set<() => void>();
export function selectGuidance(next: Mode) { mode = next; listeners.forEach(listener => listener()); }
export function useGuidanceMode() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => mode, () => "steps" as Mode); }
export function GuidanceTabs() {
  const selected = useGuidanceMode();
  return <div className="flex shrink-0 gap-2 p-2" aria-label="AskV and Next Steps">
    <TogglePillButton color="brand" aria-pressed={selected === "askv"} onClick={() => { selectGuidance("askv"); window.dispatchEvent(new Event("vndrly-guidance-askv")); }}>AskV</TogglePillButton>
    <TogglePillButton color="brand" aria-pressed={selected === "steps"} onClick={() => { selectGuidance("steps"); window.dispatchEvent(new Event("vndrly-guidance-steps")); }}>Next Steps</TogglePillButton>
  </div>;
}
