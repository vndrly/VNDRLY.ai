import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { meetingClock, meetingTimer } from "@workspace/api-client-react/meeting-workspace";
import WorkHubAudioRoom from "@/components/WorkHubAudioRoom";
import MeetingSpeakingBars from "@/components/MeetingSpeakingBars";
import MeetingTimeline, {
  authorizedThreadEntries,
  meetingTimelineEntries,
} from "@/components/meeting-timeline";
import MeetingReplayWorkspace from "@/components/meeting-replay-workspace";
import TogglePillButton from "@/components/TogglePillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { useMeetingWorkspace } from "@/lib/use-meeting-workspace";

const SURFACE = "#3a3d42";
const PANEL = "#50545a";
const WARNING = "#f59e0b";

function currentSpeaker(snapshot: NonNullable<ReturnType<typeof useMeetingWorkspace>["snapshot"]>) {
  return snapshot.participants.find((person) =>
    person.present && !person.muted && person.speaking && !person.removedAt);
}

function recapList(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
}

function focusForAccessibility(ref: React.RefObject<any>) {
  setTimeout(() => {
    const handle = findNodeHandle(ref.current);
    if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
  }, 0);
}

function useMeetingAnnouncements(snapshot: ReturnType<typeof useMeetingWorkspace>["snapshot"], recipientUserId: number | null, now: number, t: (key: string, values?: any) => string) {
  const initialized = useRef(false);
  const seenEntries = useRef(new Set<string>());
  const seenActivity = useRef(new Set<string>());
  const entryWatermark = useRef<{ time: number; id: string } | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const entries = meetingTimelineEntries(snapshot);
    const visibleIds = new Set(authorizedThreadEntries(entries, snapshot.userId, recipientUserId).map((entry) => entry.id));
    const currentActivity = snapshot.activity.filter((activity) => activity.expiresAt > now && activity.userId !== snapshot.userId);
    const activityKey = (activity: typeof currentActivity[number]) => `${activity.userId}:${activity.recipientUserId}:${activity.kind}`;
    if (!initialized.current) {
      entries.forEach((entry) => seenEntries.current.add(entry.id));
      const latest = entries.at(-1);
      entryWatermark.current = latest ? { time: latest.time, id: latest.id } : null;
      currentActivity.forEach((activity) => seenActivity.current.add(activityKey(activity)));
      initialized.current = true;
      return;
    }
    const announcements: string[] = [];
    for (const entry of entries) {
      const isNew = !seenEntries.current.has(entry.id);
      seenEntries.current.add(entry.id);
      const afterWatermark = !entryWatermark.current || entry.time > entryWatermark.current.time || (entry.time === entryWatermark.current.time && entry.id > entryWatermark.current.id);
      if (isNew && afterWatermark && visibleIds.has(entry.id)) announcements.push(t("meetingWorkspace.announceEntry", { defaultValue: "{{name}}: {{message}}", name: entry.name, message: entry.text || entry.attachment?.fileName || "" }));
    }
    const latest = entries.at(-1);
    if (latest && (!entryWatermark.current || latest.time > entryWatermark.current.time || (latest.time === entryWatermark.current.time && latest.id > entryWatermark.current.id))) entryWatermark.current = { time: latest.time, id: latest.id };
    const nextActivity = new Set(currentActivity.map(activityKey));
    for (const activity of currentActivity) {
      const key = activityKey(activity);
      const scoped = recipientUserId === null ? activity.recipientUserId === null : activity.userId === recipientUserId && activity.recipientUserId === snapshot.userId;
      if (scoped && !seenActivity.current.has(key)) {
        const name = snapshot.participants.find((person) => person.userId === activity.userId)?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" });
        announcements.push(`${name} ${activity.kind === "file" ? t("meetingWorkspace.addingFile", { defaultValue: "is adding a file…" }) : t("meetingWorkspace.typing", { defaultValue: "is typing a message…" })}`);
      }
    }
    seenActivity.current = nextActivity;
    if (announcements.length) AccessibilityInfo.announceForAccessibility(announcements.join(". "));
  }, [now, recipientUserId, snapshot, t]);
}

