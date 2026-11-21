import React, { createContext, useContext, useState, type ReactNode } from "react";
import { AppState, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { nativeWorkHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import TogglePillButton from "@/components/TogglePillButton";
import WorkHubAudioRoom from "@/components/WorkHubAudioRoom";
import WorkHubCallTranscript from "@/components/WorkHubCallTranscript";
import { apiFetch } from "@/lib/api";
import { closeInternalCallAudio } from "@/lib/call-audio-control";
import type { WorkHubCall } from "@/lib/notification-destination";

type CallAction = "accept" | "decline" | "end";
type CallCompanion = {
  trackedId: string | null;
  track: (call: WorkHubCall) => void;
  respond: (call: WorkHubCall, action: CallAction) => void;
};
const CallContext = createContext<CallCompanion | null>(null);

export function useNativeCallCompanion() { return useContext(CallContext); }

export function NativeCallCompanionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user || (!user.vendorId && !user.partnerId)) return <>{children}</>;
  const scope = [user.id, user.activeMembershipId, user.vendorId, user.partnerId].join(":");
  return <SignedInCallCompanion key={scope} scope={scope} userId={user.id}>{children}</SignedInCallCompanion>;
}

function SignedInCallCompanion({ children, scope, userId }: { children: ReactNode; scope: string; userId: number }) {
  const colors = useColors();
  const safeArea = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const key = ["native-live-calls", scope];
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const calls = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (AppState.currentState && AppState.currentState !== "active") return queryClient.getQueryData<WorkHubCall[]>(key) ?? [];
      return apiFetch<WorkHubCall[]>("/api/work-hub/calls?filter=live", { signal });
    },
    refetchInterval: 2_500,
    retry: false,
  });
  const tracked = calls.data?.find(call => call.id === trackedId);
  const incoming = calls.data?.find(call => call.incoming && call.status === "ringing");
  const open = tracked ?? incoming;
  const connected = tracked?.status === "active";
  const admission = useQuery({
    queryKey: ["native-call-participation", scope, tracked?.occurrenceId],
    queryFn: ({ signal }) => apiFetch<{ participationMode?: string; meeting: { policyVersion: number } }>(
      `/api/work-hub/meetings/${tracked?.occurrenceId}/catch-up`, { signal },
    ),
    enabled: connected,
    retry: false,
  });
  const captionPolicy = useQuery({
    queryKey: ["native-call-transcription", scope, trackedId],
    queryFn: ({ signal }) => apiFetch<{ enabled: boolean }>(`/api/work-hub/calls/${trackedId}/transcription-state`, { signal }),
    enabled: connected,
    refetchInterval: 5_000,
    retry: false,
  });
  const track = (call: WorkHubCall) => {
    if (call.status !== "active" && call.status !== "ringing") return;
    setTrackedId(call.id);
    queryClient.setQueryData<WorkHubCall[]>(key, rows => [call, ...(rows ?? []).filter(row => row.id !== call.id)]);
  };
  const response = useMutation({
    mutationFn: async ({ call, action }: { call: WorkHubCall; action: CallAction }) => {
      const identity = action === "accept" ? await nativeWorkHubDeviceIdentity() : null;
      if (action === "accept" && !identity) throw new Error("Audio device is unavailable. Try again.");
      if (action === "end") await closeInternalCallAudio(call.id);
      return apiFetch<{ selectedAudioOwner?: boolean }>(`/api/work-hub/calls/${call.id}/respond`, {
        method: "POST", body: JSON.stringify({ action, ...identity }),
      });
    },
    onSuccess: (result, { call, action }) => {
      if (action === "accept" && result.selectedAudioOwner) track({ ...call, status: "active" });
      else queryClient.setQueryData<WorkHubCall[]>(key, rows => rows?.filter(row => row.id !== call.id));
      if (action === "end") setTrackedId(null);
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const authorize = useMutation({
    mutationFn: ({ occurrenceId, policyVersion }: { occurrenceId: string; policyVersion: number }) => apiFetch(
      `/api/work-hub/meetings/${occurrenceId}/consent`,
      { method: "POST", body: JSON.stringify({ policyVersion, response: "accepted" }) },
    ),
    onSuccess: () => { void admission.refetch(); },
  });
  const respond = (call: WorkHubCall, action: CallAction) => response.mutate({ call, action });
  const viewOnly = admission.data?.participationMode === "view_only";
  const name = open ? (open.incoming ? open.callerName : open.recipientName) : "";
  const error = response.error ?? authorize.error ?? admission.error;
  return (
    <CallContext.Provider value={{ trackedId, track, respond }}>
      {children}
      {open && (
        <View accessibilityLabel={connected ? "Active call" : incoming ? "Incoming call" : "Outgoing call"}
          style={{ position: "absolute", right: 12, top: safeArea.top + 52, width: "92%", maxWidth: 420, zIndex: 110, padding: 12, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontWeight: "700" }}>
            {connected ? name : tracked ? "Calling " + name + "…" : name + " is calling"}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {tracked
              ? <TogglePillButton color="red" disabled={response.isPending} onPress={() => respond(open, "end")}>End call</TogglePillButton>
              : <>
                <TogglePillButton color="brand" disabled={response.isPending} onPress={() => respond(open, "accept")}>Accept</TogglePillButton>
                <TogglePillButton color="red" disabled={response.isPending} onPress={() => respond(open, "decline")}>Decline</TogglePillButton>
              </>}
          </View>
          {connected && viewOnly && admission.data && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.text }}>Accept the work participation authorization to join audio. Transcription follows your company policy.</Text>
              <TogglePillButton color="brand" disabled={authorize.isPending}
                onPress={() => authorize.mutate({ occurrenceId: open.occurrenceId, policyVersion: admission.data!.meeting.policyVersion })}>Accept and participate</TogglePillButton>
            </View>
          )}
          {connected && admission.data && !viewOnly && <WorkHubAudioRoom key={open.id} occurrenceId={open.occurrenceId} callId={open.id} autoStartCall />}
          {connected && captionPolicy.data?.enabled && <WorkHubCallTranscript key={"captions-" + open.id} callId={open.id} viewerId={userId} live />}
          {connected && captionPolicy.data?.enabled === false && <Text style={{ color: colors.mutedForeground }}>Live captions are unavailable for this call.</Text>}
          {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error.message}</Text>}
        </View>
      )}
    </CallContext.Provider>
  );
}
