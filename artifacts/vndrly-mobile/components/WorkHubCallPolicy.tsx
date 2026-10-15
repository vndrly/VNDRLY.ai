import React, { useEffect, useState } from "react";
import { Modal, Switch, Text, View } from "react-native";
import TogglePillButton from "./TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
type PolicyState = {
  policy: { enabled: boolean; version: number } | null;
  available: boolean;
};
export default function WorkHubCallPolicy() {
  const { user } = useAuth(),
    colors = useColors(),
    [state, setState] = useState<PolicyState | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const allowed =
    !!user?.vendorId &&
    (user.role === "admin" ||
      user.availableMemberships?.some(
        (m) => m.id === user.activeMembershipId && m.role === "admin",
      ));
  useEffect(() => {
    let mounted = true;
    const scope = captureAuthScope();
    setState(null);
    setNotice("");
    if (allowed)
      void apiFetch<PolicyState>(
        "/api/work-hub/calls/transcription-policy",
        undefined,
        scope,
      )
        .then((result) => {
          if (mounted && isAuthScopeCurrent(scope)) setState(result);
        })
        .catch(() => {
          if (mounted) setNotice("Company transcription settings unavailable.");
        });
    return () => {
      mounted = false;
    };
  }, [allowed, user?.id, user?.activeMembershipId, user?.vendorId]);
  if (!allowed) return null;
  const update = async (enabled: boolean) => {
    if (!state || busy) return;
    const scope = captureAuthScope();
    setBusy(true);
    try {
      const result = await apiFetch<PolicyState>(
        "/api/work-hub/calls/transcription-policy",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled,
            expectedVersion: state.policy?.version ?? 0,
            operationId: crypto.randomUUID(),
          }),
        },
        scope,
      );
      if (isAuthScopeCurrent(scope)) setState(result);
    } catch {
      if (isAuthScopeCurrent(scope))
        setNotice("Could not save policy. Refresh before retrying.");
    } finally {
      if (isAuthScopeCurrent(scope)) setBusy(false);
    }
  };
  return (
    <View>
      <TogglePillButton color="brand" onPress={() => setOpen(true)}>
        Company call settings
      </TogglePillButton>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 20,
            backgroundColor: "rgba(0,0,0,0.65)",
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              padding: 16,
              borderRadius: 14,
            }}
          >
            <TogglePillButton color="brand" onPress={() => setOpen(false)}>
              Close settings
            </TogglePillButton>
            <View
              style={{
                gap: 8,
                borderWidth: 2,
                borderColor: colors.primary,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "700" }}>
                  Company call transcription
                </Text>
                <Switch
                  accessibilityLabel="Company call transcription"
                  value={state?.policy?.enabled ?? false}
                  disabled={!state || busy}
                  onValueChange={(enabled) => void update(enabled)}
                />
              </View>
              <Text style={{ color: colors.mutedForeground }}>
                Internal vendor calls and voicemail. Company policy applies
                without per-call prompts.
              </Text>
              {state && !state.available && (
                <Text style={{ color: colors.mutedForeground }}>
                  The internal speech engine is unavailable. Calls and voicemail
                  playback still work.
                </Text>
              )}
              {!!notice && <Text style={{ color: colors.text }}>{notice}</Text>}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
