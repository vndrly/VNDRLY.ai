import { ModalPressable as Pressable } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import { useRouter } from 'expo-router';
import { certificationProgram } from '@workspace/api-zod/certification-program-links';
import {
  CREDENTIAL_HOLDER_FIELD,
  credentialRequiresRecordNumber,
  EXTERNAL_CERTIFICATION_CATALOG,
  searchExternalCredentials,
} from "@workspace/api-zod/external-certification-catalog";
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { BrandedOnboardingField, BrandedOnboardingSelect } from "@/components/OnboardingControls";
import BrandedDateField from '@/components/BrandedDateField';
import { GateCard } from "@/components/gate/GateCard";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import AuthedImage from "@/components/AuthedImage";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAndUploadImage } from "@/lib/photos";
import { resolveStoragePath } from "@/lib/profile-photo";

type Cert = {
  id: number;
  name: string;
  issuer: string | null;
  certNumber: string | null;
  issuedDate: string | null;
  expirationDate: string | null;
  documentUrl: string | null;
  documentPath?: string | null;
  qualificationDetails?: Record<string, string> | null;
};

type FormState = {
  name: string;
  issuer: string;
  certNumber: string;
  issuedDate: string;
  expirationDate: string;
  documentPath: string;
  documentUrl: string;
  qualificationDetails: Record<string, string>;
};

const blankForm: FormState = {
  name: "",
  issuer: "",
  certNumber: "",
  issuedDate: "",
  expirationDate: "",
  documentPath: "",
  documentUrl: "",
  qualificationDetails: {},
};

type Props = {
  employeeId: number;
  onChanged?: () => void;
  defaultCertificationName?: string;
};

