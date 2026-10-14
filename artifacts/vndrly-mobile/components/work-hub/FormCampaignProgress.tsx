import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import { Text, View, Share } from "react-native";
import {
  FormCampaignProgressSchema,
  GeneralCampaignFieldSchema,
} from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../TogglePillButton";
import FormCampaignEditor from "./FormCampaignEditor";
export default function FormCampaignProgress({
  campaignId,
}: {
  campaignId: string;
}) {
  const { t } = useTranslation();

  const colors = useColors(),
    api = useFormCampaigns(
      `/api/work-hub/form-campaigns/${campaignId}`,
      (value) => FormCampaignProgressSchema.parse(value),
    );
  const [editing, setEditing] = useState(false),
    [reviewPublish, setReviewPublish] = useState(false),
    [notice, setNotice] = useState("");
  const card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      gap: 12,
      backgroundColor: colors.card,
    },
    label = { color: colors.text };
  if (!api.data)
    return (
      <View style={card}>
        <Text style={label}>{api.error || t("formCampaignLabels.e031")}</Text>
        <TogglePillButton color="brand" onPress={() => void api.reload()}>
          {t("formCampaignLabels.c081")}
        </TogglePillButton>
      </View>
    );
  const d = api.data,
    c = d.config,
    s = d.state;
  const command = async (action: string) => {
    try {
      const result = await api.send(
        `/api/work-hub/form-campaigns/${campaignId}/${action}`,
        {},
        s.version,
      );
      setReviewPublish(false);
      setNotice(
        action === "publish"
          ? `Published to ${String(result.resource.audienceCount)} employees. Notifications queued.`
          : t("formCampaignLabels.e032"),
      );
    } catch {}
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={card}>
        <Text style={{ ...label, fontSize: 20, fontWeight: "700" }}>
          {c.title}
        </Text>
        <Text style={label}>
          {s.status} · {c.kind}
          {t("formCampaignLabels.c039")}
          {s.version}
        </Text>
        {s.deadline && (
          <Text style={label}>
            {t("formCampaignLabels.c082")}
            {new Date(s.deadline).toLocaleString()} · {c.timezone}
          </Text>
        )}
        <TogglePillButton
          color="brand"
          onPress={() =>
            void Share.share({
              message: `${c.title}: ${d.counts.responded}/${d.counts.eligible} responded; ${d.counts.pending} outstanding; ${d.counts.overdue} overdue; ${d.counts.excluded} excluded. https://vndrly.ai/work-hub/campaign/${campaignId}`,
            })
          }
        >
          {t("formCampaignLabels.c083")}
        </TogglePillButton>
        <Text style={label}>
          {d.counts.responded} / {d.counts.eligible}
          {t("formCampaignLabels.c043")} {d.counts.pending}
          {t("formCampaignLabels.c044")}
          {d.counts.overdue}
          {t("formCampaignLabels.c045")} {d.counts.excluded}
          {t("formCampaignLabels.c046")}
        </Text>
        {s.status === "draft" && (
          <>
            <TogglePillButton
              color="brand"
              disabled={api.busy || api.uncertain}
              onPress={() => setEditing(true)}
            >
              {t("formCampaignLabels.c047")}
            </TogglePillButton>
            {c.kind === "acknowledgement" &&
              !c.policyText.trim() &&
              !c.policyAttachmentId && (
                <Text style={label}>{t("formCampaignLabels.c084")}</Text>
              )}
            <TogglePillButton
              color="brand"
              disabled={api.busy || api.uncertain}
              onPress={() => setReviewPublish(true)}
            >
              {t("formCampaignLabels.c048")}
            </TogglePillButton>
          </>
        )}
        {reviewPublish && (
          <View style={{ gap: 10 }}>
            {d.publicationPreview && (
              <Text style={label}>
                {t("formCampaignLabels.preview", {
                  count: d.publicationPreview.audienceCount,
                  date: new Date(
                    d.publicationPreview.estimatedDeadline,
                  ).toLocaleString(),
                  timezone: d.publicationPreview.timezone,
                })}
              </Text>
            )}
            <Text style={label}>
              {t("formCampaignLabels.c085")}
              {c.title}
              {t("formCampaignLabels.c086")}{" "}
              {c.audience.mode === "all_active"
                ? "all currently active company employees"
                : `${c.audience.userIds.length} selected employees`}
              {t("formCampaignLabels.c087")}{" "}
              {c.durationHours ?? (c.kind === "poll" ? 24 : 720)}
              {t("formCampaignLabels.c088")}
            </Text>
            <TogglePillButton
              color="brand"
              disabled={api.busy || api.uncertain}
              onPress={() => void command("publish")}
            >
              {t("formCampaignLabels.c051")}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              disabled={api.busy}
              onPress={() => setReviewPublish(false)}
            >
              {t("formCampaignLabels.c052")}
            </TogglePillButton>
          </View>
        )}
        {s.status === "published" && (
          <TogglePillButton
            color="brand"
            disabled={api.busy || api.uncertain}
            onPress={() => void command("pause")}
          >
            {t("formCampaignLabels.c089")}
          </TogglePillButton>
        )}
        {!!(notice || api.error) && (
          <Text accessibilityLiveRegion="polite" style={label}>
            {notice || api.error}
          </Text>
        )}
        {api.uncertain && (
          <TogglePillButton
            color="brand"
            disabled={api.busy}
            onPress={() =>
              void api
                .retryOriginal()
                .then(() => setNotice(t("formCampaignLabels.e033")))
                .catch(() => {})
            }
          >
            {t("formCampaignLabels.c000")}
          </TogglePillButton>
        )}
      </View>
      {d.totals && (
        <View style={card}>
          <Text style={{ ...label, fontWeight: "700" }}>
            {t("formCampaignLabels.c040")}
          </Text>
          {d.totals.map((choice) => (
            <Text key={choice.id} style={label}>
              {choice.label}: {choice.votes}
            </Text>
          ))}
        </View>
      )}
      {!c.anonymous && d.receipts && (
        <View style={card}>
          <Text style={{ ...label, fontWeight: "700" }}>
            {t("formCampaignLabels.c054")}
          </Text>
          {d.receipts.map((r) => (
            <View key={r.instanceId} style={{ gap: 4 }}>
              <Text style={label}>
                {r.name} ·{" "}
                {r.excluded
                  ? "Excluded"
                  : r.submittedAt
                    ? r.late
                      ? t("formCampaignLabels.e034")
                      : "Responded"
                    : "Outstanding"}
              </Text>
              {c.kind === "form" &&
                r.values &&
                Object.entries(r.values).map(([field, value]) => (
                  <Text key={field} style={label}>
                    {d.definition
                      .map((raw) => GeneralCampaignFieldSchema.parse(raw))
                      .find((f) => f.id === field)?.label ?? field}
                    : {String(value)}
                  </Text>
                ))}
              {r.email && <Text style={label}>{r.email}</Text>}
              {r.submittedAt && (
                <Text style={label}>
                  {new Date(r.submittedAt).toLocaleString()}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      {c.anonymous && <Text style={label}>{t("formCampaignLabels.c090")}</Text>}
      <View style={card}>
        <Text style={{ ...label, fontWeight: "700" }}>
          {t("formCampaignLabels.c056")}
        </Text>
        {d.briefings.length ? (
          d.briefings.map((b) => (
            <View key={b.id} style={{ gap: 4 }}>
              <Text style={label}>
                {new Date(b.createdAt).toLocaleString()}
              </Text>
              <Text style={label}>{b.body}</Text>
              <Text style={label}>
                {t("formCampaignLabels.c091")}
                {b.deliveryStatus}
              </Text>
            </View>
          ))
        ) : (
          <Text style={label}>{t("formCampaignLabels.c092")}</Text>
        )}
      </View>
      <FormCampaignEditor
        visible={editing}
        onClose={() => setEditing(false)}
        onSaved={() => void api.reload()}
        initial={c}
        campaignId={campaignId}
        version={s.version}
      />
    </View>
  );
}
