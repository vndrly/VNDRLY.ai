import "react-native-gesture-handler";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useTranslation } from "react-i18next";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import SafeKeyboardProvider from "@/components/SafeKeyboardProvider";
import SplashLogo from "@/components/SplashLogo";
import { AuthProvider } from "@/hooks/use-auth";
import { BrandProvider } from "@/hooks/use-brand";
import { initApi } from "@/lib/api";
import { getCachedToken, getCachedRole, getToken, isTokenCacheReady, subscribeToken, getUser } from "@/lib/auth";
import { hasActiveConsentForThisDevice, isConsentDeclined } from "@/lib/locationConsent";
import { startLiveLocationReporter, stopLiveLocationReporter } from "@/lib/liveLocationReporter";
import { initSentry, setSentryUser, wrapRoot } from "@/lib/sentry";
import "@/lib/i18n";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
initSentry();
initApi();

/** Never leave the splash spinner up forever if SecureStore/keychain stalls. */
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      if (__DEV__) console.warn("[query]", err instanceof Error ? err.message : err);
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      if (__DEV__) console.warn("[mutation]", err instanceof Error ? err.message : err);
    },
  }),
});

function AuthGate() {
  const { t } = useTranslation();
  const segments = useSegments();
  const [checked, setChecked] = useState(isTokenCacheReady());
  const [hasAuth, setHasAuth] = useState(!!getCachedToken());
  const [role, setRole] = useState<string | null>(getCachedRole());

  useEffect(() => {
    if (checked) return;
    const timeout = setTimeout(() => {
      // Never force-logout on slow SecureStore — only stop blocking the UI.
      setChecked(true);
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [checked]);

  useEffect(() => {
    let cancelled = false;
    // Tag crash reports with the active user. username doubles as email
    // contact in this app.
    const tagUser = (u: Awaited<ReturnType<typeof getUser>>) =>
      setSentryUser(
        u
          ? { id: u.id, username: u.username ?? null, email: u.username ?? null }
          : null,
      );
    if (!isTokenCacheReady()) {
      (async () => {
        const t = await getToken();
        const u = await getUser();
        if (!cancelled) {
          setHasAuth(!!t);
          setRole(u?.role ?? null);
          setChecked(true);
          tagUser(u);
        }
      })();
    } else {
      (async () => {
        const u = await getUser();
        if (!cancelled) {
          setRole(u?.role ?? null);
          tagUser(u);
        }
      })();
    }
    const unsub = subscribeToken(async (t) => {
      const u = t ? await getUser() : null;
      setRole(u?.role ?? null);
      setHasAuth(!!t);
      setChecked(true);
      tagUser(u);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!checked) return;
    const seg0 = segments[0] as string | undefined;
    const inLogin = seg0 === "login";
    const inGuestLogin = seg0 === "guest-login";
    const inGuestStack = seg0 === "visitor-checkin";
    if (!hasAuth) {
      if (!inLogin && !inGuestLogin) router.replace("/login");
      return;
    }
    if (role === "guest") {
      if (!inGuestStack) router.replace("/visitor-checkin");
    } else {
      if (inLogin || inGuestLogin || inGuestStack) router.replace("/(tabs)");
    }
  }, [checked, hasAuth, role, segments]);

  // After the user is authenticated, gate location consent and start the
  // live-location reporter when consent is active.
  useEffect(() => {
    if (!checked || !hasAuth || role === "guest") {
      stopLiveLocationReporter();
      return;
    }
    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (cancelled || !user) return;
      if (user.role !== "field_employee") return;
      const consented = await hasActiveConsentForThisDevice();
      if (cancelled) return;
      if (consented) {
        startLiveLocationReporter();
        return;
      }
      const declined = await isConsentDeclined();
      if (!declined && segments[0] !== "location-consent") {
        router.replace("/location-consent");
      }
    })();
    return () => { cancelled = true; };
  }, [checked, hasAuth, role, segments]);

  // Deep-link from push notifications: route by payload.type.
  useEffect(() => {
    if (!checked || !hasAuth) return;
    // expo-notifications has no web implementation for
    // getLastNotificationResponseAsync / addNotificationResponseReceivedListener
    // and throws "method or property is not available on web". Push deep-links
    // only matter on native, so bail out on web.
    if (Platform.OS === "web") return;
    function routeForData(data: unknown): string | null {
      if (!data || typeof data !== "object") return null;
      const d = data as Record<string, unknown>;
      // Removed-from-crew push deep-links to the tickets list (the removed
      // member no longer has access to the ticket detail).
      if (d.type === "crew_removed") return "/(tabs)";
      const ticketId =
        typeof d.ticketId === "number"
          ? d.ticketId
          : typeof d.ticketId === "string"
            ? Number(d.ticketId)
            : null;
      if (!ticketId || !Number.isFinite(ticketId)) return null;
      return `/ticket/${ticketId}`;
    }
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const path = routeForData(resp.notification.request.content.data);
      if (path) router.push(path as never);
    });
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (!resp) return;
      const path = routeForData(resp.notification.request.content.data);
      if (path) router.push(path as never);
    });
    return () => sub.remove();
  }, [checked, hasAuth]);

  if (!checked) {
    return <SplashLogo />;
  }

  return (
    // Task #186: surface the active-organization indicator on every
    // authenticated stack screen too — Notifications, History, New
    // Ticket, Ticket detail, Edit Profile, etc. The tab navigator
    // sets the same `headerRight` so dual-role users get a consistent
    // reminder no matter where they navigate. The component self-
    // hides for single-membership users and screens that suppress
    // the header (login, guest-login, visitor-checkin, the (tabs)
    // host) so this opt-in is harmless on those routes.
    <Stack
      screenOptions={{
        headerBackTitle: t("stack.back"),
        headerRight: () => <ActiveOrgIndicator />,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="guest-login" options={{ headerShown: false }} />
      <Stack.Screen name="visitor-checkin" options={{ headerShown: false }} />
      <Stack.Screen name="new-ticket" options={{ title: t("stack.newTicket") }} />
      <Stack.Screen name="ticket/[id]" options={{ title: t("stack.tracking") }} />
      <Stack.Screen name="ticket/[id]/crew-tracker" options={{ title: t("stack.crewTracker") }} />
      <Stack.Screen name="invoice/[id]" options={{ title: t("stack.invoice") }} />
      <Stack.Screen name="history" options={{ title: t("stack.history") }} />
      <Stack.Screen name="edit-profile" options={{ title: t("stack.editProfile") }} />
      <Stack.Screen name="crew-changes" options={{ headerShown: false }} />
      <Stack.Screen name="compliance" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="notification-preferences" options={{ headerShown: false }} />
      <Stack.Screen name="location-consent" options={{ headerShown: false }} />
    </Stack>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider>
        <SplashLogo />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrandProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeKeyboardProvider>
                  <AuthGate />
                </SafeKeyboardProvider>
              </GestureHandlerRootView>
            </BrandProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default wrapRoot(RootLayout);