export default function EmployeeCertificationsPanel({ employeeId, onChanged, defaultCertificationName }: Props) {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [credentialSearch, setCredentialSearch] = useState("");
  const credential = EXTERNAL_CERTIFICATION_CATALOG.find(item => item.name === form.name);
  const fields = credential ? [CREDENTIAL_HOLDER_FIELD, ...credential.fields] : [];
  const options = pickerOpen ? searchExternalCredentials(credentialSearch) : [];
  const [uploading, setUploading] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

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
    const defaultType = EXTERNAL_CERTIFICATION_CATALOG.find(item =>
      item.name === defaultCertificationName ||
      (defaultCertificationName === "CDL" && item.name === "Commercial Driver License (CDL)"));
    setForm({ ...blankForm, name: defaultType?.name ?? "" });
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
      documentPath: c.documentPath ?? "",
      documentUrl: c.documentUrl ?? "",
      qualificationDetails: c.qualificationDetails ?? {},
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      Alert.alert(t("common.error"), t("employees.certifications.nameRequired"));
      return;
    }
    if (credentialRequiresRecordNumber(form.name) && !form.certNumber.trim() && !editingId) {
      Alert.alert(t("common.error"), t("employees.certifications.numberRequired", { defaultValue: "Enter the certificate number or credential identifier." }));
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
        documentUrl: form.documentPath ? `/api/storage${form.documentPath}` : form.documentUrl || null,
        qualificationDetails: form.qualificationDetails,
        documentPath: form.documentPath || null,
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

  const takeCredentialPhoto = async () => {
    setUploading(true);
    try {
      const uploaded = await captureAndUploadImage({ maxBytes: 10 * 1024 * 1024 });
      if (uploaded) setForm((current) => ({ ...current, documentPath: uploaded.objectPath }));
    } catch (e) {
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("employees.certifications.photoFailed"),
      );
    } finally {
      setUploading(false);
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


  return (
    <GateCard
      title={`${t("employees.certifications.title")} (${certs.length})`}
      subtitle={!loading && certs.length === 0 ? t("employees.certifications.empty") : undefined}
      icon="award"
      testID="employee-certifications-panel"
      headerAction={
        <ProfileMiniCardButton
          borderColor={colors.primary}
          inHeader
          onPress={startAdd}
          testID="button-add-certification"
        >
          {t("common.add")}
        </ProfileMiniCardButton>
      }
    >

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : (
        certs.map((c) => (
          <View key={c.id} style={[styles.certRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.certName, { color: colors.foreground }]}>{c.name}</Text>
              <Text style={[styles.certMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                {[c.issuer, c.certNumber ? `#${c.certNumber}` : null, c.expirationDate ? `exp ${c.expirationDate}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            {c.documentPath || c.documentUrl ? (
              <TouchableOpacity
                onPress={() =>
                  setPreviewPhoto(resolveStoragePath(c.documentPath ?? c.documentUrl))
                }
                style={styles.iconBtn}
                accessibilityLabel={t("employees.certifications.viewPhoto")}
                testID={`button-view-cert-photo-${c.id}`}
              >
                <Feather name="image" size={16} color={colors.primary} />
              </TouchableOpacity>
            ) : null}
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
        <View style={[styles.form, { borderColor: colors.primary, backgroundColor: "#242426" }]}>
          <Text style={[styles.formTitle, { color: colors.foreground }]}>
            {editingId ? t("employees.certifications.editTitle") : t("employees.certifications.addTitle")}
          </Text>
          {editingId ? (
            <Text style={{ color: colors.foreground }}>{form.name}</Text>
          ) : (
          <BrandedOnboardingSelect
            onPress={() => { setCredentialSearch(defaultCertificationName === "PEC" && !form.name ? "PEC" : ""); setPickerOpen(true); }}
            testID="input-cert-name"
            label={t('common.name', {defaultValue: 'Name'})}
            value={form.name || t("employees.certifications.chooseType", { defaultValue: "Choose credential type" })}
            expanded={pickerOpen}
          />
          )}
          {editingId && !credential && (
            <Text style={{ color: colors.mutedForeground }}>
              {t("employees.certifications.unmapped", { defaultValue: "This saved credential has no catalog match." })}
            </Text>
          )}
          <BrandedOnboardingField
            label={t("employees.certifications.issuerLabel")}
            value={form.issuer}
            onChangeText={(v) => setForm({ ...form, issuer: v })}
          />
          <BrandedOnboardingField
            label={credential?.recordNumberOptional
              ? t("employees.certifications.optionalRecordNumber", { defaultValue: "Record number (if shown)" })
              : t("employees.certifications.numberLabel") + " *"}
            testID="input-cert-number"
            value={form.certNumber}
            onChangeText={(v) => setForm({ ...form, certNumber: v })}
          />
          <BrandedDateField
            label={t("employees.certifications.issuedLabel")}
            value={form.issuedDate}
            onChange={(v) => setForm({ ...form, issuedDate: v })}
          />
          <BrandedDateField
            label={t("employees.certifications.expiresLabel")}
            value={form.expirationDate}
            onChange={(v) => setForm({ ...form, expirationDate: v })}
          />
          {credential?.nonExpiring && (
            <Text style={{ color: colors.mutedForeground }}>
              {t("employees.certifications.noIssuerExpiry", { defaultValue: "The issuer does not set an expiry. Leave Expires blank unless your credential shows one." })}
            </Text>
          )}
          {fields.map(field => /date$/i.test(field) ? <BrandedDateField key={field} label={field} value={form.qualificationDetails[field] ?? ''}
            onChange={value => setForm(current => ({...current, qualificationDetails: {...current.qualificationDetails, [field]: value}}))} /> : (
            <BrandedOnboardingField
              key={field}
              label={field}
              value={form.qualificationDetails[field] ?? ""}
              onChangeText={value => setForm(current => ({
                ...current,
                qualificationDetails: { ...current.qualificationDetails, [field]: value },
              }))}
            />
          ))}
          <ProfileMiniCardButton
            borderColor={colors.primary}
            onPress={() => void takeCredentialPhoto()}
            loading={uploading}
            testID="button-cert-photo"
          >
            {uploading
              ? t("employees.certifications.uploadingPhoto")
              : form.documentPath
                ? t("employees.certifications.photoAttached")
                : t("employees.certifications.takePhoto")}
          </ProfileMiniCardButton>
          <View style={styles.formActions}>
            <ProfileMiniCardButton
              borderColor={colors.primary}
              onPress={() => {
                setFormOpen(false);
                setEditingId(null);
                setForm(blankForm);
              }}
            >
              {t("common.cancel")}
            </ProfileMiniCardButton>
            <ProfileMiniCardButton borderColor={colors.primary} onPress={save} loading={saving}>
              {t("common.save")}
            </ProfileMiniCardButton>
          </View>
        </View>
      ) : null}

      <DismissibleModal visible={pickerOpen} transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.photoBackdrop}>
          <View style={[styles.picker, { borderColor: colors.primary }]}>
            <BrandedOnboardingField
              label={t("employees.certifications.searchTypes", { defaultValue: "Search credential types" })}
              value={credentialSearch}
              onChangeText={setCredentialSearch}
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {options.map(option => {
                const program = certificationProgram(option.name);
                return <View key={option.name} style={styles.pickerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={option.name}
                  accessibilityState={{ selected: option.name === form.name }}
                  style={[styles.pickerOption, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setForm(current => {
                      if (option.name === current.name) return current;
                      const holder = current.qualificationDetails[CREDENTIAL_HOLDER_FIELD];
                      return {
                        ...current, name: option.name,
                        qualificationDetails: holder ? { [CREDENTIAL_HOLDER_FIELD]: holder } : {},
                      };
                    });
                    setPickerOpen(false);
                  }}
                >
                  <Text numberOfLines={2} style={{ minWidth: 0, flexShrink: 1, lineHeight: 20, color: option.name === form.name ? colors.primary : colors.foreground }}>{option.name}</Text>
                </Pressable>
                {program && <Pressable accessibilityRole="link" accessibilityLabel={`VNDRLY/U Cert: ${program.title}`}
                  style={styles.programLink} onPress={() => { setPickerOpen(false); setFormOpen(false); router.push(`/work-hub/bundle/${program.id}` as never); }}>
                  <Text style={{ color: colors.primary, textAlign: 'right', fontSize: 12, lineHeight: 16 }}>{'VNDRLY/U\nCert'}</Text>
                  <Feather name="external-link" size={12} color={colors.primary} />
                </Pressable>}
                </View>;
              })}
              {!options.length && <Text style={{ color: colors.mutedForeground }}>{t("employees.certifications.noTypes", { defaultValue: "No matching credential types." })}</Text>}
            </ScrollView>
          </View>
        </View>
      </DismissibleModal>

      <DismissibleModal
        visible={!!previewPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <Pressable
          style={styles.photoBackdrop}
          onPress={() => setPreviewPhoto(null)}
          testID="cert-photo-modal"
        >
          {previewPhoto ? (
            <AuthedImage
              uri={previewPhoto}
              style={styles.photoPreview}
              resizeMode="contain"
              testID="cert-photo-image"
            />
          ) : null}
          <TouchableOpacity
            onPress={() => setPreviewPhoto(null)}
            style={styles.photoClose}
            accessibilityLabel={t("common.close")}
            testID="button-close-cert-photo"
          >
            <Feather name="x" size={24} color="#ffffff" />
          </TouchableOpacity>
        </Pressable>
      </DismissibleModal>
    </GateCard>
  );
}

const styles = StyleSheet.create({
  picker: { width: "92%", maxWidth: 600, maxHeight: "80%", padding: 16, gap: 10, borderWidth: 1, borderRadius: 14, backgroundColor: "#242426" },
  pickerRow: { flexDirection: 'row', minWidth: 0, maxWidth: '100%', alignItems: 'stretch' },
  programLink: { width: 96, flexShrink: 0, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'flex-end', padding: 8 },
  pickerOption: { flex: 1, minWidth: 0, minHeight: 56, justifyContent: "center", borderBottomWidth: 1, paddingVertical: 8 },
  certRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  certName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  certMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 6 },
  form: { minWidth: 0, maxWidth: '100%', borderWidth: 1, borderRadius: 10, padding: 12, gap: 6, marginTop: 4 },
  formTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 4 },
  formActions: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  photoBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 20 },
  photoPreview: { width: "100%", height: "78%" },
  photoClose: { position: "absolute", top: 48, right: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
