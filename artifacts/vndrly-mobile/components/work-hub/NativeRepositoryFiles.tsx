import { GATE_ONLY_RELEASE } from "@/lib/gate-release";
import React, { useRef, useState, useEffect } from "react";
import { View, Text, Pressable, Switch } from "react-native";
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const scope = captureAuthScope();
  const key = ["native-repository-files", scope, owner.type, owner.id];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      await apiFetch(
        "/api/work-hub/file-library/sync-references",
        { method: "POST", body: JSON.stringify(owner) },
        scope,
      );
      return apiFetch<any[]>(
        `/api/work-hub/file-library?orgType=${owner.type}&orgId=${owner.id}`,
        {},
        scope,
      );
    },
  });
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
  const button = (label: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
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
  const upload = (source: "camera" | "files") =>
    void run(async (s) => {
      if (!attempt.current) {
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
        )
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
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
      }
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
      await cache.invalidateQueries({ queryKey: ["native-repository-files"] });
    });
  return (
    <View style={card}>
      <Text style={{ ...text, fontWeight: "700" }}>Shared File Library</Text>
      <Text style={text}>Add to…</Text>
      {button(folder ? "General repository" : "✓ General repository", () =>
        setFolder(""),
      )}
      {data.folders.map((f: any) =>
        button(`${folder === f.id ? "✓ " : ""}${f.data.name}`, () =>
          setFolder(f.id),
        ),
      )}
      {!GATE_ONLY_RELEASE && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch
              accessibilityLabel="Designate as training materials"
              disabled={!!attempt.current}
              value={training}
              trackColor={{ false: "#666", true: c.primary }}
              onValueChange={setTraining}
            />
            <Text style={text}>Designate as training materials</Text>
          </View>
          <Text style={text}>Associate with authorized Travel</Text>
          {button("No trip", () => setTrip(""))}
          {data.trips
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
      {button(attempt.current ? "Retry staged upload" : "Upload a file", () =>
        upload("files"),
      )}
      {!attempt.current &&
        button(
          GATE_ONLY_RELEASE
            ? "Capture document photo"
            : "Capture receipt photo",
          () => upload("camera"),
        )}
      {error && (
        <Text accessibilityRole="alert" style={text}>
          {error}
        </Text>
      )}
      {q.data
        ?.filter(
          (f) =>
            f.data.state === "active" &&
            (!trainingOnly || f.data.purpose === "training"),
        )
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((f) => (
          <View key={f.id}>
            {button(f.data.name, () => {
              setDetail(f);
              setFolder(f.data.folderId ?? "");
              setTrip(f.data.tripId ?? "");
            })}
            <Text style={text}>
              {data.creators.find((p: any) => p.id === f.createdBy)?.name ??
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
            data.canManageTraining &&
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
