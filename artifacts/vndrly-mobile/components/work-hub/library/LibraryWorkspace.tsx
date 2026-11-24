import { ModalTextInput as TextInput } from "@/components/ModalDraft";
import { NativeRepository } from "../NativeRepository";
import React, { useState } from "react";
import { ScrollView, Text, View, Switch } from "react-native";
import { router } from "expo-router";
import { z } from "zod/v4";
import { AssignmentMetadataSchema } from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import LibraryMiniCardButton from "./LibraryMiniCardButton";
import VndrlyUCatalog from './VndrlyUCatalog';
const itemsSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      title: z.string(),
      kind: z.string(),
      platformManaged: z.boolean().default(false),
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
    [tab, setTab] = useState(canManage ? "bundles" : "toComplete"),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const [myServices, setMyServices] = useState(false);
  const [mine,setMine]=useState(false);
  const [trainingNeededOpen, setTrainingNeededOpen] = useState(false);
  const list = useFormCampaigns(
    `/api/work-hub/library?archived=${archived}&myServices=${tab === "training" && myServices}${tab === "bundles" ? "&kind=bundle" : ""}`,
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
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ ...card, flex: 1, minHeight: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(canManage
            ? ["library", "training", "bundles", "augmented", "assignments"]
            : ["toComplete", "bundles"]
          ).map((value) => (
            <LibraryMiniCardButton
              key={value}
              solid={tab === value}
              onPress={() => {
                setTab(value);
                setSearch("");
              }}
            >
              {value === "bundles" ? "VNDRLY/U Certifications" : value === "library" ? "From Library" : value === "training"
                ? "VNDRLY/U Courses"
                : value === "augmented"
                  ? "Vendor Augmented"
                  : t(`workHubLibrary.${value}`)}
            </LibraryMiniCardButton>
          ))}
        </View>
        <LibraryMiniCardButton accessibilityLabel={t("workHubLibrary.refresh")} onPress={() => void relevant.reload()}>↻</LibraryMiniCardButton>
        </View>
        {tab !== "library" && <TextInput
          accessibilityLabel={t("workHubLibrary.searchContent")}
          placeholder={t("workHubLibrary.searchContent")}
          value={search}
          onChangeText={setSearch}
          style={{
            ...label,
            borderWidth: 1,
            borderColor: colors.primary,
            borderRadius: 20,
            padding: 12,
          }}
        />}
        {tab === "training" && <View style={{ gap: 8 }}><Text style={label}>{t("workHubLibrary.managedTraining")}</Text><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={label}>{t("workHubLibrary.allTraining")}</Text><Switch accessibilityLabel={t("workHubLibrary.myServices")} value={myServices} onValueChange={setMyServices} /><Text style={label}>{t("workHubLibrary.myServices")}</Text></View></View>}
        {canManage && (tab === "training" || tab === "bundles") && (
          <View style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:8}}>
            <LibraryMiniCardButton
              solid={archived}
              onPress={() => setArchived(!archived)}
            >
              {t("workHubLibrary.archived")}
            </LibraryMiniCardButton>
            {tab === "bundles" && <LibraryMiniCardButton onPress={() => router.push("/work-hub/bundle/new" as never)}>{t("workHubLibrary.newBundle")}</LibraryMiniCardButton>}
            {tab === "bundles" && <View style={{marginLeft:"auto",flexDirection:"row",gap:8}}><LibraryMiniCardButton solid={mine} onPress={()=>setMine(true)}>Mine</LibraryMiniCardButton><LibraryMiniCardButton solid={!mine} onPress={()=>setMine(false)}>All</LibraryMiniCardButton></View>}
          </View>
        )}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
        {!!relevant.error && (
          <Text accessibilityRole="alert" style={label}>{relevant.error}</Text>
        )}
        {(tab === "bundles" || tab === "training") && (
          <VndrlyUCatalog
            mine={tab === "bundles" && mine}
            kind={tab === "bundles" ? "programs" : "courses"}
            search={search}
          />
        )}
      {tab === "augmented" && <NativeRepository augmentationsOnly />}
      {tab === "library" && <NativeRepository filesOnly trainingOnly />}
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
              <LibraryMiniCardButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/${item.kind === "training" ? "training" : "checklist"}/${item.instanceId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </LibraryMiniCardButton>
            </View>
          ))}
      {tab === "bundles" && !!list.data?.items.some(i => i.kind === "bundle") && <View style={card}>
        <LibraryMiniCardButton solid={trainingNeededOpen} onPress={() => setTrainingNeededOpen(!trainingNeededOpen)}>{t("workHubLibrary.trainingNeededByRole")}</LibraryMiniCardButton>
        {trainingNeededOpen && list.data.items.filter(i => i.kind === "bundle" && i.title.toLowerCase().includes(search.toLowerCase())).map(item => <View key={item.itemId} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 6 }}><Text style={{ ...label, fontWeight: "700" }}>{item.title}</Text><Text style={label}>{t(`workHubLibrary.state_${item.state}`)} · {t("workHubLibrary.version")} {item.contentVersion}</Text><LibraryMiniCardButton onPress={() => router.push(`/work-hub/bundle/${item.itemId}` as never)}>{t("workHubLibrary.view")}</LibraryMiniCardButton></View>)}
      </View>}
      {tab === "training" &&
        list.data?.items
          .filter(
            (i) =>
              i.kind === "training" && i.platformManaged &&
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
              <LibraryMiniCardButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/library/${item.itemId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </LibraryMiniCardButton>
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
              <LibraryMiniCardButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/assignment/${item.instanceId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </LibraryMiniCardButton>
            </View>
          ))}
      {tab === "assignments" &&
        assignments.data?.anonymous.map((item) => (
          <View key={item.itemId} style={card}>
            <Text style={{ ...label, fontWeight: "700" }}>{item.title}</Text>
            <Text style={label}>
              {t("workHubLibrary.anonymous")} · {item.responded}/{item.assigned}
            </Text>
            <LibraryMiniCardButton
              color="brand"
              onPress={() =>
                router.push(`/work-hub/library/${item.itemId}` as never)
              }
            >
              {t("workHubLibrary.view")}
            </LibraryMiniCardButton>
          </View>
        ))}
        </ScrollView>
      </View>
    </View>
  );
}
