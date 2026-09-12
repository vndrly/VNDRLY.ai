import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { nativeWorkHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { apiFetch } from "@/lib/api";

type Device = { id: string; friendlyName: string; deviceClass: string; capabilities: { microphone?: boolean }; revokedAt: string | null; currentAudioOwner?: boolean };
type Preferences = { rankedDeviceIds: string[]; automaticBackupDeviceIds: string[]; learning: Record<string, number> };

export default function WorkHubDeviceSettings() {
  const colors = useColors();
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} });
  const [currentId, setCurrentId] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [rows, saved, identity] = await Promise.all([
        apiFetch<Device[]>("/api/work-hub/devices"),
        apiFetch<Preferences>("/api/work-hub/devices/preferences"),
        nativeWorkHubDeviceIdentity(),
      ]);
      setDevices(rows.filter((row) => !row.revokedAt));
      setPreferences(saved);
      setCurrentId(identity?.deviceId ?? "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("workHubDevices.failed"));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const ordered = useMemo(() => [...devices].sort((a, b) => {
    const left = preferences.rankedDeviceIds.indexOf(a.id), right = preferences.rankedDeviceIds.indexOf(b.id);
    return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
  }), [devices, preferences.rankedDeviceIds]);
  const request = async (path: string, method: string, body?: unknown) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await apiFetch(path, { method, headers: { "x-work-hub-source": "ios" }, body: body === undefined ? undefined : JSON.stringify(body) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("workHubDevices.failed")); }
    finally { setBusy(false); }
  };
  const savePreferences = (patch: Partial<Preferences> & { clearLearning?: boolean }) => request("/api/work-hub/devices/preferences", "PUT", {
    rankedDeviceIds: patch.rankedDeviceIds ?? (preferences.rankedDeviceIds.length ? preferences.rankedDeviceIds : ordered.map((device) => device.id)),
    automaticBackupDeviceIds: patch.automaticBackupDeviceIds ?? preferences.automaticBackupDeviceIds,
    ...(patch.clearLearning ? { clearLearning: true } : {}),
  });
  const move = (id: string, direction: -1 | 1) => {
    const ids = ordered.map((device) => device.id), index = ids.indexOf(id), target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void savePreferences({ rankedDeviceIds: ids });
  };
  return <View testID="work-hub-device-settings" style={{ borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Feather name="monitor" size={20} color={colors.primary} /><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{t("workHubDevices.title")}</Text></View>
    <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.descriptionMobile")}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {ordered.map((device) => {
      const automatic = preferences.automaticBackupDeviceIds.includes(device.id);
      return <View key={device.id} accessibilityLabel={device.friendlyName} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{device.friendlyName}{device.id === currentId ? ` · ${t("workHubDevices.thisDevice")}` : ""}{device.currentAudioOwner ? ` · ${t("workHubDevices.audioOwner")}` : ""}</Text>
        <TextInput accessibilityLabel={t("workHubDevices.nameLabel")} value={names[device.id] ?? device.friendlyName} onChangeText={(value) => setNames((current) => ({ ...current, [device.id]: value }))} style={{ minHeight: 44, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, color: colors.text }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <TogglePillButton disabled={busy} style={{ flexGrow: 1 }} onPress={() => void request(`/api/work-hub/devices/${device.id}`, "PATCH", { friendlyName: names[device.id] ?? device.friendlyName })}>{t("common.save")}</TogglePillButton>
          <TogglePillButton disabled={busy} style={{ flexGrow: 1 }} onPress={() => move(device.id, -1)}>{t("workHubDevices.moveUp")}</TogglePillButton>
          <TogglePillButton disabled={busy} style={{ flexGrow: 1 }} onPress={() => move(device.id, 1)}>{t("workHubDevices.moveDown")}</TogglePillButton>
          <TogglePillButton disabled={busy || !device.capabilities.microphone} solid={automatic} accessibilityState={{ selected: automatic }} style={{ flexGrow: 1 }} onPress={() => void savePreferences({ automaticBackupDeviceIds: automatic ? preferences.automaticBackupDeviceIds.filter((id) => id !== device.id) : [...preferences.automaticBackupDeviceIds, device.id] })}>{automatic ? t("workHubDevices.backupEnabled") : t("workHubDevices.allowBackup")}</TogglePillButton>
          <TogglePillButton color="red" disabled={busy || device.id === currentId} style={{ flexGrow: 1 }} onPress={() => void request(`/api/work-hub/devices/${device.id}`, "DELETE")}>{t("workHubDevices.forget")}</TogglePillButton>
        </View>
      </View>;
    })}
    {!ordered.length && <Text style={{ color: colors.mutedForeground }}>{t("workHubDevices.none")}</Text>}
    <TogglePillButton disabled={busy} onPress={() => void savePreferences({ clearLearning: true })}>{t("workHubDevices.clearLearning")}</TogglePillButton>
  </View>;
}
