import React, { useEffect, useRef, useState } from "react";
import { Linking, ScrollView, Switch, View } from "react-native";
import {
  OnboardingText as Text,
  OnboardingInput as TextInput,
} from "./OnboardingControls";
import { useTranslation } from "react-i18next";
import { LEGAL_POLICY_VERSION } from "@workspace/api-zod";
import {
  PLATFORM_EULA_TEXT,
  PLATFORM_EULA_VERSION,
} from "../../../lib/platform-eula/src/index";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import { pickOnboardingCompanyLogo } from "@/lib/onboarding-field-photo";
import {
  DEFERABLE_ONBOARDING,
  ONBOARDING_FIELDS,
  ONBOARDING_STEPS,
  missingOnboardingSectionFields,
  onboardingTransition,
  onboardingValue,
  requiredOnboardingFields,
  setOnboardingValue,
  type NativeOnboardingProgress,
} from "@/lib/onboarding-native";

export default function NativeOnboarding({
  organization,
}: {
  organization: { type: "vendor" | "partner"; id: number };
}) {
  const { t } = useTranslation(),
    colors = useColors();
  const [progress, setProgress] = useState<NativeOnboardingProgress | null>(
      null,
    ),
    [payload, setPayload] = useState<Record<string, any>>({});
  const [section, setSection] = useState("company-basics"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [completionVerified, setCompletionVerified] = useState(false);
  const [catalog, setCatalog] = useState<{ id: number; name: string }[]>([]),
    [revision, setRevision] = useState(0);
  const pending = useRef<AbortController | null>(null),
    valid = useRef(true);
  const path = `/api/onboarding/${organization.type}/${organization.id}`;
  useEffect(() => {
    valid.current = true;
    const scope = captureAuthScope(),
      controller = new AbortController();
    setProgress(null);
    setCompletionVerified(false);
    setPayload({});
    setError("");
    setBusy(false);
    const invalidate = () => {
      valid.current = false;
      controller.abort();
      pending.current?.abort();
      setProgress(null);
      setCompletionVerified(false);
      setPayload({});
      setError(t("onboardingNative.accountChanged"));
    };
    const user = subscribeUser(invalidate),
      token = subscribeToken(invalidate);
    void apiFetch<NativeOnboardingProgress>(
      `${path}/progress`,
      { signal: controller.signal },
      scope,
    )
      .then((row) => {
        if (
          !valid.current ||
          controller.signal.aborted ||
          !isAuthScopeCurrent(scope)
        )
          return;
        if (
          row.orgType !== organization.type ||
          (organization.type === "vendor" ? row.vendorId : row.partnerId) !==
            organization.id
        )
          throw new Error(t("onboardingNative.accountChanged"));
        setProgress(row);
        setCompletionVerified(
          Boolean(row.completedAt) &&
            requiredOnboardingFields(organization.type, row.payload ?? {})
              .length === 0,
        );
        setPayload(row.payload ?? {});
        setSection(
          row.currentStep === "done"
            ? ONBOARDING_STEPS[organization.type][0]
            : row.currentStep,
        );
      })
      .catch((cause) => {
        if (valid.current && !controller.signal.aborted)
          setError(cause.message);
      });
    if (organization.type === "vendor")
      void apiFetch<{ id: number; name: string }[]>(
        "/api/work-types",
        { signal: controller.signal },
        scope,
      )
        .then((rows) => {
          if (valid.current && isAuthScopeCurrent(scope)) setCatalog(rows);
        })
        .catch(() => {});
    return () => {
      valid.current = false;
      controller.abort();
      pending.current?.abort();
      user();
      token();
    };
  }, [path, revision]);
  const set = (field: string, value: unknown) =>
    setPayload((current) => setOnboardingValue(current, field, value));
  const mutate = async (finish: boolean, defer = false) => {
    if (pending.current || !progress || !valid.current) return;
    const scope = captureAuthScope(),
      controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    const current = () =>
      valid.current && !controller.signal.aborted && isAuthScopeCurrent(scope);
    try {
      if (!finish && !defer) {
        const missing = missingOnboardingSectionFields(
          organization.type,
          section,
          payload,
        );
        if (missing.length)
          throw new Error(
            `${t("onboardingNative.missing")}: ${missing.map((field) => t(`onboardingNative.fields.${field.split(".").at(-1)}`)).join(", ")}`,
          );
      }
      if (finish) {
        const missing = requiredOnboardingFields(organization.type, payload);
        if (missing.length)
          throw new Error(
            `${t("onboardingNative.missing")}: ${missing.map((field) => t(`onboardingNative.fields.${field.split(".").at(-1)}`)).join(", ")}`,
          );
      }
      const next = finish
        ? progress.currentStep
        : onboardingTransition(organization.type, section, defer);
      const completedSteps = finish
        ? progress.completedSteps
        : defer
          ? progress.completedSteps.filter((step) => step !== section)
          : [...new Set([...progress.completedSteps, section])];
      const skippedSteps = finish
        ? progress.skippedSteps
        : defer
          ? [...new Set([...progress.skippedSteps, section])]
          : progress.skippedSteps.filter((step) => step !== section);
      const saved = await apiFetch<NativeOnboardingProgress>(
        `${path}/progress`,
        {
          method: "PUT",
          signal: controller.signal,
          body: JSON.stringify({
            payload,
            currentStep: next,
            completedSteps,
            skippedSteps,
          }),
        },
        scope,
      );
      if (!current()) return;
      if (finish) {
        const completed = await apiFetch<NativeOnboardingProgress>(
          `${path}/complete`,
          { method: "POST", signal: controller.signal },
          scope,
        );
        if (!current()) return;
        if (
          !completed.completedAt ||
          completed.orgType !== organization.type ||
          (organization.type === "vendor"
            ? completed.vendorId
            : completed.partnerId) !== organization.id
        )
          throw new Error(t("onboardingNative.unknown"));
        setProgress(completed);
        setCompletionVerified(true);
        setPayload(completed.payload ?? payload);
      } else {
        setProgress(saved);
        setSection(next);
      }
    } catch (cause: any) {
      if (current()) {
        const missing = Array.isArray(cause.data?.missing)
          ? cause.data.missing.filter(
              (field: unknown) => typeof field === "string",
            )
          : [];
        setError(
          `${cause.message ?? t("onboardingNative.failed")}${missing.length ? `: ${missing.join(", ")}` : ""}`,
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (current()) setBusy(false);
      }
    }
  };
  const uploadLogo = async () => {
    if (busy || pending.current) return;
    const scope = captureAuthScope(),
      controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const file = await pickOnboardingCompanyLogo(scope, controller.signal);
      if (file && valid.current && isAuthScopeCurrent(scope))
        set(
          organization.type === "vendor" ? "branding.logoUrl" : "logoUrl",
          file,
        );
    } catch (cause: any) {
      if (valid.current && isAuthScopeCurrent(scope)) setError(cause.message);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (valid.current && isAuthScopeCurrent(scope)) setBusy(false);
    }
  };
  const button = (label: string, onPress: () => void, disabled = busy) => (
    <TogglePillButton
      color="blue"
      accessibilityLabel={t(`onboardingNative.${label}`)}
      disabled={disabled}
      onPress={onPress}
    >
      {t(`onboardingNative.${label}`)}
    </TogglePillButton>
  );
  return (
    <ScrollView
      contentContainerStyle={{ padding: 18, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ color: colors.text, fontSize: 24 }}>
        {t("onboardingNative.title")}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {error}
        </Text>
      ) : null}
      {button("reload", () => setRevision((value) => value + 1))}
      {completionVerified ? (
        <Text>{t("onboardingNative.completed")}</Text>
      ) : progress ? (
        <>
          <Text>{t("onboardingNative.savedNotComplete")}</Text>
          <View style={{ gap: 8 }}>
            {ONBOARDING_STEPS[organization.type].map((step) => (
              <TogglePillButton
                key={step}
                color="blue"
                disabled={busy}
                onPress={() => setSection(step)}
              >
                {t(`onboardingNative.sections.${step}`)}
              </TogglePillButton>
            ))}
          </View>
          <Text style={{ fontSize: 20 }}>
            {t(`onboardingNative.sections.${section}`)}
          </Text>
          {section === "company-basics" ? (
            <Text>{t("onboardingNative.companyCreated")}</Text>
          ) : null}
          {(ONBOARDING_FIELDS[section] ?? []).map((field) => (
            <View key={field}>
              <Text>
                {t(`onboardingNative.fields.${field.split(".").at(-1)}`)}
              </Text>
              <TextInput
                accessibilityLabel={t(
                  `onboardingNative.fields.${field.split(".").at(-1)}`,
                )}
                value={String(onboardingValue(payload, field) ?? "")}
                editable={!busy}
                onChangeText={(value) => set(field, value)}
                keyboardType={
                  /Radius|Miles/.test(field)
                    ? "numeric"
                    : field.endsWith("email")
                      ? "email-address"
                      : "default"
                }
                autoCapitalize={field.endsWith("email") ? "none" : "sentences"}
                style={{ color: colors.text, borderWidth: 1, padding: 10 }}
              />
            </View>
          ))}
          {section === "platform-eula" ? (
            <>
              <Text>{PLATFORM_EULA_TEXT}</Text>
              <Text>{t("onboardingNative.acceptEula")}</Text>
              <Switch
                accessibilityLabel={t("onboardingNative.acceptEula")}
                disabled={busy}
                value={
                  payload.platformEula?.accepted === true &&
                  payload.platformEula?.version === PLATFORM_EULA_VERSION
                }
                onValueChange={(accepted) =>
                  set("platformEula", {
                    accepted,
                    version: PLATFORM_EULA_VERSION,
                  })
                }
              />
            </>
          ) : null}
          {section === "legal-consent" ? (
            <>
              {button("privacy", () => {
                void Linking.openURL("https://vndrly.ai/legal/privacy");
              })}
              {button("terms", () => {
                void Linking.openURL("https://vndrly.ai/legal/terms");
              })}
              <Text>{t("onboardingNative.acceptLegal")}</Text>
              <Switch
                accessibilityLabel={t("onboardingNative.acceptLegal")}
                disabled={busy}
                value={
                  payload.legalConsent?.accepted === true &&
                  payload.legalConsent?.version === LEGAL_POLICY_VERSION
                }
                onValueChange={(accepted) =>
                  set("legalConsent", {
                    ...payload.legalConsent,
                    accepted,
                    version: LEGAL_POLICY_VERSION,
                  })
                }
              />
              <Text>{t("onboardingNative.smsDisclosure")}</Text>
              <Switch
                accessibilityLabel={t("onboardingNative.smsOptIn")}
                disabled={busy}
                value={payload.legalConsent?.smsOptIn === true}
                onValueChange={(smsOptIn) =>
                  set("legalConsent", {
                    ...payload.legalConsent,
                    accepted:
                      payload.legalConsent?.accepted === true &&
                      payload.legalConsent?.version === LEGAL_POLICY_VERSION,
                    smsOptIn,
                    version: LEGAL_POLICY_VERSION,
                  })
                }
              />
            </>
          ) : null}
          {section === "branding" ? (
            <>
              {button("uploadLogo", () => {
                void uploadLogo();
              })}
              <Text>{t("onboardingNative.optionalBranding")}</Text>
            </>
          ) : null}
          {section === "work-types"
            ? catalog.map((item) => (
                <View key={item.id}>
                  <Text>{item.name}</Text>
                  <Switch
                    disabled={busy}
                    accessibilityLabel={item.name}
                    value={(payload.workTypeIds ?? [])
                      .map(Number)
                      .includes(item.id)}
                    onValueChange={(selected) =>
                      set(
                        "workTypeIds",
                        selected
                          ? [
                              ...new Set([
                                ...(payload.workTypeIds ?? []).map(Number),
                                item.id,
                              ]),
                            ]
                          : (payload.workTypeIds ?? []).filter(
                              (id: unknown) => Number(id) !== item.id,
                            ),
                      )
                    }
                  />
                </View>
              ))
            : null}
          {section === "invite-team" ? (
            <>
              <Text>{t("onboardingNative.optionalInvites")}</Text>
              <TextInput
                accessibilityLabel={t("onboardingNative.fields.email")}
                editable={!busy}
                value={(payload.inviteEmails ?? []).join(", ")}
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={(value) =>
                  set(
                    "inviteEmails",
                    value
                      .split(",")
                      .map((email) => email.trim())
                      .filter(Boolean),
                  )
                }
              />
            </>
          ) : null}
          {button("saveContinue", () => {
            void mutate(false);
          })}
          {DEFERABLE_ONBOARDING[organization.type].includes(section)
            ? button("defer", () => {
                void mutate(false, true);
              })
            : null}
          {button("finish", () => {
            void mutate(true);
          })}
        </>
      ) : null}
    </ScrollView>
  );
}
