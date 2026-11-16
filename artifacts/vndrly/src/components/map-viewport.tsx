import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Move the existing map above page clipping without remounting its camera or controls. */
export function MapViewport({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.style.display = "contents";
    return element;
  });
  useLayoutEffect(() => {
    const content = anchor.current?.closest("main");
    const measure = () => {
      const rect = content?.getBoundingClientRect();
      const top = Math.max(0, rect?.top ?? 0);
      const left = Math.max(0, rect?.left ?? 0);
      host.style.setProperty("--map-viewport-top", `${top}px`);
      host.style.setProperty("--map-viewport-left", `${left}px`);
      host.style.setProperty("--map-viewport-width", `${Math.min(rect?.width || innerWidth, innerWidth - left)}px`);
      host.style.setProperty("--map-viewport-height", `${Math.max(0, innerHeight - top)}px`);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (content) observer?.observe(content);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    (expanded ? document.body : anchor.current)?.appendChild(host);
    const oldOverflow = document.body.style.overflow;
    const oldContentOverflow = content?.style.overflow;
    if (expanded) document.body.style.overflow = "hidden";
    if (expanded && content) content.style.overflow = "hidden";
    const message = { type: "gate-map-fullscreen", expanded };
    const native = (window as Window & { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(message, "http://localhost:8081");
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.body.style.overflow = oldOverflow;
      if (content) content.style.overflow = oldContentOverflow ?? "";
      host.remove();
      if (expanded) {
        if (native) native.postMessage(JSON.stringify({ ...message, expanded: false }));
        else if (window.parent !== window) window.parent.postMessage({ ...message, expanded: false }, "http://localhost:8081");
      }
    };
  }, [expanded, host]);
  return <><span ref={anchor} style={{ display: "contents" }} />{createPortal(children, host)}</>;
}
