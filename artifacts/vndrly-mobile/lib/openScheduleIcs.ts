import type { TFunction } from "i18next";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";

import { getApiBase } from "./api";
import { getToken } from "./auth";
import { translateApiError } from "./apiErrors";

/** Fetch schedule.ics for a ticket and open the share sheet (Add to Calendar on iOS). */
export async function openScheduleIcs(ticketId: number, t: TFunction): Promise<void> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/tickets/${ticketId}/schedule.ics`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch (e) {
    throw new Error(translateApiError(e, t));
  }
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    throw new Error(
      translateApiError({ status: res.status, data, message: `HTTP ${res.status}` }, t),
    );
  }
  const ics = await res.text();
  const filename = `vndrly-ticket-${ticketId}.ics`;

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

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    Alert.alert(t("mySchedule.calendarErrorTitle"), t("mySchedule.calendarShareUnavailable"));
    return;
  }
  const uri = `${cacheDir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, ics, {
    encoding: FileSystem.EncodingType.UTF8,
  });

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
