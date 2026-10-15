import React, { useEffect, useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AssignedLibraryReadSchema } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { downloadAndShareProtectedFile } from "@/lib/meeting-files";
import TogglePillButton from "../../TogglePillButton";
export default function EmployeeResponse({
  instanceId,
}: {
  instanceId: string;
}) {
  const { t } = useTranslation(),
    colors = useColors();
  const api = useFormCampaigns(
    `/api/work-hub/library/instances/${instanceId}`,
    (v) => AssignedLibraryReadSchema.parse(v),
  );
  const [lessons, setLessons] = useState<string[]>([]),
    [answers, setAnswers] = useState<Record<string, string[]>>({}),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [choices, setChoices] = useState<string[]>([]),
    [ack, setAck] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setLessons([]);
    setAnswers({});
    setValues({});
    setChoices([]);
    setAck(false);
    setNotice("");
  }, [instanceId, api.contextKey]);
  useEffect(() => {
    if (api.data) {
      setLessons(api.data.assignment.progress.lessonIds);
      setAnswers(api.data.assignment.progress.answers);
      if(api.data.assignment.status === "completed") {
        const saved=[...api.data.history].sort((a,b)=>b.version-a.version)[0]?.values;
        if(saved) {
          setValues(saved.values && typeof saved.values === "object" ? saved.values as Record<string,unknown> : saved);
          setAck(saved.acknowledged === true);
          setChoices(Array.isArray(saved.choices) ? saved.choices.filter((v):v is string=>typeof v === "string") : []);
        }
      }
    }
  }, [api.data?.instanceId, api.data?.version]);
  const card = {
      backgroundColor: colors.card,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      gap: 12,
    },
    label = { color: colors.text };
  const toggle = (value: string, array: string[]) =>
    array.includes(value)
      ? array.filter((x) => x !== value)
      : [...array, value];
  if (!api.data)
    return (
      <View style={card}>
        <Text style={label}>{api.error || t("workHubLibrary.loading")}</Text>
        <TogglePillButton color="brand" onPress={() => void api.reload()}>
          {t("workHubLibrary.refresh")}
        </TogglePillButton>
      </View>
    );
  const data = api.data,
    content = data.metadata.content,
    training = content?.training,
    blocked = api.busy || api.uncertain || !data.canSubmit;
  const send = async (mode: "progress" | "attempt" | "complete") => {
    try {
      const result = api.uncertain
        ? await api.retryOriginal()
        : await api.send(
            `/api/work-hub/library/instances/${instanceId}/${mode}`,
            { acknowledged: ack, lessonIds: lessons, answers, values, choices },
            data.version,
          );
      const resource = result.resource;
      if (resource.instanceId && resource.instanceId !== instanceId)
        throw Error(t("workHubLibrary.unconfirmed"));
      const grade = resource.grade as
        | { passed: boolean; scorePercent: number }
        | undefined;
      setNotice(
        grade
          ? t(
              grade.passed
                ? "workHubLibrary.passed"
                : "workHubLibrary.needsRetry",
            )
          : t(
              mode === "progress"
                ? "workHubLibrary.progressSaved"
                : "workHubLibrary.responseSaved",
            ),
      );
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
          {t("workHubLibrary.version")} {data.metadata.contentVersion} ·{" "}
          {t(`workHubLibrary.status_${data.assignment.status}`)}
        </Text>
        <Text style={label}>
          {t("workHubLibrary.due")}:{" "}
          {new Date(data.assignment.dueAt).toLocaleString()}
        </Text>
        {!!content?.description && (
          <Text style={label}>{content.description}</Text>
        )}
        {data.attachments.map((file) => (
          <TogglePillButton
            key={file.fileId}
            color="brand"
            onPress={() => {
              const scope = captureAuthScope();
              void downloadAndShareProtectedFile(
                {
                  ...file,
                  authScope: scope,
                  assertCurrent: () => {
                    if (!isAuthScopeCurrent(scope))
                      throw Error(t("workHubLibrary.accountChanged"));
                  },
                },
                `/api/work-hub/library/instances/${instanceId}/files/${file.fileId}`,
              ).catch((e) => {
                if (isAuthScopeCurrent(scope)) setNotice(e.message);
              });
            }}
          >
            {file.fileName}
          </TogglePillButton>
        ))}
        {data.metadata.kind === "policy" && (
          <>
            <Text style={label}>{content?.policyText}</Text>
            <TogglePillButton
              color="brand"
              disabled={blocked}
              solid={ack}
              onPress={() => setAck(!ack)}
            >
              {t("workHubLibrary.ackPolicy")}
            </TogglePillButton>
          </>
        )}
        {training && (
          <>
            {training.lessons.map((lesson) => (
              <View key={lesson.id} style={card}>
                <Text style={{ ...label, fontWeight: "700" }}>
                  {lesson.title}
                </Text>
                <Text style={label}>{lesson.body}</Text>
                {lesson.links.map((link) => (
                  <TogglePillButton
                    key={link}
                    color="brand"
                    onPress={() =>
                      void Linking.openURL(link).catch((e) =>
                        setNotice(e.message),
                      )
                    }
                  >
                    {t("workHubLibrary.openResource")}
                  </TogglePillButton>
                ))}
                <TogglePillButton
                  color="brand"
                  disabled={blocked}
                  solid={lessons.includes(lesson.id)}
                  onPress={() => setLessons(toggle(lesson.id, lessons))}
                >
                  {t(
                    lessons.includes(lesson.id)
                      ? "workHubLibrary.lessonComplete"
                      : "workHubLibrary.markLesson",
                  )}
                </TogglePillButton>
              </View>
            ))}
            {training.questions.map((question) => (
              <View key={question.id} style={card}>
                <Text style={{ ...label, fontWeight: "700" }}>
                  {question.prompt}
                </Text>
                <Text style={label}>
                  {t(
                    question.multiple
                      ? "workHubLibrary.selectMultiple"
                      : "workHubLibrary.selectOne",
                  )}
                </Text>
                {question.options.map((option) => (
                  <TogglePillButton
                    key={option.id}
                    color="brand"
                    disabled={blocked}
                    solid={answers[question.id]?.includes(option.id)}
                    onPress={() =>
                      setAnswers({
                        ...answers,
                        [question.id]: question.multiple
                          ? toggle(option.id, answers[question.id] ?? [])
                          : [option.id],
                      })
                    }
                  >
                    {option.label}
                  </TogglePillButton>
                ))}
              </View>
            ))}
            {training.completionMode !== "quiz" && (
              <TogglePillButton
                color="brand"
                disabled={blocked}
                solid={ack}
                onPress={() => setAck(!ack)}
              >
                {t("workHubLibrary.ackTraining")}
              </TogglePillButton>
            )}
            <Text style={label}>
              {t("workHubLibrary.passingScore")}: {training.passingPercent}% ·{" "}
              {t("workHubLibrary.attempts")}:{" "}
              {data.history.filter((h) => h.values.type === "quiz" && (!data.assignment.attemptResetAt || new Date(h.submittedAt).getTime() > Date.parse(data.assignment.attemptResetAt))).length}/
              {training.allowRetries ? training.maximumAttempts : 1}
            </Text>
            <TogglePillButton
              color="brand"
              disabled={blocked}
              onPress={() => void send("progress")}
            >
              {t("workHubLibrary.saveProgress")}
            </TogglePillButton>
          </>
        )}
        {data.metadata.kind === "form" &&
          content?.fields.map((field) => (
            <View key={field.id} style={{ gap: 8 }}>
              <Text style={label}>
                {field.label}
                {field.required ? " *" : ""}
              </Text>
              {field.type === "choice" ? (
                field.options.map((option) => (
                  <TogglePillButton
                    key={option.id}
                    disabled={blocked}
                    color="brand"
                    solid={values[field.id] === option.id}
                    onPress={() =>
                      setValues({ ...values, [field.id]: option.id })
                    }
                  >
                    {option.label}
                  </TogglePillButton>
                ))
              ) : field.type === "checkbox" ? (
                <TogglePillButton
                  color="brand"
                  disabled={blocked}
                  solid={values[field.id] === true}
                  onPress={() =>
                    setValues({
                      ...values,
                      [field.id]: values[field.id] !== true,
                    })
                  }
                >
                  {t(
                    values[field.id]
                      ? "workHubLibrary.checked"
                      : "workHubLibrary.check",
                  )}
                </TogglePillButton>
              ) : (
                <TextInput
                  accessibilityLabel={field.label}
                  value={String(values[field.id] ?? "")}
                  editable={!blocked}
                  multiline={field.type === "textarea"}
                  keyboardType={field.type === "number" ? "numeric" : "default"}
                  onChangeText={(v) =>
                    setValues({
                      ...values,
                      [field.id]:
                        field.type === "number" && v !== "" ? Number(v) : v,
                    })
                  }
                  placeholder={
                    field.type === "date" ? "YYYY-MM-DD" : field.label
                  }
                  style={{
                    ...label,
                    borderWidth: 2,
                    borderColor: colors.primary,
                    borderRadius: 10,
                    padding: 12,
                  }}
                />
              )}
            </View>
          ))}
        {data.metadata.kind === "poll" &&
          content?.poll?.choices.map((option) => (
            <TogglePillButton
              key={option.id}
              color="brand"
              disabled={blocked}
              solid={choices.includes(option.id)}
              onPress={() =>
                setChoices(
                  content.poll!.maxSelections === 1
                    ? [option.id]
                    : toggle(option.id, choices),
                )
              }
            >
              {option.label}
            </TogglePillButton>
          ))}
        {!!(notice || api.error) && (
          <Text accessibilityLiveRegion="polite" style={label}>
            {notice || api.error}
          </Text>
        )}
        {(data.canSubmit || api.uncertain) && (
          <TogglePillButton
            color="brand"
            disabled={api.busy}
            onPress={() =>
              void send(
                training && training.completionMode !== "checkoff"
                  ? "attempt"
                  : "complete",
              )
            }
          >
            {api.busy
              ? t("workHubLibrary.saving")
              : api.uncertain
                ? t("workHubLibrary.retry")
                : t(
                    training && training.completionMode !== "checkoff"
                      ? "workHubLibrary.submitQuiz"
                      : "workHubLibrary.submitResponse",
                  )}
          </TogglePillButton>
        )}
      </View>
      {data.history.map((receipt) => (
        <View key={receipt.id} style={card}>
          <Text style={label}>
            {t("workHubLibrary.receipt")} {receipt.version} ·{" "}
            {new Date(receipt.submittedAt).toLocaleString()}
          </Text>
          {receipt.values.grade && typeof receipt.values.grade === "object" ? (
            <Text style={label}>
              {t(
                (receipt.values.grade as { passed: boolean }).passed
                  ? "workHubLibrary.passed"
                  : "workHubLibrary.needsRetry",
              )}{" "}
              ·{" "}
              {(receipt.values.grade as { scorePercent: number }).scorePercent}%
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
