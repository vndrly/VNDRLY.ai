import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  nativeWorkDestination,
  parseNativeWorkAction,
} from "@/lib/native-system-actions";
import { gateLandingRoute } from "@/lib/app-navigation";

/** System shortcuts open existing authenticated screens, never submit mutations. */
export default function NativeWorkEntry() {
  const params = useLocalSearchParams();
  const { user, isLoading, requiresContextChoice } = useAuth();
  useEffect(() => {
    if (isLoading || !user || requiresContextChoice) return;
    const scope = captureAuthScope();
    const systemRequestId = typeof params.systemRequestId === "string" && /^[0-9a-f-]{36}$/i.test(params.systemRequestId) ? params.systemRequestId : null;
    const action = Object.keys(params).every(key => key === "action" || key === "systemRequestId")
      ? parseNativeWorkAction(params.action) : null;
    if (!isAuthScopeCurrent(scope)) return;
    router.replace(
      (action
        ? `${nativeWorkDestination(action)}${systemRequestId && ["start-duty", "end-duty"].includes(action) ? `&systemRequestId=${encodeURIComponent(systemRequestId)}` : ""}`
        : gateLandingRoute(user)) as never,
    );
  }, [params, user, isLoading, requiresContextChoice]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
