import type { TFunction } from "i18next";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";

import type { AssistantMessage } from "@/hooks/use-assistant";

export function transcriptToMarkdown(
  messages: AssistantMessage[],
  userName: string,
): string {
  const lines: string[] = [];
  lines.push("# AskV transcript");
  lines.push("");
  lines.push(`_Exported ${new Date().toLocaleString()}_`);
  lines.push("");
  for (const m of messages) {
    const who = m.role === "user" ? userName : "VNDRLY Assistant";
    lines.push(`## ${who}`);
    lines.push("");
    lines.push((m.content ?? "").trim());
    lines.push("");
  }
  return lines.join("\n");
}

/** Write transcript markdown and open the iOS share sheet. */
export async function shareAssistantTranscript(
  messages: AssistantMessage[],
  userName: string,
  t: TFunction,
): Promise<void> {
  if (messages.length === 0) return;
  const md = transcriptToMarkdown(messages, userName);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `vndrly-assistant-${ts}.md`;

  if (Platform.OS === "web") {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    Alert.alert(t("askv.transcriptErrorTitle"), t("askv.transcriptShareUnavailable"));
    return;
  }
  const uri = `${cacheDir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, md, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert(t("askv.transcriptErrorTitle"), t("askv.transcriptShareUnavailable"));
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: "text/markdown",
    UTI: "net.daringfireball.markdown",
    dialogTitle: t("askv.downloadTranscript"),
  });
}
