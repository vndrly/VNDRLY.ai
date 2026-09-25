import React, { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  "message", "note", "meeting", "transcript", "file", "task", "form", "announcement", "asset",
] as const;

function responseShape(value: SearchResponse | SearchResult[]): SearchResponse {
  return Array.isArray(value) ? { results: value, cappedSources: [] } : value;
}

export function WorkHubSearch({ onOpen, initialFilters }: { onOpen: (destination: WorkHubSearchDestination) => void; initialFilters?: WorkHubSearchFilters }) {
  const { t } = useTranslation();
  const typeLabel = (type: string) => t(`workHubSearch.types.${type}`, { defaultValue: t("workHubSearch.records") });
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
  const queryRef = useRef<TextInput>(null);
  const errorId = useId();
  const [invalidQuery, setInvalidQuery] = useState(false);

  const submit = async () => {
    if (query.trim().length < 2) {
      setInvalidQuery(true);
      queryRef.current?.focus();
      setError(t("workHubSearch.minimumQuery"));
      return;
    }
    setLoading(true);
    setInvalidQuery(false);
    setError("");
    setResults(null);
    try {
      const filters: WorkHubSearchFilters = { query: query.trim(), ...(start ? { start } : {}), ...(end ? { end } : {}), ...(types.length ? { types } : {}) };
      const response = responseShape(await apiFetch<SearchResponse | SearchResult[]>(buildWorkHubSearchPath(filters)));
      setSubmittedFilters(filters);
      setResults(response.results);
      setCappedSources(response.cappedSources);
      setNextCursor(response.nextCursor ?? null);
    } catch {
      setError(t("workHubSearch.searchFailed"));
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
    } catch {
      setError(t("workHubSearch.moreFailed"));
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
    } catch {
      setError(t("workHubSearch.itemUnavailable"));
    } finally {
      setOpeningTitle("");
    }
  };

  const inputStyle = { color: colors.text, borderWidth: 2, borderColor: colors.primary, borderRadius: 12, minHeight: 44, minWidth: 0, paddingHorizontal: 12 } as const;
  return <View style={{ gap: 14 }}>
    <View style={{ borderWidth: 2, borderColor: colors.primary, borderRadius: 16, backgroundColor: colors.card, padding: 16, gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{t("workHubSearch.title")}</Text>
      <TextInput ref={queryRef} {...{ "aria-invalid": invalidQuery, "aria-describedby": invalidQuery ? errorId : undefined }} accessibilityHint={invalidQuery ? error : undefined} accessibilityLabel={t("workHubSearch.queryLabel")} value={query} onChangeText={setQuery} placeholder={t("workHubSearch.queryPlaceholder")} placeholderTextColor={colors.mutedForeground} style={inputStyle} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput accessibilityLabel={t("workHubSearch.fromLabel")} value={start} onChangeText={setStart} placeholder={t("workHubSearch.fromPlaceholder")} placeholderTextColor={colors.mutedForeground} style={[inputStyle, { flex: 1 }]} />
        <TextInput accessibilityLabel={t("workHubSearch.throughLabel")} value={end} onChangeText={setEnd} placeholder={t("workHubSearch.throughPlaceholder")} placeholderTextColor={colors.mutedForeground} style={[inputStyle, { flex: 1 }]} />
      </View>
      <Text style={{ color: colors.text, fontWeight: "600" }}>{t("workHubSearch.contentType")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {contentTypes.map(value => <TogglePillButton key={value} color="brand" solid={types.includes(value)} accessibilityLabel={typeLabel(value)} accessibilityState={{ selected: types.includes(value) }} onPress={() => setTypes(current => current.includes(value) ? current.filter(type => type !== value) : [...current, value])}>{typeLabel(value)}</TogglePillButton>)}
      </View>
      <TogglePillButton color="brand" solid accessibilityLabel={t("workHubSearch.search")} onPress={() => void submit()}>{t("workHubSearch.search")}</TogglePillButton>
    </View>
    <View testID="search-results-divider" style={{ height: 2, backgroundColor: colors.primary }} />
    {error ? <Text nativeID={errorId} accessibilityRole="alert" style={{ color: colors.text, backgroundColor: colors.card, borderColor: colors.destructive, borderWidth: 1, borderRadius: 6, padding: 8 }}>{error}</Text> : null}
    {loading ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.text }}>{t("workHubSearch.searching")}</Text></View> : null}
    {!loading && results === null ? <Text style={{ color: colors.mutedForeground }}>{t("workHubSearch.initial")}</Text> : null}
    {!loading && results?.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t("workHubSearch.empty")}</Text> : null}
    {cappedSources.length > 0 ? <Text style={{ color: colors.mutedForeground }}>{t("workHubSearch.capped", { sources: cappedSources.map(typeLabel).join(", ") })}</Text> : null}
    {results?.map(result => <Pressable key={result.id} accessibilityRole="button" accessibilityLabel={t("workHubSearch.open", { title: result.title })} onPress={() => void open(result)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, padding: 16, minHeight: 56, gap: 4 }}>
      <Text style={{ color: colors.primary, fontWeight: "700", textTransform: "uppercase" }}>{typeLabel(result.subjectType)}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{result.title}</Text>
    </Pressable>)}
    {nextCursor ? <TogglePillButton color="brand" accessibilityLabel={t("workHubSearch.loadMore")} disabled={loading} onPress={() => void loadMore()}>{t("workHubSearch.loadMore")}</TogglePillButton> : null}
    {openingTitle ? <Text style={{ color: colors.mutedForeground }}>{t("workHubSearch.opening", { title: openingTitle })}</Text> : null}
  </View>;
}
