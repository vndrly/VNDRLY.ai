import React, { useState } from "react";
import { View, Text, TextInput, Switch, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
export function NativeAugmented({
  data: d,
  save,
  audience,
  audienceList,
  owner,
  identity,
  setAudience, seedDocumentId,
}: {
  seedDocumentId?:string;
  owner: { type: string; id: number };
  identity: unknown[];
  setAudience: (value: any) => void;
  data: any;
  save: (
    action: string,
    payload: unknown,
    version?: number | null,
  ) => Promise<boolean>;
  audience: any;
  audienceList: () => React.ReactNode;
}) {
  const c = useColors(),
    [editing, setEditing] = useState<any>(seedDocumentId?{}:null),
    [title, setTitle] = useState(""),
    [base, setBase] = useState(""),
    [courseIds, setCourses] = useState<string[]>([]),
    [documentIds, setDocuments] = useState<string[]>(seedDocumentId?[seedDocumentId]:[]),
    [months, setMonths] = useState(""),
    [source, setSource] = useState("");
  const q = useQuery({
    queryKey: [
      "native-augmentation-materials",
      ...identity,
      owner.type,
      owner.id,
    ],
    queryFn: () =>
      apiFetch<any[]>(
        `/api/work-hub/file-library?purpose=training&orgType=${owner.type}&orgId=${owner.id}`,
        {},
        captureAuthScope(),
      ),
  });
  const text = { color: c.text },
    card = {
      backgroundColor: c.card,
      borderWidth: 2,
      borderColor: c.primary,
      borderRadius: 14,
      padding: 12,
      gap: 10,
    };
  const button = (name: string, run: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={run}
      style={{
        borderWidth: 1,
        borderColor: c.primary,
        borderRadius: 7,
        minHeight: 44,
        padding: 10,
      }}
    >
      <Text style={text}>{name}</Text>
    </Pressable>
  );
  const toggle = (name: string, on: boolean, change: (v: boolean) => void) => (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Switch
        accessibilityLabel={name}
        value={on}
        trackColor={{ false: "#666", true: c.primary }}
        onValueChange={change}
      />
      <Text style={{ ...text, flex: 1 }}>{name}</Text>
    </View>
  );
  return (
    <View style={card}>
      <Text style={{ ...text, fontWeight: "700" }}>Vendor Augmented</Text>
      {d.augmentations.map((a: any) => (
        <View key={a.id}>
          <Text style={{ ...text, fontWeight: "700" }}>{a.data.title}</Text>
          <Text style={text}>
            Added {new Date(a.createdAt).toLocaleDateString()} ·{" "}
            {a.data.courseIds?.length ?? 0} added courses ·{" "}
            {a.data.documentIds?.length ?? 0} materials
          </Text>
          {d.canManageTraining &&
            button("Edit recipients and additions", () => {
              setAudience(
                a.data.audience ?? {
                  userIds: a.data.userIds ?? [],
                  groupIds: [],
                  roles: [],
                },
              );
              setEditing(a);
              setTitle(a.data.title);
              setBase(a.data.baseItemId);
              setCourses(a.data.courseIds ?? []);
              setDocuments(a.data.documentIds ?? []);
              setMonths(
                a.data.renewalMonths ? String(a.data.renewalMonths) : "",
              );
              setSource(a.data.renewalSource ?? "");
            })}
        </View>
      ))}
      {d.canManageTraining &&
        button("Add augmentation", () => {
          setAudience({ userIds: [], groupIds: [], roles: [] });
          setEditing({});
          setMonths("");
          setSource("");
          setTitle("");
          setBase("");
          setCourses([]);
          setDocuments([]);
        })}
      {editing && (
        <>
          <Text style={text}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={{
              ...text,
              borderWidth: 1,
              borderColor: c.primary,
              padding: 10,
            }}
          />
          <Text style={text}>Base course/certification</Text>
          {d.courses.map((c: any) =>
            button(`${base === c.id ? "✓ " : ""}${c.title}`, () =>
              setBase(c.id),
            ),
          )}
          <Text style={text}>Additional VNDRLY/U courses</Text>
          {d.courses
            .filter((c: any) => c.id !== base)
            .map((c: any) =>
              toggle(c.title, courseIds.includes(c.id), (on) =>
                setCourses(
                  on
                    ? [...courseIds, c.id]
                    : courseIds.filter((id) => id !== c.id),
                ),
              ),
            )}
          <Text style={text}>From Library</Text>
          {q.data?.filter(doc=>doc.data.scope==="company").map((doc) =>
            toggle(doc.data.name, documentIds.includes(doc.id), (on) =>
              setDocuments(
                on
                  ? [...documentIds, doc.id]
                  : documentIds.filter((id) => id !== doc.id),
              ),
            ),
          )}
          {audienceList()}
          <Text style={text}>Vendor renewal interval (months, optional)</Text>
          <TextInput
            keyboardType="number-pad"
            value={months}
            onChangeText={setMonths}
            style={{
              ...text,
              borderWidth: 1,
              borderColor: c.primary,
              padding: 10,
            }}
          />
          <Text style={text}>Policy / source for this interval</Text>
          <TextInput
            value={source}
            onChangeText={setSource}
            style={{
              ...text,
              borderWidth: 1,
              borderColor: c.primary,
              padding: 10,
            }}
          />
          {d.renewalSources.map((r: any) => (
            <Text key={r.id} style={text}>
              {r.label}: {r.condition}
            </Text>
          ))}
          {button(
            "Save augmentation and assign",
            () =>
              void save(
                "augment",
                {
                  ...(editing.id ? { id: editing.id } : {}),
                  title,
                  baseItemId: base,
                  courseIds,
                  documentIds,
                  required: true,
                  renewalMonths: months ? Number(months) : null,
                  renewalSource: source,
                  audience,
                },
                editing.data?.version ?? null,
              ).then((ok) => {
                if (ok) setEditing(null);
              }),
          )}
        </>
      )}
    </View>
  );
}
