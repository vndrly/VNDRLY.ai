import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type Cert = {
  id: number;
  name: string;
  issuer: string | null;
  certNumber: string | null;
  issuedDate: string | null;
  expirationDate: string | null;
  documentUrl: string | null;
};

type FormState = {
  name: string;
  issuer: string;
  certNumber: string;
  issuedDate: string;
  expirationDate: string;
};

const blankForm: FormState = {
  name: "",
  issuer: "",
  certNumber: "",
  issuedDate: "",
  expirationDate: "",
};

type Props = {
  employeeId: number;
  onChanged?: () => void;
};

export default function EmployeeCertificationsPanel({ employeeId, onChanged }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Cert[]>(`/api/field-employees/${employeeId}/certifications`);
      setCerts(rows ?? []);
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("employees.certifications.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [employeeId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const startAdd = () => {
    setEditingId(null);
    setForm(blankForm);
    setFormOpen(true);
  };

  const startEdit = (c: Cert) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      issuer: c.issuer ?? "",
      certNumber: c.certNumber ?? "",
      issuedDate: c.issuedDate ?? "",
      expirationDate: c.expirationDate ?? "",
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      Alert.alert(t("common.error"), t("employees.certifications.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        issuer: form.issuer.trim() || null,
        certNumber: form.certNumber.trim() || null,
        issuedDate: form.issuedDate.trim() || null,
        expirationDate: form.expirationDate.trim() || null,
        documentUrl: null,
        documentPath: null,
      };
      if (editingId) {
        await apiFetch(`/api/field-employees/${employeeId}/certifications/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
      } else {
        await apiFetch(`/api/field-employees/${employeeId}/certifications`, {
          method: "POST",
          body: JSON.stringify(data),
        });
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(blankForm);
      await load();
      onChanged?.();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("employees.certifications.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = (c: Cert) => {
    Alert.alert(
      t("employees.certifications.removeTitle"),
      t("employees.certifications.removeConfirm", { name: c.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.remove"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await apiFetch(`/api/field-employees/${employeeId}/certifications/${c.id}`, {
                  method: "DELETE",
                });
                await load();
                onChanged?.();
              } catch (e) {
                Alert.alert(t("common.error"), e instanceof Error ? e.message : t("employees.certifications.deleteFailed"));
              }
            })();
          },
        },
      ],
    );
  };

  const inputStyle = {
    color: colors.foreground,
    borderColor: colors.border,
    backgroundColor: colors.background,
  };

  return (
    <View style={[styles.wrap, { borderColor: colors.border }]} testID="employee-certifications-panel">
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("employees.certifications.title")} ({certs.length})
        </Text>
        <TouchableOpacity onPress={startAdd} style={[styles.addBtn, { borderColor: colors.primary }]} testID="button-add-certification">
          <Feather name="plus" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>{t("common.add")}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : certs.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{t("employees.certifications.empty")}</Text>
      ) : (
        certs.map((c) => (
          <View key={c.id} style={[styles.certRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.certName, { color: colors.foreground }]}>{c.name}</Text>
              <Text style={[styles.certMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                {[c.issuer, c.certNumber ? `#${c.certNumber}` : null, c.expirationDate ? `exp ${c.expirationDate}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <TouchableOpacity onPress={() => startEdit(c)} style={styles.iconBtn} accessibilityLabel={t("common.edit")}>
              <Feather name="edit-2" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(c)} style={styles.iconBtn} accessibilityLabel={t("common.remove")}>
              <Feather name="trash-2" size={16} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ))
      )}

      {formOpen ? (
        <View style={[styles.form, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.formTitle, { color: colors.foreground }]}>
            {editingId ? t("employees.certifications.editTitle") : t("employees.certifications.addTitle")}
          </Text>
          <Text style={[styles.label, { color: colors.foreground }]}>{t("employees.certifications.nameLabel")} *</Text>
          <TextInput
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder={t("employees.certifications.namePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, inputStyle]}
            testID="input-cert-name"
          />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("employees.certifications.issuerLabel")}</Text>
          <TextInput
            value={form.issuer}
            onChangeText={(v) => setForm({ ...form, issuer: v })}
            style={[styles.input, inputStyle]}
          />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("employees.certifications.numberLabel")}</Text>
          <TextInput
            value={form.certNumber}
            onChangeText={(v) => setForm({ ...form, certNumber: v })}
            style={[styles.input, inputStyle]}
          />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("employees.certifications.issuedLabel")}</Text>
          <TextInput
            value={form.issuedDate}
            onChangeText={(v) => setForm({ ...form, issuedDate: v })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, inputStyle]}
          />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("employees.certifications.expiresLabel")}</Text>
          <TextInput
            value={form.expirationDate}
            onChangeText={(v) => setForm({ ...form, expirationDate: v })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, inputStyle]}
          />
          <View style={styles.formActions}>
            <TouchableOpacity
              onPress={() => {
                setFormOpen(false);
                setEditingId(null);
                setForm(blankForm);
              }}
              style={[styles.cancelBtn, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground }}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <LayeredPillButton onPress={save} disabled={saving} height={40} style={{ flex: 1 }}>
              <Text style={styles.saveText}>{saving ? t("fieldEmployees.saving") : t("common.save")}</Text>
            </LayeredPillButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, marginTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  certRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  certName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  certMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 6 },
  form: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6, marginTop: 4 },
  formTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 4 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 15 },
  formActions: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  cancelBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  saveText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
