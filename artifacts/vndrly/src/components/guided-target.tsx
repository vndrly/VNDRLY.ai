import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown } from "lucide-react";
import "./guided-target.css";

export type GuidanceTarget = { scopeId: string; targetId: string; prompt: string };
type Registration = GuidanceTarget & { owner: string; priority: number; used: boolean };
type Registry = { target: Registration | null; register: (owner: string, target: GuidanceTarget | null, priority: number) => void; show: () => void };
const Context = createContext<Registry | null>(null);

function visible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return element.isConnected && element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden" && !element.hidden && !element.closest("[inert],[aria-hidden=true]");
}

/** Require an exact registered scope and exactly one usable control, including inside portals. */
export function findGuidanceTarget(target: GuidanceTarget | null): HTMLElement | null {
  if (!target) return null;
  const candidates = [...document.querySelectorAll<HTMLElement>("[data-guidance-scope]")]
    .filter(scope => scope.dataset.guidanceScope === target.scopeId && visible(scope))
    .flatMap(scope => [...scope.querySelectorAll<HTMLElement>(target.targetId.startsWith("testid:") ? "[data-testid]" : "[data-guidance-id]")].filter(element =>
      (target.targetId.startsWith("testid:") ? element.dataset.testid === target.targetId.slice(7) : element.dataset.guidanceId === target.targetId) && visible(element) && !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true"));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

export function GuidedTargetProvider({ scope, active, children }: { scope: string; active: boolean; children: ReactNode }) {
  const entries = useRef(new Map<string, Registration>());
  const consumed = useRef(new Set<string>());
  const epoch = useRef({ scope, active, value: 0 });
  if (epoch.current.scope !== scope || epoch.current.active !== active) {
    entries.current.clear(); consumed.current.clear(); epoch.current = { scope, active, value: epoch.current.value + 1 };
  }
  const [registered, setRegistered] = useState<{ epoch: number; target: Registration | null }>({ epoch: epoch.current.value, target: null });
  const update = useCallback(() => {
    const target = [...entries.current.values()].sort((a, b) => b.priority - a.priority || a.owner.localeCompare(b.owner))[0] ?? null;
    setRegistered({ epoch: epoch.current.value, target });
  }, []);
  const register = useCallback((owner: string, target: GuidanceTarget | null, priority: number) => {
    if (!target || !epoch.current.active) entries.current.delete(owner);
    else {
      const previous = entries.current.get(owner);
      entries.current.set(owner, { ...target, owner, priority, used: previous?.scopeId === target.scopeId && previous.targetId === target.targetId ? previous.used : consumed.current.has(`${target.scopeId}:${target.targetId}`) });
    }
    update();
  }, [update, scope, active]);
  const target = active && registered.epoch === epoch.current.value ? registered.target : null;
  const show = useCallback(() => {
    const element = findGuidanceTarget(target);
    if (!element) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center", inline: "nearest" });
  }, [target]);
  useEffect(() => {
    if (!target || target.used) return;
    const used = (event: Event) => {
      const element = findGuidanceTarget(target);
      if (!element || !element.contains(event.target as Node)) return;
      const record = entries.current.get(target.owner);
      if (record) { record.used = true; consumed.current.add(`${record.scopeId}:${record.targetId}`); update(); }
    };
    document.addEventListener("pointerdown", used, true);
    document.addEventListener("input", used, true);
    document.addEventListener("change", used, true);
    document.addEventListener("keydown", used, true);
    return () => {
      document.removeEventListener("pointerdown", used, true); document.removeEventListener("input", used, true);
      document.removeEventListener("change", used, true); document.removeEventListener("keydown", used, true);
    };
  }, [target, update]);
  return <Context.Provider value={{ target, register, show }}>{children}{target && !target.used && <GuidedTargetRing target={target} />}</Context.Provider>;
}

/** Only active workflow controls publish targets. Registration never clicks or saves. */
export function useGuidedTarget(target: GuidanceTarget | null, active = true, priority = 0) {
  const registry = useContext(Context);
  const owner = useId();
  const register = registry?.register;
  useEffect(() => {
    if (!register) return;
    register(owner, active ? target : null, priority);
    return () => register(owner, null, priority);
  }, [register, owner, active, target?.scopeId, target?.targetId, target?.prompt, priority]);
}

/** askV reads the same registered next control that Next Steps highlights. */
export function useCurrentGuidanceTarget(): GuidanceTarget | null {
  return useContext(Context)?.target ?? null;
}

export function GuidanceTargetStatus() {
  const registry = useContext(Context);
  if (!registry?.target) return null;
  return <div className="next-steps-target-prompt"><p role="status">{registry.target.prompt}</p><button type="button" className="underline" onClick={registry.show}>Show me</button></div>;
}

function GuidedTargetRing({ target }: { target: GuidanceTarget }) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    let observed: HTMLElement | null = null;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    const measure = () => {
      const element = findGuidanceTarget(target);
      if (observed !== element) { if (observed) resizeObserver?.unobserve(observed); observed = element; if (element) resizeObserver?.observe(element); }
      const bounds = element?.getBoundingClientRect();
      const clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      for (let ancestor = element?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor), area = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { clip.top = Math.max(clip.top, area.top); clip.bottom = Math.min(clip.bottom, area.bottom); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clip.left = Math.max(clip.left, area.left); clip.right = Math.min(clip.right, area.right); }
      }
      const next = bounds && bounds.width > 0 && bounds.height > 0 && bounds.top >= clip.top && bounds.bottom <= clip.bottom && bounds.left >= clip.left && bounds.right <= clip.right
        ? { left: bounds.left - 4, top: bounds.top - 4, width: bounds.width + 8, height: bounds.height + 8 } : null;
      setRect(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "disabled", "style", "class", "data-guidance-id", "data-guidance-scope"] });
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true); measure();
    return () => { cancelAnimationFrame(frame); mutation.disconnect(); resizeObserver?.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [target.scopeId, target.targetId]);
  return rect ? <div className="guidance-target-ring" style={rect} aria-hidden="true" data-testid="guidance-target-ring"><ArrowDown className="guidance-target-arrow" /></div> : null;
}

/** Keep the helper within the exact guided modal's focus and accessibility boundary. */
export function GuidedHelperPortal({ children }: { children: (inModal: boolean) => ReactNode }) {
  const registry = useContext(Context);
  const target = registry?.target ?? null;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const lastScope = useRef<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const validModal = (element: HTMLElement | null) => Boolean(element?.isConnected && element.getAttribute("role") === "dialog" && element.dataset.state !== "closed" && visible(element));
    const locate = () => {
      const control = findGuidanceTarget(target);
      // A helper control must never select its own portal host.
      const exact = control && !control.closest('[data-testid="next-steps-active-helper"]') ? control.closest<HTMLElement>('[role="dialog"]') : null;
      if (validModal(exact)) lastScope.current = target!.scopeId;
      setHost(previous => {
        if (validModal(exact)) return exact;
        // Busy/used controls may briefly unregister; retain only the same real guided form.
        if (validModal(previous) && lastScope.current && [...previous!.querySelectorAll<HTMLElement>("[data-guidance-scope]")].some(scope => scope.dataset.guidanceScope === lastScope.current && !scope.closest('[data-testid="next-steps-active-helper"]'))) return previous;
        return null;
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(locate); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden", "inert", "hidden", "data-state", "data-guidance-scope"] });
    locate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [target?.scopeId, target?.targetId]);
  const content = children(Boolean(host));
  return host ? createPortal(content, host, "scoped-gate-helper") : content;
}
