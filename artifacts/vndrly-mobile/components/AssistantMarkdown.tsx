import { router } from "expo-router";
import React from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { resolveAssistantLink } from "@/lib/assistant-deep-links";
import {
  parseAssistantInlineSegments,
  type AssistantInlineSegment,
} from "@/lib/assistant-markdown-inline";

function openAssistantLink(href: string): void {
  const target = resolveAssistantLink(href);
  if (!target) return;
  if (target.type === "route") {
    router.push(target.path as never);
    return;
  }
  void Linking.openURL(target.url);
}

function hrefIsNavigable(href: string): boolean {
  if (resolveAssistantLink(href)) return true;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function onLinkPress(href: string): void {
  const resolved = resolveAssistantLink(href);
  if (resolved) {
    openAssistantLink(href);
    return;
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    openAssistantLink(href);
    return;
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    void Linking.openURL(href);
  }
}

function InlineRow({
  segments,
  colors,
  bodyStyle,
  testIDPrefix,
}: {
  segments: AssistantInlineSegment[];
  colors: ReturnType<typeof useColors>;
  bodyStyle: TextStyle;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.inlineRow}>
      {segments.map((seg, i) => {
        const key = `${testIDPrefix ?? "inline"}-${i}`;
        if (seg.kind === "link" && hrefIsNavigable(seg.href)) {
          return (
            <Pressable
              key={key}
              onPress={() => onLinkPress(seg.href)}
              hitSlop={6}
              accessibilityRole="link"
              testID={`${key}-link`}
            >
              <Text
                style={[
                  bodyStyle,
                  styles.link,
                  { color: colors.primary },
                ]}
              >
                {seg.label}
              </Text>
            </Pressable>
          );
        }
        if (seg.kind === "bold") {
          return (
            <Text
              key={key}
              style={[bodyStyle, { fontFamily: "Inter_600SemiBold" }]}
            >
              {seg.text}
            </Text>
          );
        }
        if (seg.kind === "code") {
          return (
            <Text
              key={key}
              style={[
                bodyStyle,
                {
                  fontFamily: "Inter_500Medium",
                  backgroundColor: colors.muted,
                  fontSize: 13,
                },
              ]}
            >
              {seg.text}
            </Text>
          );
        }
        if (seg.kind === "text") {
          return (
            <Text key={key} style={bodyStyle}>
              {seg.text}
            </Text>
          );
        }
        return null;
      })}
    </View>
  );
}

export default function AssistantMarkdown({ text }: { text: string }) {
  const colors = useColors();
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\n+/);
  const bodyStyle: TextStyle = {
    ...styles.body,
    color: colors.foreground,
  };

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
                  <View style={styles.listBody}>
                    <InlineRow
                      segments={parseAssistantInlineSegments(
                        l.replace(/^\s*[-*]\s+/, ""),
                      )}
                      colors={colors}
                      bodyStyle={bodyStyle}
                      testIDPrefix={`list-${i}-${j}`}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return (
          <InlineRow
            key={i}
            segments={parseAssistantInlineSegments(para)}
            colors={colors}
            bodyStyle={bodyStyle}
            testIDPrefix={`para-${i}`}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  inlineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  link: { textDecorationLine: "underline" },
  list: { gap: 4 },
  listRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  listBody: { flex: 1 },
  bullet: { fontSize: 15, lineHeight: 22, width: 12 },
});
