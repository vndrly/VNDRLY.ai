import { router } from "expo-router";
import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

function renderInline(
  s: string,
  colors: ReturnType<typeof useColors>,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = s;
  let key = 0;

  while (rest.length > 0) {
    const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    const boldMatch = /\*\*([^*]+)\*\*/.exec(rest);
    const codeMatch = /`([^`]+)`/.exec(rest);

    const candidates = [
      linkMatch ? { idx: linkMatch.index, len: linkMatch[0].length, kind: "link" as const, m: linkMatch } : null,
      boldMatch ? { idx: boldMatch.index, len: boldMatch[0].length, kind: "bold" as const, m: boldMatch } : null,
      codeMatch ? { idx: codeMatch.index, len: codeMatch[0].length, kind: "code" as const, m: codeMatch } : null,
    ].filter(Boolean) as Array<{
      idx: number;
      len: number;
      kind: "link" | "bold" | "code";
      m: RegExpExecArray;
    }>;

    if (candidates.length === 0) {
      nodes.push(<Text key={key++}>{rest}</Text>);
      break;
    }

    candidates.sort((a, b) => a.idx - b.idx);
    const next = candidates[0];
    if (next.idx > 0) {
      nodes.push(<Text key={key++}>{rest.slice(0, next.idx)}</Text>);
    }

    if (next.kind === "link") {
      const label = next.m[1];
      const href = next.m[2].trim();
      const isInternal = href.startsWith("/") && !href.startsWith("//");
      const isSafeAbsolute = /^(https?:|mailto:|tel:)/i.test(href);
      if (isInternal) {
        nodes.push(
          <Text
            key={key++}
            style={{ color: colors.primary, textDecorationLine: "underline" }}
            onPress={() => {
              const ticketMatch = href.match(/^\/tickets\/(\d+)/);
              if (ticketMatch) {
                router.push(`/ticket/${ticketMatch[1]}`);
                return;
              }
              if (href === "/field" || href.startsWith("/foreman")) {
                router.push("/(tabs)");
                return;
              }
            }}
          >
            {label}
          </Text>,
        );
      } else if (isSafeAbsolute) {
        nodes.push(
          <Text
            key={key++}
            style={{ color: colors.primary, textDecorationLine: "underline" }}
            onPress={() => void Linking.openURL(href)}
          >
            {label}
          </Text>,
        );
      } else {
        nodes.push(<Text key={key++}>{label}</Text>);
      }
    } else if (next.kind === "bold") {
      nodes.push(
        <Text key={key++} style={{ fontFamily: "Inter_600SemiBold" }}>
          {next.m[1]}
        </Text>,
      );
    } else {
      nodes.push(
        <Text
          key={key++}
          style={{
            fontFamily: "Inter_500Medium",
            backgroundColor: colors.muted,
            fontSize: 13,
          }}
        >
          {next.m[1]}
        </Text>,
      );
    }

    rest = rest.slice(next.idx + next.len);
  }

  return nodes;
}

export default function AssistantMarkdown({ text }: { text: string }) {
  const colors = useColors();
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\n+/);

  return (
    <View style={styles.wrap}>
      {paragraphs.map((para, i) => {
        const lines = para.split("\n");
        const isList =
          lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l.trim()));
        if (isList) {
          return (
            <View key={i} style={styles.list}>
              {lines.map((l, j) => (
                <View key={j} style={styles.listRow}>
                  <Text style={[styles.bullet, { color: colors.foreground }]}>•</Text>
                  <Text style={[styles.body, { color: colors.foreground }]}>
                    {renderInline(l.replace(/^\s*[-*]\s+/, ""), colors)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={[styles.body, { color: colors.foreground }]}>
            {renderInline(para, colors)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  list: { gap: 4 },
  listRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bullet: { fontSize: 15, lineHeight: 22, width: 12 },
});
