class ProviderUnavailableError extends Error { status = 503; code = "work_hub.provider_unavailable"; constructor() { super("Work Hub audio is not configured"); } }
const unavailable = async (): Promise<never> => { throw new ProviderUnavailableError(); };
export const disabledAudioProvider = { kind: "disabled" as const, createJoinLease: unavailable, startRecording: unavailable, stopRecording: unavailable, requestTranscript: unavailable };
