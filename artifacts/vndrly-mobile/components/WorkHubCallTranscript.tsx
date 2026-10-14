import React, { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, subscribeUser, subscribeToken } from "@/lib/auth";
type Segment = {
  id: string;
  speakerName: string | null;
  startsAtMs: number;
  text: string;
};
export default function WorkHubCallTranscript({
  callId,
  live = false,
}: {
  callId: string;
  live?: boolean;
}) {
  const colors = useColors(),
    [segments, setSegments] = useState<Segment[]>([]),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const scope = captureAuthScope();
    let mounted = true,
      pending = false;
    setSegments([]);
    setError("");
    const invalidate = () => {
      if (isAuthScopeCurrent(scope)) return;
      mounted = false;
      setSegments([]); setSearch(""); setError("");
      if (timer) clearInterval(timer);
    };
    const unsubscribeUser = subscribeUser(invalidate);
    const unsubscribeToken = subscribeToken(invalidate);
    const load = async () => {
      if (pending || !mounted || !isAuthScopeCurrent(scope)) return;
      pending = true;
      try {
        const result = await apiFetch<{ segments: Segment[] }>(
          `/api/work-hub/calls/${callId}/transcript`,
          undefined,
          scope,
        );
        if (mounted && isAuthScopeCurrent(scope)) {
          setSegments(result.segments);
          setError("");
        }
      } catch {
        if (mounted) {
          setSegments([]);
          setError("Transcript unavailable.");
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = live ? setInterval(() => void load(), 3000) : null;
    return () => {
      mounted = false;
      unsubscribeUser(); unsubscribeToken();
      if (timer) clearInterval(timer);
    };
  }, [callId, live]);
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: "700" }}>
        {live
          ? "Call transcript · updates automatically"
          : "Saved call transcript"}
      </Text>
      <Text style={{ color: colors.mutedForeground }}>
        Speech recognition may contain errors.
      </Text>
      <TextInput
        accessibilityLabel="Search call transcript"
        placeholder="Find in transcript"
        value={search}
        onChangeText={setSearch}
        style={{
          color: colors.text,
          borderWidth: 2,
          borderColor: colors.primary,
          borderRadius: 10,
          padding: 10,
        }}
      />
      {!!error && (
        <Text style={{ color: colors.mutedForeground }}>{error}</Text>
      )}
      {!error && !segments.length && (
        <Text style={{ color: colors.mutedForeground }}>
          {live
            ? "Text appears after speech is processed."
            : "No saved transcript."}
        </Text>
      )}
      <ScrollView style={{ maxHeight: 360 }}>
        {segments
          .filter((s) => s.text.toLowerCase().includes(search.toLowerCase()))
          .map((s) => (
            <View key={s.id} style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                {s.speakerName ?? "Participant"} ·{" "}
                {Math.floor(s.startsAtMs / 60000)}:
                {String(Math.floor(s.startsAtMs / 1000) % 60).padStart(2, "0")}
              </Text>
              <Text selectable style={{ color: colors.text }}>
                {s.text}
              </Text>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}
