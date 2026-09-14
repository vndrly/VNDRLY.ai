import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

const AUTHORIZATION_VERSION = "work-participation-2026-09";
type Status = { state: "pending" | "claimed" | "expired" | "revoked" | "invalid"; username?: string; sponsorName?: string };

export default function ActivateAccount() {
  const colors = useColors();
  const { token = "" } = useLocalSearchParams<{ token?: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus({ state: "invalid" });
      return;
    }
    apiFetch<Status>(`/api/implementation-a/account-invitations/activate/${encodeURIComponent(token)}`)
      .then(setStatus)
      .catch(() => setStatus({ state: "invalid" }));
  }, [token]);

  const ready = password.length >= 12 && password === confirm && authorized;
  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/api/implementation-a/account-invitations/activate/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, authorizationVersion: AUTHORIZATION_VERSION }),
      });
      setDone(true);
    } catch {
      setError("We could not activate this account. Ask your company administrator for a new link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Activate account", headerBackVisible: false }} />
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]} accessibilityLiveRegion="polite">
          <Text style={[styles.eyebrow, { color: colors.primary }]}>VNDRLY ACCOUNT ACTIVATION</Text>
          {!status ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : done ? <>
            <Text style={[styles.title, { color: colors.foreground }]}>Your account is ready</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Sign in with the password you just created to finish your employee profile.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Continue to sign in</Text></Pressable>
          </> : status.state !== "pending" ? <>
            <Text style={[styles.title, { color: colors.foreground }]}>This invitation is unavailable</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Ask your company administrator to resend it.</Text>
          </> : <>
            <Text style={[styles.title, { color: colors.foreground }]}>{status.sponsorName} created your account</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Your username is {status.username}. Create your own password; VNDRLY never sends a temporary password.</Text>
            <TextInput accessibilityLabel="Create password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" placeholder="Create password" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
            <TextInput accessibilityLabel="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" placeholder="Confirm password" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
            <Pressable accessibilityRole="checkbox" accessibilityLabel="Accept work participation authorization" accessibilityState={{ checked: authorized }} onPress={() => setAuthorized((value) => !value)} style={[styles.authorization, { borderColor: colors.border }]}>
              <Text style={[styles.check, { color: colors.primary }]}>{authorized ? "✓" : "○"}</Text>
              <Text style={[styles.authorizationText, { color: colors.foreground }]}>Work participation authorization: I accept my company&apos;s disclosed Work Hub participation, location, safety, and automatic meeting-transcription policies.</Text>
            </Pressable>
            {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready || submitting }} disabled={!ready || submitting} onPress={submit} style={[styles.button, { backgroundColor: colors.primary, opacity: ready && !submitting ? 1 : 0.45 }]}><Text style={styles.buttonText}>{submitting ? "Activating…" : "Activate account"}</Text></Pressable>
          </>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: { borderWidth: 2, borderRadius: 18, padding: 20, gap: 14 },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  loader: { marginVertical: 24 },
  title: { fontSize: 24, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  authorization: { minHeight: 56, flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  check: { fontSize: 20, lineHeight: 22 },
  authorizationText: { flex: 1, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "700" },
});
