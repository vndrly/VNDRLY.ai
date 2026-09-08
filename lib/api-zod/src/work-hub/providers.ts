export type CreateAudioRoomInput = { occurrenceId: string; region?: string };
export type AudioRoomLease = { providerRoomId: string; expiresAt: string };
export type ParticipantTokenInput = { occurrenceId: string; userId: number; role: "host" | "co_host" | "speaker" | "participant" };
export type ParticipantToken = { token: string; expiresAt: string };
export type EndAudioRoomInput = { occurrenceId: string; providerRoomId: string };
export type RecordingCommand = { occurrenceId: string; providerRoomId: string; actorUserId: number };
export type RecordingHandle = { providerRecordingId: string };
export type RawWebhook = { headers: Readonly<Record<string, string | string[] | undefined>>; body: Uint8Array };
export type VerifiedAudioEvent = { eventId: string; kind: string; providerRoomId: string; occurredAt: string; payload: unknown };

export interface RealtimeAudioProvider {
  createRoom(input: CreateAudioRoomInput): Promise<AudioRoomLease>;
  createParticipantToken(input: ParticipantTokenInput): Promise<ParticipantToken>;
  endRoom(input: EndAudioRoomInput): Promise<void>;
  startRecording(input: RecordingCommand): Promise<RecordingHandle>;
  stopRecording(input: RecordingCommand): Promise<void>;
  verifyWebhook(input: RawWebhook): Promise<VerifiedAudioEvent>;
}

export type TranscriptionJobInput = { artifactId: string; signedAudioUrl: string; language?: string };
export type TranscriptionJobHandle = { providerJobId: string };
export type TranscriptionStatusInput = { providerJobId: string };
export type TranscriptionStatus = { state: "queued" | "processing" | "complete" | "failed"; segments?: unknown[]; errorCode?: string };
export type TranscriptionCancelInput = { providerJobId: string };

export interface TranscriptionProvider {
  submit(input: TranscriptionJobInput): Promise<TranscriptionJobHandle>;
  getStatus(input: TranscriptionStatusInput): Promise<TranscriptionStatus>;
  cancel(input: TranscriptionCancelInput): Promise<void>;
}

export type CalendarConnectorCapability = "calendar.read";
export type CalendarConnectionInput = { organizationType: "vendor" | "partner"; organizationId: number; redirectUri: string; state: string; codeVerifier: string };
export type ExternalCalendar = { id: string; name: string; canRead: boolean };
export type CalendarSyncPage = { events: unknown[]; nextCursor: string | null };

export interface CalendarConnector {
  readonly capabilities: readonly CalendarConnectorCapability[];
  createAuthorizationUrl(input: CalendarConnectionInput): Promise<string>;
  listCalendars(connectionId: string): Promise<ExternalCalendar[]>;
  sync(connectionId: string, calendarId: string, cursor: string | null): Promise<CalendarSyncPage>;
  revoke(connectionId: string): Promise<void>;
  health(connectionId: string): Promise<"connected" | "degraded" | "disconnected">;
}
