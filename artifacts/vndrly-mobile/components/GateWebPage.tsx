import React from "react";
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";

export default function GateWebPage({ path, control }: { control?: "next-steps"; path: "/gate" | "/gate/change-over" | "/gate/map" | "/gate/history" | "/gate/shift-notes" | "/gate/header" | "/personal-agreements" }) {
  const params = useLocalSearchParams<{ section?: string; siteId?: string; stationId?: string; range?: string; recordType?: string }>();
  const { user, activeMembershipId } = useAuth();
  const [session, setSession] = useState<{ scope: string; token: string }>();
  const scope = user ? JSON.stringify([user.id, activeMembershipId]) : "";
  useEffect(() => {
    let active = true;
    if (scope) void getToken().then(token => {
      if (active) setSession(token ? { scope, token } : undefined);
    });
    return () => { active = false; };
  }, [scope]);

  if (!scope || session?.scope !== scope) return null;
  const url = new URL(path, getApiBase());
  url.searchParams.set("gateDashboardEmbed", "1");
  if (path === "/personal-agreements" && params.section === "eula") url.searchParams.set("section", "eula");
  if (control) url.searchParams.set("control", control);
  if (params.siteId) url.searchParams.set("siteId", params.siteId);
  if (params.stationId) url.searchParams.set("stationId", params.stationId);
  if (path === "/gate/history") {
    if (params.range) url.searchParams.set("range", params.range);
    if (params.recordType) url.searchParams.set("recordType", params.recordType);
  }
  const bootstrap = `if (location.origin === ${JSON.stringify(url.origin)} && location.pathname === ${JSON.stringify(path)}) { window.__gateDashboardSession = ${JSON.stringify(session.token)}; } true;`;
  return <WebView key={scope} source={{ uri: url.href }} originWhitelist={[url.origin]}
    onShouldStartLoadWithRequest={request => new URL(request.url).origin === url.origin}
    injectedJavaScriptBeforeContentLoaded={bootstrap} />;
}
