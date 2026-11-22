import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/hooks/use-auth";
import { GateRow } from "@/components/gate/GateChrome";
import { useColors } from "@/hooks/useColors";
import { nativeWorkHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { apiFetch } from "@/lib/api";

type Device = { id: string; userId: number; friendlyName: string; deviceClass: string; capabilities: { microphone?: boolean }; revokedAt: string | null; connected: boolean; currentAudioOwner?: boolean };
type Preferences = { rankedDeviceIds: string[] };

export default function WorkHubDeviceSettings({ children, trailing, embedded = false, onExit }: { children?: React.ReactNode; trailing?: React.ReactNode; embedded?: boolean; onExit?: () => void }) {
  const colors = useColors();
  const { user } = useAuth();
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(embedded);
  const [devicesExpanded, setDevicesExpanded] = useState(embedded);
  const [devices, setDevices] = useState<Device[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ rankedDeviceIds: [] });
  const [currentId, setCurrentId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [rows, saved, identity] = await Promise.all([
        apiFetch<Device[]>("/api/work-hub/devices"),
        apiFetch<Preferences>("/api/work-hub/devices/preferences"),
        nativeWorkHubDeviceIdentity(),
      ]);
      setDevices(rows.filter(row => row.userId === user?.id && !row.revokedAt && row.connected));
      setPreferences(saved);
      setCurrentId(identity?.deviceId ?? "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("workHubDevices.failed"));
    }
  }, [t, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!expanded) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [expanded, load]);

  const change = async (path: string, method: string, body?: unknown) => {
    setBusy(true); setError("");
    try { await apiFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("workHubDevices.failed")); }
    finally { setBusy(false); }
  };
  const pinnedId = devices.find(device => device.currentAudioOwner)?.id ?? currentId;
  const ordered = useMemo(() => [...devices].sort((a, b) => {
    const left = preferences.rankedDeviceIds.indexOf(a.id), right = preferences.rankedDeviceIds.indexOf(b.id);
    return Number(b.id === pinnedId) - Number(a.id === pinnedId) || (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
  }), [devices, preferences.rankedDeviceIds, pinnedId]);
  const audioOwner = ordered.find(device => device.currentAudioOwner);
  const backups = ordered.filter(device => device.id !== pinnedId && device.capabilities.microphone).map(device => device.id);
  const move = (id: string, offset: number) => {
    const index = backups.indexOf(id), target = index + offset;
    if (index < 0 || target < 0 || target >= backups.length) return;
    const ids = [...backups]; [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const remaining = preferences.rankedDeviceIds.filter(key => devices.some(device => device.id === key) && !ids.includes(key));
    void change("/api/work-hub/devices/preferences", "PUT", { rankedDeviceIds: [...ids, ...remaining].slice(0, 20) });
  };

  return <View testID="work-hub-device-settings">
    {!embedded && <GateRow trailing={trailing} label={t("workHubDevices.title")}
      icon={expanded ? "chevron-down" : "chevron-right"}
      expanded={expanded}
      onPress={() => { if (!expanded) void load(); setExpanded(!expanded); }} />}
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
        const backupIndex = backups.indexOf(device.id);
        return <View key={device.id} accessibilityLabel={device.friendlyName} style={{ borderTopColor: colors.border, borderTopWidth: 1, gap: 8, paddingTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name={device.deviceClass === "desktop" ? "monitor" : device.deviceClass === "tablet" ? "tablet" : "smartphone"} size={20} color={colors.primary} />
            <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>{device.friendlyName}{isCurrent ? ` · ${t("workHubDevices.thisDevice")}` : ""}</Text>
            <ProfileMiniCardButton inHeader borderColor={colors.primary} accessibilityLabel={`Move ${device.friendlyName} up`} disabled={busy || backupIndex <= 0} onPress={() => move(device.id, -1)}>↑</ProfileMiniCardButton>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {isCurrent && <Feather name="star" size={16} color={colors.primary} />}
            <Text style={{ color: ownsAudio ? colors.primary : colors.mutedForeground, fontSize: 13, flex: 1 }}>{ownsAudio ? t("workHubDevices.voiceActive") : t("workHubDevices.readyForHandoff")}</Text>
            {ownsAudio && <Feather name="mic" size={16} color={colors.primary} />}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput accessibilityLabel={`Name for ${device.friendlyName}`} value={names[device.id] ?? device.friendlyName} onChangeText={value => setNames(current => ({ ...current, [device.id]: value }))} style={{ flex: 1, minWidth: 0, color: colors.text, borderColor: colors.primary, borderWidth: 1, borderRadius: 8, padding: 10 }} />
            <ProfileMiniCardButton inHeader borderColor={colors.primary} disabled={busy || !(names[device.id] ?? device.friendlyName).trim()} onPress={() => void change(`/api/work-hub/devices/${device.id}`, "PATCH", { friendlyName: (names[device.id] ?? device.friendlyName).trim() })}>{t("workHubDevices.save", "Save")}</ProfileMiniCardButton>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <ProfileMiniCardButton inHeader borderColor={colors.primary} disabled={busy || isCurrent} accessibilityLabel={`Forget ${device.friendlyName}`} onPress={() => void change(`/api/work-hub/devices/${device.id}`, "DELETE")}>{t("workHubDevices.forget", "Forget")}</ProfileMiniCardButton>
            <ProfileMiniCardButton inHeader borderColor={colors.primary} accessibilityLabel={`Move ${device.friendlyName} down`} disabled={busy || backupIndex < 0 || backupIndex >= backups.length - 1} onPress={() => move(device.id, 1)}>↓</ProfileMiniCardButton>
          </View>
        </View>;
      })}
      {devicesExpanded && !ordered.length && <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.none")}</Text>}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <ProfileMiniCardButton borderColor={colors.primary} onPress={() => onExit ? onExit() : setExpanded(false)}>Exit</ProfileMiniCardButton>
      <ProfileMiniCardButton borderColor={colors.primary} disabled={busy} onPress={() => void change("/api/work-hub/devices/preferences", "PUT", { rankedDeviceIds: preferences.rankedDeviceIds, clearLearning: true })}>{t("workHubDevices.clearLearning", "Clear learned order")}</ProfileMiniCardButton>
    </View>
    </View>}
  </View>;
}
