/** Site-wide pill doctrine — matches web Crew Tracker (23px). */
export const PILL_HEIGHT_PX = 23;

export const PILL_TEXT = {
  fontFamily: "Inter_400Regular",
  fontSize: 12,
} as const;

/** Shared layout for CSS status/tag chips (non-PNG pills). */
export const PILL_CHIP_LAYOUT = {
  height: PILL_HEIGHT_PX,
  minHeight: PILL_HEIGHT_PX,
  paddingHorizontal: 12,
  paddingVertical: 0,
  borderRadius: 999,
  justifyContent: "center" as const,
  alignItems: "center" as const,
};
