import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GateRow } from "@/components/gate/GateChrome";
import { useColors } from "@/hooks/useColors";
import { nativeWorkHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { apiFetch } from "@/lib/api";

type Device = { id: string; friendlyName: string; deviceClass: string; capabilities: { microphone?: boolean }; revokedAt: string | null; connected: boolean; currentAudioOwner?: boolean };
type Preferences = { rankedDeviceIds: string[]; automaticBackupDeviceIds: string[]; learning: Record<string, number> };

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export default function WorkHubDeviceSettings({ children, trailing }: { children?: React.ReactNode; trailing?: React.ReactNode }) {
  const colors = useColors();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [devicesExpanded, setDevicesExpanded] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} });
  const [currentId, setCurrentId] = useState("");
  const [error, setError] = useState("");

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
      ].slice(0, 20);
      const automaticBackupDeviceIds = [...rankedDeviceIds];
      const automatic = { ...saved, rankedDeviceIds, automaticBackupDeviceIds };
      setDevices(active.filter(row => row.connected));
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
  }, [load]);
  useEffect(() => {
    if (!expanded) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [expanded, load]);

  const ordered = useMemo(() => [...devices].sort((a, b) => {
    const left = preferences.rankedDeviceIds.indexOf(a.id), right = preferences.rankedDeviceIds.indexOf(b.id);
    return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
  }), [devices, preferences.rankedDeviceIds]);
  const audioOwner = ordered.find(device => device.currentAudioOwner);

  return <View testID="work-hub-device-settings">
    <GateRow trailing={trailing} label={t("workHubDevices.title")}
      icon={expanded ? "chevron-down" : "chevron-right"}
      expanded={expanded}
      onPress={() => { if (!expanded) void load(); setExpanded(!expanded); }} />
    {expanded && <View style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 16, gap: 16 }}>
    {children}
    <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.automaticDescription")}</Text>
    <View style={{ backgroundColor: `${colors.primary}16`, borderColor: colors.primary, borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{audioOwner ? t("workHubDevices.voiceActiveOn", { device: audioOwner.friendlyName }) : t("workHubDevices.noActiveVoice")}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t("workHubDevices.contentAvailable")}</Text>
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    <View style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 12, gap: 8 }}>
      <GateRow
        label={t("workHubDevices.connectedDevices", "Connected devices")}
        icon={devicesExpanded ? "chevron-down" : "chevron-right"}
        expanded={devicesExpanded}
        showDivider={false}
        onPress={() => setDevicesExpanded(open => !open)}
      />
      {devicesExpanded && ordered.map(device => {
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
      {devicesExpanded && !ordered.length && <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.none")}</Text>}
    </View>
    <ProfileMiniCardButton borderColor={colors.primary} onPress={() => setExpanded(false)}>{t("common.close", "Close")}</ProfileMiniCardButton>
    </View>}
  </View>;
}
