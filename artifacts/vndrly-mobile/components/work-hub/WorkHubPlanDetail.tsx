import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import {
  isPlanTaskId,
  planAccountKey,
  readNativePlanProjection,
  type NativePlanProjection,
} from "@/lib/work-hub-plan";

export default function WorkHubPlanDetail({ taskId }: { taskId: string }) {
  const { user } = useAuth(),
    colors = useColors(),
    { t } = useTranslation();
  const key = `${user ? planAccountKey(user) : ""}:${taskId}`;
  const [saved, setSaved] = useState<{
    key: string;
    projection: NativePlanProjection;
  } | null>(null);
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setSaved(null);
    setError(false);
    if (!user || !isPlanTaskId(taskId)) {
      setError(true);
      setLoading(false);
      return;
    }
    const scope = captureAuthScope(),
      controller = new AbortController();
    const current = () =>
      !controller.signal.aborted && isAuthScopeCurrent(scope);
    const invalidate = () => {
      controller.abort();
      setSaved(null);
      setLoading(false);
      setError(true);
    };
    const stopUser = subscribeUser(invalidate),
      stopToken = subscribeToken(invalidate);
    setLoading(true);
    void apiFetch<unknown>(
      `/api/work-hub/tasks/${taskId}/plan`,
      { signal: controller.signal },
      scope,
    )
      .then((value) => {
        if (current())
          setSaved({
            key,
            projection: readNativePlanProjection(value, taskId, user),
          });
      })
      .catch(() => {
        if (current()) setError(true);
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      controller.abort();
      stopUser();
      stopToken();
    };
  }, [key, refresh]);
  const projection = saved?.key === key ? saved.projection : null;
  const text = { color: colors.text },
    secondary = { color: colors.mutedForeground };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Text style={[text, { fontSize: 22, fontWeight: "700" }]}>
        {projection?.title ?? t("workPlan.title")}
      </Text>
      <Text style={secondary}>{t("workPlan.boundary")}</Text>
      <TogglePillButton
        color="blue"
        onPress={() => setRefresh((value) => value + 1)}
        disabled={loading}
      >
        {t("workPlan.refresh")}
      </TogglePillButton>
      {loading ? (
        <ActivityIndicator accessibilityLabel={t("workPlan.loading")} />
      ) : null}
      {error ? (
        <Text style={text} accessibilityRole="alert">
          {t("workPlan.unavailable")}
        </Text>
      ) : null}
      {projection ? (
        <>
          <Text style={secondary}>
            {t("workPlan.revision", {
              task: projection.taskVersion,
              plan: projection.plan.version,
              status: projection.taskStatus,
            })}
          </Text>
          <Text style={secondary}>{t("workPlan.handoff")}</Text>
          {projection.plan.steps.map((step) => (
            <View
              key={step.id}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                borderRadius: 12,
                padding: 14,
                gap: 8,
              }}
            >
              <Text style={[text, { fontWeight: "700" }]}>
                {step.id} · {step.specialist}
              </Text>
              <Text style={text}>{t(`workPlan.states.${step.state}`)}</Text>
              <Text style={secondary}>
                {t(
                  projection.verifiedCompletionStepIds.includes(step.id)
                    ? "workPlan.verified"
                    : step.state === "completed"
                      ? "workPlan.recordedUnverified"
                      : "workPlan.notCompleted",
                )}
              </Text>
              {step.completion?.kind === "planned_read_observed" ? (
                <Text style={secondary}>
                  {t("workPlan.readOnlyCheckpoint")}
                </Text>
              ) : null}
              {projection.eligibleStepIds.includes(step.id) ? (
                <Text style={secondary}>{t("workPlan.eligible")}</Text>
              ) : null}
              <Text style={secondary}>
                {t("workPlan.dependencies", {
                  value: step.dependsOn.length
                    ? step.dependsOn.join(", ")
                    : t("workPlan.none"),
                })}
              </Text>
              <Text style={secondary}>
                {t("workPlan.tools", { value: step.toolNames.join(", ") })}
              </Text>
              {step.deadlineAt ? (
                <Text style={secondary}>
                  {t("workPlan.deadline", {
                    value: new Date(step.deadlineAt).toLocaleString(),
                  })}
                  {projection.overdueStepIds.includes(step.id)
                    ? ` · ${t("workPlan.overdue")}`
                    : ""}
                </Text>
              ) : null}
              {step.detail ? <Text style={text}>{step.detail}</Text> : null}
              {step.resultReferences.length ? (
                <Text style={secondary}>
                  {t("workPlan.references", {
                    value: String(step.resultReferences.length),
                  })}
                </Text>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
