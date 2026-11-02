import { NativeRepository } from "../NativeRepository";
import React, { useState } from "react";
import { Text, TextInput, View, Switch } from "react-native";
import { router } from "expo-router";
import { z } from "zod/v4";
import { AssignmentMetadataSchema } from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../../TogglePillButton";
import LibraryEditor from "./LibraryEditor";
const itemsSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      title: z.string(),
      kind: z.string(),
      state: z.string(),
      version: z.number(),
      contentVersion: z.number(),
    }),
  ),
});
const checklistSchema = z.object({
  items: z.array(
    z.object({
      instanceId: z.uuid(),
      title: z.string(),
      kind: z.string(),
      assignment: AssignmentMetadataSchema,
      href: z.string(),
    }),
  ),
});
const namedAssignmentSchema = z.object({
  instanceId: z.uuid(),
  title: z.string(),
  name: z.string(),
  status: z.string(),
  dueAt: z.string(),
  version: z.number(),
});
const anonymousAssignmentSchema = z.object({
  itemId: z.uuid(),
  title: z.string(),
  anonymous: z.literal(true),
  assigned: z.number(),
  responded: z.number(),
});
const assignmentsSchema = z
  .object({
    items: z.array(z.union([anonymousAssignmentSchema, namedAssignmentSchema])),
  })
  .transform((data) => ({
    items: data.items.filter(
      (i): i is z.infer<typeof namedAssignmentSchema> => "instanceId" in i,
    ),
    anonymous: data.items.filter(
      (i): i is z.infer<typeof anonymousAssignmentSchema> => "anonymous" in i,
    ),
  }));
