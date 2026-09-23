import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useColors } from "@/hooks/useColors";
import { nativeWorkHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { apiFetch } from "@/lib/api";
import { requestAskVMicrophonePermission } from "@/lib/askv-audio-session";

type Device = { id: string; friendlyName: string; deviceClass: string; capabilities: { microphone?: boolean }; revokedAt: string | null; currentAudioOwner?: boolean };
type Preferences = { rankedDeviceIds: string[]; automaticBackupDeviceIds: string[]; learning: Record<string, number> };

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export default function WorkHubDeviceSettings() {
  const colors = useColors();
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} });
  const [currentId, setCurrentId] = useState("");
  const [error, setError] = useState("");
  const [microphoneAllowed, setMicrophoneAllowed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rows, saved, identity] = await Promise.all([
        apiFetch<Device[]>("/api/work-hub/devices"),
        apiFetch<Preferences>("/api/work-hub/devices/preferences"),
        nativeWorkHubDeviceIdentity(),
      ]);
      const active = rows.filter(row => !row.revokedAt);
      const eligibleIds = active.filter(row => row.capabilities.microphone).map(row => row.id);
      const rankedDeviceIds = [
        ...saved.rankedDeviceIds.filter(id => eligibleIds.includes(id)),
        ...eligibleIds.filter(id => !saved.rankedDeviceIds.includes(id)),
      ];
      const automaticBackupDeviceIds = [...rankedDeviceIds];
      const automatic = { ...saved, rankedDeviceIds, automaticBackupDeviceIds };
      setDevices(active);
      setPreferences(automatic);
      setCurrentId(identity?.deviceId ?? "");
      setError("");
      if (!sameIds(saved.rankedDeviceIds, rankedDeviceIds) || !sameIds(saved.automaticBackupDeviceIds, automaticBackupDeviceIds)) {
        await apiFetch("/api/work-hub/devices/preferences", {
          method: "PUT",
          headers: { "x-work-hub-source": "ios" },
          body: JSON.stringify({ rankedDeviceIds, automaticBackupDeviceIds }),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("workHubDevices.failed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
    void Audio.getPermissionsAsync().then(result => setMicrophoneAllowed(result.status === "granted")).catch(() => undefined);
  }, [load]);
  const enableMicrophone = async () => {
    try {
      await requestAskVMicrophonePermission();
      const permission = await Audio.getPermissionsAsync();
      setMicrophoneAllowed(permission.status === "granted");
      setError("");
    } catch {
      setError(t("workHubDevices.microphoneDenied"));
    }
  };
  const ordered = useMemo(() => [...devices].sort((a, b) => {
    const left = preferences.rankedDeviceIds.indexOf(a.id), right = preferences.rankedDeviceIds.indexOf(b.id);
    return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
  }), [devices, preferences.rankedDeviceIds]);
  const audioOwner = ordered.find(device => device.currentAudioOwner);

  return <View testID="work-hub-device-settings" style={{ borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Feather name="headphones" size={20} color={colors.primary} /><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{t("workHubDevices.title")}</Text></View>
    <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.automaticDescription")}</Text>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={t("workHubDevices.allowMicrophone")} accessibilityState={{ checked: microphoneAllowed }} disabled={microphoneAllowed} onPress={() => void enableMicrophone()} style={({ pressed }) => ({ alignItems: "center", flexDirection: "row", gap: 10, opacity: pressed ? .7 : 1, paddingVertical: 4 })}>
      <View style={{ alignItems: "center", backgroundColor: microphoneAllowed ? colors.primary : "transparent", borderColor: microphoneAllowed ? colors.primary : colors.mutedForeground, borderRadius: 4, borderWidth: 2, height: 22, justifyContent: "center", width: 22 }}>{microphoneAllowed ? <Feather name="check" size={16} color={colors.background} /> : null}</View>
      <Text style={{ color: colors.text, flex: 1, fontWeight: "600" }}>{t("workHubDevices.allowMicrophone")}</Text>
    </Pressable>
    <View style={{ backgroundColor: `${colors.primary}16`, borderColor: colors.primary, borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{audioOwner ? t("workHubDevices.voiceActiveOn", { device: audioOwner.friendlyName }) : t("workHubDevices.noActiveVoice")}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t("workHubDevices.contentAvailable")}</Text>
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {ordered.map(device => {
      const isCurrent = device.id === currentId;
      const ownsAudio = !!device.currentAudioOwner;
      return <View key={device.id} accessibilityLabel={device.friendlyName} style={{ alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 }}>
        <Feather name={device.deviceClass === "desktop" ? "monitor" : device.deviceClass === "tablet" ? "tablet" : "smartphone"} size={20} color={ownsAudio ? colors.primary : colors.mutedForeground} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>{device.friendlyName}{isCurrent ? ` · ${t("workHubDevices.thisDevice")}` : ""}</Text>
          <Text style={{ color: ownsAudio ? colors.primary : colors.mutedForeground, fontSize: 13 }}>{ownsAudio ? t("workHubDevices.voiceActive") : t("workHubDevices.readyForHandoff")}</Text>
        </View>
      </View>;
    })}
    {!ordered.length && <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.none")}</Text>}
  </View>;
}
