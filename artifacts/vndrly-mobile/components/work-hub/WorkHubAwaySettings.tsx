import { ModalTextInput as TextInput } from "@/components/ModalDraft";
import { OnboardingInput } from "@/components/OnboardingControls";
import { useBrand } from "@/hooks/use-brand";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  WorkHubAwayChannelsSchema,
  WorkHubAwayReadSchema,
  type WorkHubAwayRead,
} from "@workspace/api-zod";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  getUser,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import { nativeUuid } from "@/lib/native-uuid";
import {
  makeAwayAttempt,
  submitAwayAttempt,
  type AwayAttempt,
} from "@/lib/work-hub-away";
const subscribe = (listener: () => void) => {
  const user = subscribeUser(listener),
    token = subscribeToken(listener);
  return () => {
    user();
    token();
  };
};
const generation = () => captureAuthScope().generation;
export default function WorkHubAwaySettings({ inline = false, showSetup = false }: { inline?: boolean; showSetup?: boolean }) {
  const key = useSyncExternalStore(subscribe, generation);
  return <AwayForm key={key} inline={inline} showSetup={showSetup} />;
}
function AwayForm({ inline, showSetup }: { inline: boolean; showSetup: boolean }) {
  const scope = useRef(captureAuthScope()).current,
    mounted = useRef(true),
    busy = useRef(false);
  const current = () => mounted.current && isAuthScopeCurrent(scope);
  const brand = useBrand();
  const colors = useColors(),
    { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const [setting, setSetting] = useState<WorkHubAwayRead | null>(null),
    [channels, setChannels] = useState<{ id: string; name: string }[]>([]),
    [truncated, setTruncated] = useState(false);
  const [actor, setActor] = useState<AwayAttempt["actor"] | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [reply, setReply] = useState("");
  const [attempt, setAttempt] = useState<AwayAttempt | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = async () => {
    if (busy.current || !current()) return;
    busy.current = true;
    setLoading(true);
    setError("");
    setSaved(false);
    try {
      const user = await getUser();
      if (!current()) return;
      const owner =
        user?.role === "partner" && user.partnerId
          ? { type: "partner" as const, id: user.partnerId }
          : user &&
              ["vendor", "field_employee"].includes(user.role) &&
              user.vendorId
            ? { type: "vendor" as const, id: user.vendorId }
            : null;
      if (!user || !owner) throw Error("Current organization required");
      const [raw, list] = await Promise.all([
        apiFetch<unknown>("/api/work-hub/away-responder", {}, scope),
        apiFetch<unknown>("/api/work-hub/away-responder/channels", {}, scope),
      ]);
      if (!current()) return;
      const value = WorkHubAwayReadSchema.parse(raw),
        choices = WorkHubAwayChannelsSchema.parse(list);
      if (
        value.rule &&
        (value.rule.userId !== user.id ||
          value.rule.owner.type !== owner.type ||
          value.rule.owner.id !== owner.id ||
          value.rule.version !== value.version)
      )
        throw Error("Setting outside current account");
      setActor({ userId: user.id, owner });
      setSetting(value);
      setChannels(choices.channels);
      setTruncated(choices.truncated);
      setSelected(
        value.rule?.channelIds.filter((id) =>
          choices.channels.some((c) => c.id === id),
        ) ?? [],
      );
      setStart(value.rule?.startsAt ?? "");
      setEnd(value.rule?.endsAt ?? "");
      setReply(value.rule?.replyText ?? t("workHubAway.neutral"));
    } catch {
      if (current()) {
        setSetting(null);
        setActor(null);
        setChannels([]);
        setReply("");
        setError("workHubAway.loadFailed");
      }
    } finally {
      if (current()) setLoading(false);
      busy.current = false;
    }
  };
  const submit = async (
    action: "configure" | "pause" | "revoke",
    retry = false,
  ) => {
    if (busy.current || !current() || !actor || !setting) return;
    busy.current = true;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      let next = attempt;
      if (!retry) {
        if (next) throw Error("Resolve original request first");
        const operationId = nativeUuid();
        if (action === "configure") {
          if (
            !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) ||
            !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(end)
          )
            throw Error("Explicit timezone required");
          next = makeAwayAttempt(
            {
              operationId,
              action,
              expectedVersion: setting.version,
              startsAt: new Date(start).toISOString(),
              endsAt: new Date(end).toISOString(),
              replyText: reply,
              channelIds: selected,
            },
            actor,
            channels.map((c) => c.id),
            Date.now(),
          );
        } else {
          if (!setting.rule) throw Error("Saved rule required");
          next = makeAwayAttempt(
            {
              operationId,
              action,
              expectedVersion: setting.version,
              ruleId: setting.rule.id,
            },
            actor,
            [],
            Date.now(),
          );
        }
        setAttempt(next);
      }
      if (!next) throw Error("Original request missing");
      const receipt = await submitAwayAttempt(
        next,
        retry,
        (path, init) => apiFetch<unknown>(path, init, scope),
        current,
      );
      if (!current()) return;
      setSetting({
        rule: receipt.rule,
        version: receipt.rule.version,
        providerDeliveryVerified: false,
      });
      setAttempt(null);
      setSaved(true);
    } catch (failure) {
      if (current()) {
        if ((failure as { status?: number })?.status === 409) {
          setAttempt(null);
          setSetting(null);
          setError("workHubAway.conflict");
        } else {
          setError(
            attempt || retry ? "workHubAway.unknown" : "workHubAway.saveFailed",
          );
        }
      }
    } finally {
      if (current()) setSaving(false);
      busy.current = false;
    }
  };
  useEffect(() => {
    if (showSetup) {
      setOpen(true);
      void load();
    }
  }, [showSetup]);

  const disabled = saving || loading || !!attempt;
  const text = { color: colors.foreground },
    input = {
      color: colors.foreground,
      borderColor: colors.border,
      borderWidth: 1,
      padding: 10,
      borderRadius: 8,
    };
  const Input = inline ? OnboardingInput : TextInput;
  const fieldStyle = inline ? { backgroundColor: "#303034", color: "#ececec", borderColor: brand.primary, borderRadius: 9999, paddingHorizontal: 12 } : input;
  if (!open && !showSetup)
    return (
      <View style={{ marginTop: inline ? 0 : 20 }}>
        <ProfileMiniCardButton borderColor={brand.primary} onPress={() => {
          setOpen(true);
          void load();
        }}>
          {t("workHubAway.open")}
        </ProfileMiniCardButton>
      </View>
    );
  return (
    <View style={{ marginTop: inline ? 0 : 20, gap: 12, width: inline ? "100%" : undefined }}>
      <Text style={text}>{t("workHubAway.title")}</Text>
      <Text style={{ color: colors.mutedForeground }}>
        {t("workHubAway.description")}
      </Text>
      {loading && <ActivityIndicator />}
      {error && (
        <Text accessibilityRole="alert" style={text}>
          {t(error)}
        </Text>
      )}
      {saved && <Text style={text}>{t("workHubAway.saved")}</Text>}
      {attempt && (
        <>
          <Text style={text}>{t("workHubAway.unknown")}</Text>
          <ProfileMiniCardButton borderColor={brand.primary}
            loading={saving}
            disabled={saving}
            onPress={() => void submit(attempt.command.action, true)}
          >
            {t("workHubAway.retry")}
          </ProfileMiniCardButton>
        </>
      )}
      {setting && (
        <>
          {!setting.rule && setting.version > 0 && (
            <Text style={text}>{t("workHubAway.replacePrevious")}</Text>
          )}
          <Text style={text}>
            {t(`workHubAway.${setting.rule?.status ?? "notConfigured"}`)}
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            {t("workHubAway.windowHint")}
          </Text>
          <Input
            accessibilityLabel={t("workHubAway.start")}
            value={start}
            editable={!disabled}
            onChangeText={setStart}
            style={fieldStyle}
          />
          <Input
            accessibilityLabel={t("workHubAway.end")}
            value={end}
            editable={!disabled}
            onChangeText={setEnd}
            style={fieldStyle}
          />
          <Input
            accessibilityLabel={t("workHubAway.reply")}
            value={reply}
            editable={!disabled}
            onChangeText={setReply}
            maxLength={500}
            multiline
            style={inline ? { ...fieldStyle, borderRadius: 8 } : input}
          />
          <Text style={text}>{t("workHubAway.channels")}</Text>
          {channels.map((channel) => (
            <View
              key={channel.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={text}>{channel.name}</Text>
              <Switch
                accessibilityLabel={channel.name}
                value={selected.includes(channel.id)}
                disabled={disabled}
                onValueChange={(value) =>
                  setSelected((ids) =>
                    value
                      ? [...ids, channel.id]
                      : ids.filter((id) => id !== channel.id),
                  )
                }
              />
            </View>
          ))}
          {!channels.length && (
            <Text style={text}>{t("workHubAway.noChannels")}</Text>
          )}
          {truncated && <Text style={text}>{t("workHubAway.partial")}</Text>}
          <ProfileMiniCardButton borderColor={brand.primary}
            disabled={disabled || !selected.length}
            loading={saving}
            onPress={() => void submit("configure")}
          >
            {t("workHubAway.save")}
          </ProfileMiniCardButton>
          {setting.rule?.status === "active" && (
            <ProfileMiniCardButton borderColor={brand.primary}
              disabled={disabled}
              onPress={() => void submit("pause")}
            >
              {t("workHubAway.pause")}
            </ProfileMiniCardButton>
          )}
          {setting.rule && setting.rule.status !== "revoked" && (
            <ProfileMiniCardButton borderColor={brand.primary}
              disabled={disabled}
              onPress={() => void submit("revoke")}
            >
              {t("workHubAway.revoke")}
            </ProfileMiniCardButton>
          )}
        </>
      )}
      <ProfileMiniCardButton borderColor={brand.primary} disabled={disabled} onPress={() => void load()}>
        {t("workHubAway.refresh")}
      </ProfileMiniCardButton>
    </View>
  );
}
