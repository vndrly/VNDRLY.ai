import React, { useEffect, useRef, useState } from "react";
import { Image, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { scanWorkDocumentDraft } from "@/lib/native-work-capture";
import { discardScannedWorkPages } from "@/lib/work-hub-background-upload-native";
import { uploadAsset } from "@/lib/photos";
import { nativeUuid } from "@/lib/native-uuid";
type Visit = { id: number; firstName?: string | null; lastName?: string | null; siteLocationId: number };
type Fields = { firstName: string; lastName: string; documentType: string; issuingRegion: string; documentLastFour: string; expiresOn: string };
type Review = { visit: Visit; operationId: string; uri: string; source: "visionkit_document_scan" | "camera_manual_review"; fileIds: string[]; ocr: string; capturedAt: string; objectPath?: string; submittedFields?: Record<string, string>; scope: ReturnType<typeof captureAuthScope> };
export default function GateIdentityDocument({ visits, siteId }: { visits: Visit[]; siteId: number | null }) {
  const { t } = useTranslation(), colors = useColors();
  const [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [fields, setFields] = useState<Fields>({ firstName: "", lastName: "", documentType: "", issuingRegion: "", documentLastFour: "", expiresOn: "" });
  const [saved, setSaved] = useState<{ visitId: number; expiresAt: string } | null>(null);
  const currentReview = useRef(review); currentReview.current = review;
  const inflight = useRef(false), alive = useRef(true);
  useEffect(() => {
    const clear = () => { setReview(null); setFields({ firstName: "", lastName: "", documentType: "", issuingRegion: "", documentLastFour: "", expiresOn: "" }); setSaved(null); setError(""); };
    const user = subscribeUser(clear), token = subscribeToken(clear);
    return () => { alive.current = false; user(); token(); const value = currentReview.current; if (value?.fileIds.length && isAuthScopeCurrent(value.scope)) void discardScannedWorkPages(value.fileIds, value.scope).catch(() => undefined); };
  }, []);
  useEffect(() => { if (review && review.visit.siteLocationId !== siteId) { if (isAuthScopeCurrent(review.scope)) void discardScannedWorkPages(review.fileIds, review.scope).catch(() => undefined); setReview(null); } }, [siteId]);
  async function capture(visit: Visit, scanner: boolean) {
    if (inflight.current) return; inflight.current = true; setBusy(true); setError("");
    const scope = captureAuthScope();
    try {
      if (review?.fileIds.length) await discardScannedWorkPages(review.fileIds, review.scope);
      let uri = "", fileIds: string[] = [], ocr = "";
      if (scanner) {
        const draft = await scanWorkDocumentDraft();
        if (draft.pages.length !== 1) { await discardScannedWorkPages(draft.pages.map(page => page.fileId), scope); throw new Error(t("gateIdentity.onePage")); }
        uri = draft.pages[0].uri; fileIds = draft.pages.map(page => page.fileId); ocr = draft.pages[0].ocrText;
      } else {
        const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) throw new Error(t("nativeOperations.cameraPermission"));
        const result = await ImagePicker.launchCameraAsync({ quality: 0.8 }); if (result.canceled || !result.assets[0]) return; uri = result.assets[0].uri;
      }
      if (!alive.current || !isAuthScopeCurrent(scope)) { if (fileIds.length) void discardScannedWorkPages(fileIds, scope).catch(() => undefined); return; }
      setReview({ visit, operationId: nativeUuid(), uri, fileIds, ocr, capturedAt: new Date().toISOString(), scope, source: scanner ? "visionkit_document_scan" : "camera_manual_review" });
      setFields({ firstName: visit.firstName ?? "", lastName: visit.lastName ?? "", documentType: "", issuingRegion: "", documentLastFour: "", expiresOn: "" }); setSaved(null);
    } catch (e) { if (alive.current && isAuthScopeCurrent(scope)) setError(e instanceof Error ? e.message : t("gateIdentity.unavailable")); }
    finally { inflight.current = false; if (alive.current && isAuthScopeCurrent(scope)) setBusy(false); }
  }
  async function save() {
    if (!review || inflight.current || !fields.firstName.trim() || !fields.lastName.trim()) return;
    if (!isAuthScopeCurrent(review.scope) || !visits.some(visit => visit.id === review.visit.id && visit.siteLocationId === siteId)) return;
    inflight.current = true; setBusy(true); setError("");
    const selected = review;
    try {
      const objectPath = selected.objectPath ?? (await uploadAsset({ uri: selected.uri, width: 0, height: 0, mimeType: "image/jpeg", fileName: "gate-id.jpg" }, 10 * 1024 * 1024, "gate-evidence", selected.scope)).objectPath;
      if (!isAuthScopeCurrent(selected.scope)) return;

      const body = { operationId: selected.operationId, objectPath, capturedAt: selected.capturedAt, reviewConfirmed: true, source: selected.source, fields: selected.submittedFields ?? {
        firstName: fields.firstName.trim(), lastName: fields.lastName.trim(), documentType: fields.documentType.trim(), issuingRegion: fields.issuingRegion.trim(),
        ...(fields.documentLastFour.trim() ? { documentLastFour: fields.documentLastFour.trim() } : {}), ...(fields.expiresOn.trim() ? { expiresOn: fields.expiresOn.trim() } : {}),
      } };
      setReview({ ...selected, objectPath, submittedFields: body.fields });
      await apiFetch(`/api/visits/gate/${selected.visit.id}/identity-document`, { method: "POST", body: JSON.stringify(body) }, selected.scope);
      const canonical = await apiFetch<{ visitId: number; operationId: string; expiresAt: string; fields: { firstName: string; lastName: string } }>(`/api/visits/gate/${selected.visit.id}/identity-document`, {}, selected.scope);
      if (canonical.visitId !== selected.visit.id || canonical.operationId !== selected.operationId || canonical.fields.firstName !== body.fields.firstName || canonical.fields.lastName !== body.fields.lastName) throw new Error(t("gateIdentity.unverified"));
      if (selected.fileIds.length) await discardScannedWorkPages(selected.fileIds, selected.scope);
      if (alive.current && isAuthScopeCurrent(selected.scope)) { setReview(null); setSaved(canonical); }
    } catch (e) { if (alive.current && isAuthScopeCurrent(selected.scope)) setError(e instanceof Error ? e.message : t("gateIdentity.unavailable")); }
    finally { inflight.current = false; if (alive.current && isAuthScopeCurrent(selected.scope)) setBusy(false); }
  }
  return <View style={{ gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: "700" }}>{t("gateIdentity.title")}</Text>
    <Text style={{ color: colors.text }}>{t("gateIdentity.privacy")}</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{error}</Text> : null}
    {!review ? visits.filter(visit => visit.siteLocationId === siteId).slice(0, 30).map(visit => <View key={visit.id} style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>{visit.firstName} {visit.lastName} · {t("gateIdentity.visit", { id: visit.id })}</Text>
      <TogglePillButton disabled={busy} onPress={() => { void capture(visit, true); }}>{t("gateIdentity.scan")}</TogglePillButton>
      <TogglePillButton disabled={busy} onPress={() => { void capture(visit, false); }}>{t("gateIdentity.manualCamera")}</TogglePillButton>
    </View>) : <>
      <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("gateIdentity.uncertain")}</Text>
      <Image source={{ uri: review.uri }} accessibilityLabel={t("gateIdentity.preview")} style={{ height: 230, width: "100%" }} resizeMode="contain" />
      {review.ocr ? <Text selectable style={{ color: colors.text }}>{review.ocr}</Text> : null}
      {Object.keys(fields).map(name => <TextInput key={name} accessibilityLabel={t(`gateIdentity.${name}`)} placeholder={t(`gateIdentity.${name}`)} value={fields[name as keyof Fields]} onChangeText={value => setFields(current => ({ ...current, [name]: value }))} editable={!busy && !review.submittedFields} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, color: colors.text }} />)}
      <TogglePillButton disabled={busy || !fields.firstName.trim() || !fields.lastName.trim()} onPress={() => { void save(); }}>{t("gateIdentity.confirmSave")}</TogglePillButton>
      <TogglePillButton disabled={busy} onPress={() => { const selected = review; setReview(null); if (selected.fileIds.length) void discardScannedWorkPages(selected.fileIds, selected.scope).catch(() => setError(t("gateIdentity.cleanup"))); }}>{t("gateIdentity.discard")}</TogglePillButton>
    </>}
    {saved ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{t("gateIdentity.saved", { id: saved.visitId, date: new Date(saved.expiresAt).toLocaleDateString() })}</Text> : null}
  </View>;
}
