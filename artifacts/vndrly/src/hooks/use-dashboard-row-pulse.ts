import { useEffect, useRef } from "react";

// Keep the last displayed values across Dashboard navigation in this tab.
const displayed = new Map<string, string>();

export function useDashboardRowPulse<Element extends HTMLElement>(key?: string, value?: string | number) {
  const ref = useRef<Element>(null);
  useEffect(() => {
    if (!key || value === undefined) return;
    const next = String(value);
    const previous = displayed.get(key);
    displayed.delete(key);
    displayed.set(key, next);
    if (displayed.size > 512) displayed.delete(displayed.keys().next().value!);
    if (previous === undefined || previous === next || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const pulse = ref.current?.animate?.(
      [{ backgroundColor: "color-mix(in srgb, var(--brand-primary) 35%, transparent)" }, { backgroundColor: "transparent" }],
      { duration: 550, easing: "ease-out" },
    );
    return () => pulse?.cancel();
  }, [key, value]);
  return ref;
}
