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
    (expanded ? document.body : anchor.current)?.appendChild(host);
    const oldOverflow = document.body.style.overflow;
    if (expanded) document.body.style.overflow = "hidden";
    const message = { type: "gate-map-fullscreen", expanded };
    const native = (window as Window & { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(message, "http://localhost:8081");
    return () => {
      document.body.style.overflow = oldOverflow;
      host.remove();
      if (expanded) {
        if (native) native.postMessage(JSON.stringify({ ...message, expanded: false }));
        else if (window.parent !== window) window.parent.postMessage({ ...message, expanded: false }, "http://localhost:8081");
      }
    };
  }, [expanded, host]);
  return <><span ref={anchor} style={{ display: "contents" }} />{createPortal(children, host)}</>;
}
