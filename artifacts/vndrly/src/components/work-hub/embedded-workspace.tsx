import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { GateNativeHeaderBridge } from "@/components/gate-native-header-bridge";
import { brandStyleVars, useBrand } from "@/hooks/use-brand";
import { iosPreviewParentOrigin } from "@/lib/gate-dashboard-session";

/** The app owns navigation and AskV; the companion page owns its original cards. */
export default function EmbeddedWorkspace({ children }: { children: ReactNode }) {
  const brand = useBrand();
  const [location] = useLocation();
  const search = useSearch();
  const initial = useRef({ path: location, search, channel: new URLSearchParams(search).get("gateVoiceChannel") });
  const sendNavigation = (href: string) => {
    const message = { type: "workspace-navigate", href, channel: initial.current.channel };
    const native = (window as Window & { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify(message));
    else if (window.parent !== window && window.location.origin === "http://localhost:5173") window.parent.postMessage(message, iosPreviewParentOrigin());
    else return false;
    return true;
  };
  useEffect(() => {
    // Wouter form submissions and redirects must also update the owning app route.
    if (location !== initial.current.path || search !== initial.current.search) {
      sendNavigation(location + (search ? `?${search}` : "") + window.location.hash);
    }
  }, [location, search]);
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.getAttribute("target") === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.getAttribute("href")!, window.location.href);
      if (url.origin !== window.location.origin || !/^\/(work-hub(?:\/|$)|gate(?:\/|$))/.test(url.pathname) || (url.pathname === location && url.hash)) return;
      if (!sendNavigation(url.pathname + url.search + url.hash)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [location]);
  return <main className="gate-portal-workspace min-h-screen min-w-0 p-4 pt-2" style={brandStyleVars(brand)}>
    <GateNativeHeaderBridge />
    {children}
  </main>;
}
