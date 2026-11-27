import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { iosPreviewParentOrigin } from "@/lib/gate-dashboard-session";

/**
 * Gives an expanded view the whole screen: the iPhone app hides its top bar and bottom tabs,
 * and a desktop browser goes full screen. Leaving browser full screen calls `onExit`.
 */
export function useHostFullscreen(expanded: boolean, onExit?: () => void) {
  const exit = useRef(onExit);
  exit.current = onExit;
  useLayoutEffect(() => {
    const message = { type: "gate-map-fullscreen", expanded };
    const native = (window as Window & { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(message, iosPreviewParentOrigin());

    // Fullscreen the whole document so its portaled menus and dialogs still work.
    const root = document.documentElement;
    const requestFullscreen = expanded && !native && window.parent === window &&
      document.fullscreenEnabled && !document.fullscreenElement;
    let enteredFullscreen = document.fullscreenElement === root;
    let closed = false;
    const fullscreenChanged = () => {
      if (document.fullscreenElement === root) enteredFullscreen = true;
      else if (enteredFullscreen) exit.current?.();
    };
    const leaveFullscreen = () => {
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    };
    if (expanded) document.addEventListener("fullscreenchange", fullscreenChanged);
    if (requestFullscreen) {
      void root.requestFullscreen().then(() => {
        if (closed) leaveFullscreen();
      }).catch(() => {}); // The fixed viewport also works when permission is unavailable.
    }
    return () => {
      closed = true;
      if (!expanded) return;
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      leaveFullscreen();
      if (native) native.postMessage(JSON.stringify({ ...message, expanded: false }));
      else if (window.parent !== window) window.parent.postMessage({ ...message, expanded: false }, iosPreviewParentOrigin());
    };
  }, [expanded]);
}

/** Move the existing map above page clipping without remounting its camera or controls. */
export function MapViewport({ expanded, onExitFullscreen, children }: { expanded: boolean; onExitFullscreen?: () => void; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.style.display = "contents";
    return element;
  });
  useLayoutEffect(() => {
    const content = anchor.current?.closest("main");
    (expanded ? document.body : anchor.current)?.appendChild(host);
    const oldOverflow = document.body.style.overflow;
    const oldContentOverflow = content?.style.overflow;
    const app = anchor.current?.closest<HTMLElement>("#root");
    const wasInert = app?.inert ?? false;
    const oldVisibility = app?.style.visibility ?? "";
    if (expanded) document.body.style.overflow = "hidden";
    if (expanded && content) content.style.overflow = "hidden";
    if (expanded && app) { app.inert = true; app.style.visibility = "hidden"; }
    return () => {
      document.body.style.overflow = oldOverflow;
      if (content) content.style.overflow = oldContentOverflow ?? "";
      if (expanded && app) { app.inert = wasInert; app.style.visibility = oldVisibility; }
      host.remove();
    };
  }, [expanded, host]);
  useHostFullscreen(expanded, onExitFullscreen);
  return <><span ref={anchor} style={{ display: "contents" }} />{createPortal(children, host)}</>;
}
