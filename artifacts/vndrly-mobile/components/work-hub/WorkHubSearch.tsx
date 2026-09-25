import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { buildWorkHubSearchPath, type WorkHubSearchFilters } from "@/lib/work-hub-mobile";

export { buildWorkHubSearchPath as searchQueryPath };

export type WorkHubSearchDestination = {
  module: string;
  section?: string;
  itemId?: string;
  assetId?: string;
  occurrenceId?: string;
};

type SearchResult = {
  id: string;
  subjectType: string;
  subjectId: string;
  title: string;
  destination: WorkHubSearchDestination;
  updatedAt?: string;
};

type SearchResponse = { results: SearchResult[]; cappedSources: string[]; nextCursor?: string | null };
const contentTypes = [
  ["message", "Messages"], ["note", "Notes"], ["meeting", "Meetings"],
  ["transcript", "Transcripts"], ["file", "Files"], ["task", "Tasks"],
  ["form", "Forms"], ["announcement", "Announcements"], ["asset", "Inventory"],
] as const;

function responseShape(value: SearchResponse | SearchResult[]): SearchResponse {
  return Array.isArray(value) ? { results: value, cappedSources: [] } : value;
}

export function WorkHubSearch({ onOpen, initialFilters }: { onOpen: (destination: WorkHubSearchDestination) => void; initialFilters?: WorkHubSearchFilters }) {
  const colors = useColors();
  const [query, setQuery] = useState(initialFilters?.query ?? "");
  const [start, setStart] = useState(initialFilters?.start ?? "");
  const [end, setEnd] = useState(initialFilters?.end ?? "");
  const [types, setTypes] = useState<string[]>(initialFilters?.types ?? []);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [cappedSources, setCappedSources] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [submittedFilters, setSubmittedFilters] = useState<WorkHubSearchFilters | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingTitle, setOpeningTitle] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    if (query.trim().length < 2) {
      setError("Enter at least two characters.");
      return;
    }
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const filters: WorkHubSearchFilters = { query: query.trim(), ...(start ? { start } : {}), ...(end ? { end } : {}), ...(types.length ? { types } : {}) };
      const response = responseShape(await apiFetch<SearchResponse | SearchResult[]>(buildWorkHubSearchPath(filters)));
      setSubmittedFilters(filters);
      setResults(response.results);
      setCappedSources(response.cappedSources);
      setNextCursor(response.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || !submittedFilters) return;
    setLoading(true);
    setError("");
    try {
      const path = `${buildWorkHubSearchPath(submittedFilters)}&cursor=${encodeURIComponent(nextCursor)}`;
      const response = responseShape(await apiFetch<SearchResponse | SearchResult[]>(path));
      setResults(current => [...(current ?? []), ...response.results]);
      setCappedSources(response.cappedSources);
      setNextCursor(response.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "More results could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const open = async (result: SearchResult) => {
    setOpeningTitle(result.title);
    setError("");
    try {
      const detailPath = result.subjectType === "asset"
        ? `/api/implementation-a/assets/${encodeURIComponent(result.subjectId)}`
        : `/api/work-hub/search/items/${encodeURIComponent(result.subjectType)}/${encodeURIComponent(result.subjectId)}`;
      await apiFetch(detailPath);
      onOpen(result.destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This item is no longer available.");
    } finally {
      setOpeningTitle("");
    }
  };

  const inputStyle = { color: colors.text, borderWidth: 2, borderColor: colors.primary, borderRadius: 12, minHeight: 44, paddingHorizontal: 12 } as const;
  return <View style={{ gap: 14 }}>
    <View style={{ borderWidth: 2, borderColor: colors.primary, borderRadius: 16, backgroundColor: colors.card, padding: 16, gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>Find Work Hub records</Text>
      <TextInput accessibilityLabel="Search Work Hub" value={query} onChangeText={setQuery} placeholder="Search authorized records" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput accessibilityLabel="From date" value={start} onChangeText={setStart} placeholder="From: YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[inputStyle, { flex: 1 }]} />
        <TextInput accessibilityLabel="Through date" value={end} onChangeText={setEnd} placeholder="Through: YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[inputStyle, { flex: 1 }]} />
      </View>
      <Text style={{ color: colors.text, fontWeight: "600" }}>Content type</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {contentTypes.map(([value, label]) => <TogglePillButton key={value} color="brand" solid={types.includes(value)} accessibilityLabel={label} accessibilityState={{ selected: types.includes(value) }} onPress={() => setTypes(current => current.includes(value) ? current.filter(type => type !== value) : [...current, value])}>{label}</TogglePillButton>)}
      </View>
      <TogglePillButton color="brand" solid accessibilityLabel="Search" onPress={() => void submit()}>Search</TogglePillButton>
    </View>
    <View testID="search-results-divider" style={{ height: 2, backgroundColor: colors.primary }} />
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {loading ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.text }}>Searching…</Text></View> : null}
    {!loading && results === null ? <Text style={{ color: colors.mutedForeground }}>Enter a search to see authorized records.</Text> : null}
    {!loading && results?.length === 0 ? <Text style={{ color: colors.mutedForeground }}>No authorized results found.</Text> : null}
    {cappedSources.length > 0 ? <Text style={{ color: colors.mutedForeground }}>Results may be limited for {cappedSources.join(", ")} because a source was capped. Narrow your dates or content type to search more precisely.</Text> : null}
    {results?.map(result => <Pressable key={result.id} accessibilityRole="button" accessibilityLabel={`Open ${result.title}`} onPress={() => void open(result)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, padding: 16, minHeight: 56, gap: 4 }}>
      <Text style={{ color: colors.primary, fontWeight: "700" }}>{result.subjectType.toUpperCase()}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{result.title}</Text>
    </Pressable>)}
    {nextCursor ? <TogglePillButton color="brand" accessibilityLabel="Load more inventory results" disabled={loading} onPress={() => void loadMore()}>Load more inventory results</TogglePillButton> : null}
    {openingTitle ? <Text style={{ color: colors.mutedForeground }}>Opening {openingTitle}</Text> : null}
  </View>;
}
