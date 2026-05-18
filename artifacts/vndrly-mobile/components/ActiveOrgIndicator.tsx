import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";

// Task #186 — compact "active organization" indicator surfaced in the
// header of every authenticated tab. Originally the only place a dual-
// role user could see which org they were acting as was the brand row
// on the Home tab. Once they navigated to Schedule / Scan / Profile
// they lost that visual reminder, making it easy to forget the new
// context after switching on Profile (e.g. they could end up creating
// a ticket under the wrong org).
//
// Renders only when the user actually has more than one membership —
// single-membership users get the same clean tab header they had
// before so we don't add clutter for the common case. The component
// reads from the same `useAuth` context the Profile picker writes
// into via `switchContext`, so flipping the active org on Profile
// updates this pill instantly across every tab without any prop
// drilling or refetch.
export default function ActiveOrgIndicator() {
  const { t } = useTranslation();
  const colors = useColors();
  const { availableMemberships, activeMembership } = useAuth();

  // Single-membership users still get a clean header (no extra clutter).
  if (availableMemberships.length < 2) return null;
  if (!activeMembership) return null;

  const partner = activeMembership.orgType === "partner";
  return (
    <View
      style={styles.bar}
      accessibilityLabel={`${t("auth.activeOrg")}: ${activeMembership.orgName} (${
        partner ? t("auth.partner") : t("auth.vendor")
      })`}
      testID="active-org-indicator"
    >
      <Text
        style={[styles.orgName, { color: colors.foreground }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        testID="active-org-indicator-name"
      >
        {activeMembership.orgName}
      </Text>
      <View
        style={[
          styles.pill,
          partner ? styles.pillPartner : styles.pillVendor,
        ]}
        testID={`active-org-indicator-pill-${activeMembership.orgType}`}
      >
        <Text style={styles.pillText}>
          {partner ? t("auth.partner") : t("auth.vendor")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    maxWidth: 220,
  },
  orgName: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    flexShrink: 1,
  },
  // Mirrors the brand-row pill colors used on the Home tab so the
  // two indicators read as the same control to the eye.
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillPartner: { backgroundColor: "#3b82f6" },
  pillVendor: { backgroundColor: "#7c3aed" },
  pillText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#ffffff",
  },
});
