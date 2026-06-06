import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";

export type CrewPreset = {
  id: number;
  name: string;
  memberEmployeeIds: number[];
};

type Coworker = {
  id: number;
  userId: number | null;
  firstName: string | null;
  lastName: string | null;
  vendorRole?: string | null;
  jobTitle?: string | null;
};

function empName(e: Coworker): string {
  return `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || `#${e.id}`;
}

function isForemanRole(role: string | null | undefined): boolean {
  return role === "foreman" || role === "both";
}

type Props = {
  visible: boolean;
  onClose: () => void;
  preset?: CrewPreset | null;
  onSaved: () => void;
};

export default function SetCrewModal({ visible, onClose, preset, onSaved }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [employees, setEmployees] = useState<Coworker[]>([]);
  const [error, setError] = useState<string | null>(null);

  const editing = preset != null;

  useEffect(() => {
    if (!visible) return;
    setName(preset?.name ?? "");
    setSelectedIds(preset?.memberEmployeeIds ?? []);
    setError(null);
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const rows = await apiFetch<Coworker[]>("/api/field/co-workers");
        if (!cancelled) setEmployees(rows ?? []);
      } catch (e) {
        if (!cancelled) setError(translateApiError(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, preset, t]);

  const selectedCount = selectedIds.length;

  const sortedEmployees = useMemo(
    () =>
      [...employees].sort((a, b) => {
        const af = isForemanRole(a.vendorRole) ? 0 : 1;
        const bf = isForemanRole(b.vendorRole) ? 0 : 1;
        if (af !== bf) return af - bf;
        return empName(a).localeCompare(empName(b));
      }),
    [employees],
  );

  function toggle(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("crews.nameRequired"));
      return;
    }
    if (selectedIds.length === 0) {
      setError(t("crews.membersRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing && preset) {
        await apiFetch(`/api/field/crew-presets/${preset.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: trimmed, memberEmployeeIds: selectedIds }),
        });
      } else {
        await apiFetch("/api/field/crew-presets", {
          method: "POST",
          body: JSON.stringify({ name: trimmed, memberEmployeeIds: selectedIds }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!preset) return;
    Alert.alert(t("crews.deleteTitle"), t("crews.deleteBody", { name: preset.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("crews.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setSaving(true);
            try {
              await apiFetch(`/api/field/crew-presets/${preset.id}`, { method: "DELETE" });
              onSaved();
              onClose();
            } catch (e) {
              Alert.alert(t("common.error"), translateApiError(e, t));
            } finally {
              setSaving(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} testID="button-set-crew-cancel">
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
              {t("common.cancel")}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {editing ? t("crews.editTitle") : t("crews.setCrewTitle")}
          </Text>
          <View style={{ width: 56 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            ) : null}

            <Text style={[styles.label, { color: colors.foreground }]}>{t("crews.crewName")}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t("crews.crewNamePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
              ]}
              testID="input-crew-name"
            />

            <Text style={[styles.label, { color: colors.foreground }]}>
              {t("crews.membersLabel", { count: selectedCount })}
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t("crews.membersHint")}</Text>

            {sortedEmployees.map((e) => {
              const on = selectedIds.includes(e.id);
              const foreman = isForemanRole(e.vendorRole);
              return (
                <TouchableOpacity
                  key={e.id}
                  onPress={() => toggle(e.id)}
                  style={[
                    styles.row,
                    {
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.accent : colors.card,
                    },
                  ]}
                  testID={`crew-member-${e.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: colors.foreground }]}>{empName(e)}</Text>
                    {e.jobTitle ? (
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{e.jobTitle}</Text>
                    ) : null}
                  </View>
                  {foreman ? (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.badgeText}>{t("crews.foremanBadge")}</Text>
                    </View>
                  ) : null}
                  <Text style={{ color: on ? colors.primary : colors.mutedForeground, fontSize: 18 }}>
                    {on ? "✓" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <LayeredPillButton
              onPress={() => void save()}
              disabled={saving}
              loading={saving}
              height={44}
              style={styles.saveBtn}
              testID="button-save-crew"
            >
              <Text style={styles.saveText}>{t("crews.saveCrew")}</Text>
            </LayeredPillButton>

            {editing ? (
              <LayeredPillButton
                onPress={() => void remove()}
                disabled={saving}
                height={40}
                inactive
                style={styles.deleteBtn}
                testID="button-delete-crew"
              >
                <Text style={styles.saveText}>{t("crews.deleteCrew")}</Text>
              </LayeredPillButton>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, paddingBottom: 32 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 8, marginTop: 8 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, marginBottom: 10, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  rowName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: {
    color: "#ffffff",
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  saveBtn: { marginTop: 16 },
  deleteBtn: { marginTop: 10 },
  saveText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  error: { fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 8 },
});
