import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { GATE_ONLY_RELEASE } from "@/lib/gate-release";
import React, { useRef, useState, useEffect } from "react";
import { View, Text, TextInput, Switch } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  pickMeetingFile,
  downloadAndShareProtectedFile,
  type OwnedMeetingFile,
} from "@/lib/meeting-files";
import { uploadWorkHubFile } from "@/lib/work-hub-file-upload";
import { nativeUuid } from "@/lib/native-uuid";
import { useColors } from "@/hooks/useColors";
export default function NativeRepositoryFiles({
  owner,
  data,
  save,
  activeTrip,
  trainingOnly = false,
  onUseReceipt,
  onAddTo,
}: {
  activeTrip?: string;
  trainingOnly?: boolean;
  onUseReceipt?: (document: any) => void;
  onAddTo?: (document: any) => void;
  owner: { type: string; id: number };
  data: any;
  save: (
    action: string,
    payload: unknown,
    version?: number | null,
  ) => Promise<boolean>;
}) {
  const c = useColors(),
    cache = useQueryClient(),
    [folder, setFolder] = useState(""),
    [trip, setTrip] = useState(""),
    [training, setTraining] = useState(trainingOnly),
    [detail, setDetail] = useState<any>(null),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState<"updated" | "name">("updated"),
    [view, setView] = useState<"all" | "personal" | "shared">("all"),
    [folderOpen, setFolderOpen] = useState(false),
    [selectedFileName, setSelectedFileName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const scope = captureAuthScope();
  const key = ["native-repository-files", scope, owner.type, owner.id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<any[]>(
        `/api/work-hub/file-library?orgType=${owner.type}&orgId=${owner.id}`,
        {},
        scope,
      ),
  });
  useEffect(() => {
    let current = true;
    const authScope = captureAuthScope();
    void apiFetch(
      "/api/work-hub/file-library/sync-references",
      { method: "POST", body: JSON.stringify(owner) },
      authScope,
    ).then(() => {
      if (current && isAuthScopeCurrent(authScope))
        void cache.invalidateQueries({ queryKey: ["native-repository-files", authScope, owner.type, owner.id] });
    }).catch(() => {
      // Reference sync is optional for the initial file listing.
    });
    return () => { current = false; };
  }, [cache, owner.type, owner.id]);
  useEffect(() => {
    if (activeTrip) setTrip(activeTrip);
  }, [activeTrip]);
  const attempt = useRef<{
    file: OwnedMeetingFile;
    payload: any;
    op: string;
    reserved?: any;
    uploaded?: boolean;
    finalize: string;
  } | null>(null);
  const card = {
      borderColor: c.primary,
      borderWidth: 2,
      borderRadius: 14,
      padding: 12,
      gap: 10,
      backgroundColor: c.card,
    },
    text = { color: c.text };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={action}
      style={{
        borderWidth: 1,
        borderColor: c.primary,
        borderRadius: 7,
        padding: 10,
        minHeight: 44,
      }}
    >
      <Text style={text}>{label}</Text>
    </Pressable>
  );
  const run = async (fn: (s: any) => Promise<void>) => {
    setBusy(true);
    setError("");
    const authScope = captureAuthScope(),
      controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 120000);
    const assertCurrent = () => {
      if (!isAuthScopeCurrent(authScope))
        throw Error("Company or user changed; reopen this view");
    };
    try {
      await fn({
        authScope,
        signal: controller.signal,
        assertCurrent,
        registerTemporaryCleanup: () => {},
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };
  const stageFile = async (source: "camera" | "files", s: { assertCurrent: () => void }) => {
    const file = await pickMeetingFile(source);
    s.assertCurrent();
    if (!file) return;
    const checksum = Array.from(
      new Uint8Array(
        await Crypto.digest(
          Crypto.CryptoDigestAlgorithm.SHA256,
          new Uint8Array(file.bytes).buffer,
        ),
      ),
    ).map((x) => x.toString(16).padStart(2, "0")).join("");
    attempt.current = {
      file,
      op: nativeUuid(),
      finalize: nativeUuid(),
      payload: {
        scope: "company",
        fileName: file.name,
        contentType: file.type,
        byteSize: file.bytes.byteLength,
        checksumSha256: checksum,
        ...(training ? { purpose: "training" } : {}),
        ...(folder ? { folderId: folder } : {}),
        ...(trip ? { tripId: trip } : {}),
        uploadSource: trip ? "travel" : "repository",
      },
    };
    setSelectedFileName(file.name);
  };
  const upload = (source: "camera" | "files") =>
    void run(async (s) => {
      if (!attempt.current) await stageFile(source, s);
      if (!attempt.current) return;
      const a = attempt.current;
      const command = (payload: unknown, operationId: string) => ({
        owner,
        context: { kind: "organization", id: owner.id },
        payloadVersion: 1,
        expectedVersion: null,
        payload,
        operationId,
      });
      if (!a.reserved)
        a.reserved = (
          await apiFetch<any>(
            "/api/work-hub/file-library/reserve",
            {
              method: "POST",
              body: JSON.stringify(command(a.payload, a.op)),
              signal: s.signal,
            },
            s.authScope,
          )
        ).resource;
      if (!a.uploaded) {
        if (
          !(await uploadWorkHubFile({
            ...s,
            file: a.file,
            uploadURL: a.reserved.uploadURL,
          }))
        )
          throw Error("Upload failed. Retry this staged upload.");
        a.uploaded = true;
      }
      await apiFetch(
        "/api/work-hub/file-library/finalize",
        {
          method: "POST",
          body: JSON.stringify(
            command(
              { id: a.reserved.documentId, fileId: a.reserved.fileId },
              a.finalize,
            ),
          ),
          signal: s.signal,
        },
        s.authScope,
      );
      s.assertCurrent();
      attempt.current = null;
      setSelectedFileName("");
      await cache.invalidateQueries({ queryKey: ["native-repository-files"] });
    });
  const visibleFiles = (q.data ?? [])
    .filter((file: any) => file.data.state === "active" && (!trainingOnly || file.data.purpose === "training"))
    .filter((file: any) => view === "all" || (view === "personal" ? file.data.scope === "personal" : file.data.scope !== "personal"))
    .filter((file: any) => String(file.data.name ?? "").toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a: any, b: any) => sort === "name"
      ? String(a.data.name ?? "").localeCompare(String(b.data.name ?? ""))
      : String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return (
    <View style={card}>
      <Text style={{ ...text, fontWeight: "700" }}>File library</Text>
      <Text style={{ ...text, fontWeight: "600" }}>Sort by</Text>
      {button(sort === "updated" ? "Last updated  ⌄" : "Name  ⌄", () => setSort(sort === "updated" ? "name" : "updated"))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput accessibilityLabel="Search files" placeholder="Search files" placeholderTextColor={c.mutedForeground} value={search} onChangeText={setSearch} style={{ ...text, flex: 1, minHeight: 44, borderWidth: 1, borderColor: c.primary, borderRadius: 20, paddingHorizontal: 12 }} />
        {button(view === "all" ? "All files  ⌄" : view === "personal" ? "Personal  ⌄" : "Company & channel  ⌄", () => setView(view === "all" ? "personal" : view === "personal" ? "shared" : "all"))}
      </View>
      <View style={{ ...card, borderWidth: 1 }}>
        <Text style={{ ...text, fontWeight: "700" }}>↥  Upload a file</Text>
        <Text style={text}>Files are visible to the chosen audience and authorized administrators. Replacement uploads preserve earlier versions. Word and Excel files can be downloaded; edit them in their own applications.</Text>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Text style={text}>Add to…</Text>
          {button(`${(data?.folders ?? []).find((f: any) => f.id === folder)?.data.name ?? "General repository"}  ⌄`, () => setFolderOpen(!folderOpen))}
        </View>
        {folderOpen && <View style={{ gap: 6 }}>
          {button(folder ? "General repository" : "✓ General repository", () => { setFolder(""); setFolderOpen(false); })}
          {(data?.folders ?? []).map((f: any) => button(`${folder === f.id ? "✓ " : ""}${f.data.name}`, () => { setFolder(f.id); setFolderOpen(false); }))}
        </View>}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={text}>Designate as training materials</Text>
          <Switch accessibilityLabel="Designate as training materials" disabled={!!attempt.current} value={training} trackColor={{ false: "#666", true: c.primary }} onValueChange={setTraining} />
        </View>
      {!GATE_ONLY_RELEASE && (
        <>
          <Text style={text}>Associate with authorized Travel</Text>
          {button("No trip", () => setTrip(""))}
          {(data?.trips ?? [])
            .filter((t: any) =>
              ["authorized", "returned"].includes(t.data.status),
            )
            .map((t: any) =>
              button(
                `${trip === t.id ? "✓ " : ""}${t.data.title} · ${t.data.travelerName}`,
                () => setTrip(t.id),
              ),
            )}
        </>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {button("Choose file", () => void run((s) => stageFile("files", s)), !!attempt.current?.reserved)}
        <Text style={text}>{selectedFileName || "No file selected"}</Text>
        {button(attempt.current?.reserved ? "Retry upload" : "Upload", () => upload("files"), !selectedFileName)}
      </View>
      {!attempt.current &&
        button(
          GATE_ONLY_RELEASE
            ? "Capture document photo"
            : "Capture receipt photo",
          () => upload("camera"),
        )}
      </View>
      {error && (
        <Text accessibilityRole="alert" style={text}>
          {error}
        </Text>
      )}
      {q.error && <Text accessibilityRole="alert" style={text}>{q.error.message}</Text>}
      {q.isLoading && <Text style={{ color: c.mutedForeground }}>Loading files…</Text>}
      {!q.isLoading && !q.error && visibleFiles.length === 0 && <Text style={{ color: c.mutedForeground }}>No files match this view.</Text>}
      {visibleFiles.map((f: any) => (
          <View key={f.id}>
            {button(f.data.name, () => {
              setDetail(f);
              setFolder(f.data.folderId ?? "");
              setTrip(f.data.tripId ?? "");
            })}
            <Text style={text}>
              {data?.creators?.find((p: any) => p.id === f.createdBy)?.name ??
                f.createdBy}{" "}
              · {new Date(f.createdAt).toLocaleString()} ·{" "}
              {f.data.uploadSource ?? f.data.scope}
            </Text>
          </View>
        ))}
      {detail && (
        <View style={card}>
          <Text style={{ ...text, fontWeight: "700" }}>{detail.data.name}</Text>
          <Text style={text}>
            Created {new Date(detail.createdAt).toLocaleString()} · Updated{" "}
            {new Date(detail.updatedAt).toLocaleString()}
          </Text>
          {!GATE_ONLY_RELEASE &&
            data?.canManageTraining &&
            detail.data.scope === "company" &&
            onAddTo &&
            button("Add to course / certification…", () => onAddTo(detail))}
          {onUseReceipt &&
            button("Use as this trip's receipt", () => {
              onUseReceipt(detail);
              setDetail(null);
            })}
          {button(
            "Download / print / share",
            () =>
              void run((s) =>
                downloadAndShareProtectedFile(
                  {
                    ...s,
                    fileName: detail.data.name,
                    contentType: detail.data.contentType,
                    byteSize: detail.data.byteSize,
                  },
                  `/api/work-hub/file-library/${detail.id}/download`,
                ),
              ),
          )}
          {detail.canManage && (
            <>
              {!GATE_ONLY_RELEASE && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Switch
                    value={detail.data.purpose === "training"}
                    accessibilityLabel="Training material"
                    trackColor={{ false: "#666", true: c.primary }}
                    onValueChange={(on) =>
                      setDetail({
                        ...detail,
                        data: {
                          ...detail.data,
                          purpose: on ? "training" : null,
                        },
                      })
                    }
                  />
                  <Text style={text}>Training material</Text>
                </View>
              )}
              {button(
                GATE_ONLY_RELEASE
                  ? "Apply selected folder"
                  : "Apply selected folder and trip",
                () =>
                  void save(
                    "file-details",
                    {
                      id: detail.id,
                      training: detail.data.purpose === "training",
                      categoryIds: detail.data.categoryIds ?? [],
                      folderId: folder || null,
                      tripId: trip || null,
                    },
                    detail.data.version ?? 1,
                  ).then((ok) => {
                    if (!ok) return;
                    setDetail(null);
                    void cache.invalidateQueries({
                      queryKey: ["native-repository-files"],
                    });
                  }),
              )}
            </>
          )}
          {button("Close file details", () => setDetail(null))}
        </View>
      )}
    </View>
  );
}
