import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

import NavPaneChromeBackground from "@/components/NavPaneChromeBackground";
import { NAV_PANE_DARK_BG, SCREEN_ROOT_BACKGROUND } from "@/lib/nav-pane-tokens";

type Props = ViewProps & {
  children: React.ReactNode;
};

/** Global nav-pane surface + decorative halftone/header blur behind all screens. */
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
    backgroundColor: NAV_PANE_DARK_BG,
  },
  content: {
    flex: 1,
    backgroundColor: SCREEN_ROOT_BACKGROUND,
  },
});
