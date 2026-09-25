import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { pickMeetingFile } from "@/lib/meeting-files";
import { captureAndUploadImage } from "@/lib/photos";
import type { MobileWorkHubCapabilities } from "@/lib/work-hub-mobile";

type Owner = { type: "vendor" | "partner"; id: number };
type FileRow = { id: string; data: { name?: string; scope?: string; state?: string; currentFileId?: string | null }; createdBy?: number; updatedAt?: string; capabilities?: { canDownload: boolean; canManage: boolean } };
type NoteRow = { id: string; channelId: string; title: string; body: string; version: number; createdById: number; createdAt: string; capabilities?: { canEdit: boolean } };
type AssetRow = { id: string; name: string; category?: string; status?: string; condition?: string | null; version?: number; holderUserId?: number | null; currentHolderDisplayName?: string | null; currentLocation?: string | null; hold?: string | null; policy?: { photosRequiredOnCheckout: boolean; photosRequiredOnReturn: boolean; expectedReturnRequired: boolean; supervisorApprovalRequired: boolean }; capabilities?: { canCheckOut: boolean; canReturn: boolean; canVerifyIssued: boolean } };
type Props = { owner: Owner; capabilities: MobileWorkHubCapabilities; files: FileRow[]; notes: NoteRow[]; assets: AssetRow[]; channels: Array<{ id: string; name: string }>; onRefresh: () => void | Promise<void>; selectedAssetId?: string };

const command = (owner: Owner, payload: unknown, expectedVersion: number | null = null) => ({ operationId: crypto.randomUUID(), owner, context: { kind: "organization", id: owner.id }, payloadVersion: 1, expectedVersion, payload });

