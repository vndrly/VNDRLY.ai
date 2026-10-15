import DeliveryEditor from "./delivery-editor";
import React, { useState } from "react";
import {
  Paragraph as Text,
  Field as TextInput,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
} from "./editor-controls";
import {
  LibraryDraftSchema,
  type LibraryDraft,
  type LibraryField,
  type TrainingDefinition,
} from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
const seed: LibraryDraft = {
  kind: "policy",
  title: "",
  description: "",
  delivery:{reminderHours:null,briefing:{enabled:false,hour:8,minute:0,push:false},escalationHours:null},
  policyText: "",
  policyAttachmentId: null,
  fields: [],
  training: null,
  poll: null,
  dueHours: 720,
  timezone: "America/Chicago",
};
const trainingSeed: TrainingDefinition = {
  lessons: [],
  questions: [],
  completionMode: "both",
  passingPercent: 80,
  allowRetries: true,
  maximumAttempts: 3,
  refresherDays: null,
};
export default function LibraryEditor({
  initial,
  onSave,
  disabled = false,
  files = [],
}: {
  initial?: LibraryDraft;
  onSave: (value: LibraryDraft) => Promise<unknown>;
  disabled?: boolean;
  files?: { id: string; fileName: string }[];
}) {
  const { t } = useTranslation(),
    colors = useColors(),
    [draft, setDraft] = useState<LibraryDraft>(initial ?? seed),
    [error, setError] = useState("");
  const card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 12,
      padding: 12,
      gap: 10,
    },
    field = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      padding: 10,
      color: colors.text,
    },
    label = { color: colors.text };
  const patch = (value: Partial<LibraryDraft>) =>
    setDraft({ ...draft, ...value });
  const input = (
    key: string,
    value: string,
    change: (value: string) => void,
    multiline = false,
  ) => (
    <TextInput
      accessibilityLabel={t(key)}
      placeholder={t(key)}
      editable={!disabled}
      value={value}
      onChangeText={change}
      multiline={multiline}
      style={field}
    />
  );
  const training = (value: Partial<TrainingDefinition>) =>
    patch({ training: { ...(draft.training ?? trainingSeed), ...value } });
  const updateField = (index: number, value: Partial<LibraryField>) =>
    patch({
      fields: draft.fields.map((f, i) =>
        i === index ? { ...f, ...value } : f,
      ),
    });
  const save = async () => {
    const result = LibraryDraftSchema.safeParse(draft);
    if (!result.success) {
      setError(
        result.error.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("\n"),
      );
      return;
    }
    try {
      await onSave(result.data);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("workHubLibrary.unavailable"),
      );
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["policy", "form", "poll", "training"] as const).map((kind) => (
          <TogglePillButton
            key={kind}
            color="brand"
            solid={draft.kind === kind}
            disabled={disabled}
            onPress={() =>
              patch({
                kind,
                training:
                  kind === "training"
                    ? (draft.training ?? trainingSeed)
                    : draft.training,
                poll:
                  kind === "poll"
                    ? (draft.poll ?? {
                        choices: [
                          { id: "a", label: "" },
                          { id: "b", label: "" },
                        ],
                        maxSelections: 1,
                        anonymous: false,
                        allowChanges: false,
                        resultsTiming: "at_close",
                        durationHours: 24,
                      })
                    : draft.poll,
              })
            }
          >
            {t(`workHubLibrary.kind_${kind}`)}
          </TogglePillButton>
        ))}
      </View>
      {input("workHubLibrary.title", draft.title, (v) => patch({ title: v }))}
      {input(
        "workHubLibrary.description",
        draft.description,
        (v) => patch({ description: v }),
        true,
      )}
      <Text style={label}>{t("workHubLibrary.deadlineHours")}</Text>
      {input("workHubLibrary.deadlineHours", String(draft.dueHours), (v) =>
        patch({ dueHours: Number(v) }),
      )}
      {input("workHubLibrary.timezone", draft.timezone, (v) =>
        patch({ timezone: v }),
      )}
      {draft.kind === "policy" &&
        input(
          "workHubLibrary.policyText",
          draft.policyText,
          (v) => patch({ policyText: v }),
          true,
        )}
      {draft.kind === "policy" && (
        <View style={{ gap: 8 }}>
          <Text style={label}>{t("workHubLibrary.policyAttachment")}</Text>
          {files.map((file) => (
            <TogglePillButton
              key={file.id}
              color="brand"
              disabled={disabled}
              solid={draft.policyAttachmentId === file.id}
              onPress={() =>
                patch({
                  policyAttachmentId:
                    draft.policyAttachmentId === file.id ? null : file.id,
                })
              }
            >
              {file.fileName}
            </TogglePillButton>
          ))}
        </View>
      )}
      {draft.kind === "form" && (
        <>
          {draft.fields.map((f, index) => (
            <View key={f.id} style={card}>
              {input("workHubLibrary.fieldLabel", f.label, (v) =>
                updateField(index, { label: v }),
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(
                  [
                    "text",
                    "textarea",
                    "number",
                    "date",
                    "checkbox",
                    "choice",
                  ] as const
                ).map((type) => (
                  <TogglePillButton
                    key={type}
                    color="brand"
                    disabled={disabled}
                    solid={f.type === type}
                    onPress={() => updateField(index, { type })}
                  >
                    {t(`workHubLibrary.field_${type}`)}
                  </TogglePillButton>
                ))}
              </View>
              <TogglePillButton
                color="brand"
                disabled={disabled}
                solid={f.required}
                onPress={() => updateField(index, { required: !f.required })}
              >
                {t("workHubLibrary.requiredField")}
              </TogglePillButton>
              {f.type === "choice" && (
                <>
                  {f.options.map((o, oi) =>
                    input("workHubLibrary.answerOption", o.label, (v) =>
                      updateField(index, {
                        options: f.options.map((x, i) =>
                          i === oi ? { ...x, label: v } : x,
                        ),
                      }),
                    ),
                  )}
                  <TogglePillButton
                    color="brand"
                    disabled={disabled}
                    onPress={() =>
                      updateField(index, {
                        options: [
                          ...f.options,
                          { id: crypto.randomUUID(), label: "" },
                        ],
                      })
                    }
                  >
                    {t("workHubLibrary.addOption")}
                  </TogglePillButton>
                </>
              )}
              <TogglePillButton
                color="red"
                disabled={disabled}
                onPress={() =>
                  patch({ fields: draft.fields.filter((_, i) => i !== index) })
                }
              >
                {t("workHubLibrary.removeField")}
              </TogglePillButton>
            </View>
          ))}
          <TogglePillButton
            color="brand"
            disabled={disabled}
            onPress={() =>
              patch({
                fields: [
                  ...draft.fields,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    type: "text",
                    required: false,
                    options: [],
                  },
                ],
              })
            }
          >
            {t("workHubLibrary.addField")}
          </TogglePillButton>
        </>
      )}
      {draft.kind === "training" && draft.training && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["checkoff", "quiz", "both"] as const).map((mode) => (
              <TogglePillButton
                key={mode}
                color="brand"
                disabled={disabled}
                solid={draft.training!.completionMode === mode}
                onPress={() => training({ completionMode: mode })}
              >
                {t(`workHubLibrary.mode_${mode}`)}
              </TogglePillButton>
            ))}
          </View>
          {draft.training.lessons.map((lesson, index) => (
            <View key={lesson.id} style={card}>
              {input("workHubLibrary.lessonTitle", lesson.title, (v) =>
                training({
                  lessons: draft.training!.lessons.map((l, i) =>
                    i === index ? { ...l, title: v } : l,
                  ),
                }),
              )}
              {input(
                "workHubLibrary.lessonBody",
                lesson.body,
                (v) =>
                  training({
                    lessons: draft.training!.lessons.map((l, i) =>
                      i === index ? { ...l, body: v } : l,
                    ),
                  }),
                true,
              )}
              {input(
                "workHubLibrary.resourceLinks",
                lesson.links.join("\n"),
                (v) =>
                  training({
                    lessons: draft.training!.lessons.map((l, i) =>
                      i === index
                        ? { ...l, links: v.split("\n").filter(Boolean) }
                        : l,
                    ),
                  }),
                true,
              )}
              <Text style={label}>{t("workHubLibrary.lessonAttachments")}</Text>
              {files.map((file) => (
                <TogglePillButton
                  key={file.id}
                  color="brand"
                  disabled={disabled}
                  solid={lesson.fileIds.includes(file.id)}
                  onPress={() =>
                    training({
                      lessons: draft.training!.lessons.map((l, i) =>
                        i === index
                          ? {
                              ...l,
                              fileIds: l.fileIds.includes(file.id)
                                ? l.fileIds.filter((id) => id !== file.id)
                                : [...l.fileIds, file.id],
                            }
                          : l,
                      ),
                    })
                  }
                >
                  {file.fileName}
                </TogglePillButton>
              ))}
              <TogglePillButton
                color="red"
                disabled={disabled}
                onPress={() =>
                  training({
                    lessons: draft.training!.lessons.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              >
                {t("workHubLibrary.removeLesson")}
              </TogglePillButton>
            </View>
          ))}
          <TogglePillButton
            color="brand"
            disabled={disabled}
            onPress={() =>
              training({
                lessons: [
                  ...draft.training!.lessons,
                  {
                    id: crypto.randomUUID(),
                    title: "",
                    body: "",
                    links: [],
                    fileIds: [],
                  },
                ],
              })
            }
          >
            {t("workHubLibrary.addLesson")}
          </TogglePillButton>
          {draft.training.questions.map((q, index) => {
            const update = (value: Partial<typeof q>) =>
              training({
                questions: draft.training!.questions.map((x, i) =>
                  i === index ? { ...x, ...value } : x,
                ),
              });
            return (
              <View key={q.id} style={card}>
                {input(
                  "workHubLibrary.question",
                  q.prompt,
                  (v) => update({ prompt: v }),
                  true,
                )}
                <TogglePillButton
                  color="brand"
                  disabled={disabled}
                  solid={q.multiple}
                  onPress={() =>
                    update({ multiple: !q.multiple, correctOptionIds: [] })
                  }
                >
                  {t("workHubLibrary.multipleAnswers")}
                </TogglePillButton>
                <Text style={label}>
                  {t("workHubLibrary.privateAnswerKey")}
                </Text>
                {q.options.map((o, oi) => (
                  <View key={o.id} style={{ gap: 6 }}>
                    {input("workHubLibrary.answerOption", o.label, (v) =>
                      update({
                        options: q.options.map((x, i) =>
                          i === oi ? { ...x, label: v } : x,
                        ),
                      }),
                    )}
                    <TogglePillButton
                      color="brand"
                      disabled={disabled}
                      solid={q.correctOptionIds.includes(o.id)}
                      onPress={() =>
                        update({
                          correctOptionIds: q.multiple
                            ? q.correctOptionIds.includes(o.id)
                              ? q.correctOptionIds.filter((x) => x !== o.id)
                              : [...q.correctOptionIds, o.id]
                            : [o.id],
                        })
                      }
                    >
                      {t("workHubLibrary.correctAnswer")}
                    </TogglePillButton>
                  </View>
                ))}
                <TogglePillButton
                  color="brand"
                  disabled={disabled}
                  onPress={() =>
                    update({
                      options: [
                        ...q.options,
                        { id: crypto.randomUUID(), label: "" },
                      ],
                    })
                  }
                >
                  {t("workHubLibrary.addOption")}
                </TogglePillButton>
                <TogglePillButton
                  color="red"
                  disabled={disabled}
                  onPress={() =>
                    training({
                      questions: draft.training!.questions.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  {t("workHubLibrary.removeQuestion")}
                </TogglePillButton>
              </View>
            );
          })}
          <TogglePillButton
            color="brand"
            disabled={disabled}
            onPress={() =>
              training({
                questions: [
                  ...draft.training!.questions,
                  {
                    id: crypto.randomUUID(),
                    prompt: "",
                    options: [
                      { id: crypto.randomUUID(), label: "" },
                      { id: crypto.randomUUID(), label: "" },
                    ],
                    multiple: false,
                    correctOptionIds: [],
                  },
                ],
              })
            }
          >
            {t("workHubLibrary.addQuestion")}
          </TogglePillButton>
          {input(
            "workHubLibrary.passingScore",
            String(draft.training.passingPercent),
            (v) => training({ passingPercent: Number(v) }),
          )}
          <TogglePillButton
            color="brand"
            disabled={disabled}
            solid={draft.training.allowRetries}
            onPress={() =>
              training({ allowRetries: !draft.training!.allowRetries })
            }
          >
            {t("workHubLibrary.allowRetries")}
          </TogglePillButton>
          {input(
            "workHubLibrary.maximumAttempts",
            String(draft.training.maximumAttempts),
            (v) => training({ maximumAttempts: Number(v) }),
          )}
          {input(
            "workHubLibrary.refresherDays",
            draft.training.refresherDays === null
              ? ""
              : String(draft.training.refresherDays),
            (v) => training({ refresherDays: v ? Number(v) : null }),
          )}
        </>
      )}
      {draft.kind === "poll" && draft.poll && (
        <>
          {draft.poll.choices.map((o, oi) =>
            input("workHubLibrary.answerOption", o.label, (v) =>
              patch({
                poll: {
                  ...draft.poll!,
                  choices: draft.poll!.choices.map((x, i) =>
                    i === oi ? { ...x, label: v } : x,
                  ),
                },
              }),
            ),
          )}
          <TogglePillButton
            color="brand"
            disabled={disabled}
            onPress={() =>
              patch({
                poll: {
                  ...draft.poll!,
                  choices: [
                    ...draft.poll!.choices,
                    { id: crypto.randomUUID(), label: "" },
                  ],
                },
              })
            }
          >
            {t("workHubLibrary.addOption")}
          </TogglePillButton>
          {input(
            "workHubLibrary.pollHours",
            String(draft.poll.durationHours),
            (v) =>
              patch({ poll: { ...draft.poll!, durationHours: Number(v) } }),
          )}
          {input(
            "workHubLibrary.maxSelections",
            String(draft.poll.maxSelections),
            (v) =>
              patch({ poll: { ...draft.poll!, maxSelections: Number(v) } }),
          )}
          <TogglePillButton
            color="brand"
            disabled={disabled}
            solid={draft.poll.anonymous}
            onPress={() =>
              patch({
                poll: { ...draft.poll!, anonymous: !draft.poll!.anonymous },
              })
            }
          >
            {t("workHubLibrary.anonymous")}
          </TogglePillButton>
          <TogglePillButton
            color="brand"
            disabled={disabled}
            solid={draft.poll.allowChanges}
            onPress={() =>
              patch({
                poll: {
                  ...draft.poll!,
                  allowChanges: !draft.poll!.allowChanges,
                },
              })
            }
          >
            {t("workHubLibrary.allowChanges")}
          </TogglePillButton>
          <TogglePillButton
            color="brand"
            disabled={disabled}
            solid={draft.poll.resultsTiming === "live"}
            onPress={() =>
              patch({
                poll: {
                  ...draft.poll!,
                  resultsTiming:
                    draft.poll!.resultsTiming === "live" ? "at_close" : "live",
                },
              })
            }
          >
            {t("workHubLibrary.liveResults")}
          </TogglePillButton>
        </>
      )}
      <DeliveryEditor value={draft.delivery} onChange={delivery=>patch({delivery})} disabled={disabled}/>
      {!!error && (
        <Text accessibilityLiveRegion="polite" style={label}>
          {error}
        </Text>
      )}
      <TogglePillButton
        color="brand"
        disabled={disabled}
        onPress={() => void save()}
      >
        {t("workHubLibrary.saveDraft")}
      </TogglePillButton>
    </View>
  );
}
