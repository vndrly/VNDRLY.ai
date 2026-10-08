import { InventoryManagement } from "./InventoryManagement";
import { InventoryRegistration } from "./InventoryRegistration";
import { makeCustodyAttempt, custodyFingerprintValues, submitCustodyAttempt, CustodyAbsentConflict, type CustodyAttempt } from "@workspace/api-zod";
import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getApiBase } from "@/lib/api";
import { getUser, captureAuthScope, isAuthScopeCurrent, subscribeUser, subscribeToken, type AuthScope } from "@/lib/auth";
import { pickMeetingFile, downloadAndShareProtectedFile, type OwnedMeetingFile } from "@/lib/meeting-files";
import { uploadWorkHubFile } from "@/lib/work-hub-file-upload";
import { nativeUuid } from "@/lib/native-uuid";
import { captureAndUploadImage } from "@/lib/photos";
import type { MobileWorkHubCapabilities } from "@/lib/work-hub-mobile";
import { InventoryRecovery } from "./InventoryRecovery";
import { InventoryTransfer } from "./InventoryTransfer";
import NativeNoteDraft from "./NativeNoteDraft";
import BackgroundWorkHubUpload from "./BackgroundWorkHubUpload";
import { enqueueNativeOperation } from "@/lib/native-operation-journal-runtime";
import { isOfflineWorkHubFailure } from "@/lib/work-hub-queue-runtime";

type Owner = { type: "vendor" | "partner"; id: number };
type FileRow = { id: string; data: { name?: string; scope?: string; state?: string; currentFileId?: string | null; contentType?: string; byteSize?: number }; createdBy?: number; updatedAt?: string; capabilities?: { canDownload: boolean; canManage: boolean } };
type NoteRow = { id: string; channelId: string; title: string; body: string; version: number; createdById: number; createdAt: string; capabilities?: { canEdit: boolean } };
type AssetRow = { id: string; name: string; category?: string; status?: string; condition?: string | null; version?: number; holderUserId?: number | null; currentHolderDisplayName?: string | null; currentLocation?: string | null; hold?: string | null; holds?: { id: string; reason: string; placedAt: string; source: "inventory" | "fleet_maintenance"; canRelease: boolean }[]; policy?: { photosRequiredOnCheckout: boolean; photosRequiredOnReturn: boolean; expectedReturnRequired: boolean; supervisorApprovalRequired: boolean }; capabilities?: { canCheckOut: boolean; canReturn: boolean; canVerifyIssued: boolean; canTransfer?: boolean } };
type ChannelRow = { id: string; name: string; ownerOrgType: Owner["type"]; ownerOrgId: number; contextKind: string; contextId: string | number };
type Props = { owner: Owner; capabilities: MobileWorkHubCapabilities; files: FileRow[]; notes: NoteRow[]; assets: AssetRow[]; channels: ChannelRow[]; onRefresh: () => void | Promise<void>; selectedAssetId?: string };

const command = (owner: Owner, payload: unknown, expectedVersion: number | null = null, context = { kind: "organization", id: owner.id as string | number }) => ({ operationId: nativeUuid(), owner, context, payloadVersion: 1, expectedVersion, payload });
type RequestScope = { authScope: AuthScope; signal: AbortSignal; assertCurrent: () => void; registerTemporaryCleanup: (cleanup: (() => void) | null) => void };
type UploadAttempt = { targetKey: string; file: OwnedMeetingFile; reserve: ReturnType<typeof command>; reserved?: { documentId: string; fileId: string; uploadURL: string; owner?: Owner }; uploaded?: boolean; finalize?: ReturnType<typeof command> };

export function FilesInventory(props: Props) {
  return <FilesInventoryContent key={`${props.owner.type}:${props.owner.id}`} {...props} />;
}

