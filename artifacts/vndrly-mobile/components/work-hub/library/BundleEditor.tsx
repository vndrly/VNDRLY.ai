import DeliveryEditor from "./DeliveryEditor";
import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { z } from "zod/v4";
import {
  BundleDefinitionSchema,
  type BundleDefinition,
} from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../../TogglePillButton";
import OptionSwitch from "./OptionSwitch";
const schema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      title: z.string(),
      kind: z.string(),
      state: z.string(),
      contentVersion: z.number(),
    }),
  ),
});
const empty: BundleDefinition = {
  description: "",
  delivery:{reminderHours:null,briefing:{enabled:false,hour:8,minute:0,push:false},escalationHours:null},
  entries: [],
  onboarding: {
    enabled: false,
    activatedAt: null,
    nextScanAt: null,
    ownerUserId: null,
    roles: [],
    groupIds: [],
  },
};
export default function BundleEditor({
  initial,
  title: initialTitle = "",
  onSave,
  disabled = false,
}: {
  initial?: BundleDefinition;
  title?: string;
  onSave: (value: {
    title: string;
    bundle: BundleDefinition;
  }) => Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useTranslation(),
    colors = useColors(),
    api = useFormCampaigns("/api/work-hub/library?published=true", (v) => schema.parse(v)),
    [title, setTitle] = useState(initialTitle),
    [bundle, setBundle] = useState<BundleDefinition>(initial ?? empty),
    [notice, setNotice] = useState("");
  const field = {
      color: colors.text,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      padding: 12,
    },
    label = { color: colors.text },
    card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 12,
      padding: 12,
      gap: 10,
    };
  const entry = (
    index: number,
    value: Partial<BundleDefinition["entries"][number]>,
  ) =>
    setBundle({
      ...bundle,
      entries: bundle.entries.map((x, i) =>
        i === index ? { ...x, ...value } : x,
      ),
    });
  const save = async () => {
    try {
      if (!title.trim()) throw Error(t("workHubLibrary.titleRequired"));
      await onSave({
        title: title.trim(),
        bundle: BundleDefinitionSchema.parse(bundle),
      });
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : t("workHubLibrary.unavailable"),
      );
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <TextInput
        accessibilityLabel={t("workHubLibrary.title")}
        placeholder={t("workHubLibrary.title")}
        value={title}
        editable={!disabled}
        onChangeText={setTitle}
        style={field}
      />
      <TextInput
        accessibilityLabel={t("workHubLibrary.description")}
        placeholder={t("workHubLibrary.description")}
        value={bundle.description}
        editable={!disabled}
        onChangeText={(description) => setBundle({ ...bundle, description })}
        multiline
        style={field}
      />
      <Text style={label}>{t("workHubLibrary.choosePublished")}</Text>
      {api.data?.items
        .filter((i) => i.state === "published" && i.kind !== "bundle")
        .map((item) => (
          <TogglePillButton
            key={item.itemId}
            color="brand"
            disabled={disabled}
            solid={bundle.entries.some((e) => e.templateId === item.itemId)}
            onPress={() =>
              setBundle({
                ...bundle,
                entries: bundle.entries.some(
                  (e) => e.templateId === item.itemId,
                )
                  ? bundle.entries.filter((e) => e.templateId !== item.itemId)
                  : [
                      ...bundle.entries,
                      {
                        templateId: item.itemId,
                        contentVersion: item.contentVersion,
                        dueHours: 720,
                        presentation: "first_entry",
                        requiredBeforeWork: false,
                      },
                    ],
              })
            }
          >
            {item.title} · {t("workHubLibrary.version")} {item.contentVersion}
          </TogglePillButton>
        ))}
      {bundle.entries.map((e, index) => (
        <View key={e.templateId} style={card}>
          <Text style={{ ...label, fontWeight: "700" }}>
            {api.data?.items.find((i) => i.itemId === e.templateId)?.title ??
              e.templateId}{" "}
            · {t("workHubLibrary.version")} {e.contentVersion}
          </Text>
          <TextInput
            accessibilityLabel={t("workHubLibrary.deadlineHours")}
            value={String(e.dueHours)}
            editable={!disabled}
            onChangeText={(value) => entry(index, { dueHours: Number(value) })}
            keyboardType="numeric"
            style={field}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["first_entry", "next_login", "immediate"] as const).map((p) => (
              <TogglePillButton
                key={p}
                color="brand"
                disabled={disabled}
                solid={e.presentation === p}
                onPress={() => entry(index, { presentation: p })}
              >
                {t(`workHubLibrary.presentation_${p}`)}
              </TogglePillButton>
            ))}
          </View>
          <OptionSwitch
            label={t("workHubLibrary.required")}
            disabled={disabled}
            value={e.requiredBeforeWork}
            onChange={(v) => entry(index, { requiredBeforeWork: v })}
          />
        </View>
      ))}
      <DeliveryEditor value={bundle.delivery} onChange={delivery=>setBundle({...bundle,delivery})} disabled={disabled}/>
      {!!(notice || api.error) && (
        <Text style={label}>{notice || api.error}</Text>
      )}
      <TogglePillButton
        color="brand"
        disabled={disabled || api.loading || !!api.error}
        onPress={() => void save()}
      >
        {t("workHubLibrary.saveDraft")}
      </TogglePillButton>
    </View>
  );
}
