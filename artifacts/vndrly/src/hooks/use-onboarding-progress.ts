import { useEffect, useState } from "react";
import { onboardingApi, type OnboardingProgressRow } from "@/lib/onboarding-api";

export function useOnboardingProgress(): {
  progress: OnboardingProgressRow | null;
  loading: boolean;
  refresh: () => void;
} {
  const [progress, setProgress] = useState<OnboardingProgressRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

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
  }, [tick]);

  return {
    progress,
    loading,
    refresh: () => setTick((n) => n + 1),
  };
}
