import { formatTrainingTitle } from "@/lib/training-title";
import {useAuth} from "@/hooks/use-auth";
import {useQuery} from "@tanstack/react-query";
import {ownerForUser,workHubRequest} from "@/lib/work-hub-client";
import DeliveryEditor from "./delivery-editor";
import React, { useState } from "react";
import {
  Paragraph as Text,
  Field as TextInput,
  Frame as View,
  Pill as TogglePillButton,
  usePalette as useColors,
} from "./editor-controls";
import { z } from "zod/v4";
import {
  BundleDefinitionSchema,
  type BundleDefinition,
} from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useLibrary as useFormCampaigns } from "./use-library";
import OptionSwitch from "./option-switch";
const schema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      title: z.string(),
      kind: z.string(),
      platformManaged:z.boolean().default(false),
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
  const {user}=useAuth(),owner=ownerForUser(user);
  const [selectedFiles,setSelectedFiles]=useState<string[]>([]);
  const [supplements,setSupplements]=useState<Record<string,{itemId:string;version:number;published:boolean}>>({});
  const [saving,setSaving]=useState(false);
  const documents=useQuery({queryKey:["bundle-source-documents",user?.userId,user?.activeMembershipId,owner?.type,owner?.id],enabled:!!owner,queryFn:()=>workHubRequest<Array<{id:string;data:{name:string;scope:string;state:string;purpose?:string;currentFileId:string|null}}>>(`/file-library?orgType=${owner!.type}&orgId=${owner!.id}&purpose=training`)});
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
      setSaving(true);
      const additions:BundleDefinition["entries"]=[];
      for(const documentId of selectedFiles){
        const doc=documents.data?.find(d=>d.id===documentId&&d.data.purpose==="training"&&d.data.scope==="company"&&d.data.state==="active"&&d.data.currentFileId);
        if(!doc)throw Error("Selected company document is unavailable");
        let item=supplements[documentId];
        if(!item){const created=await api.send("/api/work-hub/library",{kind:"training",title:doc.data.name,description:"Vendor-added supplemental training",training:{completionMode:"checkoff",lessons:[{id:"source",title:doc.data.name,body:"Review the attached company training material.",fileIds:[doc.data.currentFileId]}],questions:[]}});item={itemId:String(created.resource.itemId),version:Number(created.resource.version),published:false};setSupplements(current=>({...current,[documentId]:item}));}
        if(!item.published){await api.send(`/api/work-hub/library/${item.itemId}/publish`,{},item.version);item={...item,published:true};setSupplements(current=>({...current,[documentId]:item}));}
        additions.push({templateId:item.itemId,contentVersion:1,dueHours:720,presentation:"first_entry",requiredBeforeWork:false});
      }
      await onSave({
        title: title.trim(),
        bundle: BundleDefinitionSchema.parse({...bundle,entries:[...bundle.entries,...additions.filter(a=>!bundle.entries.some(e=>e.templateId===a.templateId))]}),
      });
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : t("workHubLibrary.unavailable"),
      );
    } finally {setSaving(false);}
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
            disabled={disabled||saving||(user?.role!=="admin"&&item.platformManaged&&!!initial?.entries.some(e=>e.templateId===item.itemId))}
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
            {formatTrainingTitle(item.title)} · {t("workHubLibrary.version")} {item.contentVersion}
          </TogglePillButton>
        ))}
      <details className="space-y-2"><summary className="font-semibold">Add from company Library</summary><p>Select company-shared documents, PDFs or videos as supplemental training.</p>{documents.data?.filter(d=>d.data.purpose==="training"&&d.data.scope==="company"&&d.data.state==="active"&&d.data.currentFileId).map(d=><OptionSwitch key={d.id} label={d.data.name} disabled={disabled||saving} value={selectedFiles.includes(d.id)} onChange={checked=>setSelectedFiles(current=>checked?[...current,d.id]:current.filter(id=>id!==d.id))}/>)}{documents.error&&<p role="alert">Company Library unavailable</p>}</details>
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
        disabled={disabled || saving || api.loading || !!api.error}
        onPress={() => void save()}
      >
        {t("workHubLibrary.saveDraft")}
      </TogglePillButton>
    </View>
  );
}
