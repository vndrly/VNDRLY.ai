import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod/v4";
import { useQueryClient } from "@tanstack/react-query";
import { FormCampaignConfigSchema, FormCampaignProgressSchema, FormCampaignSummarySchema, type FormCampaignConfig } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
import ProfileMiniCardButton from "../ProfileMiniCardButton";
import FormCampaignEditor from "./FormCampaignEditor";
export type FormCampaignSummary = z.infer<typeof FormCampaignSummarySchema>;
export default function FormCampaignList({completed, kind, campaigns}:{completed?:boolean; kind?: "poll"; campaigns?: FormCampaignSummary[]}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const colors = useColors(),
    { user } = useAuth(),
    api = useFormCampaigns("/api/work-hub/form-campaigns", (value) =>
      z.object({ campaigns: z.array(FormCampaignSummarySchema) }).parse(value),
    ),
    [create, setCreate] = useState(false),
    [editing, setEditing] = useState<{config: FormCampaignConfig; id?: string; version?: number} | null>(null),
    [actionError, setActionError] = useState("");
  const openEditor = async (campaign: FormCampaignSummary, reuse: boolean) => {
    try {
      const detail = FormCampaignProgressSchema.parse(await apiFetch(`/api/work-hub/form-campaigns/${campaign.campaignId}`, undefined, captureAuthScope()));
      setEditing({ config: FormCampaignConfigSchema.parse(detail.config), id: reuse ? undefined : campaign.campaignId, version: reuse ? undefined : detail.state.version });
      setCreate(true);
      setActionError("");
    } catch (error) { setActionError(error instanceof Error ? error.message : "Could not open saved item"); }
  };
  const remove = async (campaign: FormCampaignSummary) => {
    try {
      setActionError("");
      await api.send(`/api/work-hub/form-campaigns/${campaign.campaignId}/archive`, {}, campaign.state.version);
      await api.reload();
      await queryClient.invalidateQueries({ queryKey: ["work-hub", "form-campaigns"] });
    } catch (error) { setActionError(error instanceof Error ? error.message : "Could not delete saved item"); }
  };
  const admin =
      user?.role === "admin" ||
      user?.availableMemberships?.some(
        (m) => m.id === user.activeMembershipId && m.role === "admin",
      ),
    card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      gap: 12,
      backgroundColor: colors.card,
    };
  const displayCampaigns = (campaigns ?? api.data?.campaigns ?? [])
    .filter(c => !kind || c.kind === kind)
    .filter(c => completed === undefined || (!!c.instanceId && c.completed === completed))
    .sort((a, b) => Number(b.state.status === "published") - Number(a.state.status === "published"));
  return (
    <View style={{ gap: 12 }}>
      {admin && completed === undefined && (
        <ProfileMiniCardButton borderColor={colors.primary} onPress={() => { setEditing(null); setCreate(true); }}>
          {t("formCampaignLabels.c058")}
        </ProfileMiniCardButton>
      )}
      {admin && completed === undefined && <Text style={{ color: colors.text, fontWeight: "700" }}>Saved polls and policies</Text>}
      {displayCampaigns.map((c, index) => (
        <React.Fragment key={c.campaignId}>
        {admin && completed === undefined && (index === 0 || (displayCampaigns[index - 1].state.status === "published") !== (c.state.status === "published")) && <Text style={{ color: colors.text, fontWeight: "700" }}>{c.state.status === "published" ? "Active" : "Inactive"}</Text>}
        <View style={card} key={c.campaignId}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {c.title}
          </Text>
          <Text style={{ color: colors.text }}>
            {c.kind === "acknowledgement" ? "Policy" : c.kind} · {c.state.status === "published" ? "Active" : "Inactive"}
            {c.state.deadline
              ? ` · ${new Date(c.state.deadline).toLocaleString()}`
              : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {c.instanceId && (
              <ProfileMiniCardButton
                inHeader
                borderColor={colors.primary}
                onPress={() =>
                  router.push(`/work-hub/form/${c.instanceId}` as never)
                }
              >
                {t("formCampaignLabels.c059")}
              </ProfileMiniCardButton>
            )}
            {c.canManage && (
              <ProfileMiniCardButton
                inHeader
                borderColor={colors.primary}
                onPress={() =>
                  router.push(`/work-hub/campaign/${c.campaignId}` as never)
                }
              >
                {t("formCampaignLabels.c060")}
              </ProfileMiniCardButton>
            )}
            {c.canManage && <ProfileMiniCardButton inHeader borderColor={colors.primary} onPress={() => void openEditor(c, true)}>Reuse</ProfileMiniCardButton>}
            {c.canManage && <ProfileMiniCardButton inHeader borderColor={colors.primary} onPress={() => void openEditor(c, c.state.status !== "draft")}>Customize</ProfileMiniCardButton>}
            {c.canManage && <ProfileMiniCardButton inHeader borderColor={colors.primary} onPress={() => void remove(c)}>Delete</ProfileMiniCardButton>}
          </View>
        </View>
        </React.Fragment>
      ))}
      {!!api.error && !campaigns && (
        <Text style={{ color: colors.mutedForeground }}>
          {t("formCampaignLabels.c080")}
        </Text>
      )}
      {!!actionError && <Text accessibilityRole="alert" style={{ color: colors.text }}>{actionError}</Text>}
      <FormCampaignEditor
        initialKind={kind}
        initial={editing?.config}
        campaignId={editing?.id}
        version={editing?.version}
        visible={create}
        onClose={() => { setCreate(false); setEditing(null); }}
        onSaved={() => {
          void api.reload();
          void queryClient.invalidateQueries({ queryKey: ["work-hub", "form-campaigns"] });
        }}
      />
    </View>
  );
}
