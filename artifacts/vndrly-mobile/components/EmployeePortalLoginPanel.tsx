import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import LayeredPillButton from "@/components/LayeredPillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type LoginStatus = {
  hasLogin?: boolean;
  portalLoginEnabled?: boolean;
  email?: string;
  mustChangePassword?: boolean;
};

type Props = {
  employeeId: number;
  defaultEmail?: string;
  vendorRole?: string | null;
  onSaved?: () => void;
};

export default function EmployeePortalLoginPanel({
  employeeId,
  defaultEmail = "",
  vendorRole,
  onSaved,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [portalLoginEnabled, setPortalLoginEnabled] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [hasLogin, setHasLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<LoginStatus>(`/api/field-employees/${employeeId}/login`)
      .then((info) => {
        if (cancelled) return;
        const enabled = !!(info?.hasLogin || info?.portalLoginEnabled);
        setPortalLoginEnabled(enabled);
        setHasLogin(!!info?.hasLogin);
        setMustChangePassword(!!info?.mustChangePassword);
        if (info?.email) setEmail(info.email);
        else if (defaultEmail) setEmail(defaultEmail);
      })
      .catch(() => {
        if (!cancelled) {
          setPortalLoginEnabled(false);
          setHasLogin(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, defaultEmail]);

  const portalPath =
    vendorRole === "admin" || vendorRole === "office"
      ? "/"
      : vendorRole === "foreman" || vendorRole === "both"
        ? "/foreman"
        : "/field";

  const save = async () => {
    setSaving(true);
    try {
      if (!portalLoginEnabled) {
        await apiFetch(`/api/field-employees/${employeeId}/login`, { method: "DELETE" });
        setHasLogin(false);
        setPassword("");
        onSaved?.();
        return;
      }
      if (!email.trim()) throw new Error(t("fieldEmployeeDetail.emailPasswordRequired"));
      if (!hasLogin && password.length < 8) throw new Error(t("fieldEmployeeDetail.emailPasswordRequired"));
      if (hasLogin && password.length > 0 && password.length < 8) {
        throw new Error(t("fieldEmployeeDetail.emailPasswordRequired"));
      }
      await apiFetch(`/api/field-employees/${employeeId}/login`, {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          portalLoginEnabled: true,
          mustChangePassword,
          ...(password ? { password } : {}),
        }),
      });
      setHasLogin(true);
      setPassword("");
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />;
  }

  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>{t("fieldEmployeeDetail.fieldPortalLogin")}</Text>

      <TouchableOpacity
        style={styles.checkRow}
        onPress={() => setPortalLoginEnabled((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: portalLoginEnabled }}
        testID="employee-login-portal-enabled"
      >
        <View style={[styles.checkbox, portalLoginEnabled && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {portalLoginEnabled ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <View style={styles.checkCopy}>
          <Text style={[styles.checkLabel, { color: colors.foreground }]}>{t("fieldEmployeeDetail.enablePortalLogin")}</Text>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            {t("fieldEmployeeDetail.enablePortalLoginHelp", { path: portalPath })}
          </Text>
        </View>
      </TouchableOpacity>

      {portalLoginEnabled ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>{t("fieldEmployeeDetail.loginEmail")}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            testID="employee-login-email"
          />
          <Text style={[styles.label, { color: colors.foreground }]}>
            {hasLogin ? t("fieldEmployeeDetail.newPassword") : t("fieldEmployeeDetail.password")}
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={hasLogin ? t("fieldEmployeeDetail.passwordOptionalPlaceholder") : t("fieldEmployeeDetail.passwordPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            testID="employee-login-password"
          />
          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => setMustChangePassword((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: mustChangePassword }}
            testID="employee-login-must-change"
          >
            <View style={[styles.checkbox, mustChangePassword && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {mustChangePassword ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <View style={styles.checkCopy}>
              <Text style={[styles.checkLabel, { color: colors.foreground }]}>{t("fieldEmployeeDetail.forcePasswordChange")}</Text>
              <Text style={[styles.help, { color: colors.mutedForeground }]}>{t("fieldEmployeeDetail.forcePasswordChangeHelp")}</Text>
            </View>
          </TouchableOpacity>
        </>
      ) : null}

      <LayeredPillButton onPress={save} disabled={saving} height={40} style={styles.saveBtn} testID="employee-login-save">
        <Text style={styles.saveText}>
          {saving
            ? t("fieldEmployeeDetail.saving")
            : portalLoginEnabled
              ? hasLogin
                ? t("fieldEmployeeDetail.updatePassword")
                : t("fieldEmployeeDetail.createLogin")
              : t("fieldEmployeeDetail.saveLoginSettings")}
        </Text>
      </LayeredPillButton>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#94a3b8",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "700" },
  checkCopy: { flex: 1 },
  checkLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  help: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  saveBtn: { marginTop: 4 },
  saveText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14, textShadowColor: "rgba(0,0,0,0.65)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
});
