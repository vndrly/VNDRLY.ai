import { NativeAugmented } from "./NativeAugmented";
import NativeRepositoryFiles from "./NativeRepositoryFiles";
import React, { useState, useRef } from "react";
import { View, Text, TextInput, Pressable, Switch } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { isAuthScopeCurrent, captureAuthScope } from "@/lib/auth";
import { downloadAndShareProtectedFile } from "@/lib/meeting-files";
import { nativeUuid } from "@/lib/native-uuid";
import type { RepositoryAudienceSchema } from "@workspace/api-zod";
type Row = {
  id: string;
  createdBy: number;
  createdAt: string;
  data: Record<string, any>;
};
type Audience = { userIds: number[]; groupIds: string[]; roles: string[] };
const empty: Audience = { userIds: [], groupIds: [], roles: [] };
export function NativeRepository({
  progressOnly = false,
  augmentationsOnly = false,
  completedOnly = false,
  filesOnly = false,
  trainingOnly = false,
}: {
  progressOnly?: boolean;
  augmentationsOnly?: boolean;
  completedOnly?: boolean;
  filesOnly?: boolean;
  trainingOnly?: boolean;
}) {
  const { user, activeMembershipId } = useAuth(),
    colors = useColors(),
    cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState<string | null>(null),[addToFile,setAddToFile]=useState<string|null>(null),
    [authorizeOpen, setAuthorizeOpen] = useState(false),
    [tripId, setTripId] = useState(""),
    [audience, setAudience] = useState(empty),
    [form, setForm] = useState<Record<string, string>>({ currency: "USD" }),
    [expense, setExpense] = useState<Record<string, string>>({
      kind: "receipt",
    }),
    [kind, setKind] = useState("receipt"),
    [folderName, setFolderName] = useState(""),
    [folderEditing, setFolderEditing] = useState<Row | null>(null),
    [folderParent, setFolderParent] = useState<string | null>(null),
    [folderGrantIndex, setFolderGrantIndex] = useState(0),
    [folderPermissions, setFolderPermissions] = useState({
      read: true,
      write: false,
      edit: false,
    }),
    [travelRoleUsers, setTravelRoleUsers] = useState<number[] | null>(null),
    [templateEdit, setTemplateEdit] = useState<Row | null>(null),
    [templateFields, setTemplateFields] = useState<Record<string, string>>({}),
    [tripFormValues, setTripFormValues] = useState<
      Record<string, Record<string, string>>
    >({}),
    [returnReason, setReturnReason] = useState("");
  const attempts = useRef(new Map<string, string>()),
    key = ["native-repository", user?.id, activeMembershipId];
  const query = useQuery({
      queryKey: key,
      enabled: !!user,
      queryFn: () =>
        apiFetch<any>("/api/work-hub/repository", {}, captureAuthScope()),
    }),
    d = query.data;
  const receiptQuery = useQuery({
    queryKey: [...key, "receipts"],
    enabled: !!user,
    queryFn: () =>
      apiFetch<any[]>(
        "/api/work-hub/repository/receipts",
        {},
        captureAuthScope(),
      ),
  });
  const owner = user?.vendorId
    ? { type: "vendor", id: user.vendorId }
    : user?.partnerId
      ? { type: "partner", id: user.partnerId }
      : null;
  const save = async (
    action: string,
    payload: unknown,
    version: number | null = null,
  ) => {
    if (!owner) return false;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ action, payload, version });
    const operationId = attempts.current.get(fingerprint) ?? nativeUuid();
    attempts.current.set(fingerprint, operationId);
    try {
      await apiFetch(
        `/api/work-hub/repository/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId,
            owner,
            context: { kind: "organization", id: owner.id },
            payloadVersion: 1,
            expectedVersion: version,
            payload,
          }),
        },
        captureAuthScope(),
      );
      attempts.current.delete(fingerprint);
      await cache.invalidateQueries({ queryKey: key });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const card = {
      backgroundColor: colors.card,
      borderColor: colors.primary,
      borderWidth: 2,
      borderRadius: 14,
      padding: 12,
      gap: 10,
    },
    text = { color: colors.text };
  const button = (label: string, run: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={run}
      style={{
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 7,
        padding: 10,
        minHeight: 44,
      }}
    >
      <Text style={text}>{label}</Text>
    </Pressable>
  );
  const share = async (path: string) => {
    const authScope = captureAuthScope(),
      controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 60000);
    const assertCurrent = () => {
      if (!isAuthScopeCurrent(authScope))
        throw Error("Account changed; reopen this view");
    };
    try {
      const meta = await apiFetch<{
        fileName: string;
        contentType: string;
        byteSize: number;
      }>(path + "?metadata=1", { signal: controller.signal }, authScope);
      await downloadAndShareProtectedFile(
        { ...meta, authScope, assertCurrent, signal: controller.signal },
        path,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to share file");
    } finally {
      clearTimeout(timer);
    }
  };
  const field = (
    label: string,
    values: Record<string, string>,
    update: (v: Record<string, string>) => void,
  ) => (
    <View key={label}>
      <Text style={text}>
        {label
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/^./, (x) => x.toUpperCase())}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={values[label] ?? ""}
        onChangeText={(v) => update({ ...values, [label]: v })}
        style={{
          ...text,
          borderColor: colors.primary,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
          minHeight: 44,
        }}
      />
    </View>
  );
  const audienceList = () => (
    <View style={{ gap: 8 }}>
      {[
        {
          key: "userIds",
          name: "Individuals",
          items: d.options.people.map((p: any) => ({
            id: p.userId,
            name: p.name,
          })),
        },
        { key: "groupIds", name: "Groups", items: d.options.groups },
        {
          key: "roles",
          name: "Positions",
          items: [...d.options.accountTypes, ...d.options.positions],
        },
      ].map((s) => (
        <View key={s.key}>
          {button(s.name, () => setOpen(open === s.name ? null : s.name))}
          {open === s.name &&
            s.items.map((p: any) => (
              <View
                key={p.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Switch
                  accessibilityLabel={p.name}
                  value={(audience[s.key as keyof Audience] as any[]).includes(
                    p.id,
                  )}
                  trackColor={{ false: "#666666", true: colors.primary }}
                  onValueChange={(on) => {
                    const current = audience[s.key as keyof Audience] as any[];
                    setAudience({
                      ...audience,
                      [s.key]: on
                        ? [...current, p.id]
                        : current.filter((id) => id !== p.id),
                    });
                  }}
                />
                <Text style={{ ...text, flex: 1 }}>{p.name}</Text>
              </View>
            ))}
        </View>
      ))}
    </View>
  );
  if (!d)
    return query.error ? (
      <Text accessibilityRole="alert" style={text}>
        {query.error.message}
      </Text>
    ) : null;
  if(addToFile&&owner)return <View>{button("Back to File Library",()=>setAddToFile(null))}<NativeAugmented key={addToFile} seedDocumentId={addToFile} owner={owner} identity={key} setAudience={setAudience} data={d} save={save} audience={audience} audienceList={audienceList}/></View>;
  if (augmentationsOnly && owner)
    return (
      <NativeAugmented
        owner={owner}
        identity={key}
        setAudience={setAudience}
        data={d}
        save={save}
        audience={audience}
        audienceList={audienceList}
      />
    );
  if (filesOnly && owner)
    return (
      <NativeRepositoryFiles
        owner={owner}
        data={d}
        save={save}
        trainingOnly={trainingOnly} onAddTo={doc=>{setAudience(empty);setAddToFile(doc.id);}}
      />
    );
  const trip = d.trips.find((t: Row) => t.id === tripId);
  return (
    <View style={{ gap: 12 }}>
      {error && (
        <Text accessibilityRole="alert" style={text}>
          {error}
        </Text>
      )}
      {d.certifications
        .filter((c: any) => !completedOnly || c.complete)
        .map((c: any) => (
          <View style={card} key={c.id}>
            <Text style={{ ...text, fontWeight: "700" }}>
              {c.title}
              {c.augmented ? " · Vendor Augmented" : ""}
            </Text>
            <Text style={text}>
              {c.steps.filter((s: any) => s.complete).length} / {c.steps.length}{" "}
              complete
            </Text>
            {c.augmented &&
              !c.complete &&
              button(
                "Prepare current course assignments",
                () => void save("renew", { augmentationId: c.id }),
              )}
            {c.steps.map((s: any, i: number) => (
              <View key={s.id}>
                {button(
                  `${s.complete ? "✓" : "○"} ${i + 1}. ${s.title}`,
                  () => {
                    if (s.type === "course") router.push(s.href as never);
                    else router.push("/work-hub/files-notes" as never);
                  },
                )}
                {s.type === "material" &&
                  !s.complete &&
                  button(
                    "Confirm material completed",
                    () =>
                      void save("ack", {
                        augmentationId: c.id,
                        documentId: s.id,
                        confirmed: true,
                      }),
                  )}
              </View>
            ))}
          </View>
        ))}
      {!progressOnly && owner && (
        <NativeRepositoryFiles
          owner={owner}
          data={d}
          save={save}
          activeTrip={tripId} onAddTo={doc=>{setAudience(empty);setAddToFile(doc.id);}}
          onUseReceipt={(document) =>
            setExpense({ ...expense, documentId: document.id, receiptId: "" })
          }
        />
      )}
      {!progressOnly && (
        <>
          <View style={card}>
            <Text style={{ ...text, fontWeight: "700" }}>Logical folders</Text>
            {d.folders.map((f: Row) => (
              <View key={f.id}>
                <Text style={text}>{f.data.name}</Text>
                {d.canAdmin &&
                  button("Edit folder: " + f.data.name, () => {
                    setFolderEditing(f);
                    setFolderName(f.data.name);
                    setFolderParent(f.data.parentId);
                    setFolderGrantIndex(0);
                    const g = f.data.grants?.[0] ?? {};
                    setAudience({
                      userIds: g.userIds ?? [],
                      groupIds: g.groupIds ?? [],
                      roles: g.roles ?? [],
                    });
                    setFolderPermissions({
                      read: !!g.read,
                      write: !!g.write,
                      edit: !!g.edit,
                    });
                  })}
              </View>
            ))}
            {d.canAdmin && (
              <>
                {field("Folder name", { "Folder name": folderName }, (v) =>
                  setFolderName(v["Folder name"]),
                )}
                {button("New logical folder", () => {
                  setFolderEditing(null);
                  setFolderParent(null);
                  setFolderName("");
                  setFolderGrantIndex(0);
                  setAudience(empty);
                  setFolderPermissions({
                    read: true,
                    write: false,
                    edit: false,
                  });
                })}
                <Text style={text}>Parent folder</Text>
                {button("Top level", () => setFolderParent(null))}
                {d.folders
                  .filter((f: Row) => f.id !== folderEditing?.id)
                  .map((f: Row) =>
                    button(
                      `${folderParent === f.id ? "✓ " : ""}${f.data.name}`,
                      () => setFolderParent(f.id),
                    ),
                  )}
                {(folderEditing?.data.grants ?? []).map(
                  (g: any, index: number) =>
                    button("Permission rule " + (index + 1), () => {
                      setFolderGrantIndex(index);
                      setAudience({
                        userIds: g.userIds ?? [],
                        groupIds: g.groupIds ?? [],
                        roles: g.roles ?? [],
                      });
                      setFolderPermissions({
                        read: !!g.read,
                        write: !!g.write,
                        edit: !!g.edit,
                      });
                    }),
                )}
                {folderEditing &&
                  button("Add permission rule", () => {
                    setFolderGrantIndex(folderEditing.data.grants?.length ?? 0);
                    setAudience(empty);
                    setFolderPermissions({
                      read: true,
                      write: false,
                      edit: false,
                    });
                  })}
                {audienceList()}
                {(["read", "write", "edit"] as const).map((permission) => (
                  <View
                    key={permission}
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <Switch
                      accessibilityLabel={`Folder ${permission}`}
                      value={folderPermissions[permission]}
                      trackColor={{ false: "#666", true: colors.primary }}
                      onValueChange={(value) =>
                        setFolderPermissions({
                          ...folderPermissions,
                          [permission]: value,
                        })
                      }
                    />
                    <Text style={text}>
                      {permission[0].toUpperCase() + permission.slice(1)}
                    </Text>
                  </View>
                ))}
                {button(
                  "Save logical folder",
                  () =>
                    void save(
                      "folder",
                      {
                        ...(folderEditing ? { id: folderEditing.id } : {}),
                        name: folderName,
                        category: folderEditing?.data.category ?? folderName,
                        parentId: folderParent,
                        protected: true,
                        grants: [
                          ...(folderEditing?.data.grants ?? []).filter(
                            (_: any, index: number) =>
                              index !== folderGrantIndex,
                          ),
                          { ...audience, ...folderPermissions },
                        ],
                      },
                      folderEditing?.data.version ?? null,
                    ),
                )}
                {!d.folders.some((f: Row) => f.data.category === "Travel") &&
                  button(
                    "Create Travel and working templates",
                    () => void save("travel-setup", {}),
                  )}
              </>
            )}
          </View>
          {d.canAdmin && (
            <View style={card}>
              <Text style={{ ...text, fontWeight: "700" }}>
                Assign Travel role
              </Text>
              {d.options.people
                .filter((p: any) => p.canAssignTravelRole && p.role !== "admin")
                .map((p: any) => (
                  <View
                    key={p.userId}
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <Switch
                      accessibilityLabel={`Assign Travel: ${p.name}`}
                      value={(
                        travelRoleUsers ??
                        d.travelGrants[0]?.data.userIds ??
                        []
                      ).includes(p.userId)}
                      trackColor={{ false: "#666", true: colors.primary }}
                      onValueChange={(on) => {
                        const current =
                          travelRoleUsers ??
                          d.travelGrants[0]?.data.userIds ??
                          [];
                        setTravelRoleUsers(
                          on
                            ? [...current, p.userId]
                            : current.filter((id: number) => id !== p.userId),
                        );
                      }}
                    />
                    <Text style={text}>{p.name}</Text>
                  </View>
                ))}
              {button(
                "Save Assign Travel permissions",
                () =>
                  void save(
                    "travel-grant",
                    {
                      userIds:
                        travelRoleUsers ??
                        d.travelGrants[0]?.data.userIds ??
                        [],
                    },
                    d.travelGrants[0]?.data.version ?? null,
                  ),
              )}
            </View>
          )}
          {d.canAssignTravel && (
            <View style={card}>
              <Text style={{ ...text, fontWeight: "700" }}>
                Travel templates
              </Text>
              {d.templates.map((t: Row) =>
                button(t.data.name, () => {
                  setTemplateEdit(t);
                  setTemplateFields({
                    Name: t.data.name,
                    Fields: t.data.fields.join("\n"),
                  });
                }),
              )}
              {templateEdit && (
                <>
                  {field("Name", templateFields, setTemplateFields)}
                  {field("Fields", templateFields, setTemplateFields)}
                  {button(
                    "Save template",
                    () =>
                      void save(
                        "template",
                        {
                          id: templateEdit.id,
                          name: templateFields.Name,
                          fields:
                            templateFields.Fields.split("\n").filter(Boolean),
                        },
                        templateEdit.data.version,
                      ).then((ok) => {
                        if (ok) setTemplateEdit(null);
                      }),
                  )}
                </>
              )}
            </View>
          )}
          <View style={card}>
            <Text style={{ ...text, fontWeight: "700" }}>Travel</Text>
            {d.trips.map((t: Row) =>
              button(
                `${t.data.travelerName} · ${t.data.title} · ${t.data.status}`,
                () => setTripId(t.id),
              ),
            )}
            {d.canAssignTravel && (
              <>
                {button("Authorize a trip", () =>
                  setAuthorizeOpen(!authorizeOpen),
                )}
                {authorizeOpen && (
                  <>
                    {[
                      "title",
                      "origin",
                      "destination",
                      "startDate",
                      "endDate",
                      "purpose",
                      "currency",
                      "budget",
                      "rate",
                      "perDiem",
                    ].map((f) => field(f, form, setForm))}
                    {audienceList()}
                    {button(
                      "Authorize selected travelers",
                      () =>
                        void save("authorize", {
                          ...form,
                          budgetCents: Math.round(
                            Number(form.budget || 0) * 100,
                          ),
                          mileageRateCents: form.rate
                            ? Number(form.rate) * 100
                            : null,
                          perDiemCents: Math.round(
                            Number(form.perDiem || 0) * 100,
                          ),
                          audience,
                          templateIds: d.templates.map((t: Row) => t.id),
                        }),
                    )}
                  </>
                )}
              </>
            )}
            {trip && (
              <View style={{ gap: 10 }}>
                <Text style={{ ...text, fontWeight: "700" }}>
                  {trip.data.title} · {trip.data.travelerName}
                </Text>
                <Text style={text}>
                  {trip.data.origin} → {trip.data.destination} ·{" "}
                  {trip.data.startDate} – {trip.data.endDate}
                </Text>
                {(trip.data.formSnapshots ?? []).map((snapshot: any) => (
                  <View key={snapshot.id} style={card}>
                    <Text style={{ ...text, fontWeight: "700" }}>
                      {snapshot.name}
                    </Text>
                    {snapshot.fields.map((label: string) => (
                      <View key={label}>
                        <Text style={text}>{label}</Text>
                        <TextInput
                          accessibilityLabel={label}
                          editable={["authorized", "returned"].includes(
                            trip.data.status,
                          )}
                          style={{
                            ...text,
                            borderWidth: 1,
                            borderColor: colors.primary,
                            borderRadius: 8,
                            padding: 8,
                          }}
                          value={
                            tripFormValues[snapshot.id]?.[label] ??
                            trip.data.forms?.[snapshot.id]?.values?.[label] ??
                            ""
                          }
                          onChangeText={(value) =>
                            setTripFormValues((current) => ({
                              ...current,
                              [snapshot.id]: {
                                ...(current[snapshot.id] ??
                                  trip.data.forms?.[snapshot.id]?.values ??
                                  {}),
                                [label]: value,
                              },
                            }))
                          }
                        />
                      </View>
                    ))}
                    {["authorized", "returned"].includes(trip.data.status) &&
                      button(
                        "Save completed form",
                        () =>
                          void save(
                            "trip-form",
                            {
                              tripId: trip.id,
                              formId: snapshot.id,
                              values:
                                tripFormValues[snapshot.id] ??
                                trip.data.forms?.[snapshot.id]?.values ??
                                {},
                            },
                            trip.data.version,
                          ),
                      )}
                  </View>
                ))}
                {d.canAssignTravel && trip.data.status === "submitted" && (
                  <View>
                    {field(
                      "Return reason",
                      { "Return reason": returnReason },
                      (v) => setReturnReason(v["Return reason"]),
                    )}
                    {button(
                      "Return trip for correction",
                      () =>
                        void save(
                          "trip-status",
                          {
                            tripId: trip.id,
                            action: "return",
                            reason: returnReason,
                          },
                          trip.data.version,
                        ),
                    )}
                  </View>
                )}
                {["authorized", "returned"].includes(trip.data.status) && (
                  <>
                    {[
                      "receipt",
                      "mileage",
                      "per_diem",
                      "lodging",
                      "transportation",
                      "advance",
                      "other",
                    ].map((k) =>
                      button(`${kind === k ? "✓ " : ""}${k}`, () => setKind(k)),
                    )}
                    {[
                      "date",
                      "description",
                      "merchant",
                      ...(kind === "mileage" ? ["distance"] : ["amount"]),
                      "missingReceiptReason",
                    ].map((f) => field(f, expense, setExpense))}
                    {expense.documentId && (
                      <View>
                        <Text style={text}>
                          Receipt photo selected. Review the extracted values
                          before saving.
                        </Text>
                        {button(
                          "Read receipt photo",
                          () =>
                            void apiFetch<any>(
                              "/api/work-hub/repository/receipt-read",
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  documentId: expense.documentId,
                                }),
                              },
                              captureAuthScope(),
                            )
                              .then((result) =>
                                setExpense({
                                  ...expense,
                                  merchant:
                                    result.fields.merchant ?? expense.merchant,
                                  date: result.fields.date ?? expense.date,
                                  amount: result.fields.total ?? expense.amount,
                                }),
                              )
                              .catch((e) => setError(e.message)),
                        )}
                      </View>
                    )}
                    <View style={card}>
                      <Text style={{ ...text, fontWeight: "700" }}>
                        Attach reviewed Conversations receipt
                      </Text>
                      {(receiptQuery.data ?? []).map((r) =>
                        button(
                          `${expense.receiptId === r.id ? "✓ " : ""}${r.fields.merchant ?? "Receipt"} · ${r.fields.date} · ${r.fields.total} ${r.fields.currency}`,
                          () =>
                            setExpense({
                              ...expense,
                              receiptId: r.id,
                              date: r.fields.date,
                              merchant: r.fields.merchant ?? "",
                              amount: r.fields.total,
                            }),
                        ),
                      )}
                    </View>
                    {button(
                      "Save expense",
                      () =>
                        void save("expense", {
                          tripId: trip.id,
                          kind,
                          date: expense.date,
                          description: expense.description,
                          merchant: expense.merchant ?? "",
                          receiptId: expense.receiptId || null,
                          documentId: expense.documentId || null,
                          ...(kind === "mileage"
                            ? { distance: Number(expense.distance) }
                            : {
                                amountCents: Math.round(
                                  Number(expense.amount) * 100,
                                ),
                              }),
                          missingReceiptReason:
                            expense.missingReceiptReason ?? "",
                        }),
                    )}
                    {button(
                      "Submit trip for review",
                      () =>
                        void save(
                          "trip-status",
                          { tripId: trip.id, action: "submit", reason: "" },
                          trip.data.version,
                        ),
                    )}
                  </>
                )}
                {d.canAssignTravel &&
                  trip.data.status === "submitted" &&
                  button(
                    "Approve trip report",
                    () =>
                      void save(
                        "trip-status",
                        { tripId: trip.id, action: "approve", reason: "" },
                        trip.data.version,
                      ),
                  )}
                {d.canAssignTravel &&
                  trip.data.status === "approved" &&
                  button(
                    "Close trip",
                    () =>
                      void save(
                        "trip-status",
                        { tripId: trip.id, action: "close", reason: "" },
                        trip.data.version,
                      ),
                  )}
                <Text style={{ ...text, fontWeight: "700" }}>
                  Trip total:{" "}
                  {(
                    d.expenses
                      .filter((e: Row) => e.data.tripId === trip.id)
                      .reduce(
                        (sum: number, e: Row) =>
                          sum + Number(e.data.amountCents),
                        0,
                      ) / 100
                  ).toFixed(2)}{" "}
                  {trip.data.currency}
                </Text>
                {d.canAssignTravel &&
                  button(
                    "Share expense report CSV",
                    () => void share("/api/work-hub/repository/travel/export"),
                  )}
                {d.expenses
                  .filter((e: Row) => e.data.tripId === trip.id)
                  .map((e: Row) => (
                    <View key={e.id}>
                      <Text style={text}>
                        {e.data.date} · {e.data.description} ·{" "}
                        {(e.data.amountCents / 100).toFixed(2)}{" "}
                        {e.data.currency}
                      </Text>
                      {e.data.receiptSnapshot &&
                        button(
                          "View receipt",
                          () =>
                            void share(
                              `/api/work-hub/repository/expenses/${e.id}/receipt`,
                            ),
                        )}
                    </View>
                  ))}
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}