export default function LibraryWorkspace({
  canManage = false,
}: {
  canManage?: boolean;
}) {
  const { t } = useTranslation(),
    colors = useColors(),
    [tab, setTab] = useState(canManage ? "library" : "toComplete"),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [create, setCreate] = useState(false),
    [notice, setNotice] = useState("");
  const [myServices, setMyServices] = useState(false);
  const list = useFormCampaigns(
    `/api/work-hub/library${archived ? "?archived=true" : ""}`,
    (v) => itemsSchema.parse(v),
  );
  const checklist = useFormCampaigns("/api/work-hub/library/to-complete", (v) =>
    checklistSchema.parse(v),
  );
  const assignments = useFormCampaigns(
    canManage
      ? "/api/work-hub/library/assignments"
      : "/api/work-hub/library/to-complete",
    (v) =>
      canManage ? assignmentsSchema.parse(v) : { items: [], anonymous: [] },
  );
  const filesApi = useFormCampaigns(
    canManage
      ? "/api/work-hub/library/options"
      : "/api/work-hub/library/to-complete",
    (value) =>
      canManage
        ? z
            .object({
              files: z.array(z.object({ id: z.uuid(), fileName: z.string() })),
            })
            .parse(value)
        : { files: [] },
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
  const relevant =
    tab === "toComplete"
      ? checklist
      : tab === "assignments"
        ? assignments
        : list;
  return (
    <View style={{ gap: 12 }}>
      {tab === "augmented" && <NativeRepository augmentationsOnly />}
      {tab === "library" && <NativeRepository filesOnly trainingOnly />}
      {tab === "training" && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Text style={label}>All</Text>
          <Switch value={myServices} onValueChange={setMyServices} />
          <Text style={label}>My training, by service</Text>
        </View>
      )}
      <View style={card}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(canManage
            ? ["library", "training", "bundles", "augmented", "assignments"]
            : ["toComplete"]
          ).map((value) => (
            <TogglePillButton
              key={value}
              color="brand"
              solid={tab === value}
              onPress={() => {
                setTab(value);
                setCreate(false);
                setNotice("");
              }}
            >
              {value === "training"
                ? "VNDRLY/U Courses"
                : value === "augmented"
                  ? "Vendor Augmented"
                  : t(`workHubLibrary.${value}`)}
            </TogglePillButton>
          ))}
        </View>
        <TextInput
          accessibilityLabel={t("workHubLibrary.searchContent")}
          placeholder={t("workHubLibrary.searchContent")}
          value={search}
          onChangeText={setSearch}
          style={{
            ...label,
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 10,
            padding: 12,
          }}
        />
        {canManage && ["bundles"].includes(tab) && (
          <>
            <TogglePillButton
              color="brand"
              solid={archived}
              onPress={() => setArchived(!archived)}
            >
              {t("workHubLibrary.archived")}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              onPress={() =>
                tab === "bundles"
                  ? router.push("/work-hub/bundle/new" as never)
                  : setCreate(!create)
              }
            >
              {t(
                tab === "bundles"
                  ? "workHubLibrary.newBundle"
                  : "workHubLibrary.createContent",
              )}
            </TogglePillButton>
          </>
        )}
        {!!(notice || relevant.error) && (
          <Text style={label}>{notice || relevant.error}</Text>
        )}
        <TogglePillButton color="brand" onPress={() => void relevant.reload()}>
          {t("workHubLibrary.refresh")}
        </TogglePillButton>
      </View>
      {create && (
        <View style={card}>
          <LibraryEditor
            files={filesApi.data?.files}
            disabled={list.busy || list.uncertain}
            onSave={async (draft) => {
              const result = await list.send("/api/work-hub/library", draft);
              const id = z.uuid().parse(result.resource.itemId);
              setCreate(false);
              router.push(`/work-hub/library/${id}` as never);
            }}
          />
          {list.uncertain && (
            <TogglePillButton
              color="brand"
              onPress={() =>
                void list
                  .retryOriginal()
                  .then((result) => {
                    setCreate(false);
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
      )}
      {tab === "toComplete" &&
        checklist.data?.items
          .filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
          .map((item) => (
            <View key={item.instanceId} style={card}>
              <Text style={{ ...label, fontWeight: "700" }}>{item.title}</Text>
              <Text style={label}>
                {t(`workHubLibrary.status_${item.assignment.status}`)} ·{" "}
                {new Date(item.assignment.dueAt).toLocaleString()}
              </Text>
              <TogglePillButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/${item.kind === "training" ? "training" : "checklist"}/${item.instanceId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </TogglePillButton>
            </View>
          ))}
      {["training", "bundles"].includes(tab) &&
        list.data?.items
          .filter(
            (i) =>
              (tab === "bundles"
                ? i.kind === "bundle"
                : tab === "training"
                  ? i.kind === "training"
                  : !["bundle", "training"].includes(i.kind)) &&
              i.title.toLowerCase().includes(search.toLowerCase()),
          )
          .map((item) => (
            <View key={item.itemId} style={card}>
              <Text style={{ ...label, fontWeight: "700" }}>{item.title}</Text>
              <Text style={label}>
                {t(`workHubLibrary.kind_${item.kind}`)} ·{" "}
                {t(`workHubLibrary.state_${item.state}`)} ·{" "}
                {t("workHubLibrary.version")} {item.contentVersion}
              </Text>
              <TogglePillButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/${item.kind === "bundle" ? "bundle" : "library"}/${item.itemId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </TogglePillButton>
            </View>
          ))}
      {tab === "assignments" &&
        assignments.data?.items
          .filter((i) =>
            `${i.title} ${i.name}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((item) => (
            <View key={item.instanceId} style={card}>
              <Text style={{ ...label, fontWeight: "700" }}>
                {item.title} · {item.name}
              </Text>
              <Text style={label}>
                {t(`workHubLibrary.status_${item.status}`)} ·{" "}
                {new Date(item.dueAt).toLocaleString()}
              </Text>
              <TogglePillButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/assignment/${item.instanceId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </TogglePillButton>
            </View>
          ))}
      {tab === "assignments" &&
        assignments.data?.anonymous.map((item) => (
          <View key={item.itemId} style={card}>
            <Text style={{ ...label, fontWeight: "700" }}>{item.title}</Text>
            <Text style={label}>
              {t("workHubLibrary.anonymous")} · {item.responded}/{item.assigned}
            </Text>
            <TogglePillButton
              color="brand"
              onPress={() =>
                router.push(`/work-hub/library/${item.itemId}` as never)
              }
            >
              {t("workHubLibrary.view")}
            </TogglePillButton>
          </View>
        ))}
    </View>
  );
}