function FilesInventoryContent({ owner, capabilities, files, notes, assets, channels, onRefresh, selectedAssetId }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [backgroundUploadAvailable, setBackgroundUploadAvailable] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const errorId = useId();
  const noteTitleRef = useRef<TextInput>(null);
  const expectedReturnRef = useRef<TextInput>(null);
  const [invalidField, setInvalidField] = useState<"noteTitle" | "expectedReturn" | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const [channelId, setChannelId] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [custody, setCustody] = useState<{ assetId: string; action: "checkout" | "return" | "verify-issued"; operationId: string } | null>(null);
  const custodyAttempt = useRef<CustodyAttempt | null>(null);
  const [custodyUnknown, setCustodyUnknown] = useState(false);
  const [custodyCondition, setCustodyCondition] = useState("good");
  const [custodyPhotos, setCustodyPhotos] = useState<string[]>([]);
  const [expectedReturn, setExpectedReturn] = useState("");
  const [releaseHold, setReleaseHold] = useState<{ assetId: string; holdId: string } | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseUnknown, setReleaseUnknown] = useState(false);
  const releaseAttempt = useRef<{ assetId: string; holdId: string; body: { operationId: string; expectedVersion: number; reason: string } } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const noteAttempt = useRef<{ key: string; body: ReturnType<typeof command> } | null>(null);
  const uploadAttempt = useRef<UploadAttempt | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    const invalidate = () => { requestRef.current?.abort(); cleanupRef.current?.(); noteAttempt.current = null; uploadAttempt.current = null; custodyAttempt.current = null; setCustody(null); setCustodyUnknown(false); releaseAttempt.current = null; setReleaseHold(null); setReleaseReason(""); setReleaseUnknown(false); };
    const unsubscribeUser = subscribeUser(invalidate);
    const unsubscribeToken = subscribeToken(invalidate);
    return () => { mountedRef.current = false; invalidate(); unsubscribeUser(); unsubscribeToken(); };
  }, []);
  const card = { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, padding: 16, gap: 10 } as const;
  const muted = { color: colors.mutedForeground };
  const enumLabel = (kind: "scope" | "status" | "condition", value: string) => t(`filesInventory.${kind}.${value}`, { defaultValue: t("filesInventory.unknownValue") });
  const fieldError = (field: "noteTitle" | "expectedReturn") => ({
    accessibilityHint: invalidField === field ? error : undefined,
    "aria-invalid": invalidField === field,
    "aria-describedby": invalidField === field ? errorId : undefined,
  });
  const run = async (work: (scope: RequestScope) => Promise<void>) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const authScope = captureAuthScope();
    const current = () => mountedRef.current && requestRef.current === controller && !controller.signal.aborted && isAuthScopeCurrent(authScope);
    const assertCurrent = () => { if (!current()) throw Object.assign(new Error("Request authorization changed"), { name: "AbortError" }); };
    setBusy(true); setError(""); setInvalidField(null);
    try { assertCurrent(); await work({ authScope, signal: controller.signal, assertCurrent, registerTemporaryCleanup: cleanup => { cleanupRef.current = cleanup; } }); }
    catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : t("filesInventory.actionFailed"));
        if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0)) {
          noteAttempt.current = null; uploadAttempt.current = null;
          releaseAttempt.current = null; setReleaseHold(null); setReleaseUnknown(false);
          await onRefresh();
        }
      }
    }
    finally { if (current()) setBusy(false); if (requestRef.current === controller) requestRef.current = null; }
  };
  const channelTarget = (id: string) => {
    const channel = channels.find(item => item.id === id);
    if (!channel) throw new Error(t("filesInventory.chooseGroup"));
    return { owner: { type: channel.ownerOrgType, id: channel.ownerOrgId }, context: { kind: channel.contextKind, id: channel.contextId } };
  };
  const upload = () => void run(async (scope) => {
    const selectedChannel = channelId || (!capabilities.canManageAsset && channels.length === 1 ? channels[0]!.id : "");
    if (!capabilities.canManageAsset && !selectedChannel && channels.length > 0) throw new Error(t("filesInventory.chooseGroup"));
    const uploadScope = selectedChannel ? "channel" : capabilities.canManageAsset ? "company" : "personal";
    const targetOwner = uploadScope === "channel" ? channelTarget(selectedChannel).owner : owner;
    // File-library envelopes require the document owner's organization context;
    // the channel itself remains in the reserve payload for ACL enforcement.
    const target = { owner: targetOwner, context: { kind: "organization", id: targetOwner.id } };
    const targetKey = JSON.stringify({ ...target, uploadScope, channelId: selectedChannel });
    if (!uploadAttempt.current || uploadAttempt.current.targetKey !== targetKey) {
      const picked = await pickMeetingFile("files"); scope.assertCurrent();
      if (!picked) return;
      const bytes = new Uint8Array(picked.bytes);
      const checksum = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes.buffer))).map(byte => byte.toString(16).padStart(2, "0")).join("");
      scope.assertCurrent();
      uploadAttempt.current = { targetKey, file: { ...picked, bytes, size: bytes.byteLength }, reserve: command(target.owner, { scope: uploadScope, ...(uploadScope === "channel" ? { channelId: selectedChannel } : {}), fileName: picked.name, contentType: picked.type, byteSize: bytes.byteLength, checksumSha256: checksum }, null, target.context) };
    }
    const attempt = uploadAttempt.current;
    if (!attempt.reserved) {
      const reserved = await apiFetch<{ resource: NonNullable<UploadAttempt["reserved"]> }>("/api/work-hub/file-library/reserve", { method: "POST", body: JSON.stringify(attempt.reserve), signal: scope.signal }, scope.authScope);
      scope.assertCurrent(); attempt.reserved = reserved.resource;
    }
    if (!attempt.uploaded) {
      setNotice(t("filesInventory.reservedNotice", { name: attempt.file.name }));
      if (!await uploadWorkHubFile({ ...scope, file: attempt.file, uploadURL: attempt.reserved.uploadURL })) throw new Error(t("filesInventory.uploadFailed", { name: attempt.file.name }));
      scope.assertCurrent(); attempt.uploaded = true;
    }
    setNotice(t("filesInventory.uploadedNotice", { name: attempt.file.name }));
    attempt.finalize ??= command(attempt.reserved.owner ?? attempt.reserve.owner, { id: attempt.reserved.documentId, fileId: attempt.reserved.fileId });
    await apiFetch("/api/work-hub/file-library/finalize", { method: "POST", body: JSON.stringify(attempt.finalize), signal: scope.signal }, scope.authScope);
    scope.assertCurrent(); uploadAttempt.current = null;
    setNotice(t("filesInventory.finalizedNotice", { name: attempt.file.name }));
    await onRefresh();
  });
  const saveNote = () => void run(async (scope) => {
    const targetChannelId = editing?.channelId ?? channelId;
    if (!targetChannelId || !noteTitle.trim()) {
      if (!noteTitle.trim()) { setInvalidField("noteTitle"); noteTitleRef.current?.focus(); }
      throw new Error(t("filesInventory.chooseGroupAndTitle"));
    }
    const path = `/api/work-hub/channels/${encodeURIComponent(targetChannelId)}/notes${editing ? `/${encodeURIComponent(editing.id)}` : ""}`;
    const target = channelTarget(targetChannelId);
    const payload = { title: noteTitle.trim(), body: noteBody };
    const key = JSON.stringify({ path, ...target, payload, version: editing?.version ?? null });
    if (noteAttempt.current?.key !== key) noteAttempt.current = { key, body: command(target.owner, payload, editing?.version ?? null, target.context) };
    try { await apiFetch(path, { method: editing ? "PATCH" : "POST", body: JSON.stringify(noteAttempt.current.body), signal: scope.signal }, scope.authScope); }
    catch (cause) {
      scope.assertCurrent();
      if (!isOfflineWorkHubFailure(cause)) throw cause;
      const user = await getUser(); scope.assertCurrent(); if (!user) throw cause;
      await enqueueNativeOperation(user, { domain: "note", operationId: noteAttempt.current.body.operationId, capturedAt: new Date().toISOString(), payload: { path, method: editing ? "PATCH" : "POST", command: noteAttempt.current.body } });
      scope.assertCurrent(); noteAttempt.current = null; setNoteOpen(false); setEditing(null); setNoteTitle(""); setNoteBody(""); setNotice(t("nativeJournal.pending")); return;
    }
    scope.assertCurrent(); noteAttempt.current = null;
    setNoteOpen(false); setEditing(null); setNoteTitle(""); setNoteBody(""); setNotice(t(editing ? "filesInventory.noteUpdated" : "filesInventory.noteAdded"));
    await onRefresh();
  });
  const openFile = (file: FileRow) => void run(async (scope) => {
    if (!file.capabilities?.canDownload || !file.data.contentType || !file.data.byteSize) throw new Error(t("filesInventory.fileUnavailable"));
    await downloadAndShareProtectedFile({ ...scope, fileName: file.data.name ?? t("filesInventory.openFile"), contentType: file.data.contentType, byteSize: file.data.byteSize }, `/api/work-hub/file-library/${encodeURIComponent(file.id)}/download`);
  });
  const openCustody = (asset: AssetRow, action: "checkout" | "return" | "verify-issued") => {
    if (custodyAttempt.current) return;
    setCustodyUnknown(false);
    setCustody({ assetId: asset.id, action, operationId: nativeUuid() });
    setCustodyCondition(asset.condition && ["new", "good", "fair", "damaged", "missing", "stolen"].includes(asset.condition) ? asset.condition : "good");
    setCustodyPhotos([]);
    setExpectedReturn("");
    setError("");
  };
  const addCustodyPhoto = () => void run(async (scope) => {
    const uploaded = await captureAndUploadImage();
    scope.assertCurrent();
    if (!uploaded) return;
    setCustodyPhotos((current) => [...current, `${getApiBase()}/api/storage${uploaded.objectPath}`]);
    setNotice(t("filesInventory.photoAdded"));
  });
  const submitCustody = (asset: AssetRow) => void run(async (scope) => {
    if (!custody || !asset.version) return;
    const needsPhotos = custody.action === "checkout" ? asset.policy?.photosRequiredOnCheckout : custody.action === "return" ? asset.policy?.photosRequiredOnReturn : false;
    if (!custodyAttempt.current && needsPhotos && custodyPhotos.length === 0) throw new Error(t("filesInventory.photoRequired"));
    let expectedReturnAt: string | undefined;
    if (custody.action === "checkout" && expectedReturn.trim()) {
      const timestamp = Date.parse(expectedReturn.trim());
      if (!Number.isFinite(timestamp)) {
        setInvalidField("expectedReturn"); expectedReturnRef.current?.focus();
        throw new Error(t("filesInventory.invalidExpectedReturn"));
      }
      expectedReturnAt = new Date(timestamp).toISOString();
    }
    if (!custodyAttempt.current && custody.action === "checkout" && asset.policy?.expectedReturnRequired && !expectedReturnAt) {
      setInvalidField("expectedReturn"); expectedReturnRef.current?.focus();
      throw new Error(t("filesInventory.expectedReturnRequired"));
    }
    try {
      if (!custodyAttempt.current) {
        const user = await getUser(); scope.assertCurrent();
        if (!user) throw Error(t("filesInventory.actionFailed"));
        const raw = { assetId: asset.id, action: custody.action, actorUserId: user.id, holderUserId: asset.holderUserId ?? null, input: { operationId: custody.operationId, expectedVersion: asset.version, condition: custodyCondition, confirmed: true, photos: custodyPhotos, ...(expectedReturnAt ? { expectedReturnAt } : {}) } };
        const bytes = new TextEncoder().encode(JSON.stringify(custodyFingerprintValues(raw)));
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes); scope.assertCurrent();
        const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        custodyAttempt.current = makeCustodyAttempt(raw, fingerprint);
      }
      setCustodyUnknown(true);
      await submitCustodyAttempt(custodyAttempt.current, (path, init) => apiFetch(path, { ...init, signal: scope.signal }, scope.authScope), () => { try { scope.assertCurrent(); return true; } catch { return false; } });
      scope.assertCurrent(); custodyAttempt.current = null; setCustodyUnknown(false); setCustody(null);
      setNotice(t("filesInventory.custodyApplied"));
      try { await onRefresh(); } catch { scope.assertCurrent(); setNotice(t("inventoryCustody.savedRefresh")); }
    } catch (cause) {
      scope.assertCurrent();
      if (isOfflineWorkHubFailure(cause) && custodyAttempt.current) {
        const user = await getUser(); scope.assertCurrent(); if (!user) throw cause;
        const attempt = custodyAttempt.current;
        await enqueueNativeOperation(user, { domain: "custody", operationId: attempt.input.operationId, capturedAt: new Date().toISOString(), payload: { assetId: attempt.assetId, action: attempt.action, actorUserId: attempt.actorUserId, holderUserId: attempt.holderUserId, input: attempt.input, fingerprint: attempt.fingerprint } });
        scope.assertCurrent(); custodyAttempt.current = null; setCustodyUnknown(false); setCustody(null); setNotice(t("nativeJournal.inventoryPending")); return;
      }
      if (cause instanceof CustodyAbsentConflict) {
        custodyAttempt.current = null; setCustodyUnknown(false); setCustody(null);
        await onRefresh(); scope.assertCurrent(); setNotice(t("filesInventory.assetChanged")); return;
      }
      throw cause;
    }
  });

  const submitHoldRelease = (asset: AssetRow) => void run(async (scope) => {
    if (!releaseHold || releaseHold.assetId !== asset.id) return;
    const hold = asset.holds?.find(item => item.id === releaseHold.holdId);
    if (!releaseAttempt.current) {
      if (!hold?.canRelease || hold.source !== "inventory" || !asset.version) throw new Error(t("filesInventory.actionFailed"));
      if (!releaseReason.trim() || releaseReason.trim().length > 2000) throw new Error(t("filesInventory.holdReleaseReasonRequired"));
      releaseAttempt.current = { ...releaseHold, body: { operationId: nativeUuid(), expectedVersion: asset.version, reason: releaseReason.trim() } };
    }
    const attempt = releaseAttempt.current;
    if (attempt.assetId !== asset.id || attempt.holdId !== releaseHold.holdId) throw new Error(t("filesInventory.actionFailed"));
    try {
      const result = await apiFetch<{ assetId: string; holdId: string; operationId: string; version: number; status: string; physicalRepairVerified: false }>(`/api/implementation-a/assets/${encodeURIComponent(attempt.assetId)}/holds/${encodeURIComponent(attempt.holdId)}/release`, { method: "POST", body: JSON.stringify(attempt.body), signal: scope.signal }, scope.authScope);
      scope.assertCurrent();
      if (result.assetId !== attempt.assetId || result.holdId !== attempt.holdId || result.operationId !== attempt.body.operationId || result.status !== "applied" || result.version !== attempt.body.expectedVersion + 1 || result.physicalRepairVerified !== false) throw new Error(t("filesInventory.holdReleaseUnknown"));
      releaseAttempt.current = null; setReleaseHold(null); setReleaseUnknown(false); setReleaseReason("");
      setNotice(t("filesInventory.holdReleased"));
      await onRefresh();
    } catch (cause) {
      scope.assertCurrent();
      const status = (cause as { status?: number }).status;
      if (status === 409 || (cause as { code?: string }).code === "asset.version_conflict") {
        releaseAttempt.current = null; setReleaseHold(null); setReleaseUnknown(false);
        await onRefresh(); scope.assertCurrent(); setNotice(t("filesInventory.assetChanged")); return;
      }
      if (status === undefined || status >= 500) setReleaseUnknown(true);
      else releaseAttempt.current = null;
      throw cause;
    }
  });

  return <View style={{ gap: 14 }}>
    {error ? <Text nativeID={errorId} accessibilityRole="alert" style={{ color: colors.text, backgroundColor: colors.card, borderColor: colors.destructive, borderWidth: 1, borderRadius: 6, padding: 8 }}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text> : null}
    {!selectedAssetId && <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{t("filesInventory.filesNotes")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {capabilities.canUploadFile && !backgroundUploadAvailable ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.uploadFile")} disabled={busy} onPress={upload}>{t("filesInventory.uploadFile")}</TogglePillButton> : null}
        {capabilities.canCreateNote ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.addNote")} disabled={busy} onPress={() => { noteAttempt.current = null; setEditing(null); setNoteTitle(""); setNoteBody(""); setNoteOpen(true); }}>{t("filesInventory.addNote")}</TogglePillButton> : null}
      </View>
      {capabilities.canUploadFile && !capabilities.canManageAsset && channels.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{channels.map(channel => <TogglePillButton key={channel.id} accessibilityLabel={t("filesInventory.fileGroup", { name: channel.name })} accessibilityState={{ selected: channelId === channel.id }} disabled={busy} solid={channelId === channel.id} onPress={() => setChannelId(channel.id)}>{channel.name}</TogglePillButton>)}</View> : null}
      {capabilities.canUploadFile ? <BackgroundWorkHubUpload target={{owner: channelId || (!capabilities.canManageAsset && channels.length === 1) ? channelTarget(channelId || channels[0]!.id).owner : owner, scope: channelId || (!capabilities.canManageAsset && channels.length === 1) ? "channel" : capabilities.canManageAsset ? "company" : "personal", channelId: channelId || (!capabilities.canManageAsset && channels.length === 1 ? channels[0]!.id : undefined)}} disabled={busy || (!capabilities.canManageAsset && channels.length > 1 && !channelId)} onAvailability={setBackgroundUploadAvailable} onSaved={onRefresh} /> : null}
      {noteOpen ? <View style={{ gap: 8 }}>
        {!editing ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{channels.map(channel => <TogglePillButton key={channel.id} accessibilityLabel={t("filesInventory.useGroup", { name: channel.name })} accessibilityState={{ selected: channelId === channel.id }} disabled={busy} solid={channelId === channel.id} onPress={() => setChannelId(channel.id)}>{channel.name}</TogglePillButton>)}</View> : null}
        <TextInput ref={noteTitleRef} {...fieldError("noteTitle")} accessibilityLabel={t("filesInventory.noteTitle")} editable={!busy} value={noteTitle} onChangeText={setNoteTitle} placeholder={t("filesInventory.titlePlaceholder")} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10, minHeight: 44 }} />
        <TextInput accessibilityLabel={t("filesInventory.noteBody")} editable={!busy} value={noteBody} onChangeText={setNoteBody} multiline placeholder={t("filesInventory.notePlaceholder")} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10, minHeight: 90 }} />
        <NativeNoteDraft key={`${owner.type}:${owner.id}:${editing?.id ?? "new"}:${editing?.version ?? 0}:${editing?.channelId ?? channelId}`} value={noteBody} disabled={busy} onChange={setNoteBody} onBusy={setBusy} />
        <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.saveNote")} disabled={busy} onPress={saveNote}>{t("filesInventory.saveNote")}</TogglePillButton>
      </View> : null}
      {!files.length && !notes.length ? <Text style={muted}>{t("filesInventory.noFilesNotes")}</Text> : null}
      {files.map(file => <View key={file.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{file.data.name ?? t("filesInventory.untitledFile")}</Text>
        <Text style={muted}>{t("filesInventory.fileMetadata", { scope: enumLabel("scope", file.data.scope ?? "company"), user: file.createdBy ?? "—", date: file.updatedAt ? new Date(file.updatedAt).toLocaleDateString() : "" })}</Text>
        <Text style={muted}>{t(file.data.currentFileId ? "filesInventory.finalized" : "filesInventory.reserved")}</Text>
        {file.capabilities?.canDownload ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.openNamedFile", { name: file.data.name ?? t("filesInventory.untitledFile") })} disabled={busy} onPress={() => openFile(file)}>{t("filesInventory.openFile")}</TogglePillButton> : null}
      </View>)}
      {notes.map(note => <View key={note.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{note.title}</Text>
        <Text style={muted}>{t("filesInventory.noteMetadata", { user: note.createdById, date: new Date(note.createdAt).toLocaleDateString() })}</Text>
        <Text style={{ color: colors.text }}>{note.body}</Text>
        {capabilities.canEditNote && note.capabilities?.canEdit ? <TogglePillButton color="brand" accessibilityLabel={t("filesInventory.editNamedNote", { name: note.title })} disabled={busy} onPress={() => { noteAttempt.current = null; setEditing(note); setNoteTitle(note.title); setNoteBody(note.body); setNoteOpen(true); }}>{t("filesInventory.editNote")}</TogglePillButton> : null}
      </View>)}
    </View>}
    <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{t("filesInventory.inventory")}</Text>
      {!assets.length || selectedAssetId && !assets.some(asset => asset.id === selectedAssetId) ? <Text style={muted}>{t("filesInventory.noInventory")}</Text> : null}
      <InventoryRegistration owner={owner} canManage={capabilities.canCreateAsset && capabilities.canManageAsset} onSaved={onRefresh} />
      {assets.filter(asset => !selectedAssetId || asset.id === selectedAssetId).map((asset,index) => <View key={asset.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{asset.name}</Text>
        <InventoryTransfer assetId={asset.id} owner={owner} canTransfer={asset.capabilities?.canTransfer === true} onRefresh={onRefresh} />
        <InventoryRecovery assetId={asset.id} owner={owner} canManage={capabilities.canManageAsset} onRefresh={onRefresh} includePlatformQueue={index===0}/>
        {asset.category && asset.status && asset.version && <InventoryManagement owner={owner} asset={{...asset,category:asset.category,status:asset.status,version:asset.version}} assets={assets.filter((a): a is AssetRow & {category:string;status:string;version:number} => !!a.category && !!a.status && !!a.version)} canManage={capabilities.canManageAsset} onSaved={onRefresh} />}
        <InventoryRegistration owner={owner} assetId={asset.id} version={asset.version} canManage={capabilities.canManageAsset} onSaved={onRefresh} />
        <Text style={muted}>{[asset.category, asset.status ? enumLabel("status", asset.status) : null, asset.condition ? enumLabel("condition", asset.condition) : null].filter(Boolean).join(" · ")}</Text>
        <Text style={muted}>{[asset.currentHolderDisplayName ? t("filesInventory.heldBy", { name: asset.currentHolderDisplayName }) : null, asset.currentLocation, asset.hold ? t("filesInventory.hold", { reason: asset.hold }) : null].filter(Boolean).join(" · ")}</Text>
        {[...(asset.holds ?? []), ...(releaseUnknown && releaseAttempt.current?.assetId === asset.id && !asset.holds?.some(hold => hold.id === releaseAttempt.current?.holdId) ? [{ id: releaseAttempt.current.holdId, reason: t("filesInventory.holdReleaseUnknown"), placedAt: "", source: "inventory" as const, canRelease: false }] : [])].map(hold => <View key={hold.id} style={{ gap: 6 }}>
          <Text style={muted}>{hold.reason}</Text>
          {hold.canRelease && hold.source === "inventory" && asset.version ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.releaseNamedHold", { name: hold.reason })} disabled={busy || releaseUnknown} onPress={() => { releaseAttempt.current = null; setReleaseHold({ assetId: asset.id, holdId: hold.id }); setReleaseReason(""); setReleaseUnknown(false); }}>{t("filesInventory.releaseHold")}</TogglePillButton> : null}
          {releaseHold?.assetId === asset.id && releaseHold.holdId === hold.id ? <View style={{ gap: 8 }}>
            <Text style={muted}>{t("filesInventory.holdReleaseConfirmation")}</Text>
            <TextInput accessibilityLabel={t("filesInventory.releaseHoldReason")} editable={!busy && !releaseUnknown} value={releaseReason} onChangeText={setReleaseReason} maxLength={2000} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10, minHeight: 44 }} />
            {releaseUnknown ? <Text style={muted}>{t("filesInventory.holdReleaseUnknown")}</Text> : null}
            <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.confirmHoldRelease")} disabled={busy} onPress={() => submitHoldRelease(asset)}>{t("filesInventory.confirmHoldRelease")}</TogglePillButton>
          </View> : null}
        </View>)}
        {asset.capabilities?.canCheckOut && capabilities.canCheckOutAsset ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.checkOutNamed", { name: asset.name })} disabled={busy || custodyUnknown} onPress={() => openCustody(asset, "checkout")}>{t("filesInventory.checkOut")}</TogglePillButton> : null}
        {asset.capabilities?.canReturn && capabilities.canCheckOutAsset ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.returnNamed", { name: asset.name })} disabled={busy || custodyUnknown} onPress={() => openCustody(asset, "return")}>{t("filesInventory.returnAsset")}</TogglePillButton> : null}
        {asset.capabilities?.canVerifyIssued && capabilities.canVerifyIssuedAsset ? <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.verifyNamed", { name: asset.name })} disabled={busy || custodyUnknown} onPress={() => openCustody(asset, "verify-issued")}>{t("filesInventory.verifyIssued")}</TogglePillButton> : null}
        {custody?.assetId === asset.id ? <View style={{ gap: 8 }}>
          <Text style={muted}>{t("filesInventory.custodyConfirmation", { name: asset.name })}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["new", "good", "fair", "damaged", "missing", "stolen"] as const).map(condition => <TogglePillButton key={condition} color="blue" solid={custodyCondition === condition} accessibilityState={{ selected: custodyCondition === condition }} disabled={busy || custodyUnknown} accessibilityLabel={t(`filesInventory.condition.${condition}`)} onPress={() => setCustodyCondition(condition)}>{t(`filesInventory.condition.${condition}`)}</TogglePillButton>)}</View>
          {custody.action === "checkout" ? <TextInput ref={expectedReturnRef} {...fieldError("expectedReturn")} accessibilityLabel={t("filesInventory.expectedReturn")} editable={!busy && !custodyUnknown} value={expectedReturn} onChangeText={setExpectedReturn} placeholder={t("filesInventory.expectedReturnPlaceholder")} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10, minHeight: 44 }} /> : null}
          <TogglePillButton color="blue" accessibilityLabel={t("filesInventory.addEvidencePhoto")} disabled={busy || custodyUnknown} onPress={addCustodyPhoto}>{t("filesInventory.addEvidencePhoto")}</TogglePillButton>
          {custodyPhotos.length ? <Text style={muted}>{t("filesInventory.photoCount", { count: custodyPhotos.length })}</Text> : null}
          {custodyUnknown ? <Text style={muted}>{t("inventoryCustody.unknown")}</Text> : null}
          <TogglePillButton color="blue" accessibilityLabel={custodyUnknown ? t("inventoryCustody.retry") : t(`filesInventory.confirm.${custody.action}`)} disabled={busy} onPress={() => submitCustody(asset)}>{custodyUnknown ? t("inventoryCustody.retry") : t(`filesInventory.confirm.${custody.action}`)}</TogglePillButton>
        </View> : null}
      </View>)}
    </View>
  </View>;
}
