import { ModalTextInput as TextInput } from "@/components/ModalDraft";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { GateRow } from "@/components/gate/GateChrome";
import ProfilePhotoImage from "@/components/ProfilePhotoImage";
import { useColors } from "@/hooks/useColors";
import { apiFetch, refreshAuthMe } from "@/lib/api";
import { captureAndUploadImage, pickAndUploadImage } from "@/lib/photos";

type FieldMe = {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  vendorName: string | null;
  jobTitle: string | null;
  profilePhotoPath: string | null;
  photoUrl: string | null;
};

type FieldMeFull = {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  profilePhotoPath: string | null;
  photoUrl?: string | null;
};

export default function EditProfileForm({ inline = false, fieldsExpanded = true, editToggle, onProfileChanged, onPhotoChanged }: {
  inline?: boolean;
  fieldsExpanded?: boolean;
  editToggle?: React.ReactNode;
  onProfileChanged: () => void;
  onPhotoChanged?: () => void;
}) {
  const colors = useColors();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [employeeDetails, setEmployeeDetails] = useState(false);
  const [notice, setNotice] = useState("");

  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [directPhotoUrl, setDirectPhotoUrl] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  useEffect(() => {
    apiFetch<FieldMe & { phone?: string | null }>("/api/field/me")
      .then((me) => {
        setEmployeeDetails(Boolean(me.employeeId));
        setFirstName(me.firstName ?? "");
        setLastName(me.lastName ?? "");
        setEmail(me.email ?? "");
        setJobTitle(me.jobTitle ?? "");
        setPhone((me.phone as string | null) ?? "");
        setPhotoPath(me.profilePhotoPath);
        setDirectPhotoUrl(me.photoUrl ?? null);
      })
      .catch((e) =>
        Alert.alert(
          t("common.error"),
          e instanceof Error ? e.message : t("editProfile.couldNotLoad"),
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const uploadFrom = async (source: "camera" | "library") => {
    try {
      const result =
        source === "camera"
          ? await captureAndUploadImage()
          : await pickAndUploadImage();
      if (!result) return;
      const saved = await apiFetch<FieldMeFull>("/api/field/me", {
        method: "PATCH",
        body: JSON.stringify({ profilePhotoPath: result.objectPath }),
      });
      setPhotoPath(saved.profilePhotoPath);
      setDirectPhotoUrl(saved.photoUrl ?? null);
      onPhotoChanged?.();
    } catch (e: unknown) {
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("editProfile.couldNotUpload"),
      );
    }
  };

  const onChangePhoto = () => {
    Alert.alert(
      t("editProfile.photoTitle"),
      t("editProfile.photoChooseSource"),
      [
        {
          text: t("editProfile.takePhoto"),
          onPress: () => uploadFrom("camera"),
        },
        {
          text: t("editProfile.chooseLibrary"),
          onPress: () => uploadFrom("library"),
        },
        { text: t("common.cancel"), style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  const onSave = async () => {
    if (!firstName.trim()) {
      Alert.alert(t("common.required"), t("editProfile.requiredFirstName"));
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      Alert.alert(
        t("editProfile.invalidEmailTitle"),
        t("editProfile.invalidEmailBody"),
      );
      return;
    }
    setNotice("");
    setSaving(true);
    try {
      await apiFetch<FieldMeFull>("/api/field/me", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          jobTitle: jobTitle.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      await refreshAuthMe();
      Alert.alert(t("editProfile.savedTitle"), t("editProfile.savedBody"));
      onProfileChanged();
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : t("editProfile.couldNotSave"));
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("editProfile.couldNotSave"),
      );
    } finally {
      setSaving(false);
    }
  };

  const onChangePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert(t("common.required"), t("editProfile.pwRequired"));
      return;
    }
    if (newPw.length < 8) {
      Alert.alert(t("editProfile.pwShortTitle"), t("editProfile.pwShortBody"));
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert(
        t("editProfile.pwMismatchTitle"),
        t("editProfile.pwMismatchBody"),
      );
      return;
    }
    setPwSaving(true);
    try {
      await apiFetch<void>("/api/field/me/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: currentPw,
          newPassword: newPw,
        }),
      });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      Alert.alert(
        t("editProfile.pwUpdatedTitle"),
        t("editProfile.pwUpdatedBody"),
      );
    } catch (e: unknown) {
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("editProfile.couldNotChangePw"),
      );
    } finally {
      setPwSaving(false);
    }
  };

  const hasPhoto = !!(photoPath || directPhotoUrl);

  return (
    <>
    {notice ? (
      <Text
        accessibilityRole="alert"
        style={{ color: colors.foreground }}
      >
        {notice}
      </Text>
    ) : null}
    <View testID="profile-photo-control" style={[styles.header, inline && styles.inlineHeader]}>
      <TouchableOpacity
        onPress={onChangePhoto}
        style={styles.avatarWrap}
        disabled={loading || !employeeDetails}
      >
        {hasPhoto ? (
          <ProfilePhotoImage
            profilePhotoPath={photoPath}
            photoUrl={directPhotoUrl}
            style={styles.avatar}
          />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarPlaceholder,
              { backgroundColor: colors.accent },
            ]}
          >
            <Feather
              name="user"
              size={36}
              color={colors.accentForeground}
            />
          </View>
        )}
        <View
          style={[
            styles.cameraBadge,
            { backgroundColor: colors.primary },
          ]}
        >
          <Feather
            name="camera"
            size={14}
            color={colors.primaryForeground}
          />
        </View>
      </TouchableOpacity>
      <Text style={[styles.tapHint, { color: colors.mutedForeground }]}>
        {t("editProfile.tapToChange")}
      </Text>
    </View>

    {editToggle}
    {fieldsExpanded && (
      <>
        <View
          style={[
            styles.section,
              inline && styles.inlineSection,
            { borderColor: colors.primary, backgroundColor: "#242426" },
          ]}
        >
          <Text
            style={styles.sectionTitle}
          >
            {t("editProfile.yourDetails")}
          </Text>

          <Field
            label={t("editProfile.firstName")}
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            colors={colors}
            testID="input-first-name"
          />
          <Field
            label={t("editProfile.lastName")}
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            colors={colors}
            testID="input-last-name"
          />
          <Field
            label={t("editProfile.email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            colors={colors}
            testID="input-email"
          />
          {employeeDetails && (
            <>
              <Field
                label={t("editProfile.jobTitle")}
                value={jobTitle}
                onChangeText={setJobTitle}
                autoCapitalize="words"
                placeholder={t("editProfile.jobTitlePlaceholder")}
                colors={colors}
                testID="input-job-title"
              />
              <Field
                label={t("editProfile.phone")}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder={t("editProfile.phonePlaceholder")}
                colors={colors}
                testID="input-phone"
              />
            </>
          )}
          <ProfileMiniCardButton borderColor={colors.primary}
            onPress={onSave}
            loading={saving}
            disabled={loading}
            testID="button-save-profile"
          >
            {t("editProfile.saveChanges")}
          </ProfileMiniCardButton>
        </View>

        <View
          style={[
            styles.section,
              inline && styles.inlineSection,
            { borderColor: colors.primary, backgroundColor: "#242426" },
          ]}
        >
          <GateRow
            label={t("editProfile.changePassword")}
            icon={passwordOpen ? "chevron-down" : "chevron-right"}
            expanded={passwordOpen}
            showDivider={false}
            onPress={() => setPasswordOpen(open => !open)}
          />
          {passwordOpen && (
            <View>
              <Field
                label={t("editProfile.currentPw")}
                value={currentPw}
                onChangeText={setCurrentPw}
                secureTextEntry
                colors={colors}
                testID="input-current-password"
              />
              <Field
                label={t("editProfile.newPw")}
                value={newPw}
                onChangeText={setNewPw}
                secureTextEntry
                colors={colors}
                testID="input-new-password"
              />
              <Field
                label={t("editProfile.confirmPw")}
                value={confirmPw}
                onChangeText={setConfirmPw}
                secureTextEntry
                colors={colors}
                testID="input-confirm-password"
              />

              <ProfileMiniCardButton borderColor={colors.primary}
                onPress={onChangePassword}
                loading={pwSaving}
                testID="button-change-password"
              >
                {t("editProfile.updatePw")}
              </ProfileMiniCardButton>
            </View>
          )}
        </View>
      </>
    )}
    </>
  );
}

type ColorPalette = ReturnType<typeof useColors>;

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  colors: ColorPalette;
  testID?: string;
}) {
  const { colors, label, ...rest } = props;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <TextInput
        {...rest}
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: "#303034",
            borderColor: colors.primary,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", paddingTop: 16, paddingBottom: 12 },
  inlineHeader: { position: "absolute", right: 16, top: 14, width: 96, paddingTop: 0, paddingBottom: 0, zIndex: 1 },
  avatarWrap: { position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  tapHint: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 8, textAlign: "center" },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
  },
  inlineSection: { marginHorizontal: 0, borderWidth: 1 },
  sectionTitle: {
    color: "#fff",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  fieldLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
});
