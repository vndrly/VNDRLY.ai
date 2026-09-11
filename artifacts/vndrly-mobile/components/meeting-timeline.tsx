import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { MeetingSnapshot } from "@workspace/api-client-react/meeting-workspace";
import ProfilePhotoImage from "@/components/ProfilePhotoImage";

export type MeetingTimelineEntry = {
  id: string;
  userId: number | null;
  name: string;
  text: string;
  time: number;
  type: string;
  recipientUserId: number | null;
  attachment?: {
    fileName: string;
    contentType: string;
    byteSize: number;
    removedAt?: string;
  } | null;
};

export function meetingTimelineEntries(snapshot: MeetingSnapshot): MeetingTimelineEntry[] {
  const startedAt = Date.parse(snapshot.occurrence.startedAt ?? snapshot.occurrence.startsAt);
  return [
    ...snapshot.transcript.map((line) => ({
      id: line.id,
      userId: line.speakerUserId,
      name: line.displayName,
      text: line.text,
      time: startedAt + line.startsAtMs,
      type: "spoken",
      recipientUserId: null,
    })),
    ...snapshot.chat.map((line) => ({
      id: line.id,
      userId: line.userId,
      name: line.displayName,
      text: line.body,
      time: Date.parse(line.createdAt),
      type: line.messageType,
      recipientUserId: line.recipientUserId,
      attachment: line.attachment,
    })),
  ].sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

export function authorizedThreadEntries(
  entries: MeetingTimelineEntry[],
  currentUserId: number,
  recipientUserId: number | null,
) {
  return entries.filter((entry) => {
    const authorized = entry.recipientUserId === null ||
      entry.userId === currentUserId || entry.recipientUserId === currentUserId;
    if (!authorized) return false;
    if (recipientUserId === null) return true;
    return entry.recipientUserId !== null &&
      (entry.userId === recipientUserId || entry.recipientUserId === recipientUserId);
  });
}

function privateCounterpart(snapshot: MeetingSnapshot, entry: MeetingTimelineEntry, fallback: string) {
  const id = entry.userId === snapshot.userId ? entry.recipientUserId : entry.userId;
  return snapshot.participants.find((person) => person.userId === id)?.displayName ?? fallback;
}

function entryScope(userId: number | null, recipientUserId: number | null) {
  return `${userId ?? "system"}:${recipientUserId ?? "shared"}`;
}

export function activeMeetingEntryIds(
  snapshot: MeetingSnapshot,
  entries: MeetingTimelineEntry[],
  now: number,
  recipientUserId: number | null,
) {
  if (["ended", "cancelled"].includes(snapshot.occurrence.status)) return new Set<string>();
  const active = new Set(
    snapshot.activity
      .filter((item) => item.expiresAt > now && (recipientUserId === null
        ? item.recipientUserId === null
        : item.userId === recipientUserId && item.recipientUserId === snapshot.userId))
      .map((item) => entryScope(item.userId, item.recipientUserId)),
  );
  for (const participant of recipientUserId === null ? snapshot.participants : []) {
    if (participant.present && !participant.muted && participant.speaking && !participant.removedAt)
      active.add(entryScope(participant.userId, null));
  }
  const newest = new Map<string, string>();
  for (const entry of entries) {
    const scope = entryScope(entry.userId, entry.recipientUserId);
    if (active.has(scope) && entry.type !== "askv" && entry.type !== "system")
      newest.set(scope, entry.id);
  }
  return new Set(newest.values());
}

type Props = {
  snapshot: MeetingSnapshot;
  recipientUserId: number | null;
  search: string;
  speakerUserId: number | null;
  now: number;
  brandPrimary: string;
  onOpenFile?: (file: { id: string; recipientUserId: number | null; fileName: string; contentType: string; byteSize: number }) => void;
};

export default function MeetingTimeline({
  snapshot,
  recipientUserId,
  search,
  speakerUserId,
  now,
  brandPrimary,
  onOpenFile,
}: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const [following, setFollowing] = useState(true);
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());
  const entries = useMemo(() => meetingTimelineEntries(snapshot), [snapshot]);
  const threadEntries = useMemo(
    () => authorizedThreadEntries(entries, snapshot.userId, recipientUserId),
    [entries, recipientUserId, snapshot.userId],
  );
  const activeIds = useMemo(
    () => activeMeetingEntryIds(snapshot, entries, now, recipientUserId),
    [entries, now, recipientUserId, snapshot],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visible = threadEntries.filter((entry) =>
    (!normalizedSearch || `${entry.name} ${entry.text} ${entry.attachment?.fileName ?? ""}`
      .toLocaleLowerCase().includes(normalizedSearch)) &&
    (speakerUserId === null || entry.userId === speakerUserId),
  );
  const selectedPerson = snapshot.participants.find((person) => person.userId === recipientUserId);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setFollowing(contentSize.height - contentOffset.y - layoutMeasurement.height < 45);
  };

  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <Text selectable style={{ color: "#ffffff", fontWeight: "700" }}>
        {recipientUserId === null
          ? t("meetingWorkspace.liveTranscript", { defaultValue: "Live transcript" })
          : t("meetingWorkspace.privateWith", { defaultValue: "Private with {{name}}", name: selectedPerson?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" }) })}
      </Text>
      {!following && <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("meetingWorkspace.jumpLatest", { defaultValue: "Jump to latest" })}
        onPress={() => { setFollowing(true); scrollRef.current?.scrollToEnd({ animated: true }); }}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: brandPrimary, fontWeight: "700" }}>{t("meetingWorkspace.jumpLatest", { defaultValue: "Jump to latest" })}</Text>
      </Pressable>}
    </View>
    <ScrollView
      ref={scrollRef}
      accessibilityLabel={recipientUserId === null
        ? t("meetingWorkspace.transcriptLabel", { defaultValue: "Meeting transcript" })
        : t("meetingWorkspace.privateMessagesLabel", { defaultValue: "Private meeting messages" })}
      contentInsetAdjustmentBehavior="automatic"
      onScroll={onScroll}
      scrollEventThrottle={100}
      onContentSizeChange={() => { if (following) scrollRef.current?.scrollToEnd({ animated: false }); }}
      style={{ maxHeight: 420, minHeight: 180 }}
      contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
      keyboardShouldPersistTaps="handled"
    >
      {visible.length === 0 && <Text selectable style={{ color: "#c7cbd1", paddingVertical: 24, textAlign: "center" }}>
        {normalizedSearch
          ? t("meetingWorkspace.noMatches", { defaultValue: "No matching entries." })
          : recipientUserId === null
            ? t("meetingWorkspace.emptyTimeline", { defaultValue: "Spoken words, typed messages, and shared files appear here." })
            : t("meetingWorkspace.emptyPrivate", { defaultValue: "Your private conversation starts here." })}
      </Text>}
      {visible.map((entry) => {
        const isV = entry.type === "askv";
        const system = entry.type === "system";
        const own = entry.userId === snapshot.userId && !isV && !system;
        const participant = !isV && !system
          ? snapshot.participants.find((person) => person.userId === entry.userId)
          : undefined;
        const photo = participant?.photoUrl && !failedPhotos.has(participant.photoUrl)
          ? participant.photoUrl : null;
        const label = entry.recipientUserId !== null
          ? t("meetingWorkspace.privateLabel", { defaultValue: "Private · {{name}}", name: privateCounterpart(snapshot, entry, t("meetingWorkspace.attendee", { defaultValue: "An attendee" })) })
          : entry.type === "typed"
            ? t("meetingWorkspace.typed", { defaultValue: "Typed" })
            : entry.type === "spoken" ? t("meetingWorkspace.spoken", { defaultValue: "Spoken" }) : "";
        return <View
          key={entry.id}
          testID={`entry-${entry.id}`}
          accessibilityState={{ selected: activeIds.has(entry.id) }}
          accessibilityValue={{ text: own
            ? t("meetingWorkspace.ownMessage", { defaultValue: "Your message" })
            : t("meetingWorkspace.otherMessage", { defaultValue: "Another participant's message" }) }}
          style={{
            alignSelf: own ? "flex-end" : "flex-start",
            width: "88%",
            borderWidth: activeIds.has(entry.id) ? 2 : 1,
            borderColor: activeIds.has(entry.id) ? brandPrimary : "#686d75",
            backgroundColor: "#50545a",
            borderRadius: 14,
            borderCurve: "continuous",
            padding: 12,
            gap: 7,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
            {photo && <ProfilePhotoImage
              testID={`photo-${entry.id}`}
              profilePhotoPath={null}
              photoUrl={photo}
              accessibilityLabel={t("meetingWorkspace.photo", { defaultValue: "{{name}} photo", name: participant?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" }) })}
              onError={() => setFailedPhotos((current) => new Set(current).add(photo))}
              style={{ width: 28, height: 28, borderRadius: 14 }}
            />}
            <Text
              selectable
              testID={`name-${entry.id}`}
              style={{ color: own || isV ? "#ffffff" : brandPrimary, fontWeight: "800" }}
            >{isV ? "V" : entry.name}</Text>
            <Text selectable style={{ color: "#d8dbe0", fontSize: 12 }}>
              {new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </Text>
            {!!label && <Text selectable style={{ color: "#d8dbe0", fontSize: 12 }}>{label}</Text>}
          </View>
          {!!entry.text && <Text selectable style={{ color: "#ffffff", fontSize: 15, lineHeight: 21 }}>{entry.text}</Text>}
          {entry.type === "attachment" && entry.attachment && (entry.attachment.removedAt || !onOpenFile ||
            (recipientUserId === null ? entry.recipientUserId !== null : entry.recipientUserId === null)
            ? <Text selectable style={{ color: "#ffffff", fontSize: 13 }}>
              {`${entry.attachment.fileName} · ${entry.attachment.contentType} · ${Math.ceil(entry.attachment.byteSize / 1024)} KB${entry.attachment.removedAt
                ? ` · ${t("meetingWorkspace.fileRemoved", { defaultValue: "File removed by host" })}` : ""}`}
            </Text>
            : <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("meetingWorkspace.openFile", { defaultValue: "Open {{name}}", name: entry.attachment.fileName })}
              onPress={() => onOpenFile({ id: entry.id, recipientUserId: entry.recipientUserId, fileName: entry.attachment!.fileName, contentType: entry.attachment!.contentType, byteSize: entry.attachment!.byteSize })}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: "#ffffff", fontSize: 13, textDecorationLine: "underline" }}>
                {`${entry.attachment.fileName} · ${entry.attachment.contentType} · ${Math.ceil(entry.attachment.byteSize / 1024)} KB`}
              </Text>
            </Pressable>)}
        </View>;
      })}
    </ScrollView>
  </View>;
}
