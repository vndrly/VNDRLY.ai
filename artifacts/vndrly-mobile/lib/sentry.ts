import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { isExpoGo } from "./runtime";

let initialized = false;

function getDsn(): string | null {
  const dsn =
    process.env.EXPO_PUBLIC_SENTRY_DSN ??
    (Constants.expoConfig?.extra?.sentryDsn as string | undefined) ??
    null;
  if (!dsn || dsn.trim() === "") return null;
  return dsn.trim();
}

function getEnvironment(): string {
  if (__DEV__) return "development";
  const channel = (Constants.expoConfig as any)?.updates?.channel as
    | string
    | undefined;
  if (channel) return channel;
  return "production";
}

export function initSentry(): void {
  if (initialized) return;
  if (Platform.OS === "web") return;
  const dsn = getDsn();
  if (!dsn) {
    if (__DEV__) {
      console.log("[sentry] no DSN configured — crash reporting disabled");
    }
    return;
  }
  try {
    Sentry.init({
      dsn,
      environment: getEnvironment(),
      // Intentionally NOT setting `release` — let the @sentry/react-native
      // Expo plugin auto-derive the release identifier so it matches the
      // value used during source-map upload at EAS build time. Setting a
      // mismatched release here would leave production stack traces
      // unsymbolicated.
      // Native crash capture is unavailable in Expo Go (no native module).
      // Enable it in dev/prod builds only.
      enableNative: !isExpoGo,
      enableNativeCrashHandling: !isExpoGo,
      // Send unhandled JS promise rejections.
      enableAutoSessionTracking: true,
      // No performance traces by default — can be enabled later.
      tracesSampleRate: 0,
      // Strip request bodies/headers from breadcrumbs for privacy.
      sendDefaultPii: false,
      beforeSend(event) {
        // Drop noisy network breadcrumbs in dev so the console isn't spammed.
        if (__DEV__ && event.level === "info") return null;
        return event;
      },
    });
    initialized = true;
    if (__DEV__) {
      console.log("[sentry] initialized", {
        environment: getEnvironment(),
        native: !isExpoGo,
      });
    }
  } catch (err) {
    // Never let Sentry init crash the app.
    console.warn("[sentry] init failed", err);
  }
}

/**
 * Attach an authenticated user to subsequent error reports. Call after login,
 * and pass `null` on logout to clear.
 */
export function setSentryUser(
  user: { id?: number | string; email?: string | null; username?: string | null } | null,
): void {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id != null ? String(user.id) : undefined,
    email: user.email ?? undefined,
    username: user.username ?? undefined,
  });
}

/**
 * Report a caught error (from try/catch or ErrorBoundary) to Sentry.
 * Safe to call even if Sentry isn't initialized.
 */
export function reportError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  try {
    if (context) {
      Sentry.withScope((scope) => {
        scope.setExtras(context);
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  } catch {
    // never let the reporter itself crash anything
  }
}

/**
 * Wrap the root component so Sentry can hook into its lifecycle and capture
 * native crashes during render. No-op when Sentry isn't initialized.
 */
export function wrapRoot<C>(Component: C): C {
  if (!initialized) return Component;
  try {
    return Sentry.wrap(Component as any) as C;
  } catch {
    return Component;
  }
}
