import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

export type GateLogStatus = { loading: boolean; messages: { text: string; tone: "error" | "muted" }[] };

export default function GateLogStatusNative({ status }: { status: GateLogStatus }) {
  return <View style={{ gap: 8 }}>
    {status.loading && <ActivityIndicator color="#08b5d5" style={{ alignSelf: "flex-start" }} />}
    {status.messages.map((message, index) => <Text key={`${message.text}:${index}`} accessibilityRole={message.tone === "error" ? "alert" : undefined} style={{ color: message.tone === "error" ? "#f87171" : "#aaa", fontSize: message.text.startsWith("Sample") ? 12 : 14 }}>{message.text}</Text>)}
  </View>;
}
