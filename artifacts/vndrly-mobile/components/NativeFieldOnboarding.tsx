import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import {
  OnboardingText as Text,
  OnboardingInput as TextInput,
} from "./OnboardingControls";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import { pickOnboardingFieldPhoto } from "@/lib/onboarding-field-photo";
import {
  requiredOnboardingFields,
  type NativeOnboardingProgress,
} from "@/lib/onboarding-native";
type Invite = {
  firstName: string;
  lastName: string;
  phone: string | null;
  photoUrl: string | null;
  vendorName: string;
  progress: NativeOnboardingProgress;
};
export default function NativeFieldOnboarding({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const [invite, setInvite] = useState<Invite | null>(null),
    [payload, setPayload] = useState<Record<string, any>>({}),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [completed, setCompleted] = useState(false),
    [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null),
    active = useRef(true);
  const endpoint = `/api/onboarding/field/by-token/${encodeURIComponent(token)}`;
  useEffect(() => {
    active.current = true;
    const controller = new AbortController(),
      scope = captureAuthScope();
    setInvite(null);
    setPayload({});
    setPassword("");
    setConfirmation("");
    setError("");
    setBusy(false);
    setCompleted(false);
    const invalidate = () => {
      active.current = false;
      controller.abort();
      request.current?.abort();
      setInvite(null);
      setPayload({});
      setPassword("");
      setConfirmation("");
      setError(t("onboardingNative.accountChanged"));
    };
    const user = subscribeUser(invalidate),
      auth = subscribeToken(invalidate);
    if (token.length < 16 || token.length > 512) {
      setError(t("onboardingNative.inviteRequired"));
      return () => {
        active.current = false;
        user();
        auth();
      };
    }
    void apiFetch<Invite>(endpoint, { signal: controller.signal }, scope)
      .then((row) => {
        if (
          !active.current ||
          controller.signal.aborted ||
          !isAuthScopeCurrent(scope)
        )
          return;
        if (
          row.progress.orgType !== "field_employee" ||
          row.progress.completedAt
        )
          throw new Error(t("onboardingNative.inviteRequired"));
        setInvite(row);
        setPayload({
          info: {
            firstName: row.firstName,
            lastName: row.lastName,
            phone: row.phone,
          },
          photoUrl: row.photoUrl,
          ...row.progress.payload,
        });
      })
      .catch((cause) => {
        if (active.current && !controller.signal.aborted)
          setError(cause.message);
      });
    return () => {
      active.current = false;
      controller.abort();
      request.current?.abort();
      user();
      auth();
    };
  }, [token, revision]);
  const action = async (kind: "save" | "photo" | "finish") => {
    if (request.current || !invite || !active.current) return;
    const controller = new AbortController(),
      scope = captureAuthScope();
    request.current = controller;
    setBusy(true);
    setError("");
    const current = () =>
      active.current && !controller.signal.aborted && isAuthScopeCurrent(scope);
    try {
      if (kind === "photo") {
        const photoUrl = await pickOnboardingFieldPhoto(
          token,
          scope,
          controller.signal,
        );
        if (photoUrl && current())
          setPayload((value) => ({ ...value, photoUrl }));
        return;
      }
      if (kind === "finish") {
        const missing = requiredOnboardingFields("field_employee", payload);
        if (missing.length)
          throw new Error(
            `${t("onboardingNative.missing")}: ${missing.map((field) => t(`onboardingNative.fields.${field.split(".").at(-1)}`)).join(", ")}`,
          );
        if (password.length < 8 || password !== confirmation)
          throw new Error(t("onboardingNative.passwordRequirement"));
      }
      await apiFetch(
        `${endpoint}/progress`,
        {
          method: "PUT",
          signal: controller.signal,
          body: JSON.stringify({ payload }),
        },
        scope,
      );
      if (!current()) return;
      if (kind === "finish") {
        const result = await apiFetch<{ progress: NativeOnboardingProgress }>(
          `${endpoint}/complete`,
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              firstName: payload.info.firstName,
              lastName: payload.info.lastName,
              phone: payload.info.phone,
              vendorRole: payload.info.vendorRole,
              photoUrl: payload.photoUrl,
              pecCertification: payload.pec.certified,
              pecExpirationDate: payload.pec.expirationDate,
              password,
              preferredLanguage: i18n.language.startsWith("es") ? "es" : "en",
            }),
          },
          scope,
        );
        if (!current()) return;
        if (
          !result.progress?.completedAt ||
          result.progress.orgType !== "field_employee" ||
          result.progress.id !== invite.progress.id
        )
          throw new Error(t("onboardingNative.unknown"));
        setCompleted(true);
        setPassword("");
        setConfirmation("");
      }
    } catch (cause: any) {
      if (current()) {
        const missing = Array.isArray(cause.data?.missing)
          ? cause.data.missing
          : [];
        setError(
          `${cause.message}${missing.length ? `: ${missing.join(", ")}` : ""}`,
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (current()) setBusy(false);
      }
    }
  };
  const button = (key: string, work: () => void) => (
    <TogglePillButton
      color="blue"
      disabled={busy}
      accessibilityLabel={t(`onboardingNative.${key}`)}
      onPress={work}
    >
      {t(`onboardingNative.${key}`)}
    </TogglePillButton>
  );
  return (
    <ScrollView
      contentContainerStyle={{ padding: 18, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text>{t("onboardingNative.title")}</Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {button("reload", () => setRevision((value) => value + 1))}
      {completed ? (
        <Text>{t("onboardingNative.completedSignIn")}</Text>
      ) : invite ? (
        <>
          <Text>{invite.vendorName}</Text>
          {["firstName", "lastName", "phone"].map((field) => (
            <View key={field}>
              <Text>{t(`onboardingNative.fields.${field}`)}</Text>
              <TextInput
                accessibilityLabel={t(`onboardingNative.fields.${field}`)}
                editable={!busy}
                value={payload.info?.[field] ?? ""}
                onChangeText={(value) =>
                  setPayload((current) => ({
                    ...current,
                    info: { ...current.info, [field]: value },
                  }))
                }
              />
            </View>
          ))}
          <Text>{t("onboardingNative.fields.vendorRole")}</Text>
          {(["field", "foreman", "office", "both"] as const).map((role) => (
            <TogglePillButton
              key={role}
              color="blue"
              solid={payload.info?.vendorRole === role}
              disabled={busy}
              onPress={() =>
                setPayload((value) => ({
                  ...value,
                  info: { ...value.info, vendorRole: role },
                }))
              }
            >
              {t(`onboardingNative.roles.${role}`)}
            </TogglePillButton>
          ))}
          {button("uploadPhoto", () => {
            void action("photo");
          })}
          {payload.photoUrl ? (
            <Text>{t("onboardingNative.photoSaved")}</Text>
          ) : null}
          <Text>{t("onboardingNative.certification")}</Text>
          <Switch
            disabled={busy}
            accessibilityLabel={t("onboardingNative.certification")}
            value={payload.pec?.certified === true}
            onValueChange={(certified) =>
              setPayload((value) => ({
                ...value,
                pec: { ...value.pec, certified },
              }))
            }
          />
          <TextInput
            accessibilityLabel={t("onboardingNative.fields.expirationDate")}
            editable={!busy}
            placeholder="YYYY-MM-DD"
            value={payload.pec?.expirationDate ?? ""}
            onChangeText={(expirationDate) =>
              setPayload((value) => ({
                ...value,
                pec: { ...value.pec, expirationDate },
              }))
            }
          />
          <Text>{t("onboardingNative.passwordRequirement")}</Text>
          <TextInput
            accessibilityLabel={t("onboardingNative.password")}
            secureTextEntry
            autoCapitalize="none"
            editable={!busy}
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            accessibilityLabel={t("onboardingNative.confirmPassword")}
            secureTextEntry
            autoCapitalize="none"
            editable={!busy}
            value={confirmation}
            onChangeText={setConfirmation}
          />
          {button("save", () => {
            void action("save");
          })}
          {button("finish", () => {
            void action("finish");
          })}
        </>
      ) : null}
    </ScrollView>
  );
}
