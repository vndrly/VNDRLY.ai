import React, { useEffect, type ReactNode } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";

const BACKGROUND = "#3a3d42";

type Props = {
  children: ReactNode;
};

export default function VndrlyPageBackground({ children }: Props) {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const styleId = "vndrly-mobile-transparent-scenes";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      div[class*="r-position-u8s1d"][class*="r-bottom-1p0dtai"][class*="r-top-ipm5af"] {
        background-color: transparent !important;
      }
    `;
    document.head.appendChild(style);
  }, []);

  return (
    <View style={styles.root}>
      <Image
        source={require("@/assets/images/vndrly-page-background.png")}
        style={styles.backgroundImage}
        resizeMode="cover"
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  backgroundImage: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: "100%",
    height: "100%",
  },
  content: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
