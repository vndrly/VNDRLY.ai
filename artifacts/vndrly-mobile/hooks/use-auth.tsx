import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getUser,
  isTokenCacheReady,
  subscribeToken,
  subscribeUser,
  type MembershipSummary,
  type StoredUser,
} from "@/lib/auth";
import { refreshAuthMe, switchContext as apiSwitchContext } from "@/lib/api";

// We hydrate the auth context from local storage immediately so the UI
// is reactive on app launch, then kick off a background `/api/auth/me`
// refresh so newly-added memberships (e.g. an admin granted the user a
// second org since their last login) become visible without requiring
// a sign-out and re-login.

interface AuthContextValue {
  user: StoredUser | null;
  isLoading: boolean;
  availableMemberships: MembershipSummary[];
  activeMembershipId: number | null;
  activeMembership: MembershipSummary | null;
  switchContext: (membershipId: number) => Promise<StoredUser>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [isLoading, setIsLoading] = useState(!isTokenCacheReady());
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u = await getUser().catch(() => null);
      if (!mounted) return;
      setUser(u);
      setIsLoading(false);
      // Background refresh after hydration — only if there's an active
      // session. refreshAuthMe() will update local storage which fires
      // subscribeUser() below and re-renders this provider with the
      // latest memberships.
      if (u) void refreshAuthMe();
    })();

    const unsubUser = subscribeUser((next) => {
      setUser(next);
    });

    // When the token changes (login, logout, switch), reload the stored
    // user so the context state mirrors what's persisted.
    const unsubToken = subscribeToken(async (t) => {
      if (!t) {
        setUser(null);
        return;
      }
      const u = await getUser().catch(() => null);
      setUser(u);
    });

    return () => {
      mounted = false;
      unsubUser();
      unsubToken();
    };
  }, []);

  const switchContext = useCallback(
    async (membershipId: number) => {
      const next = await apiSwitchContext(membershipId);
      // The bearer token now embeds a different active membership, so any
      // cached React Query data (tickets, jobs, hotlist, dashboard summary,
      // etc.) belongs to the previous org. Drop it entirely so visible
      // screens don't flash the previous org's data under the new org's
      // header before their next scheduled refetch — mounted observers will
      // immediately refetch with the rotated token.
      await queryClient.cancelQueries();
      queryClient.clear();
      setUser(next);
      return next;
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await refreshAuthMe();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const memberships = user?.availableMemberships ?? [];
    const activeMembershipId = user?.activeMembershipId ?? null;
    const activeMembership =
      memberships.find((m) => m.id === activeMembershipId) ??
      memberships[0] ??
      null;
    return {
      user,
      isLoading,
      availableMemberships: memberships,
      activeMembershipId,
      activeMembership,
      switchContext,
      refresh,
    };
  }, [user, isLoading, switchContext, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
