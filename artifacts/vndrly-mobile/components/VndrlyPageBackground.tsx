import React, { type ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";

type Props = {
  children: ReactNode;
};

export default function VndrlyPageBackground({ children }: Props) {
  return (
    <View style={styles.root}>
      <Image
        source={require("@/assets/images/vndrly-page-background.png")}
        style={styles.backgroundImage}
        resizeMode="cover"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
});
