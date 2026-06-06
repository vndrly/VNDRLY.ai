import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";

import { getApiBase } from "./api";
import { getToken } from "./auth";

/** Fetch schedule.ics for a ticket and open the share sheet (Add to Calendar on iOS). */
export async function openScheduleIcs(ticketId: number, t: (key: string) => string): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${getApiBase()}/api/tickets/${ticketId}/schedule.ics`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.message || body?.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const ics = await res.text();
  const filename = `vndrly-ticket-${ticketId}.ics`;
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, ics, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (Platform.OS === "web") {
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert(t("mySchedule.calendarErrorTitle"), t("mySchedule.calendarShareUnavailable"));
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: "text/calendar",
    UTI: "public.calendar-event",
    dialogTitle: t("mySchedule.addToCalendar"),
  });
}
