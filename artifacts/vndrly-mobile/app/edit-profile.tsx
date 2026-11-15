import { router, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import EditProfileForm from "@/components/EditProfileForm";
import PortalPageHeader from "@/components/PortalPageHeader";
import ScreenSafeArea from "@/components/ScreenSafeArea";

export default function EditProfileScreen() {
  const { t } = useTranslation();
  return (
    <ScreenSafeArea style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <PortalPageHeader
            title={t("stack.editProfile")}
            testIdPrefix="edit-profile"
          />
          <EditProfileForm onProfileChanged={() => router.replace("/profile")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: 32 },
});
