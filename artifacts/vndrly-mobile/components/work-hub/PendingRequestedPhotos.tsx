import React, { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { readPendingRequestedPhotos, readRequestedPhotoPercentage, requestedPhotoBackgroundAvailable, resumeRequestedPhoto, setRequestedPhotoTransfer, type PendingRequestedPhoto } from "@/lib/requested-photo-upload";
export default function PendingRequestedPhotos() {
  const { user } = useAuth(), { t } = useTranslation(), colors = useColors();
  const [pending, setPending] = useState<PendingRequestedPhoto[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [percentages, setPercentages] = useState<Record<string, number | null>>({});
  useEffect(() => {
    setPending([]); if (!user || !requestedPhotoBackgroundAvailable()) return;
    let alive = true; const scope = captureAuthScope();
    const read = async () => { try { const values = await readPendingRequestedPhotos(); const progress = await Promise.all(values.map(async value => [value.requestId, await readRequestedPhotoPercentage(value).catch(() => null)] as const)); if (alive && isAuthScopeCurrent(scope)) { setPending(values); setPercentages(Object.fromEntries(progress)); } } catch { if (alive && isAuthScopeCurrent(scope)) setError(true); } };
    void read(); const timer = setInterval(() => { void read(); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [user?.id, user?.activeMembershipId]);
  async function run(work: () => Promise<unknown>) {
    if (busy) return; setBusy(true); const scope = captureAuthScope();
    try { await work(); if (isAuthScopeCurrent(scope)) { setPending(await readPendingRequestedPhotos()); setError(false); } }
    catch { if (isAuthScopeCurrent(scope)) setError(true); }
    finally { if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  return <View style={{ gap: 10 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeOperations.pending")}</Text> : null}
    {pending.map(photo => <View key={photo.requestId} style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>{t("nativePhotoTransfer.title", { id: photo.ticketId })}</Text>
      <Text style={{ color: colors.text }}>{t(photo.paused ? "nativePhotoTransfer.paused" : photo.transportComplete ? "nativePhotoTransfer.finalizing" : "nativePhotoTransfer.uploading")}</Text>
      {percentages[photo.requestId] != null ? <Text accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percentages[photo.requestId]! }} style={{ color: colors.text }}>{percentages[photo.requestId]}%</Text> : null}
      <Image source={{ uri: photo.staged.uri }} accessibilityLabel={t("nativeOperations.preview")} style={{ height: 130, width: "100%" }} resizeMode="contain" />
      <TogglePillButton disabled={busy} onPress={() => { void run(async () => { await setRequestedPhotoTransfer(photo.requestId, { paused: !photo.paused }); if (photo.paused) await resumeRequestedPhoto(photo.requestId); }); }}>{t(photo.paused ? "nativePhotoTransfer.resume" : "nativePhotoTransfer.pause")}</TogglePillButton>
      <TogglePillButton disabled={busy} onPress={() => { void run(async () => { await setRequestedPhotoTransfer(photo.requestId, { paused: true }); await setRequestedPhotoTransfer(photo.requestId, { wifiOnly: !photo.wifiOnly, paused: false }); await resumeRequestedPhoto(photo.requestId); }); }}>{t(photo.wifiOnly ? "nativePhotoTransfer.allowCellular" : "nativePhotoTransfer.wifiOnly")}</TogglePillButton>
      <TogglePillButton disabled={busy || photo.paused} onPress={() => { void run(() => resumeRequestedPhoto(photo.requestId)); }}>{t("nativePhotoTransfer.verify")}</TogglePillButton>
    </View>)}
  </View>;
}
