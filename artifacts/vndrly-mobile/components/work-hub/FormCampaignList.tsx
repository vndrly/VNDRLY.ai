import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod/v4";
import { FormCampaignSummarySchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../TogglePillButton";
import FormCampaignEditor from "./FormCampaignEditor";
export default function FormCampaignList({completed}:{completed?:boolean}) {
  const { t } = useTranslation();

  const colors = useColors(),
    { user } = useAuth(),
    api = useFormCampaigns("/api/work-hub/form-campaigns", (value) =>
      z.object({ campaigns: z.array(FormCampaignSummarySchema) }).parse(value),
    ),
    [create, setCreate] = useState(false);
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
  return (
    <View style={{ gap: 12 }}>
      {admin && completed === undefined && (
        <TogglePillButton color="brand" onPress={() => setCreate(true)}>
          {t("formCampaignLabels.c058")}
        </TogglePillButton>
      )}
      {api.data?.campaigns.filter(c=>completed === undefined || (!!c.instanceId && c.completed === completed)).map((c) => (
        <View style={card} key={c.campaignId}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>
            {c.title}
          </Text>
          <Text style={{ color: colors.text }}>
            {c.kind} · {c.state.status}
            {c.state.deadline
              ? ` · ${new Date(c.state.deadline).toLocaleString()}`
              : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {c.instanceId && (
              <TogglePillButton
                color="brand"
                onPress={() =>
                  router.push(`/work-hub/form/${c.instanceId}` as never)
                }
              >
                {t("formCampaignLabels.c059")}
              </TogglePillButton>
            )}
            {c.canManage && (
              <TogglePillButton
                color="brand"
                onPress={() =>
                  router.push(`/work-hub/campaign/${c.campaignId}` as never)
                }
              >
                {t("formCampaignLabels.c060")}
              </TogglePillButton>
            )}
          </View>
        </View>
      ))}
      {!!api.error && (
        <Text style={{ color: colors.mutedForeground }}>
          {t("formCampaignLabels.c080")}
        </Text>
      )}
      <FormCampaignEditor
        visible={create}
        onClose={() => setCreate(false)}
        onSaved={(id) => {
          void api.reload();
          router.push(`/work-hub/campaign/${id}` as never);
        }}
      />
    </View>
  );
}
