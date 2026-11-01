import React, { useState } from "react";
import {useAuth} from "@/hooks/use-auth";
import {
  Paragraph as Text,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
  Heading,
} from "./editor-controls";
import { useLocation, useSearch } from "wouter";
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
import { LibraryBody } from "./library-body";
import TrainingPolicy from './training-policy';
import {TrainingActions,type TrainingView} from './training-actions';
import TrainingCourseReview from './training-course-review';
import TrainingCourseAssign from './training-course-assign';
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
  const {user}=useAuth();
  const [, navigate] = useLocation();
  const search=useSearch(),requested=new URLSearchParams(search).get('view');
  const trainingView:TrainingView=['policy','review','assign'].includes(requested??'')?requested as TrainingView:'training';
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
  const guided=m.content?.training?.guided;
  const explanations:Record<string,string>=guided&&'explanations' in guided?guided.explanations:{};
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
        <Heading>
          {data.title}
        </Heading>
        <Text style={label}>
          {t(`workHubLibrary.state_${m.state}`)} · {t("workHubLibrary.version")}{" "}
          {m.contentVersion}
        </Text>
        {!!(m.trainingPolicy?.description??m.content?.description) && (
          <Text style={label}>{m.trainingPolicy?.description??m.content?.description}</Text>
        )}
        {m.kind==='training'&&<TrainingActions itemId={itemId} selected={trainingView} canManage={data.canManage}/>}
        {data.canManage && m.kind!=='training' && (
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
      {data.canManage&&m.safetyResource&&(m.kind==='policy'||(m.kind==='training'&&trainingView==='policy'))&&<TrainingPolicy itemId={itemId} onSaved={api.reload}/>}
      {data.canManage&&m.kind==='training'&&trainingView==='review'&&<TrainingCourseReview itemId={itemId}/>}
      {data.canManage&&m.kind==='training'&&trainingView==='assign'&&<TrainingCourseAssign itemId={itemId} onSaved={async()=>{navigate(`/work-hub/library/${itemId}?view=review`);}}/>}
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
      {!edit && m.content && (m.kind!=='training'||trainingView==='training'||!data.canManage) && (
        <View style={card}>
            {(m.kind === "policy" || m.kind === "form") && (
            <LibraryBody text={m.content.policyText} color={colors.text} />
          )}
          {m.content.fields.map((field) => (
            <Text key={field.id} style={label}>
              {field.label}
              {field.required ? " *" : ""} ·{" "}
              {t(`workHubLibrary.field_${field.type}`)}
            </Text>
          ))}
          {m.content.training?.lessons.map((lesson) => (
            <View key={lesson.id} style={{ gap: 8, borderWidth: 2, borderColor: colors.primary, borderRadius: 12, padding: 12, minWidth: 0, maxWidth: "100%" }}>
              <Text style={{ ...label, fontWeight: "700" }}>
                {lesson.title}
              </Text>
              <LibraryBody text={lesson.body} color={colors.text} />
            </View>
          ))}
          {user?.role==="admin"&&!!m.content.training?.questions.length&&<section aria-label="Question bank" data-library-card="" className="space-y-3 rounded-xl border-2 border-[var(--brand-primary)] p-3">
          <h3 className="font-bold">Question bank</h3>
          {m.content.training?.questions.map((q, questionIndex) => (
            <View key={q.id} style={{ gap: 8 }}>
              <Text style={{ ...label, fontWeight: "700" }}>{questionIndex + 1}. {q.prompt}</Text>
              {q.options.map((o, answerIndex) => (
                <Text key={o.id} style={{ ...label, ...(data.canManage && "correctOptionIds" in q ? (q.correctOptionIds.includes(o.id) ? { color: colors.primary, fontWeight: "700" } : { color: "#a3a3a3" }) : {}) }}>
                  {String.fromCharCode(97 + answerIndex)}. {o.label}
                  {data.canManage && "correctOptionIds" in q && q.correctOptionIds.includes(o.id)
                    ? ` · ${t("workHubLibrary.correctAnswer")}`
                    : ""}
                </Text>
              ))}
              {data.canManage&&explanations[q.id]&&<LibraryBody text={explanations[q.id]} color={colors.text}/>}
            </View>
          ))}
          </section>}
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
      {m.kind!=='training'&&<View style={card}>
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
      </View>}
    </View>
  );
}
