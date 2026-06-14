import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import type { MembershipSummary } from "@/lib/auth";

/**
 * Shown when the user has 2+ org memberships and has not yet picked a
 * remembered active context (`requiresContextChoice` from the API).
 */
export default function ContextPickerModal() {
  const colors = useColors();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user, availableMemberships, switchContext } = useAuth();
  const [busyId, setBusyId] = useState<number | null>(null);

  const visible =
    !!user &&
    !!user.requiresContextChoice &&
    availableMemberships.length >= 2;

  if (!visible) return null;

  const handlePick = async (membership: MembershipSummary) => {
    setBusyId(membership.id);
    try {
      await switchContext(membership.id);
      await queryClient.cancelQueries();
      queryClient.clear();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible transparent animationType="fade" testID="context-picker-modal">
      <View style={[styles.backdrop, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("contextPicker.title")}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {t("contextPicker.body")}
          </Text>
          {availableMemberships.map((m) => {
            const partner = m.orgType === "partner";
            const busy = busyId === m.id;
            return (
              <Pressable
                key={m.id}
                disabled={busyId !== null}
                onPress={() => void handlePick(m)}
                style={[
                  styles.option,
                  {
                    borderColor: partner ? "#3260CD" : colors.primary,
                    opacity: busyId !== null && !busy ? 0.5 : 1,
                  },
                ]}
                testID={`button-pick-context-${m.id}`}
              >
                <View style={styles.optionText}>
                  <Text style={[styles.orgName, { color: colors.foreground }]}>{m.orgName}</Text>
                  <Text style={[styles.orgType, { color: colors.mutedForeground }]}>
                    {partner ? t("auth.partner") : t("auth.vendor")}
                  </Text>
                </View>
                {busy ? <ActivityIndicator color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    marginBottom: 6,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  option: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionText: {
    flex: 1,
    paddingRight: 8,
  },
  orgName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  orgType: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
});
