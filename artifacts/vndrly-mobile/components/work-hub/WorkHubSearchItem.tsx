import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { workHubItemDestination } from "@workspace/api-client-react/work-hub-destinations";

type Item = { id: string; subjectType: string; title: string; body?: unknown; status?: string; updatedAt?: string };

export function WorkHubSearchItem({ subjectType, itemId }: { subjectType: string; itemId: string }) {
  const colors = useColors();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setItem(null);
    setError("");
    const destination = workHubItemDestination(subjectType, itemId);
    if (!destination) { setError("Item not found"); setLoading(false); return; }
    apiFetch<Item>(`/api${destination.readPath}`)
      .then(value => { if (active) setItem(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Item not found"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [subjectType, itemId]);
  return <View style={{ gap: 12, borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 16, backgroundColor: colors.card }}>
    {loading ? <ActivityIndicator color={colors.primary} /> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {item ? <>
      <Text style={{ color: colors.primary, textTransform: "uppercase", fontWeight: "700" }}>{item.subjectType}</Text>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{item.title}</Text>
      {item.body ? <Text style={{ color: colors.text }}>{typeof item.body === "string" ? item.body : JSON.stringify(item.body)}</Text> : null}
      {item.status ? <Text style={{ color: colors.mutedForeground }}>{item.status}</Text> : null}
    </> : null}
  </View>;
}
