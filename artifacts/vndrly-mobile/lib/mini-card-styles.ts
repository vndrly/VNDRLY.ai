import { StyleSheet } from "react-native";

export const miniCardStyles = StyleSheet.create({
  miniCardButton: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    minWidth: 0,
    maxWidth: "100%",
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: "#2b2b2f",
  },
  miniCardLabel: {
    color: "#ececec",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
    minWidth: 0,
  },
});
