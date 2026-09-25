import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { pickMeetingFile } from "@/lib/meeting-files";
import type { MobileWorkHubCapabilities } from "@/lib/work-hub-mobile";

type Owner = { type: "vendor" | "partner"; id: number };
type FileRow = { id: string; data: { name?: string; scope?: string; state?: string; currentFileId?: string | null }; createdBy?: number; updatedAt?: string; capabilities?: { canDownload: boolean; canManage: boolean } };
type NoteRow = { id: string; channelId: string; title: string; body: string; version: number; createdById: number; createdAt: string; capabilities?: { canEdit: boolean } };
type AssetRow = { id: string; name: string; category?: string; status?: string; condition?: string; version?: number; holderUserId?: number | null; currentHolderDisplayName?: string | null; currentLocation?: string | null; hold?: string | null };
type Props = { owner: Owner; userId?: number; capabilities: MobileWorkHubCapabilities; files: FileRow[]; notes: NoteRow[]; assets: AssetRow[]; channels: Array<{ id: string; name: string }>; onRefresh: () => void | Promise<void> };

const command = (owner: Owner, payload: unknown, expectedVersion: number | null = null) => ({ operationId: crypto.randomUUID(), owner, context: { kind: "organization", id: owner.id }, payloadVersion: 1, expectedVersion, payload });

