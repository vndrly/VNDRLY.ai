import { Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import EmployeePortalLoginPanel from "@/components/EmployeePortalLoginPanel";
import EmployeeCertificationsPanel from "@/components/EmployeeCertificationsPanel";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type Person = {
  id: number;
  vendorId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  jobTitle?: string | null;
  vendorRole?: string | null;
  pecCertification?: boolean;
  pecExpirationDate?: string | null;
};

const ROLES = ["admin", "office", "field", "both", "foreman"] as const;

function pecIsCurrent(form: { pecCertification?: boolean; pecExpirationDate?: string | null }) {
  if (form.pecExpirationDate) {
    const exp = new Date(`${form.pecExpirationDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return exp.getTime() >= today.getTime();
  }
  return !!form.pecCertification;
}

export default function EmployeeEditScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const employeeId = Number(params.id);

  const isForemanOnly =
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<"field" | "office">("field");
  const [form, setForm] = useState<Person | null>(null);

  useEffect(() => {
    if (!Number.isFinite(employeeId)) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch<Person>(`/api/field-employees/${employeeId}`).catch(() => null),
      apiFetch<Person[]>(`/api/vendor-contacts?vendorId=${user?.vendorId ?? 0}`).catch(() => [] as Person[]),
    ])
      .then(([field, officeRows]) => {
        if (cancelled) return;
        const office = (officeRows ?? []).find((r) => r.id === employeeId) ?? null;
        const row = field ?? office;
        if (!row) throw new Error(t("employees.notFound"));
        setForm(row);
        setSource(field ? "field" : "office");
      })
      .catch((e) => Alert.alert(t("common.error"), e instanceof Error ? e.message : t("employees.loadFailed")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, user?.vendorId, t]);

  const roleOptions = useMemo(() => {
    if (!form) return ROLES;
    if (!isForemanOnly || pecIsCurrent(form)) return ROLES;
    return ROLES.filter((r) => r !== "admin");
  }, [form, isForemanOnly]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const body = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone ?? "",
        jobTitle: form.jobTitle ?? "",
        vendorRole: form.vendorRole ?? "field",
        pecCertification: !!form.pecCertification,
        pecExpirationDate: form.pecExpirationDate ?? "",
      };
      if (source === "field") {
        await apiFetch(`/api/field-employees/${form.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await apiFetch(`/api/vendors/${form.vendorId}/contacts/${form.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      Alert.alert(t("common.saved"), t("employees.saved"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("employees.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("employees.editTitle")} />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("employees.editTitle")} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.firstName")}</Text>
          <TextInput value={form.firstName} onChangeText={(v) => setForm({ ...form, firstName: v })} style={[styles.input, inputStyle(colors)]} />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.lastName")}</Text>
          <TextInput value={form.lastName} onChangeText={(v) => setForm({ ...form, lastName: v })} style={[styles.input, inputStyle(colors)]} />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.email")}</Text>
          <TextInput value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" style={[styles.input, inputStyle(colors)]} />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.phone")}</Text>
          <TextInput value={form.phone ?? ""} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" style={[styles.input, inputStyle(colors)]} />
          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.jobTitle")}</Text>
          <TextInput value={form.jobTitle ?? ""} onChangeText={(v) => setForm({ ...form, jobTitle: v })} style={[styles.input, inputStyle(colors)]} />

          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.role")}</Text>
          <View style={styles.roleRow}>
            {roleOptions.map((role) => {
              const active = form.vendorRole === role;
              return (
                <TouchableOpacity
                  key={role}
                  onPress={() => setForm({ ...form, vendorRole: role })}
                  style={[styles.roleChip, { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.card }]}
                >
                  <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: "Inter_500Medium", fontSize: 12 }}>{role}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployees.pecExpiration")}</Text>
          <TextInput
            value={form.pecExpirationDate ?? ""}
            onChangeText={(v) => setForm({ ...form, pecExpirationDate: v })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, inputStyle(colors)]}
          />

          <EmployeeCertificationsPanel employeeId={form.id} />

          <EmployeePortalLoginPanel
            employeeId={form.id}
            defaultEmail={form.email}
            vendorRole={form.vendorRole}
          />

          <LayeredPillButton onPress={save} disabled={saving} height={44} style={{ marginTop: 8 }}>
            <Text style={styles.saveText}>{saving ? t("fieldEmployees.saving") : t("fieldEmployees.saveChanges")}</Text>
          </LayeredPillButton>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    color: colors.foreground,
    borderColor: colors.border,
    backgroundColor: colors.background,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 32, gap: 8 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 4 },
  roleChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  saveText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15, textShadowColor: "rgba(0,0,0,0.65)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
});
