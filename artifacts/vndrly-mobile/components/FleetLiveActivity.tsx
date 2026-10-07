import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import NativeSystem from "../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule";
import {
  showFleetWorkActivity,
  stopNativeWorkActivity,
} from "@/lib/native-live-work";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";

export default function FleetLiveActivity({
  runId,
  active,
  disabled,
}: {
  runId: string;
  active: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation(),
    colors = useColors();
  const [supported, setSupported] = useState(false),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void stopNativeWorkActivity(runId).catch(() => undefined);
    };
  }, [runId]);
  useEffect(() => {
    let mounted = true;
    if (Platform.OS === "ios")
      void NativeSystem?.getCapabilities()
        .then((value) => {
          if (mounted) setSupported(value.liveActivities);
        })
        .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const clear = () => {
      setEnabled(false);
      setBusy(false);
      setNotice("");
    };
    const token = subscribeToken(clear),
      user = subscribeUser(clear);
    return () => {
      token();
      user();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      setEnabled(false);
      setNotice("");
      void stopNativeWorkActivity(runId).catch(() => undefined);
    }
  }, [active, runId]);
  useEffect(() => {
    if (!enabled || !active) return;
    let mounted = true;
    const refresh = async () => {
      if (pending.current || AppState.currentState !== "active") return;
      pending.current = true;
      const scope = captureAuthScope();
      try {
        await showFleetWorkActivity(runId);
      } catch {
        if (mounted && isAuthScopeCurrent(scope)) {
          setEnabled(false);
          setNotice(t("nativeLiveWork.unavailable"));
        }
      } finally {
        pending.current = false;
      }
    };
    const timer = setInterval(() => void refresh(), 60_000);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      mounted = false;
      clearInterval(timer);
      app.remove();
    };
  }, [enabled, active, runId, t]);
  if (!supported) return null;
  async function start() {
    if (pending.current || disabled || !active) return;
    pending.current = true;
    setBusy(true);
    const scope = captureAuthScope();
    try {
      await showFleetWorkActivity(runId);
      if (alive.current && isAuthScopeCurrent(scope)) {
        setEnabled(true);
        setNotice(t("nativeLiveWork.shown"));
      }
    } catch {
      if (alive.current && isAuthScopeCurrent(scope))
        setNotice(t("nativeLiveWork.unavailable"));
    } finally {
      pending.current = false;
      if (alive.current && isAuthScopeCurrent(scope)) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>
        {t("nativeLiveWork.description")}
      </Text>
      <TogglePillButton
        color="blue"
        disabled={disabled || busy || !active}
        onPress={() => void start()}
        accessibilityLabel={t("nativeLiveWork.show")}
      >
        {t("nativeLiveWork.show")}
      </TogglePillButton>
      {enabled ? (
        <TogglePillButton
          color="blue"
          disabled={busy}
          onPress={() => {
            setEnabled(false);
            setNotice("");
            void stopNativeWorkActivity(runId).catch(() => {
              if (alive.current) setNotice(t("nativeLiveWork.unavailable"));
            });
          }}
          accessibilityLabel={t("nativeLiveWork.stop")}
        >
          {t("nativeLiveWork.stop")}
        </TogglePillButton>
      ) : null}
      {notice ? <Text style={{ color: colors.text }}>{notice}</Text> : null}
    </View>
  );
}
