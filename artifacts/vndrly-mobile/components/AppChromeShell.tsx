import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

import NavPaneChromeBackground from "@/components/NavPaneChromeBackground";

/** Unwired — kept in repo only. */
const UNWIRED_SHELL_BASE = "#313438";
const UNWIRED_SHELL_CONTENT = "transparent";

type Props = ViewProps & {
  children: React.ReactNode;
};

export default function AppChromeShell({ children, style, ...rest }: Props) {
  return (
    <View style={[styles.root, style]} {...rest}>
      <NavPaneChromeBackground />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UNWIRED_SHELL_BASE,
  },
  content: {
    flex: 1,
    backgroundColor: UNWIRED_SHELL_CONTENT,
  },
});
