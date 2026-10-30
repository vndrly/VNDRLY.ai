import { Children, isValidElement, type ReactNode } from "react";

/** Only labelled pill actions adopt mini-card styling; icon-only controls stay intact. */
export function hasVisiblePillLabel(children: ReactNode): boolean {
  return Children.toArray(children).some(child => {
    if (typeof child === "string") return child.trim().length > 0;
    if (typeof child === "number") return true;
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return false;
    if (child.props.className?.split(/\s+/).includes("sr-only")) return false;
    return hasVisiblePillLabel(child.props.children);
  });
}
