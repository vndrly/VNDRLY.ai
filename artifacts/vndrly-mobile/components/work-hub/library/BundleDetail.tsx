import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod/v4";
import {
  BundleDefinitionSchema,
  LibraryMetadataSchema,
} from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../../TogglePillButton";
import OptionSwitch from "./OptionSwitch";
import BundleEditor from "./BundleEditor";
import AssignmentReview from "./AssignmentReview";
const listSchema = z.object({
  items: z.array(z.object({ itemId: z.uuid(), title: z.string() })),
});
const detailSchema = z.object({
  itemId: z.uuid(),
  title: z.string(),
  metadata: LibraryMetadataSchema,
  bundle: BundleDefinitionSchema,
  canManage: z.boolean(),
  entries:z.array(z.object({itemId:z.uuid(),title:z.string(),contentVersion:z.number()})),
});
const optionsSchema = z.object({
  groups: z.array(z.object({ id: z.string(), name: z.string() })),
});
export default function BundleDetail({ itemId }: { itemId: string }) {
  const { t } = useTranslation(),
    colors = useColors(),
    isNew = itemId === "new",
    api = useFormCampaigns(
      isNew ? "/api/work-hub/bundles" : `/api/work-hub/bundles/${itemId}`,
      (v) =>
        isNew
          ? { new: true as const, list: listSchema.parse(v) }
          : { new: false as const, ...detailSchema.parse(v) },
    ),
    options = useFormCampaigns("/api/work-hub/library/options", (v) =>
      optionsSchema.parse(v),
    );
  const [edit, setEdit] = useState(isNew),
    [assign, setAssign] = useState(false),
    [enabled, setEnabled] = useState(false),
    [groups, setGroups] = useState<string[]>([]),
    [roles, setRoles] = useState<string[]>([]),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState<"publish" | "archive" | "onboarding" | null>(
      null,
    );
  const data = api.data && !api.data.new ? api.data : null;
  useEffect(() => {
    if (data) {
      setEnabled(data.bundle.onboarding.enabled);
      setGroups(data.bundle.onboarding.groupIds);
      setRoles(data.bundle.onboarding.roles);
    }
  }, [data?.metadata.version, itemId, api.contextKey]);
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
  const run = async (
    action: "publish" | "archive" | "revise" | "onboarding",
  ) => {
    if (!data) return;
    try {
      const result = await api.send(
        action === "onboarding"
          ? `/api/work-hub/bundles/${itemId}/onboarding-rule`
          : `/api/work-hub/library/${itemId}/${action}`,
        action === "onboarding" ? { enabled, roles, groupIds: groups } : {},
        data.metadata.version,
      );
      setReview(null);
      if (action === "revise")
        router.push(
          `/work-hub/bundle/${z.uuid().parse(result.resource.itemId)}` as never,
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
      {data && (
        <View style={card}>
          <Text style={{ ...label, fontWeight: "700", fontSize: 20 }}>
            {data.title}
          </Text>
          <Text style={label}>
            {t(`workHubLibrary.state_${data.metadata.state}`)} ·{" "}
            {t("workHubLibrary.version")} {data.metadata.contentVersion}
          </Text>
          <Text style={label}>{data.bundle.description}</Text>
          {data.bundle.entries.map((entry) => (
            <Text key={data.entries.find(x=>x.itemId===entry.templateId)?.title??t("workHubLibrary.savedContent")} style={label}>
              {data.entries.find(x=>x.itemId===entry.templateId)?.title??t("workHubLibrary.savedContent")} · {t("workHubLibrary.version")}{" "}
              {entry.contentVersion} · {entry.dueHours}{" "}
              {t("workHubLibrary.hours")}
            </Text>
          ))}
          {data.canManage && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {data.metadata.state === "draft" ? (
                <>
                  <TogglePillButton
                    color="brand"
                    disabled={api.busy || api.uncertain}
                    onPress={() => setEdit(!edit)}
                  >
                    {t("workHubLibrary.editDraft")}
                  </TogglePillButton>
                  <TogglePillButton
                    color="brand"
                    disabled={api.busy || api.uncertain}
                    onPress={() => setReview("publish")}
                  >
                    {t("workHubLibrary.publish")}
                  </TogglePillButton>
                </>
              ) : (
                <TogglePillButton
                  color="brand"
                  disabled={api.busy || api.uncertain}
                  onPress={() => void run("revise")}
                >
                  {t("workHubLibrary.revise")}
                </TogglePillButton>
              )}
              {data.metadata.state !== "archived" && (
                <TogglePillButton
                  color="brand"
                  disabled={api.busy || api.uncertain}
                  onPress={() => setReview("archive")}
                >
                  {t("workHubLibrary.archive")}
                </TogglePillButton>
              )}
              {data.metadata.state === "published" && (
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
        </View>
      )}
      {edit &&
        (isNew || (data?.metadata.state === "draft" && data.canManage)) && (
          <View style={card}>
            <BundleEditor
              key={`${itemId}:${data?.metadata.version ?? 0}`}
              initial={data?.bundle}
              title={data?.title}
              disabled={api.busy || api.uncertain}
              onSave={async (value) => {
                const result = await api.send(
                  isNew
                    ? "/api/work-hub/bundles"
                    : `/api/work-hub/bundles/${itemId}`,
                  value,
                  data?.metadata.version,
                  isNew ? "POST" : "PATCH",
                );
                setEdit(false);
                if (isNew)
                  router.push(
                    `/work-hub/bundle/${z.uuid().parse(result.resource.itemId)}` as never,
                  );
              }}
            />
          </View>
        )}
      {assign && data?.metadata.state === "published" && (
        <View style={card}>
          <AssignmentReview
            kind="bundle"
            initialItemId={itemId}
            onSaved={async () => setAssign(false)}
          />
        </View>
      )}
      {data?.canManage && data.metadata.state === "published" && (
        <View style={card}>
          <Text style={{ ...label, fontWeight: "700" }}>
            {t("workHubLibrary.newHireOnboarding")}
          </Text>
          <Text style={label}>{t("workHubLibrary.onboardingHint")}</Text>
          <OptionSwitch
            label={t("workHubLibrary.autoEnroll")}
            value={enabled}
            disabled={api.busy || api.uncertain}
            onChange={(v) => {
              setEnabled(v);
              setReview(null);
            }}
          />
          <Text style={label}>{t("workHubLibrary.rolesHint")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {["admin", "member", "ap", "field_employee"].map((role) => (
              <TogglePillButton
                key={role}
                color="brand"
                disabled={api.busy || api.uncertain}
                solid={roles.includes(role)}
                onPress={() => {
                  setRoles(
                    roles.includes(role)
                      ? roles.filter((x) => x !== role)
                      : [...roles, role],
                  );
                  setReview(null);
                }}
              >
                {t(`workHubLibrary.role_${role}`)}
              </TogglePillButton>
            ))}
          </View>
          <Text style={label}>{t("workHubLibrary.groupsHint")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {options.data?.groups.map((g) => (
              <TogglePillButton
                key={g.id}
                color="brand"
                disabled={api.busy || api.uncertain}
                solid={groups.includes(g.id)}
                onPress={() => {
                  setGroups(
                    groups.includes(g.id)
                      ? groups.filter((x) => x !== g.id)
                      : [...groups, g.id],
                  );
                  setReview(null);
                }}
              >
                {g.name}
              </TogglePillButton>
            ))}
          </View>
          <TogglePillButton
            color="brand"
            disabled={api.busy || api.uncertain || !!options.error}
            onPress={() => setReview("onboarding")}
          >
            {t("workHubLibrary.reviewRule")}
          </TogglePillButton>
        </View>
      )}
      {review && (
        <View style={card}>
          <Text style={label}>
            {t(
              review === "publish"
                ? "workHubLibrary.publishReview"
                : review === "archive"
                  ? "workHubLibrary.archiveReview"
                  : "workHubLibrary.onboardingReview",
            )}
          </Text>
          <Text style={label}>
            {data?.title} · {t("workHubLibrary.version")}{" "}
            {data?.metadata.contentVersion}
          </Text>
          {review === "onboarding" && (
            <Text style={label}>
              {t(enabled ? "workHubLibrary.on" : "workHubLibrary.off")} ·{" "}
              {roles.join(", ")} ·{" "}
              {groups
                .map(
                  (id) => options.data?.groups.find((g) => g.id === id)?.name,
                )
                .join(", ")}
            </Text>
          )}
          <TogglePillButton
            color="brand"
            disabled={api.busy}
            onPress={() => void run(review)}
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
      {!!(notice || api.error || options.error) && (
        <Text style={label}>{notice || api.error || options.error}</Text>
      )}
      {api.uncertain && (
        <TogglePillButton
          color="brand"
          disabled={api.busy}
          onPress={() =>
            void api
              .retryOriginal()
              .then((result) => {
                setReview(null);
                if (isNew)
                  router.push(
                    `/work-hub/bundle/${z.uuid().parse(result.resource.itemId)}` as never,
                  );
              })
              .catch((e) => setNotice(e.message))
          }
        >
          {t("workHubLibrary.retry")}
        </TogglePillButton>
      )}
    </View>
  );
}
