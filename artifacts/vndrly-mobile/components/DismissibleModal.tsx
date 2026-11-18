import { ModalDraftContext } from "./ModalDraft";
import React, {createContext, useContext, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore, useRef} from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View, type ModalProps } from "react-native";
import { overlayOwner } from "@/lib/overlay-owner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

type Props = Omit<ModalProps, "onRequestClose"> & {
  onRequestClose: () => void;
  dismissLabel?: "cancel" | "close" | "signOut";
  dismissDisabled?: boolean;
  hasUnsavedChanges?: boolean;
  /** Includes picker selections, attachments and other non-text form values. Kept in memory only. */
  draftValue?: unknown;
};

const ModalSteps = createContext<{ register: (id: string, content: React.ReactNode, dismiss: () => void) => () => void } | null>(null);

/** Persistent exits belong to the modal viewport, outside the caller's scrolling content. */
export default function DismissibleModal({ children, onRequestClose, dismissLabel = "cancel", dismissDisabled = false, hasUnsavedChanges = false, draftValue, ...props }: Props) {
  const parent = useContext(ModalSteps), id = useId();
  const visible = props.visible !== false;
  const [steps, setSteps] = useState(new Map<string, {content:React.ReactNode; dismiss:()=>void}>());
  const coordinator = useMemo(() => ({ register: (key: string, content: React.ReactNode, dismiss: () => void) => {
    setSteps(previous => new Map(previous).set(key, {content, dismiss}));
    return () => setSteps(previous => { const next = new Map(previous); next.delete(key); return next; });
  } }), []);
  const owner = useSyncExternalStore(overlayOwner.subscribe, overlayOwner.current, () => undefined);
  useLayoutEffect(() => visible && !parent ? overlayOwner.claim(id) : undefined, [visible, parent, id]);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const label = dismissLabel === "signOut" ? t("common.signOut", { defaultValue: "Sign out" }) : t(`common.${dismissLabel}`, { defaultValue: dismissLabel === "close" ? "Close" : "Cancel" });
  const dirtyFields = useRef(new Set<string>());
  const snapshot = useRef<string | undefined>(undefined), initial = useRef<string | undefined>(undefined);
  snapshot.current = JSON.stringify(draftValue);
  useLayoutEffect(() => { if (!visible) { dirtyFields.current.clear(); initial.current = undefined; } }, [visible]);
  const attempt = (action: () => void) => {
    if (dismissDisabled) return;
    if (!hasUnsavedChanges && !dirtyFields.current.size && (initial.current === undefined || initial.current === snapshot.current)) { action(); return; }
    Alert.alert(t("common.unsavedChanges", {defaultValue:"Unsaved changes"}), t("common.discardUnsaved", {defaultValue:"Discard unsaved changes?"}), [
      {text:t("common.keepEditing", {defaultValue:"Keep editing"}),style:"cancel"},
      {text:t("common.discard", {defaultValue:"Discard"}),style:"destructive",onPress:action},
    ]);
  };
  const attemptRef = useRef(attempt); attemptRef.current = attempt;
  const draft = useMemo(() => ({mark: (key:string, dirty:boolean) => { if (dirty) dirtyFields.current.add(key); else dirtyFields.current.delete(key); }, touch: () => { initial.current ??= snapshot.current; }, dismiss: (action:()=>void) => attemptRef.current(action)}), []);
  const dismiss = () => attempt(onRequestClose);
  const frame = <ModalDraftContext.Provider value={draft}><ModalSteps.Provider value={parent ?? coordinator}>
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
  </ModalSteps.Provider></ModalDraftContext.Provider>;
  useLayoutEffect(() => visible && parent ? parent.register(id, frame, dismiss) : undefined, [visible, parent, id, children, dismissDisabled, hasUnsavedChanges, onRequestClose, label]);
  if (parent) return null;
  const activeStep = [...steps.keys()].at(-1);
  return <Modal {...props} visible={visible && owner === id} onRequestClose={activeStep ? steps.get(activeStep)?.dismiss : dismiss} allowSwipeDismissal={false}>
    <View style={{flex:1}} accessibilityViewIsModal>
      <View style={[styles.viewport, activeStep && {display:"none"}]} pointerEvents={activeStep ? "none" : "auto"} accessibilityElementsHidden={Boolean(activeStep)} importantForAccessibility={activeStep ? "no-hide-descendants" : "auto"}>{frame}</View>
      {[...steps].map(([key, content]) => <View key={key} style={[StyleSheet.absoluteFill, key !== activeStep && {display:"none"}]} pointerEvents={key === activeStep ? "auto" : "none"} accessibilityElementsHidden={key !== activeStep}>{content.content}</View>)}
    </View>
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
