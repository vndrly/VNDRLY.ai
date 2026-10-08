import React, { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import {
  scanWorkTextDraft,
  summarizeWorkDraft,
} from "@/lib/native-work-capture";
import NativeDictation from "./NativeDictation";

export default function NativeNoteDraft({
  value,
  disabled,
  onChange,
  onBusy,
  includeDictation = true,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onBusy: (busy: boolean) => void;
  includeDictation?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const [draft, setDraft] = useState<{
    text: string;
    original: string;
    current: () => boolean;
    truncated: boolean;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  const latest = useRef(value);
  const editRevision = useRef(0);
  if (latest.current !== value) {
    latest.current = value;
    editRevision.current += 1;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const clear = () => {
      setDraft(null);
      setError(false);
    };
    const offToken = subscribeToken(clear),
      offUser = subscribeUser(clear);
    return () => {
      offToken();
      offUser();
    };
  }, []);
  useEffect(() => {
    setDraft(null);
  }, [value]);
  if (Platform.OS !== "ios") return null;
  async function prepare(kind: "scan" | "summary") {
    if (pending.current || disabled) return;
    pending.current = true;
    const original = value,
      revision = editRevision.current,
      scope = captureAuthScope();
    setError(false);
    setDraft(null);
    setPreparing(true);
    onBusy(true);
    try {
      const result =
        kind === "scan"
          ? await scanWorkTextDraft()
          : await summarizeWorkDraft(
              original,
              i18n.language.startsWith("es") ? "es" : "en",
            );
      if (
        !mounted.current ||
        !isAuthScopeCurrent(scope) ||
        latest.current !== original ||
        editRevision.current !== revision
      )
        return;
      setDraft({
        text: result.text,
        original,
        current: () => isAuthScopeCurrent(scope),
        truncated: "truncated" in result && result.truncated,
      });
    } catch {
      if (
        mounted.current &&
        isAuthScopeCurrent(scope) &&
        editRevision.current === revision
      )
        setError(true);
    } finally {
      pending.current = false;
      if (mounted.current) {
        setPreparing(false);
        onBusy(false);
      }
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {includeDictation ? <NativeDictation value={value} onChange={onChange} disabled={disabled || preparing} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <TogglePillButton
          color="blue"
          disabled={disabled || preparing}
          onPress={() => void prepare("scan")}
          accessibilityLabel={t("nativeWorkDraft.scan")}
        >
          {t("nativeWorkDraft.scan")}
        </TogglePillButton>
        <TogglePillButton
          color="blue"
          disabled={disabled || preparing || !value.trim()}
          onPress={() => void prepare("summary")}
          accessibilityLabel={t("nativeWorkDraft.summary")}
        >
          {t("nativeWorkDraft.summary")}
        </TogglePillButton>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {t("nativeWorkDraft.unavailable")}
        </Text>
      ) : null}
      {draft ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text }}>
            {t("nativeWorkDraft.reviewOnly")}
          </Text>
          {draft.truncated ? (
            <Text style={{ color: colors.text }}>
              {t("nativeWorkDraft.truncated")}
            </Text>
          ) : null}
          <Text style={{ color: colors.text }}>{draft.text}</Text>
          <TogglePillButton
            color="blue"
            disabled={disabled}
            accessibilityLabel={t("nativeWorkDraft.useDraft")}
            onPress={() => {
              if (draft.current() && latest.current === draft.original)
                onChange(draft.text);
              setDraft(null);
            }}
          >
            {t("nativeWorkDraft.useDraft")}
          </TogglePillButton>
        </View>
      ) : null}
    </View>
  );
}
