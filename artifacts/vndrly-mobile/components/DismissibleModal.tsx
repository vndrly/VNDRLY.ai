import React, { useContext } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View, type ModalProps } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

type Props = Omit<ModalProps, "onRequestClose"> & {
  onRequestClose: () => void;
  dismissLabel?: "cancel" | "close" | "signOut";
  dismissDisabled?: boolean;
};

/** Persistent exits belong to the modal viewport, outside the caller's scrolling content. */
export default function DismissibleModal({ children, onRequestClose, dismissLabel = "cancel", dismissDisabled = false, ...props }: Props) {
  const insets = useContext(SafeAreaInsetsContext);
  const { t } = useTranslation();
  const label = dismissLabel === "signOut" ? t("common.signOut", { defaultValue: "Sign out" }) : t(`common.${dismissLabel}`, { defaultValue: dismissLabel === "close" ? "Close" : "Cancel" });
  const dismiss = () => { if (!dismissDisabled) onRequestClose(); };
  return <Modal {...props} onRequestClose={dismiss}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.viewport}>
      <View style={[styles.header, { paddingTop: insets?.top ?? 0 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={dismissLabel === "signOut" ? label : t("common.close", { defaultValue: "Close" })}
          disabled={dismissDisabled} onPress={dismiss} testID="modal-safe-close"
          style={[styles.exit, dismissDisabled && styles.disabled]}><Text style={styles.x}>×</Text></Pressable>
      </View>
      <View style={styles.body} testID="modal-safe-body">{children}</View>
      <View style={[styles.footer, { paddingBottom: Math.max(insets?.bottom ?? 0, 8) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={dismissDisabled} onPress={dismiss}
          testID="modal-safe-cancel" style={[styles.cancel, dismissDisabled && styles.disabled]}><Text style={styles.label}>{label}</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  viewport: { flex: 1, backgroundColor: "#242426" },
  header: { flexShrink: 0, alignItems: "flex-end", paddingHorizontal: 12 },
  exit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  x: { color: "#ececec", fontSize: 28 },
  body: { flex: 1, minHeight: 0, overflow: "hidden" },
  footer: { flexShrink: 0, paddingTop: 8, paddingHorizontal: 16, alignItems: "flex-end", borderTopWidth: 1, borderTopColor: "#5b5b60" },
  cancel: { minWidth: 88, minHeight: 44, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#a3a3a3", borderRadius: 8, paddingHorizontal: 16 },
  label: { color: "#ececec", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
});
