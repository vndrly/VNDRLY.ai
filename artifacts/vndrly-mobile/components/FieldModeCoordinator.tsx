import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import FieldModeStatus from "@/components/FieldModeStatus";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { useFieldMode, type FieldModeActions } from "@/hooks/use-field-mode";
import { apiFetch } from "@/lib/api";
import { completeActiveFieldTrip } from "@/lib/field-mode-api";
import { createReporterFieldModeEventSource } from "@/lib/field-mode-event-source";
import type { FieldModeSnapshot } from "@/lib/field-mode-policy";
import { hasActiveConsentForThisDevice } from "@/lib/locationConsent";
import { speakAskV } from "@/lib/askv-speech";
import { startLiveLocationReporter, stopLiveLocationReporter } from "@/lib/liveLocationReporter";

const initialSnapshot: FieldModeSnapshot = {
  mode: "off",
  presence: "off_site",
  consented: true,
  scheduled: true,
  expectsMoreWork: true,
  shiftEndsAtMs: null,
  stoppedOffsiteAtMs: null,
  promptStartedAtMs: null,
  lastEventId: null,
};

function ActiveFieldModeCoordinator() {
  const { t, i18n } = useTranslation();
  const voice = useAskVVoiceSession();
  const source = useMemo(() => createReporterFieldModeEventSource(), []);
  const actions = useMemo<FieldModeActions>(() => ({
    startTracking: startLiveLocationReporter,
    stopTracking: async (input) => {
      try {
        await completeActiveFieldTrip({ operationId: crypto.randomUUID(), ...input, completedAt: new Date() });
      } finally {
        await stopLiveLocationReporter();
      }
    },
    announceReady: async () => { if (!voice.muted) speakAskV(t("fieldMode.active"), i18n.language.startsWith("es") ? "es-US" : "en-US"); },
    recordArrival: async () => undefined,
    recordDeparture: async () => undefined,
    promptEndWork: async () => { if (!voice.muted) speakAskV(t("fieldMode.endPrompt"), i18n.language.startsWith("es") ? "es-US" : "en-US"); },
    promptExtendedStop: async () => { if (!voice.muted) speakAskV(t("fieldMode.extendedStopPrompt"), i18n.language.startsWith("es") ? "es-US" : "en-US"); },
    createSupervisorException: async (reason) => {
      await apiFetch("/api/implementation-a/operations-health/events", { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), kind: "field_mode_exception", reason }) });
    },
  }), [i18n.language, t, voice.muted]);
  const { snapshot, dispatch } = useFieldMode({ initialSnapshot, source, actions });
  return <FieldModeStatus snapshot={snapshot} onEndWork={() => dispatch({ id: `manual-end:${Date.now()}`, type: "end_work_confirmed", atMs: Date.now() })} />;
}

export default function FieldModeCoordinator({ enabled }: { enabled: boolean }) {
  const [consented, setConsented] = useState(false);
  useEffect(() => {
    let active = true;
    if (!enabled) { setConsented(false); return () => { active = false; }; }
    void hasActiveConsentForThisDevice().then((value) => { if (active) setConsented(value); });
    return () => { active = false; };
  }, [enabled]);
  return enabled && consented ? <ActiveFieldModeCoordinator /> : null;
}
