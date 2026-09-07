import { useEffect, useState } from "react";
import { onboardingApi, type OnboardingProgressRow } from "@/lib/onboarding-api";

/** Refresh local wizard state only for committed onboarding changes. */
export function useOnboardingRefresh() {
  const [change, setChange] = useState({ revision: 0, followSavedStep: false, finalized: false });
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; refresh?: unknown }>).detail;
      if (!Array.isArray(detail?.refresh) || !detail.refresh.includes("onboarding")) return;
      setChange((previous) => ({
        revision: previous.revision + 1,
        followSavedStep: previous.followSavedStep || detail.name === "complete_onboarding_step",
        finalized: detail.name === "finalize_onboarding",
      }));
    };
    window.addEventListener("askv:data-changed", refresh);
    return () => window.removeEventListener("askv:data-changed", refresh);
  }, []);
  return change;
}

export function useOnboardingProgress(): {
  progress: OnboardingProgressRow | null;
  loading: boolean;
  refresh: () => void;
} {
  const [progress, setProgress] = useState<OnboardingProgressRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const { revision } = useOnboardingRefresh();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const me = await onboardingApi.getMine();
        if (!cancelled) setProgress(me.progress);
      } catch {
        if (!cancelled) setProgress(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick, revision]);

  return {
    progress,
    loading,
    refresh: () => setTick((n) => n + 1),
  };
}