export function FilesInventory({ owner, userId, capabilities, files, notes, assets, channels, onRefresh }: Props) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const [channelId, setChannelId] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const card = { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, padding: 16, gap: 10 } as const;
  const muted = { color: colors.mutedForeground };
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const upload = () => void run(async () => {
    const selectedChannel = channelId || (channels.length === 1 ? channels[0]!.id : "");
    if (!capabilities.canManageAsset && !selectedChannel) throw new Error("Choose a group for this file.");
    const picked = await pickMeetingFile("files");
    if (!picked) return;
    const bytes = picked.bytes;
    const checksum = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes.buffer as ArrayBuffer))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const reserved = await apiFetch<{ resource: { documentId: string; fileId: string; uploadURL: string } }>("/api/work-hub/file-library/reserve", { method: "POST", body: JSON.stringify(command(owner, { scope: capabilities.canManageAsset ? "company" : "channel", ...(capabilities.canManageAsset ? {} : { channelId: selectedChannel }), fileName: picked.name, contentType: picked.type, byteSize: picked.size, checksumSha256: checksum })) });
    setNotice(`${picked.name}: reserved. Uploading…`);
    const response = await fetch(reserved.resource.uploadURL, { method: "PUT", headers: { "Content-Type": picked.type }, body: new Blob([bytes.buffer as ArrayBuffer], { type: picked.type }) });
    if (!response.ok) throw new Error(`${picked.name}: upload failed; reservation remains unfinalized.`);
    setNotice(`${picked.name}: uploaded. Finalizing…`);
    await apiFetch("/api/work-hub/file-library/finalize", { method: "POST", body: JSON.stringify(command(owner, { id: reserved.resource.documentId, fileId: reserved.resource.fileId })) });
    setNotice(`${picked.name}: finalized and private.`);
    await onRefresh();
  });
  const saveNote = () => void run(async () => {
    const targetChannelId = editing?.channelId ?? channelId;
    if (!targetChannelId || !noteTitle.trim()) throw new Error("Choose a group and enter a title.");
    const path = `/api/work-hub/channels/${encodeURIComponent(targetChannelId)}/notes${editing ? `/${encodeURIComponent(editing.id)}` : ""}`;
    await apiFetch(path, { method: editing ? "PATCH" : "POST", body: JSON.stringify(command(owner, { title: noteTitle.trim(), body: noteBody }, editing?.version ?? null)) });
    setNoteOpen(false); setEditing(null); setNoteTitle(""); setNoteBody(""); setNotice(editing ? "Note updated." : "Note added.");
    await onRefresh();
  });
  const openFile = (file: FileRow) => void run(async () => {
    const token = await getToken();
    if (!token || !FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error("File viewing is unavailable on this device.");
    const uri = `${FileSystem.cacheDirectory}work-hub-${file.id}-${Date.now()}`;
    try {
      const result = await FileSystem.downloadAsync(`${getApiBase()}/api/work-hub/file-library/${encodeURIComponent(file.id)}/download`, uri, { headers: { Authorization: `Bearer ${token}`, "x-vndrly-client": "ios" } });
      if (result.status !== 200) throw new Error("This file is no longer available.");
      await Sharing.shareAsync(uri, { dialogTitle: file.data.name ?? "Open file" });
    } finally { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined); }
  });
  const changeCustody = (asset: AssetRow, action: "checkout" | "return") => void run(async () => {
    const result = await apiFetch<{ status: "applied" | "conflict" | "blocked"; code?: string }>(`/api/implementation-a/assets/${encodeURIComponent(asset.id)}/${action}`, { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), expectedVersion: asset.version, condition: asset.condition ?? "good", confirmed: true, photos: [] }) });
    if (result.status !== "applied") throw new Error(result.code ?? "Equipment custody changed; refresh and try again.");
    setNotice(action === "checkout" ? "Equipment checked out." : "Equipment returned.");
    await onRefresh();
  });

  return <View style={{ gap: 14 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text> : null}
    <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>Files & Notes</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {capabilities.canUploadFile ? <TogglePillButton color="brand" accessibilityLabel="Upload File" disabled={busy} onPress={upload}>Upload File</TogglePillButton> : null}
        {capabilities.canCreateNote ? <TogglePillButton color="brand" accessibilityLabel="Add Note" disabled={busy} onPress={() => { setEditing(null); setNoteTitle(""); setNoteBody(""); setNoteOpen(true); }}>Add Note</TogglePillButton> : null}
      </View>
      {capabilities.canUploadFile && !capabilities.canManageAsset && channels.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{channels.map(channel => <TogglePillButton key={channel.id} accessibilityLabel={`File group ${channel.name}`} solid={channelId === channel.id} onPress={() => setChannelId(channel.id)}>{channel.name}</TogglePillButton>)}</View> : null}
      {noteOpen ? <View style={{ gap: 8 }}>
        {!editing ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{channels.map(channel => <TogglePillButton key={channel.id} accessibilityLabel={`Use ${channel.name}`} solid={channelId === channel.id} onPress={() => setChannelId(channel.id)}>{channel.name}</TogglePillButton>)}</View> : null}
        <TextInput accessibilityLabel="Note title" value={noteTitle} onChangeText={setNoteTitle} placeholder="Title" style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10 }} />
        <TextInput accessibilityLabel="Note body" value={noteBody} onChangeText={setNoteBody} multiline placeholder="Note" style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10, minHeight: 90 }} />
        <TogglePillButton color="brand" accessibilityLabel="Save Note" disabled={busy} onPress={saveNote}>Save Note</TogglePillButton>
      </View> : null}
      {!files.length && !notes.length ? <Text style={muted}>No files or notes available.</Text> : null}
      {files.map(file => <View key={file.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{file.data.name ?? "Untitled file"}</Text>
        <Text style={muted}>File · {file.data.scope ?? "company"} · User {file.createdBy ?? "—"} · {file.updatedAt ? new Date(file.updatedAt).toLocaleDateString() : ""}</Text>
        <Text style={muted}>{file.data.currentFileId ? "Finalized" : "Reserved — upload is not finalized"}</Text>
        {file.capabilities?.canDownload ? <TogglePillButton color="brand" accessibilityLabel={`Open ${file.data.name ?? "file"}`} disabled={busy} onPress={() => openFile(file)}>Open file</TogglePillButton> : null}
      </View>)}
      {notes.map(note => <View key={note.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{note.title}</Text>
        <Text style={muted}>Note · User {note.createdById} · {new Date(note.createdAt).toLocaleDateString()}</Text>
        <Text style={{ color: colors.text }}>{note.body}</Text>
        {capabilities.canEditNote && note.capabilities?.canEdit ? <TogglePillButton color="brand" accessibilityLabel={`Edit ${note.title}`} disabled={busy} onPress={() => { setEditing(note); setNoteTitle(note.title); setNoteBody(note.body); setNoteOpen(true); }}>Edit note</TogglePillButton> : null}
      </View>)}
    </View>
    <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>Inventory</Text>
      {!assets.length ? <Text style={muted}>No inventory items available.</Text> : null}
      {assets.map(asset => <View key={asset.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{asset.name}</Text>
        <Text style={muted}>{[asset.category, asset.status, asset.condition].filter(Boolean).join(" · ")}</Text>
        <Text style={muted}>{[asset.currentHolderDisplayName ? `Held by ${asset.currentHolderDisplayName}` : null, asset.currentLocation, asset.hold ? `Hold: ${asset.hold}` : null].filter(Boolean).join(" · ")}</Text>
        {!asset.hold && capabilities.canCheckOutAsset && asset.status === "available" ? <TogglePillButton color="brand" accessibilityLabel={`Check out ${asset.name}`} disabled={busy} onPress={() => changeCustody(asset, "checkout")}>Check out</TogglePillButton> : null}
        {capabilities.canCheckOutAsset && userId && asset.holderUserId === userId ? <TogglePillButton color="brand" accessibilityLabel={`Return ${asset.name}`} disabled={busy} onPress={() => changeCustody(asset, "return")}>Return</TogglePillButton> : null}
      </View>)}
    </View>
  </View>;
}
