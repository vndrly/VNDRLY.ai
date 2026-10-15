import React, { useState } from "react";
import {
  Paragraph as Text,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
} from "./editor-controls";
import { useLocation } from "wouter";
import { z } from "zod/v4";
import {
  LibraryMetadataSchema,
  LibraryDraftSchema,
  AssignedLibraryReadSchema,
  BundleDefinitionSchema,
} from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useLibrary as useFormCampaigns } from "./use-library";
import LibraryEditor from "./library-editor";
import AssignmentReview from "./assignment-review";
const schema = z.object({
  itemId: z.uuid(),
  title: z.string(),
  metadata: LibraryMetadataSchema.extend({
    content: z.union([LibraryDraftSchema, AssignedLibraryReadSchema.shape.metadata.shape.content]).nullable(),
  }),
  bundle: BundleDefinitionSchema.nullable(),
  canManage: z.boolean(),
  history: z.array(
    z.object({
      itemId: z.uuid(),
      title: z.string(),
      contentVersion: z.number(),
    }),
  ),
});
export default function LibraryDetail({ itemId }: { itemId: string }) {
  const [, navigate] = useLocation();
  const router = { push: (path: string) => navigate(path) };
  const { t } = useTranslation(),
    colors = useColors(),
    api = useFormCampaigns(`/api/work-hub/library/${itemId}`, (v) =>
      schema.parse(v),
    );
  const [edit, setEdit] = useState(false),
    [assign, setAssign] = useState(false),
    [notice, setNotice] = useState(""),
    [reviewAction, setReviewAction] = useState<"publish" | "archive" | null>(
      null,
    );
  const filesApi = useFormCampaigns("/api/work-hub/library/options", (value) =>
    z
      .object({
        files: z.array(z.object({ id: z.uuid(), fileName: z.string() })),
      })
      .parse(value),
  );
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
  const data = api.data,
    m = data.metadata;
  const action = async (name: "publish" | "archive" | "revise") => {
    try {
      const result = await api.send(
        `/api/work-hub/library/${itemId}/${name}`,
        {},
        m.version,
      );
      setReviewAction(null);
      if (name === "revise")
        router.push(
          `/work-hub/library/${z.uuid().parse(result.resource.itemId)}` as never,
        );
      else setNotice(t("workHubLibrary.responseSaved"));
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
          {t(`workHubLibrary.state_${m.state}`)} · {t("workHubLibrary.version")}{" "}
          {m.contentVersion}
        </Text>
        {!!m.content?.description && (
          <Text style={label}>{m.content.description}</Text>
        )}
        {data.canManage && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {m.state === "draft" && (
              <TogglePillButton
                color="brand"
                disabled={api.busy || api.uncertain}
                onPress={() => setEdit(!edit)}
              >
                {t("workHubLibrary.editDraft")}
              </TogglePillButton>
            )}
            {m.state !== "draft" && (
              <TogglePillButton
                color="brand"
                disabled={api.busy || api.uncertain}
                onPress={() => void action("revise")}
              >
                {t("workHubLibrary.revise")}
              </TogglePillButton>
            )}
            {m.state === "draft" && (
              <TogglePillButton
                color="brand"
                disabled={api.busy || api.uncertain}
                onPress={() => setReviewAction("publish")}
              >
                {t("workHubLibrary.publish")}
              </TogglePillButton>
            )}
            {m.state !== "archived" && (
              <TogglePillButton
                color="brand"
                disabled={api.busy || api.uncertain}
                onPress={() => setReviewAction("archive")}
              >
                {t("workHubLibrary.archive")}
              </TogglePillButton>
            )}
            {m.state === "published" &&
              ["form", "policy", "training", "poll"].includes(m.kind) && (
                <TogglePillButton
                  color="brand"
                  disabled={api.busy || api.uncertain}
                  onPress={() => setAssign(!assign)}
                >
                  {t("workHubLibrary.assignments")}
                </TogglePillButton>
              )}
          </View>
        )}
        {reviewAction && (
          <View style={card}>
            <Text style={label}>
              {t(
                reviewAction === "publish"
                  ? "workHubLibrary.publishReview"
                  : "workHubLibrary.archiveReview",
              )}
            </Text>
            <Text style={label}>
              {data.title} · {t("workHubLibrary.version")} {m.contentVersion}
            </Text>
            <TogglePillButton
              color="brand"
              disabled={api.busy}
              onPress={() => void action(reviewAction)}
            >
              {t(
                reviewAction === "publish"
                  ? "workHubLibrary.publish"
                  : "workHubLibrary.archive",
              )}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              disabled={api.busy}
              onPress={() => setReviewAction(null)}
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
                .then((result) => {
                  setReviewAction(null);
                  if (
                    result.resource.itemId &&
                    result.resource.itemId !== itemId
                  )
                    router.push(
                      `/work-hub/library/${z.uuid().parse(result.resource.itemId)}` as never,
                    );
                })
                .catch((e) => setNotice(e.message))
            }
          >
            {t("workHubLibrary.retry")}
          </TogglePillButton>
        )}
      </View>
      {edit && m.content && data.canManage && m.state === "draft" && (
        <View style={card}>
          <LibraryEditor
            files={filesApi.data?.files}
            key={`${itemId}:${m.version}`}
            initial={LibraryDraftSchema.parse(m.content)}
            disabled={api.busy || api.uncertain}
            onSave={async (draft) => {
              await api.send(
                `/api/work-hub/library/${itemId}`,
                draft,
                m.version,
                "PATCH",
              );
              setEdit(false);
            }}
          />
        </View>
      )}
      {!edit && m.content && (
        <View style={card}>
          {m.kind === "policy" && (
            <Text style={label}>{m.content.policyText}</Text>
          )}
          {m.content.fields.map((field) => (
            <Text key={field.id} style={label}>
              {field.label}
              {field.required ? " *" : ""} ·{" "}
              {t(`workHubLibrary.field_${field.type}`)}
            </Text>
          ))}
          {m.content.training?.lessons.map((lesson) => (
            <View key={lesson.id} style={{ gap: 8 }}>
              <Text style={{ ...label, fontWeight: "700" }}>
                {lesson.title}
              </Text>
              <Text style={label}>{lesson.body}</Text>
            </View>
          ))}
          {m.content.training?.questions.map((q) => (
            <View key={q.id} style={{ gap: 8 }}>
              <Text style={{ ...label, fontWeight: "700" }}>{q.prompt}</Text>
              {q.options.map((o) => (
                <Text key={o.id} style={label}>
                  {o.label}
                  {data.canManage && "correctOptionIds" in q && q.correctOptionIds.includes(o.id)
                    ? ` · ${t("workHubLibrary.correctAnswer")}`
                    : ""}
                </Text>
              ))}
            </View>
          ))}
          {m.content.poll?.choices.map((o) => (
            <Text key={o.id} style={label}>
              {o.label}
            </Text>
          ))}
        </View>
      )}
      {assign && ["policy", "form", "training", "poll"].includes(m.kind) && (
        <View style={card}>
          <AssignmentReview
            initialItemId={itemId}
            kind={m.kind as "policy" | "form" | "training" | "poll"}
            onSaved={async () => {
              setAssign(false);
            }}
          />
        </View>
      )}
      <View style={card}>
        <Text style={{ ...label, fontWeight: "700" }}>
          {t("workHubLibrary.versionHistory")}
        </Text>
        {data.history.map((h) => (
          <TogglePillButton
            key={h.itemId}
            color="brand"
            onPress={() =>
              router.push(`/work-hub/library/${h.itemId}` as never)
            }
          >
            {h.title} · {h.contentVersion}
          </TogglePillButton>
        ))}
      </View>
    </View>
  );
}
