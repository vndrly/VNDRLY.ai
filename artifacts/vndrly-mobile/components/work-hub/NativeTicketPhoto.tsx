import React, { useEffect, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { requestedPhotoBackgroundAvailable } from "@/lib/requested-photo-upload";
import { readTicketPhotoDrafts, resumeTicketPhoto, stageTicketPhoto, type TicketPhotoDraft } from "@/lib/ticket-photo-journal";

export default function NativeTicketPhoto({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation(), colors = useColors();
  const { user } = useAuth();
  const [review, setReview] = useState<{ asset: ImagePicker.ImagePickerAsset; capturedAt: string } | null>(null);
  const [drafts, setDrafts] = useState<TicketPhotoDraft[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    setReview(null); setDrafts([]); setError(false);
    if (!requestedPhotoBackgroundAvailable()) return;
    let alive = true; const scope = captureAuthScope();
    const load = async () => { const values = await readTicketPhotoDrafts(ticketId).catch(() => []); if (alive && isAuthScopeCurrent(scope)) setDrafts(values); };
    void load(); const timer = setInterval(() => { void load(); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [ticketId, user?.id, user?.activeMembershipId]);
  if (Platform.OS !== "ios" || !requestedPhotoBackgroundAvailable()) return null;
  async function run(work: () => Promise<unknown>) {
    const scope = captureAuthScope(); setBusy(true);
    try { await work(); if (isAuthScopeCurrent(scope)) { setDrafts(await readTicketPhotoDrafts(ticketId)); setError(false); } }
    catch { if (isAuthScopeCurrent(scope)) setError(true); }
    finally { if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  return <View style={{ gap: 8, padding: 12 }}>
    <Text style={{ color: colors.text }}>{t("nativeTicketPhoto.title")}</Text>
    <TogglePillButton disabled={busy} onPress={() => { void run(async () => {
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) return;
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.75 });
      if (!result.canceled && result.assets[0]) setReview({ asset: result.assets[0], capturedAt: new Date().toISOString() });
    }); }}>{t("nativeTicketPhoto.camera")}</TogglePillButton>
    {review ? <>
      <Image source={{ uri: review.asset.uri }} accessibilityLabel={t("nativeOperations.preview")} style={{ width: "100%", height: 160 }} resizeMode="contain" />
      <Text style={{ color: colors.text }}>{t("nativeTicketPhoto.review", { id: ticketId })}</Text>
      <TogglePillButton disabled={busy} onPress={() => { void run(async () => { await stageTicketPhoto(ticketId, review.asset.uri, review.asset.mimeType ?? "image/jpeg", "camera", review.capturedAt); setReview(null); }); }}>{t("nativeTicketPhoto.stage")}</TogglePillButton>
      <TogglePillButton disabled={busy} onPress={() => setReview(null)}>{t("nativeOperations.cancel")}</TogglePillButton>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeTicketPhoto.pending")}</Text> : null}
    {drafts.map(draft => <View key={draft.operationId} style={{ gap: 8 }}>
      <Image source={{ uri: draft.staged.uri }} accessibilityLabel={t("nativeOperations.preview")} style={{ width: "100%", height: 110 }} resizeMode="contain" />
      <Text style={{ color: colors.text }}>{t("nativeTicketPhoto.pending")}</Text>
      <TogglePillButton disabled={busy} onPress={() => { void run(() => resumeTicketPhoto(draft.operationId)); }}>{t("nativePhotoTransfer.verify")}</TogglePillButton>
    </View>)}
  </View>;
}