export function FilesInventory({ owner, capabilities, files, notes, assets, channels, onRefresh, selectedAssetId }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const [channelId, setChannelId] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [custody, setCustody] = useState<{ assetId: string; action: "checkout" | "return" | "verify-issued"; operationId: string } | null>(null);
  const [custodyCondition, setCustodyCondition] = useState("good");
  const [custodyPhotos, setCustodyPhotos] = useState<string[]>([]);
  const [expectedReturn, setExpectedReturn] = useState("");
  const card = { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, padding: 16, gap: 10 } as const;
  const muted = { color: colors.mutedForeground };
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("filesInventory.actionFailed")); }
    finally { setBusy(false); }
  };
  const upload = () => void run(async () => {
    const selectedChannel = channelId || (channels.length === 1 ? channels[0]!.id : "");
    if (!capabilities.canManageAsset && !selectedChannel && channels.length > 0) throw new Error(t("filesInventory.chooseGroup"));
    const picked = await pickMeetingFile("files");
    if (!picked) return;
    const bytes = picked.bytes;
    const checksum = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes.buffer as ArrayBuffer))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const uploadScope = capabilities.canManageAsset ? "company" : selectedChannel ? "channel" : "personal";
    const reserved = await apiFetch<{ resource: { documentId: string; fileId: string; uploadURL: string } }>("/api/work-hub/file-library/reserve", { method: "POST", body: JSON.stringify(command(owner, { scope: uploadScope, ...(uploadScope === "channel" ? { channelId: selectedChannel } : {}), fileName: picked.name, contentType: picked.type, byteSize: picked.size, checksumSha256: checksum })) });
    setNotice(t("filesInventory.reservedNotice", { name: picked.name }));
    const response = await fetch(reserved.resource.uploadURL, { method: "PUT", headers: { "Content-Type": picked.type }, body: new Blob([bytes.buffer as ArrayBuffer], { type: picked.type }) });
    if (!response.ok) throw new Error(t("filesInventory.uploadFailed", { name: picked.name }));
    setNotice(t("filesInventory.uploadedNotice", { name: picked.name }));
    await apiFetch("/api/work-hub/file-library/finalize", { method: "POST", body: JSON.stringify(command(owner, { id: reserved.resource.documentId, fileId: reserved.resource.fileId })) });
    setNotice(t("filesInventory.finalizedNotice", { name: picked.name }));
    await onRefresh();
  });
  const saveNote = () => void run(async () => {
    const targetChannelId = editing?.channelId ?? channelId;
    if (!targetChannelId || !noteTitle.trim()) throw new Error(t("filesInventory.chooseGroupAndTitle"));
    const path = `/api/work-hub/channels/${encodeURIComponent(targetChannelId)}/notes${editing ? `/${encodeURIComponent(editing.id)}` : ""}`;
    await apiFetch(path, { method: editing ? "PATCH" : "POST", body: JSON.stringify(command(owner, { title: noteTitle.trim(), body: noteBody }, editing?.version ?? null)) });
    setNoteOpen(false); setEditing(null); setNoteTitle(""); setNoteBody(""); setNotice(t(editing ? "filesInventory.noteUpdated" : "filesInventory.noteAdded"));
    await onRefresh();
  });
  const openFile = (file: FileRow) => void run(async () => {
    const token = await getToken();
    if (!token || !FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error(t("filesInventory.viewUnavailable"));
    const uri = `${FileSystem.cacheDirectory}work-hub-${file.id}-${Date.now()}`;
    try {
      const result = await FileSystem.downloadAsync(`${getApiBase()}/api/work-hub/file-library/${encodeURIComponent(file.id)}/download`, uri, { headers: { Authorization: `Bearer ${token}`, "x-vndrly-client": "ios" } });
      if (result.status !== 200) throw new Error(t("filesInventory.fileUnavailable"));
      await Sharing.shareAsync(uri, { dialogTitle: file.data.name ?? t("filesInventory.openFile") });
    } finally { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined); }
  });
  const openCustody = (asset: AssetRow, action: "checkout" | "return" | "verify-issued") => {
    setCustody({ assetId: asset.id, action, operationId: crypto.randomUUID() });
    setCustodyCondition(asset.condition && ["new", "good", "fair", "damaged", "missing", "stolen"].includes(asset.condition) ? asset.condition : "good");
    setCustodyPhotos([]);
    setExpectedReturn("");
    setError("");
  };
  const addCustodyPhoto = () => void run(async () => {
    const uploaded = await captureAndUploadImage();
    if (!uploaded) return;
    setCustodyPhotos((current) => [...current, `${getApiBase()}/api/storage${uploaded.objectPath}`]);
    setNotice(t("filesInventory.photoAdded"));
  });
  const submitCustody = (asset: AssetRow) => void run(async () => {
    if (!custody || !asset.version) return;
    const needsPhotos = custody.action === "checkout" ? asset.policy?.photosRequiredOnCheckout : custody.action === "return" ? asset.policy?.photosRequiredOnReturn : false;
    if (needsPhotos && custodyPhotos.length === 0) throw new Error(t("filesInventory.photoRequired"));
    let expectedReturnAt: string | undefined;
    if (custody.action === "checkout" && expectedReturn.trim()) {
      const timestamp = Date.parse(expectedReturn.trim());
      if (!Number.isFinite(timestamp)) throw new Error(t("filesInventory.invalidExpectedReturn"));
      expectedReturnAt = new Date(timestamp).toISOString();
    }
    if (custody.action === "checkout" && asset.policy?.expectedReturnRequired && !expectedReturnAt) throw new Error(t("filesInventory.expectedReturnRequired"));
    try {
      const result = await apiFetch<{ status: "applied" | "conflict" | "blocked"; code?: string }>(`/api/implementation-a/assets/${encodeURIComponent(asset.id)}/${custody.action}`, { method: "POST", body: JSON.stringify({ operationId: custody.operationId, expectedVersion: asset.version, condition: custodyCondition, confirmed: true, photos: custodyPhotos, ...(expectedReturnAt ? { expectedReturnAt } : {}) }) });
      if (result.status === "conflict") {
        setCustody(null);
        await onRefresh();
        setNotice(t("filesInventory.assetChanged"));
        return;
      }
      if (result.status === "blocked") throw new Error(result.code ?? t("filesInventory.actionFailed"));
      setCustody(null);
      setNotice(t("filesInventory.custodyApplied"));
      await onRefresh();
    } catch (cause) {
      if ((cause as { code?: string }).code === "asset.version_conflict") {
        setCustody(null);
        await onRefresh();
        setNotice(t("filesInventory.assetChanged"));
        return;
      }
      throw cause;
    }
  });

  return <View style={{ gap: 14 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text> : null}
    {!selectedAssetId && <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{t("filesInventory.filesNotes")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {capabilities.canUploadFile ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.uploadFile")} disabled={busy} onPress={upload}>{t("filesInventory.uploadFile")}</TogglePillButton> : null}
        {capabilities.canCreateNote ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.addNote")} disabled={busy} onPress={() => { setEditing(null); setNoteTitle(""); setNoteBody(""); setNoteOpen(true); }}>{t("filesInventory.addNote")}</TogglePillButton> : null}
      </View>
      {capabilities.canUploadFile && !capabilities.canManageAsset && channels.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{channels.map(channel => <TogglePillButton key={channel.id} accessibilityLabel={t("filesInventory.fileGroup", { name: channel.name })} solid={channelId === channel.id} onPress={() => setChannelId(channel.id)}>{channel.name}</TogglePillButton>)}</View> : null}
      {noteOpen ? <View style={{ gap: 8 }}>
        {!editing ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{channels.map(channel => <TogglePillButton key={channel.id} accessibilityLabel={t("filesInventory.useGroup", { name: channel.name })} solid={channelId === channel.id} onPress={() => setChannelId(channel.id)}>{channel.name}</TogglePillButton>)}</View> : null}
        <TextInput accessibilityLabel={t("filesInventory.noteTitle")} value={noteTitle} onChangeText={setNoteTitle} placeholder={t("filesInventory.titlePlaceholder")} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10 }} />
        <TextInput accessibilityLabel={t("filesInventory.noteBody")} value={noteBody} onChangeText={setNoteBody} multiline placeholder={t("filesInventory.notePlaceholder")} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10, minHeight: 90 }} />
        <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.saveNote")} disabled={busy} onPress={saveNote}>{t("filesInventory.saveNote")}</TogglePillButton>
      </View> : null}
      {!files.length && !notes.length ? <Text style={muted}>{t("filesInventory.noFilesNotes")}</Text> : null}
      {files.map(file => <View key={file.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{file.data.name ?? t("filesInventory.untitledFile")}</Text>
        <Text style={muted}>{t("filesInventory.fileMetadata", { scope: file.data.scope ?? "company", user: file.createdBy ?? "—", date: file.updatedAt ? new Date(file.updatedAt).toLocaleDateString() : "" })}</Text>
        <Text style={muted}>{t(file.data.currentFileId ? "filesInventory.finalized" : "filesInventory.reserved")}</Text>
        {file.capabilities?.canDownload ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.openNamedFile", { name: file.data.name ?? t("filesInventory.untitledFile") })} disabled={busy} onPress={() => openFile(file)}>{t("filesInventory.openFile")}</TogglePillButton> : null}
      </View>)}
      {notes.map(note => <View key={note.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{note.title}</Text>
        <Text style={muted}>{t("filesInventory.noteMetadata", { user: note.createdById, date: new Date(note.createdAt).toLocaleDateString() })}</Text>
        <Text style={{ color: colors.text }}>{note.body}</Text>
        {capabilities.canEditNote && note.capabilities?.canEdit ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.editNamedNote", { name: note.title })} disabled={busy} onPress={() => { setEditing(note); setNoteTitle(note.title); setNoteBody(note.body); setNoteOpen(true); }}>{t("filesInventory.editNote")}</TogglePillButton> : null}
      </View>)}
    </View>}
    <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{t("filesInventory.inventory")}</Text>
      {!assets.length || selectedAssetId && !assets.some(asset => asset.id === selectedAssetId) ? <Text style={muted}>{t("filesInventory.noInventory")}</Text> : null}
      {assets.filter(asset => !selectedAssetId || asset.id === selectedAssetId).map(asset => <View key={asset.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{asset.name}</Text>
        <Text style={muted}>{[asset.category, asset.status, asset.condition].filter(Boolean).join(" · ")}</Text>
        <Text style={muted}>{[asset.currentHolderDisplayName ? t("filesInventory.heldBy", { name: asset.currentHolderDisplayName }) : null, asset.currentLocation, asset.hold ? t("filesInventory.hold", { reason: asset.hold }) : null].filter(Boolean).join(" · ")}</Text>
        {asset.capabilities?.canCheckOut && capabilities.canCheckOutAsset ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.checkOutNamed", { name: asset.name })} disabled={busy} onPress={() => openCustody(asset, "checkout")}>{t("filesInventory.checkOut")}</TogglePillButton> : null}
        {asset.capabilities?.canReturn && capabilities.canCheckOutAsset ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.returnNamed", { name: asset.name })} disabled={busy} onPress={() => openCustody(asset, "return")}>{t("filesInventory.returnAsset")}</TogglePillButton> : null}
        {asset.capabilities?.canVerifyIssued && capabilities.canVerifyIssuedAsset ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.verifyNamed", { name: asset.name })} disabled={busy} onPress={() => openCustody(asset, "verify-issued")}>{t("filesInventory.verifyIssued")}</TogglePillButton> : null}
        {custody?.assetId === asset.id ? <View style={{ gap: 8 }}>
          <Text style={muted}>{t("filesInventory.custodyConfirmation", { name: asset.name })}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["new", "good", "fair", "damaged", "missing", "stolen"] as const).map(condition => <TogglePillButton key={condition} color="blue" solid={custodyCondition === condition} accessibilityLabel={t(`filesInventory.condition.${condition}`)} onPress={() => setCustodyCondition(condition)}>{t(`filesInventory.condition.${condition}`)}</TogglePillButton>)}</View>
          {custody.action === "checkout" ? <TextInput accessibilityLabel={t("filesInventory.expectedReturn")} value={expectedReturn} onChangeText={setExpectedReturn} placeholder={t("filesInventory.expectedReturnPlaceholder")} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10 }} /> : null}
          <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.addEvidencePhoto")} disabled={busy} onPress={addCustodyPhoto}>{t("filesInventory.addEvidencePhoto")}</TogglePillButton>
          {custodyPhotos.length ? <Text style={muted}>{t("filesInventory.photoCount", { count: custodyPhotos.length })}</Text> : null}
          <TogglePillButton color="blue" accessibilityLabel={t(`filesInventory.confirm.${custody.action}`)} disabled={busy} onPress={() => submitCustody(asset)}>{t(`filesInventory.confirm.${custody.action}`)}</TogglePillButton>
        </View> : null}
      </View>)}
    </View>
  </View>;
}
