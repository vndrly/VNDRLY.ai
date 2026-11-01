import React, { useState } from "react";
import {RefreshCw} from "lucide-react";
import {WorkHubFiles} from "../files";
import {Switch} from "@/components/ui/switch";
import {
  Paragraph as Text,
  Field as TextInput,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
  Heading,
} from "./editor-controls";
import { useLocation } from "wouter";
import { z } from "zod/v4";
import { AssignmentMetadataSchema } from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useLibrary as useFormCampaigns } from "./use-library";
import LibraryEditor from "./library-editor";
import {TrainingActions} from './training-actions';
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
      platformManaged: z.boolean().default(false),
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
  const [, navigate] = useLocation();
  const router = { push: (path: string) => navigate(path) };
  const { t } = useTranslation(),
    colors = useColors(),
    [tab, setTab] = useState(canManage ? "library" : "toComplete"),
    [myServices,setMyServices]=useState(false),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [create, setCreate] = useState(false),
    [notice, setNotice] = useState("");
  const list = useFormCampaigns(
    `/api/work-hub/library?archived=${archived}&myServices=${tab==="training"&&myServices}`,
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
      <View style={{...card,position:"relative"}}>
        <button type="button" aria-label={t("workHubLibrary.refresh")} title={t("workHubLibrary.refresh")} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-inherit hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current" onClick={()=>void relevant.reload()}><RefreshCw aria-hidden="true" className="h-4 w-4"/></button>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8,paddingRight:36 }}>
          {(canManage
            ? ["library", "training", "bundles", "assignments"]
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
              {t(`workHubLibrary.${value}`)}
            </TogglePillButton>
          ))}
        </View>
        {tab!=="library"&&<TextInput
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
        />}
        {tab==="training"&&<Text style={label}>{t("workHubLibrary.managedTraining")}</Text>}
        {tab==="training"&&<label className="flex items-center gap-3"><span>{t("workHubLibrary.allTraining")}</span><Switch aria-label={t("workHubLibrary.myServices")} checked={myServices} onCheckedChange={setMyServices}/><span>{t("workHubLibrary.myServices")}</span></label>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {canManage && ["training", "bundles"].includes(tab) && (
          <>
            <TogglePillButton
              color="brand"
              solid={archived}
              onPress={() => setArchived(!archived)}
            >
              {t("workHubLibrary.archived")}
            </TogglePillButton>
            {tab==="bundles"&&<TogglePillButton
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
            </TogglePillButton>}
          </>
        )}
        
        </View>
        {!!(notice || relevant.error) && (
          <Text style={label}>{notice || relevant.error}</Text>
        )}
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
              <Heading>{item.title}</Heading>
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
      {tab==="library"&&<WorkHubFiles defaultScope="company" trainingMaterials/>}
      {["training", "bundles"].includes(tab) &&
        list.data?.items
          .filter(
            (i) =>
              (tab === "bundles" ? i.kind === "bundle" : tab === "training" ? i.kind === "training" && i.platformManaged : !["bundle", "training"].includes(i.kind)) &&
              i.title.toLowerCase().includes(search.toLowerCase()),
          )
          .map((item) => (
            <View key={item.itemId} style={card}>
              <Heading>{item.title}</Heading>
              <Text style={label}>
                {t(`workHubLibrary.kind_${item.kind}`)} ·{" "}
                {t(`workHubLibrary.state_${item.state}`)} ·{" "}
                {t("workHubLibrary.version")} {item.contentVersion}
              </Text>
              {item.kind==='training'?<TrainingActions itemId={item.itemId} canManage={canManage}/>:<TogglePillButton
                color="brand"
                onPress={() =>
                  router.push(
                    `/work-hub/${item.kind === "bundle" ? "bundle" : "library"}/${item.itemId}` as never,
                  )
                }
              >
                {t("workHubLibrary.view")}
              </TogglePillButton>}
            </View>
          ))}
      {tab === "assignments" &&
        assignments.data?.items
          .filter((i) =>
            `${i.title} ${i.name}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((item) => (
            <View key={item.instanceId} style={card}>
              <Heading>
                {item.title} · {item.name}
              </Heading>
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
            <Heading>{item.title}</Heading>
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
