import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { createOverlayQueue } from "@/lib/overlay-policy";
import "./overlay-policy.css";

const queue = createOverlayQueue();
queue.subscribe(() => {
  queueMicrotask(() => {
    const channel = new URLSearchParams(window.location.search).get("gateVoiceChannel");
    if (!channel) return;
    const message = {type:"gate-overlay-state", channel, open:queue.current() !== null};
    const native = (window as Window & {ReactNativeWebView?:{postMessage:(value:string)=>void}}).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(message, "http://localhost:8081");
  });
});
type Task = { id: string; requested: boolean; mounted: boolean; active: boolean; canDismiss: () => boolean; guard: React.MutableRefObject<() => boolean> };
export const OverlayTaskContext = React.createContext<Task | null>(null);
export function hasDismissAction(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(child => {
    if (!React.isValidElement<{children?:React.ReactNode; onClick?:unknown}>(child)) return false;
    if (child.props.onClick && /^(cancel|close|cancelar|cerrar)$/i.test(String(child.props.children).trim())) return true;
    return hasDismissAction(child.props.children);
  });
}

export function TaskDialog({ open, defaultOpen = false, onOpenChange, modal = true, children, primitive: Root = Primitive.Root, confirmation = false, ...props }: React.ComponentProps<typeof Primitive.Root> & {primitive?:React.ElementType; confirmation?:boolean}) {
  const parent = React.useContext(OverlayTaskContext);
  const id = React.useId();
  const [local, setLocal] = React.useState(defaultOpen);
  const requested = open ?? local;
  const guard = React.useRef(() => true);
  React.useLayoutEffect(() => requested && modal ? queue.register(id, parent?.id ?? (confirmation ? queue.current() : null)) : undefined, [requested, modal, id, parent?.id, confirmation]);
  const current = React.useSyncExternalStore(queue.subscribe, queue.current, () => null);
  const active = requested && (!modal || current === id);
  const [visited, setVisited] = React.useState(false);
  React.useLayoutEffect(() => { if (active) setVisited(true); else if (!requested) setVisited(false); }, [active, requested]);
  const canDismiss = () => active && guard.current();
  const change = (next: boolean) => { if (!next && !canDismiss()) return; setLocal(next); onOpenChange?.(next); };
  return <OverlayTaskContext.Provider value={{ id, requested, mounted: requested && (active || visited), active, guard, canDismiss }}>
    <Root {...props} modal={modal} open={active} onOpenChange={change}>{children}</Root>
  </OverlayTaskContext.Provider>;
}

/** Native confirmation is deliberately outside the form's React lifetime. No draft is persisted to storage. */
export function useOverlayDraft(disabled = false) {
  const task = React.useContext(OverlayTaskContext);
  const node = React.useRef<HTMLElement | null>(null);
  const baseline = React.useRef<string | null>(null);
  const dirty = React.useRef(false);
  const snapshot = () => JSON.stringify([...node.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=search]),textarea,select,[contenteditable=true]") ?? []].map(input => [input.getAttribute("name"), input instanceof HTMLInputElement && /checkbox|radio/.test(input.type) ? input.checked : input.value ?? input.textContent]));
  const remember = () => { if (baseline.current === null) baseline.current = snapshot(); };
  const allow = () => {
    if (disabled) return false;
    if (!dirty.current || window.confirm(document.documentElement.lang.startsWith("es") ? "¿Descartar los cambios sin guardar?" : "Discard unsaved changes?")) { dirty.current = false; baseline.current = null; return true; }
    return false;
  };
  React.useLayoutEffect(() => { if (task) task.guard.current = allow; });
  React.useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, []);
  return { task, ref: node, remember,
    changed: () => { dirty.current = baseline.current === null || baseline.current !== snapshot(); },
    click: (event: React.MouseEvent<HTMLElement>) => {
      if (task && !task.active) return;
      const button = (event.target as HTMLElement).closest("button,a[href]");
      if (button && (button.matches("a[href]") || /^(cancel|close|cancelar|cerrar)\b/i.test((button.getAttribute("aria-label") || button.textContent || "").trim())) && !allow()) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}

// Menus replace peers; nested submenus stay owned by their menu primitive.
let menu: { id: string; close: () => void } | null = null;
export function useExclusiveMenu(open: boolean | undefined, defaultOpen: boolean | undefined, onOpenChange?: (open: boolean) => void) {
  const id = React.useId(); const [local, setLocal] = React.useState(defaultOpen ?? false);
  const requested = open ?? local; const task = React.useContext(OverlayTaskContext);
  const callback = React.useRef(onOpenChange); callback.current = onOpenChange;
  const change = React.useCallback((value: boolean) => { setLocal(value); callback.current?.(value); }, []);
  React.useEffect(() => {
    if (!requested) return;
    if (menu && menu.id !== id) menu.close();
    menu = { id, close: () => change(false) };
    return () => { if (menu?.id === id) menu = null; };
  }, [requested, id, change]);
  React.useEffect(() => queue.subscribe(() => { if (queue.current() && queue.current() !== task?.id) change(false); }), [change, task?.id]);
  return { open: requested, onOpenChange: change };
}
