export type AskVVoiceAvailabilityStatus =
  | "available"
  | "disabled_client"
  | "disabled_globally"
  | "disabled_for_account"
  | "missing_configuration"
  | "unsupported_browser"
  | "permission_denied"
  | "connection_failed";

export interface AskVVoiceAvailability {
  status: AskVVoiceAvailabilityStatus;
  message: string | null;
}

const AVAILABLE: AskVVoiceAvailability = { status: "available", message: null };

export function browserVoiceAvailability(signals: {
  secureContext: boolean;
  peerConnection: boolean;
  getUserMedia: boolean;
}): AskVVoiceAvailability {
  if (!signals.secureContext) {
    return { status: "unsupported_browser", message: "Natural voice requires a secure HTTPS connection." };
  }
  if (!signals.peerConnection || !signals.getUserMedia) {
    return { status: "unsupported_browser", message: "This browser does not support live AskV voice conversations." };
  }
  return AVAILABLE;
}

export function currentBrowserVoiceAvailability(): AskVVoiceAvailability {
  return browserVoiceAvailability({
    secureContext: window.isSecureContext,
    peerConnection: typeof RTCPeerConnection === "function",
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
  });
}

export function microphonePermissionAvailability(state: PermissionState | "unknown"): AskVVoiceAvailability {
  return state === "denied"
    ? { status: "permission_denied", message: "Microphone access is blocked for vndrly.ai. Allow it in your browser settings, then reopen AskV." }
    : AVAILABLE;
}

export function capabilityVoiceAvailability(payload: {
  enabled?: boolean;
  availability?: { status?: string; reason?: string | null };
}): AskVVoiceAvailability {
  if (payload.enabled === true) return AVAILABLE;
  const status = payload.availability?.status;
  if (status === "disabled_globally" || status === "disabled_for_account" || status === "missing_configuration") {
    return { status, message: payload.availability?.reason || "Natural voice is unavailable." };
  }
  return { status: "connection_failed", message: "AskV could not verify voice availability. Check your connection and try again." };
}

export function realtimeConnectionMessage(status: number, payload?: { code?: string; error?: string }): string {
  if (payload?.code === "assistant.openai_missing") return "Natural voice is not configured on the server.";
  if (status === 401) return "Your session expired. Sign in again to use natural voice.";
  if (status === 403) return "Natural voice is not enabled for this account.";
  if (status >= 500) return "AskV voice could not connect right now. Please try again.";
  return payload?.error || "AskV voice could not connect. Please try again.";
}
