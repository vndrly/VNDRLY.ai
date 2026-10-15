import React, { useState } from "react";
import {
  Paragraph as Text,
  Field as TextInput,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
} from "./editor-controls";
import { z } from "zod/v4";
import {
  AssignmentMetadataSchema,
  LibraryDraftSchema,
} from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useLibrary as useFormCampaigns } from "./use-library";
const schema = z.object({
  instanceId: z.uuid(),
  title: z.string(),
  kind: z.string(),
  content: LibraryDraftSchema.nullable(),
  assignment: AssignmentMetadataSchema,
  history: z.array(
    z.object({
      id: z.uuid(),
      version: z.number(),
      values: z.record(z.string(), z.unknown()),
      submittedAt: z.coerce.date(),
    }),
  ),
});
export default function OwnerAssignment({
  instanceId,
}: {
  instanceId: string;
}) {
  const { t } = useTranslation(),
    colors = useColors(),
    api = useFormCampaigns(
      `/api/work-hub/library/assignments/${instanceId}`,
      (v) => schema.parse(v),
    ),
    [reason, setReason] = useState(""),
    [review, setReview] = useState<
      "cancel" | "exempt" | "attempt-reset" | null
    >(null),
    [notice, setNotice] = useState("");
  const card = {
      backgroundColor: colors.card,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      gap: 12,
    },
    label = { color: colors.text };
  if (!api.data)
    return (
      <View style={card}>
        <Text style={label}>{api.error || t("workHubLibrary.loading")}</Text>
        <TogglePillButton color="brand" onPress={() => void api.reload()}>
          {t("workHubLibrary.refresh")}
        </TogglePillButton>
      </View>
    );
  const data = api.data;
  const run = async () => {
    if (!review || !reason.trim()) return;
    try {
      await api.send(
        `/api/work-hub/library/instances/${instanceId}/${review}`,
        { reason: reason.trim() },
        data.assignment.version,
      );
      setReview(null);
      setReason("");
      setNotice(t("workHubLibrary.responseSaved"));
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : t("workHubLibrary.unconfirmed"),
      );
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={card}>
        <Text style={{ ...label, fontSize: 20, fontWeight: "700" }}>
          {data.title}
        </Text>
        <Text style={label}>
          {t(`workHubLibrary.status_${data.assignment.status}`)} ·{" "}
          {t("workHubLibrary.version")} {data.assignment.contentVersion}
        </Text>
        <Text style={label}>
          {t("workHubLibrary.due")}:{" "}
          {new Date(data.assignment.dueAt).toLocaleString()}
        </Text>
        {!!data.assignment.reason && (
          <Text style={label}>{data.assignment.reason}</Text>
        )}
        {["assigned", "in_progress"].includes(data.assignment.status) && (
          <>
            <TextInput
              accessibilityLabel={t("workHubLibrary.actionReason")}
              placeholder={t("workHubLibrary.actionReason")}
              value={reason}
              editable={!api.busy && !api.uncertain}
              onChangeText={(value) => {
                setReason(value);
                setReview(null);
              }}
              style={{
                ...label,
                borderWidth: 2,
                borderColor: colors.primary,
                borderRadius: 10,
                padding: 12,
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["cancel", "exempt", "attempt-reset"] as const)
                .filter(
                  (action) =>
                    action !== "attempt-reset" ||
                    data.history.some((h) => h.values.type === "quiz"),
                )
                .map((action) => (
                  <TogglePillButton
                    key={action}
                    color="brand"
                    disabled={api.busy || api.uncertain || !reason.trim()}
                    onPress={() => setReview(action)}
                  >
                    {t(`workHubLibrary.action_${action}`)}
                  </TogglePillButton>
                ))}
            </View>
          </>
        )}
        {review && (
          <View style={card}>
            <Text style={label}>
              {t(`workHubLibrary.action_${review}`)}: {data.title}
            </Text>
            <Text style={label}>{reason}</Text>
            <Text style={label}>
              {t("workHubLibrary.noEmployeeCompletion")}
            </Text>
            <TogglePillButton
              color="brand"
              disabled={api.busy || api.uncertain}
              onPress={() => void run()}
            >
              {t("workHubLibrary.confirm")}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              disabled={api.busy}
              onPress={() => setReview(null)}
            >
              {t("workHubLibrary.close")}
            </TogglePillButton>
          </View>
        )}
        {!!(notice || api.error) && (
          <Text style={label}>{notice || api.error}</Text>
        )}
        {api.uncertain && (
          <TogglePillButton
            color="brand"
            disabled={api.busy}
            onPress={() =>
              void api
                .retryOriginal()
                .then(() => setReview(null))
                .catch((e) => setNotice(e.message))
            }
          >
            {t("workHubLibrary.retry")}
          </TogglePillButton>
        )}
      </View>
      {data.history.map((h) => (
        <View key={h.id} style={card}>
          <Text style={{ ...label, fontWeight: "700" }}>
            {t("workHubLibrary.receipt")} {h.version} ·{" "}
            {new Date(h.submittedAt).toLocaleString()}
          </Text>
          {data.kind === "form" &&
            data.content?.fields.map((field) => (
              <Text key={field.id} style={label}>
                {field.label}:{" "}
                {field.type === "choice"
                  ? (field.options.find((o) => o.id === h.values[field.id])
                      ?.label ?? "—")
                  : typeof h.values[field.id] === "boolean"
                    ? t(
                        h.values[field.id]
                          ? "workHubLibrary.checked"
                          : "workHubLibrary.off",
                      )
                    : String(h.values[field.id] ?? "—")}
              </Text>
            ))}
          {h.values.acknowledged === true && (
            <Text style={label}>{t("workHubLibrary.acknowledged")}</Text>
          )}
          {data.content?.training?.questions.map((question) => {
            const answers = (h.values.answers ?? {}) as Record<
              string,
              string[]
            >;
            return (
              <Text key={question.id} style={label}>
                {question.prompt}:{" "}
                {question.options
                  .filter((o) => answers[question.id]?.includes(o.id))
                  .map((o) => o.label)
                  .join(", ") || "—"}
              </Text>
            );
          })}
          {h.values.grade && typeof h.values.grade === "object" ? (
            <Text style={label}>
              {t(
                (h.values.grade as { passed: boolean }).passed
                  ? "workHubLibrary.passed"
                  : "workHubLibrary.needsRetry",
              )}{" "}
              · {(h.values.grade as { scorePercent: number }).scorePercent}%
            </Text>
          ) : null}
          {data.kind === "poll" && data.content?.poll && (
            <Text style={label}>
              {data.content.poll.choices
                .filter(
                  (o) =>
                    Array.isArray(h.values.choices) &&
                    h.values.choices.includes(o.id),
                )
                .map((o) => o.label)
                .join(", ")}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
