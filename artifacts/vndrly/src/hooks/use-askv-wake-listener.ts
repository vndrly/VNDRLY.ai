import { useEffect, useRef, useState } from 'react';
import type { WakeAudioSource } from '@workspace/askv-wake';
import { localWakeSupported, startLocalWake } from '@/lib/askv-local-wake';

export function useAskVWakeListener(args: { enabled: boolean; onWake: (source: WakeAudioSource) => void }) {
  const latest = useRef(args); latest.current = args;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReady(false); setError(null);
    if (!args.enabled || !localWakeSupported()) return;
    const controller = new AbortController();
    let listener: Awaited<ReturnType<typeof startLocalWake>> | undefined;
    void startLocalWake({ signal: controller.signal,
      onWake: source => { setReady(false); latest.current.onWake(source); },
      onError: message => { setReady(false); setError(message); },
    }).then(value => {
      listener = value;
      if (controller.signal.aborted && !value.transferred) void value.stop();
      else if (!value.transferred) setReady(true);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Local wake detection is unavailable.'); });
    return () => { controller.abort(); if (listener && !listener.transferred) void listener.stop(); };
  }, [args.enabled]);
  return { ready, error, supported: localWakeSupported() };
}