export default function MeetingWorkspace({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const brand = useBrand();
  const { width } = useWindowDimensions();
  const workspace = useMeetingWorkspace(occurrenceId);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [tool, setTool] = useState("summary");
  const [search, setSearch] = useState("");
  const [speakerUserId, setSpeakerUserId] = useState<number | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const snapshot = workspace.snapshot;
  const rosterTriggerRef = useRef<any>(null);
  const firstRosterPersonRef = useRef<any>(null);
  const composerRef = useRef<any>(null);
  useMeetingAnnouncements(snapshot, workspace.recipientUserId, workspace.now, t);
  useEffect(() => { if (rosterOpen) focusForAccessibility(firstRosterPersonRef); }, [rosterOpen]);

  if (!snapshot) {
    return <View accessibilityLabel={t("meetingWorkspace.workspaceLabel", { defaultValue: "Meeting workspace" })} style={{ flex: 1, backgroundColor: SURFACE, padding: 20 }}>
      <Text
        selectable
        accessibilityRole={workspace.error ? "alert" : undefined}
        style={{ color: workspace.error ? colors.destructive : "#ffffff" }}
      >
        {workspace.error || t("meetingWorkspace.opening", { defaultValue: "Opening meeting…" })}
      </Text>
    </View>;
  }

  const ended = ["ended", "cancelled"].includes(snapshot.occurrence.status);
  const host = snapshot.participants.find((person) => person.role === "host");
  const speaker = ended ? undefined : currentSpeaker(snapshot);
  const present = snapshot.participants.filter((person) => person.present && !person.removedAt);
  const presentAttendeeCount = present.filter((person) => person.role !== "host").length;
  const removableParticipants = snapshot.participants.filter((person) =>
    person.userId !== snapshot.userId && person.role !== "host" && !person.removedAt);
  const selectedPerson = snapshot.participants.find((person) => person.userId === workspace.recipientUserId);
  const timerNow = snapshot.occurrence.endedAt ? Date.parse(snapshot.occurrence.endedAt) : workspace.now;
  const timing = meetingTimer(
    snapshot.occurrence.startedAt,
    snapshot.occurrence.startsAt,
    snapshot.occurrence.endsAt,
    timerNow,
  );
  const entries = meetingTimelineEntries(snapshot);
  const threadEntries = authorizedThreadEntries(entries, snapshot.userId, workspace.recipientUserId);
  const latestAnswer = !ended && snapshot.occurrence.askvInvitedAt
    ? threadEntries.filter((entry) => entry.type === "askv" && workspace.now >= entry.time && workspace.now - entry.time < 10_000).at(-1)
    : undefined;
  const scopedActivity = ended ? [] : snapshot.activity.filter((activity) => {
    if (activity.expiresAt <= workspace.now || activity.userId === snapshot.userId) return false;
    if (workspace.recipientUserId === null) return activity.recipientUserId === null;
    return activity.userId === workspace.recipientUserId && activity.recipientUserId === snapshot.userId;
  });
  const toolNames = ["summary", "actionItems", "decisions", "search", "agenda",
    ...(snapshot.canViewAttendance ? ["attendance"] : [])];
  const wide = width >= 720;

  return <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: SURFACE }}>
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 14 }}
    >
      <View testID="meeting-header-row" style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", justifyContent: "space-between", gap: 14 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text selectable accessibilityRole="header" style={{ color: "#ffffff", fontSize: 24, fontWeight: "800" }}>
            {snapshot.meeting.title}
          </Text>
          <Text selectable style={{ color: "#e1e3e6" }}>
            {t("meetingWorkspace.presentCount", { defaultValue: "{{count}} present", count: present.length })}
          </Text>
          {["scheduled", "live"].includes(snapshot.occurrence.status) && !workspace.meetingEndedAcknowledged && <WorkHubAudioRoom occurrenceId={occurrenceId} />}
          <Text selectable style={{ color: "#ffffff", fontWeight: "700" }}>
            {t("meetingWorkspace.transcriptionUnavailable", { defaultValue: "Transcription unavailable on this device." })}
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: wide ? "flex-end" : "flex-start", gap: 8 }}>
          <Text selectable style={{ color: "#ffffff", fontWeight: "700" }}>
            {host?.displayName ?? t("meetingWorkspace.host", { defaultValue: "Host" })} · {t("meetingWorkspace.host", { defaultValue: "Host" })}
          </Text>
          <Pressable
            ref={rosterTriggerRef}
            testID="meeting-roster-trigger"
            accessibilityRole="button"
            accessibilityLabel={`${t("meetingWorkspace.privateMessage", { defaultValue: "Private Message" })} +${presentAttendeeCount}`}
            accessibilityState={{ expanded: rosterOpen }}
            onPress={() => setRosterOpen((open) => !open)}
            style={{ minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: brand.primary, borderRadius: 999, paddingHorizontal: 16 }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "700" }}>
              {t("meetingWorkspace.privateMessage", { defaultValue: "Private Message" })} +{presentAttendeeCount}
            </Text>
          </Pressable>
          <View
            accessibilityLabel={speaker ? t("meetingWorkspace.speaking", { defaultValue: "{{name}} speaking", name: speaker.displayName }) : t("meetingWorkspace.noOneSpeaking", { defaultValue: "No one speaking" })}
            accessibilityLiveRegion="polite"
            style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}
          >
            <MeetingSpeakingBars active={Boolean(speaker)} color={brand.primary} />
            <Text selectable style={{ color: speaker ? brand.primary : "#ffffff", fontWeight: "800" }}>
              {speaker ? t("meetingWorkspace.speaking", { defaultValue: "{{name}} speaking", name: speaker.displayName }) : t("meetingWorkspace.noOneSpeaking", { defaultValue: "No one speaking" })}
            </Text>
          </View>
        </View>
      </View>

      {rosterOpen && <View accessibilityLabel={t("meetingWorkspace.attendees", { defaultValue: "Attendees" })} style={{ backgroundColor: PANEL, borderRadius: 14, borderCurve: "continuous", padding: 12, gap: 8 }}>
        <Text selectable style={{ color: "#ffffff", fontWeight: "800" }}>
          {t("meetingWorkspace.choosePrivate", { defaultValue: "Choose someone to message privately" })}
        </Text>
        {snapshot.participants.filter((person) => !person.removedAt && person.userId !== snapshot.userId).map((person, index) => <Pressable
          ref={index === 0 ? firstRosterPersonRef : undefined}
          testID={`meeting-roster-person-${person.userId}`}
          key={person.userId}
          accessibilityRole="button"
          accessibilityLabel={[person.displayName, person.role === "host" ? t("meetingWorkspace.host", { defaultValue: "Host" }) : null, person.speaking ? t("meetingWorkspace.speakingState", { defaultValue: "Speaking" }) : null, person.present ? t("meetingWorkspace.present", { defaultValue: "Present" }) : t("meetingWorkspace.notConnected", { defaultValue: "Not connected" })].filter(Boolean).join(", ")}
          onPress={() => { workspace.selectRecipient(person.userId); setRosterOpen(false); focusForAccessibility(composerRef); }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: brand.primary, fontWeight: "700" }}>
            {person.displayName}{person.role === "host" ? ` · ${t("meetingWorkspace.host", { defaultValue: "Host" })}` : ""} · {person.present
              ? t("meetingWorkspace.present", { defaultValue: "Present" })
              : t("meetingWorkspace.notConnected", { defaultValue: "Not connected" })}
          </Text>
        </Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel={t("meetingWorkspace.closeAttendees", { defaultValue: "Close attendees" })} onPress={() => { setRosterOpen(false); focusForAccessibility(rosterTriggerRef); }} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: "#ffffff", fontWeight: "700" }}>{t("meetingWorkspace.close", { defaultValue: "Close" })}</Text>
        </Pressable>
      </View>}

      <View testID="meeting-divider" style={{ height: 1, backgroundColor: brand.primary, opacity: 0.7 }} />
      <View testID="meeting-timer" style={{ gap: 7 }}>
        <Text selectable style={{ color: "#ffffff", fontVariant: ["tabular-nums"] }}>
          {t("meetingWorkspace.elapsed", { defaultValue: "Elapsed" })} {meetingClock(timing.elapsedMs)}
          {timing.targetMs > 0 ? ` · ${t("meetingWorkspace.target", { defaultValue: "Target" })} ${meetingClock(timing.targetMs)}` : ""}
          {timing.overtimeMs > 0 ? ` · ${t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} +${meetingClock(timing.overtimeMs)}` : ""}
        </Text>
        {timing.targetMs > 0 && <View
          accessibilityRole="progressbar"
          accessibilityLabel={t("meetingWorkspace.duration", { defaultValue: "Meeting duration" })}
          aria-valuetext={timing.overtimeMs > 0
            ? `${t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} +${meetingClock(timing.overtimeMs)}`
            : `${meetingClock(timing.elapsedMs)} ${t("meetingWorkspace.elapsed", { defaultValue: "elapsed" })}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(timing.progress), text: timing.overtimeMs > 0
            ? `${t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} +${meetingClock(timing.overtimeMs)}`
            : `${meetingClock(timing.elapsedMs)} ${t("meetingWorkspace.elapsed", { defaultValue: "elapsed" })}` }}
          testID="meeting-progress"
          style={{ height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#27292d" }}
        >
          <View style={{ width: `${timing.progress}%`, height: "100%", backgroundColor: timing.warning ? WARNING : brand.primary }} />
        </View>}
      </View>

      {!!workspace.error && <Text selectable accessibilityRole="alert" style={{ color: colors.destructive, fontWeight: "700" }}>{workspace.error}</Text>}
      {!!workspace.managementNotice && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
        <Text selectable style={{ color: workspace.managementRefreshFailed ? WARNING : "#ffffff", fontWeight: "700" }}>{workspace.managementNotice}</Text>
        {workspace.managementRefreshFailed && <TogglePillButton color="brand" onPress={() => void workspace.refresh()}>
          {t("meetingWorkspace.refresh", { defaultValue: "Refresh" })}
        </TogglePillButton>}
      </View>}
      {latestAnswer && <View accessibilityLabel={t("meetingWorkspace.latestAnswer", { defaultValue: "V's latest answer" })} style={{ backgroundColor: PANEL, borderWidth: 2, borderColor: brand.primary, borderRadius: 14, borderCurve: "continuous", padding: 14, gap: 6 }}>
        <Text selectable style={{ color: "#ffffff", fontWeight: "800" }}>V</Text>
        <Text selectable style={{ color: "#ffffff" }}>{latestAnswer.text}</Text>
        <Text selectable style={{ color: "#d8dbe0", fontSize: 12 }}>{t("meetingWorkspace.savedTranscript", { defaultValue: "Saved in the transcript" })}</Text>
      </View>}

      <MeetingTimeline
        snapshot={snapshot}
        recipientUserId={workspace.recipientUserId}
        search={search}
        speakerUserId={speakerUserId}
        now={workspace.now}
        brandPrimary={brand.primary}
        onOpenFile={(file) => void workspace.openFile(file)}
      />

      {ended && <MeetingReplayWorkspace occurrenceId={occurrenceId} meeting={snapshot} />}

      <View accessibilityRole="summary" style={{ minHeight: 22, gap: 4 }}>
        {scopedActivity.map((activity) => <Text key={`${activity.userId}:${activity.recipientUserId}`} selectable style={{ color: "#ffffff" }}>
          {snapshot.participants.find((person) => person.userId === activity.userId)?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" })} {activity.kind === "file"
            ? t("meetingWorkspace.addingFile", { defaultValue: "is adding a file…" })
            : t("meetingWorkspace.typing", { defaultValue: "is typing a message…" })}
        </Text>)}
      </View>

      {!ended && <View style={{ backgroundColor: PANEL, borderRadius: 14, borderCurve: "continuous", padding: 12, gap: 10 }}>
        <View testID="meeting-composer-actions" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <Text selectable style={{ color: "#ffffff", fontWeight: "800" }}>
            {workspace.recipientUserId === null ? t("meetingWorkspace.messageMeeting", { defaultValue: "Message the meeting" }) : t("meetingWorkspace.privateTo", { defaultValue: "Private message to {{name}}", name: selectedPerson?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" }) })}
          </Text>
          {workspace.recipientUserId !== null && <Pressable accessibilityRole="button" onPress={() => workspace.selectRecipient(null)} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: brand.primary, fontWeight: "700" }}>{t("meetingWorkspace.backMeeting", { defaultValue: "Back to meeting" })}</Text>
          </Pressable>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("meetingWorkspace.addFile", { defaultValue: "Add File" })}
            accessibilityState={{ expanded: fileMenuOpen, busy: workspace.fileBusy, disabled: workspace.fileBusy }}
            aria-busy={workspace.fileBusy}
            disabled={workspace.fileBusy}
            onPress={() => setFileMenuOpen((open) => !open)}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
          >
            <Text style={{ color: brand.primary, fontWeight: "800" }}>{t("meetingWorkspace.addFile", { defaultValue: "Add File" })}</Text>
          </Pressable>
        </View>
        {fileMenuOpen && <View accessibilityLabel={t("meetingWorkspace.fileChoices", { defaultValue: "Choose file source" })} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(["camera", "photos", "files"] as const).map((source) => <TogglePillButton
            key={source}
            color="brand"
            accessibilityLabel={source === "camera"
              ? t("meetingWorkspace.camera", { defaultValue: "Camera" })
              : source === "photos"
                ? t("meetingWorkspace.photoLibrary", { defaultValue: "Photo Library" })
                : t("meetingWorkspace.files", { defaultValue: "Files" })}
            onPress={() => { setFileMenuOpen(false); void workspace.chooseFile(source); }}
          >{source === "camera"
            ? t("meetingWorkspace.camera", { defaultValue: "Camera" })
            : source === "photos"
              ? t("meetingWorkspace.photoLibrary", { defaultValue: "Photo Library" })
              : t("meetingWorkspace.files", { defaultValue: "Files" })}</TogglePillButton>)}
          <TogglePillButton color="brand" accessibilityLabel={t("meetingWorkspace.cancel", { defaultValue: "Cancel" })} onPress={() => setFileMenuOpen(false)}>
            {t("meetingWorkspace.cancel", { defaultValue: "Cancel" })}
          </TogglePillButton>
        </View>}
        {!!workspace.fileError && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
          <Text selectable accessibilityRole="alert" style={{ color: colors.destructive, fontWeight: "700" }}>{workspace.fileError}</Text>
          {workspace.fileRetryAvailable && <TogglePillButton color="brand" accessibilityLabel={t("meetingWorkspace.retryFile", { defaultValue: "Retry file" })} disabled={workspace.fileBusy} loading={workspace.fileBusy} onPress={() => void workspace.retryFile()}>
            {t("meetingWorkspace.retryFile", { defaultValue: "Retry file" })}
          </TogglePillButton>}
        </View>}
        {!!workspace.fileNotice && <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
          <Text selectable style={{ color: workspace.fileRefreshFailed ? WARNING : "#ffffff", fontWeight: "700" }}>{workspace.fileNotice}</Text>
          {workspace.fileRefreshFailed && <TogglePillButton color="brand" accessibilityLabel={t("meetingWorkspace.refresh", { defaultValue: "Refresh" })} onPress={() => void workspace.refresh()}>
            {t("meetingWorkspace.refresh", { defaultValue: "Refresh" })}
          </TogglePillButton>}
        </View>}
        <TextInput
          ref={composerRef}
          testID="meeting-composer-input"
          accessibilityLabel={workspace.recipientUserId === null ? t("meetingWorkspace.messageMeeting", { defaultValue: "Message the meeting" }) : t("meetingWorkspace.privateTo", { defaultValue: "Private message to {{name}}", name: selectedPerson?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" }) })}
          value={workspace.draft}
          onChangeText={workspace.updateDraft}
          multiline
          scrollEnabled
          placeholder={workspace.recipientUserId === null ? t("meetingWorkspace.messagePlaceholder", { defaultValue: "Message the meeting…" }) : t("meetingWorkspace.privatePlaceholder", { defaultValue: "Private message to {{name}}…", name: selectedPerson?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "An attendee" }) })}
          placeholderTextColor="#c7cbd1"
          style={{ minHeight: 88, maxHeight: 176, color: "#ffffff", backgroundColor: SURFACE, borderWidth: 1, borderColor: brand.primary, borderRadius: 12, padding: 12, textAlignVertical: "top" }}
        />
        <TogglePillButton
          solid
          color="brand"
          accessibilityLabel={t("meetingWorkspace.send", { defaultValue: "Send" })}
          disabled={!workspace.draft.trim() || workspace.sending}
          loading={workspace.sending}
          onPress={() => void workspace.send()}
          style={{ alignSelf: "stretch" }}
        >{t("meetingWorkspace.send", { defaultValue: "Send" })}</TogglePillButton>
      </View>}

      <View style={{ gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("meetingWorkspace.meetingTools", { defaultValue: "Meeting Tools" })}
          accessibilityState={{ expanded: toolsOpen }}
          onPress={() => setToolsOpen((open) => !open)}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "800" }}>{t("meetingWorkspace.meetingTools", { defaultValue: "Meeting Tools" })}</Text>
        </Pressable>
        {toolsOpen && <View style={{ backgroundColor: PANEL, borderRadius: 14, borderCurve: "continuous", padding: 12, gap: 12 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {toolNames.map((name) => <TogglePillButton
              key={name}
              color="brand"
              solid={tool === name}
              accessibilityLabel={t(`meetingWorkspace.tools.${name}`, { defaultValue: name })}
              accessibilityState={{ selected: tool === name }}
              onPress={() => { setTool(name); setManageOpen(false); }}
            >
              {t(`meetingWorkspace.tools.${name}`, { defaultValue: name })}
            </TogglePillButton>)}
            {snapshot.canManage && !ended && <TogglePillButton
              color="brand"
              solid={manageOpen}
              accessibilityLabel={t("meetingWorkspace.manageAttendees", { defaultValue: "Manage Attendees" })}
              accessibilityState={{ selected: manageOpen }}
              onPress={() => setManageOpen((open) => !open)}
            >
              {t("meetingWorkspace.manageAttendees", { defaultValue: "Manage Attendees" })}
            </TogglePillButton>}
            {snapshot.canManage && !ended && <TogglePillButton color="brand" accessibilityLabel={t("meetingWorkspace.endMeeting", { defaultValue: "End meeting" })} onPress={workspace.requestEndConfirmation}>
              {t("meetingWorkspace.endMeeting", { defaultValue: "End meeting" })}
            </TogglePillButton>}
          </ScrollView>
          {snapshot.canManage && manageOpen && <View style={{ gap: 8 }}>
            <Text selectable style={{ color: "#ffffff" }}>{t("meetingWorkspace.manageAttendeesHelp", { defaultValue: "Choose an attendee to remove from the live meeting." })}</Text>
            {removableParticipants.map((person) => <Pressable
              key={person.userId}
              accessibilityRole="button"
              accessibilityLabel={`${person.displayName} · ${person.present
                ? t("meetingWorkspace.present", { defaultValue: "Present" })
                : t("meetingWorkspace.notConnected", { defaultValue: "Not connected" })}`}
              onPress={() => workspace.requestRemoveConfirmation(person.userId)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: brand.primary, fontWeight: "700" }}>{person.displayName} · {person.present
                ? t("meetingWorkspace.present", { defaultValue: "Present" })
                : t("meetingWorkspace.notConnected", { defaultValue: "Not connected" })}</Text>
            </Pressable>)}
          </View>}
          {tool === "summary" && <Text selectable style={{ color: "#ffffff" }}>{typeof snapshot.recap?.summary === "string" ? snapshot.recap.summary : t("meetingWorkspace.emptySummary", { defaultValue: "The saved meeting summary will appear here when available." })}</Text>}
          {tool === "actionItems" && <Text selectable style={{ color: "#ffffff" }}>{recapList(snapshot.recap?.actionItems) ?? t("meetingWorkspace.emptyActionItems", { defaultValue: "No action items have been published yet." })}</Text>}
          {tool === "decisions" && <Text selectable style={{ color: "#ffffff" }}>{recapList(snapshot.recap?.decisions) ?? t("meetingWorkspace.emptyDecisions", { defaultValue: "No decisions have been published yet." })}</Text>}
          {tool === "agenda" && <Text selectable style={{ color: "#ffffff" }}>{snapshot.meeting.agenda || t("meetingWorkspace.emptyAgenda", { defaultValue: "No agenda was added." })}</Text>}
          {tool === "search" && <View style={{ gap: 10 }}>
            <TextInput accessibilityLabel={t("meetingWorkspace.search", { defaultValue: "Search meeting" })} value={search} onChangeText={setSearch} placeholder={t("meetingWorkspace.searchPlaceholder", { defaultValue: "Search text, names, or filenames" })} placeholderTextColor="#c7cbd1" style={{ color: "#ffffff", backgroundColor: SURFACE, borderRadius: 10, padding: 12 }} />
            <Pressable accessibilityRole="button" accessibilityLabel={t("meetingWorkspace.everyone", { defaultValue: "Everyone" })} onPress={() => setSpeakerUserId(null)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: speakerUserId === null ? brand.primary : "#ffffff" }}>{t("meetingWorkspace.everyone", { defaultValue: "Everyone" })}</Text></Pressable>
            {snapshot.participants.map((person) => <Pressable key={person.userId} accessibilityRole="button" accessibilityLabel={t("meetingWorkspace.filterPerson", { defaultValue: "Filter {{name}}", name: person.displayName })} onPress={() => setSpeakerUserId(person.userId)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: speakerUserId === person.userId ? brand.primary : "#ffffff" }}>{person.displayName}</Text></Pressable>)}
          </View>}
          {tool === "attendance" && snapshot.canViewAttendance && <View style={{ gap: 8 }}>{snapshot.participants.map((person) => {
            const visits = snapshot.attendance.filter((visit) => visit.userId === person.userId);
            const status = person.removedAt
              ? t("meetingWorkspace.removedByHost", { defaultValue: "Removed by host" })
              : person.present
                ? t("meetingWorkspace.present", { defaultValue: "Present" })
                : visits.length
                  ? t("meetingWorkspace.left", { defaultValue: "Left" })
                  : t("meetingWorkspace.neverJoined", { defaultValue: "Never joined" });
            return <Text key={person.userId} selectable style={{ color: "#ffffff" }}>{person.displayName} · {status}{visits.map((visit) => ` · ${new Date(visit.joinedAt).toLocaleTimeString()} – ${visit.leftAt ? new Date(visit.leftAt).toLocaleTimeString() : t("meetingWorkspace.connected", { defaultValue: "Connected" })}`).join("")}</Text>;
          })}</View>}
        </View>}
      </View>

      {workspace.managementConfirmation && <View style={{ backgroundColor: PANEL, borderRadius: 14, borderCurve: "continuous", padding: 14, gap: 12 }}>
        <Text selectable style={{ color: "#ffffff", fontWeight: "800" }}>
          {workspace.managementConfirmation.kind === "remove"
            ? t("meetingWorkspace.removeTitle", { defaultValue: "Remove {{name}}?", name: workspace.managementConfirmation.displayName })
            : t("meetingWorkspace.endTitle", { defaultValue: "End this meeting?" })}
        </Text>
        <Text selectable style={{ color: "#ffffff" }}>
          {workspace.managementConfirmation.kind === "remove"
            ? t("meetingWorkspace.removeBody", { defaultValue: "Removal ends {{name}}'s live access. Their prior contributions stay in the meeting record.", name: workspace.managementConfirmation.displayName })
            : t("meetingWorkspace.endBody", { defaultValue: "This ends the meeting for everyone. The saved meeting record is retained." })}
        </Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TogglePillButton color="brand" accessibilityLabel={t("meetingWorkspace.cancel", { defaultValue: "Cancel" })} disabled={workspace.managementPending} onPress={workspace.cancelManagement} style={{ flex: 1 }}>
            {t("meetingWorkspace.cancel", { defaultValue: "Cancel" })}
          </TogglePillButton>
          <TogglePillButton
            color="red"
            solid
            accessibilityLabel={workspace.managementConfirmation.kind === "remove"
              ? t("meetingWorkspace.confirmRemove", { defaultValue: "Remove {{name}}", name: workspace.managementConfirmation.displayName })
              : t("meetingWorkspace.confirmEnd", { defaultValue: "End meeting for everyone" })}
            disabled={workspace.managementPending}
            loading={workspace.managementPending}
            onPress={() => void workspace.confirmManagement()}
            style={{ flex: 1 }}
          >
            {workspace.managementConfirmation.kind === "remove"
              ? t("meetingWorkspace.confirmRemove", { defaultValue: "Remove {{name}}", name: workspace.managementConfirmation.displayName })
              : t("meetingWorkspace.confirmEnd", { defaultValue: "End meeting for everyone" })}
          </TogglePillButton>
        </View>
      </View>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
