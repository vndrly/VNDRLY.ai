import { logger } from "./logger";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface SendTransactionalSmsInput {
  to: string;
  body: string;
  statusCallbackUrl?: string;
}

export interface SendTransactionalSmsResult {
  sid: string | undefined;
  status: string | undefined;
  errorCode: string | number | undefined;
}

export class TwilioSmsError extends Error {
  constructor(public readonly code: string | null, public readonly definitelyRejected: boolean, status: number) {
    super(`Twilio SMS send failed with status ${status}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function isE164Phone(value: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(value);
}

function twilioAuthHeader(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

export async function sendTransactionalSms(
  input: SendTransactionalSmsInput,
): Promise<SendTransactionalSmsResult> {
  if (!isE164Phone(input.to)) {
    throw new Error("SMS recipient must be an E.164 phone number");
  }
  if (!input.body.trim()) {
    throw new Error("SMS body is required");
  }

  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const apiKey = requireEnv("TWILIO_API_KEY");
  const apiSecret = requireEnv("TWILIO_API_SECRET");
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? "";
  const from = process.env.TWILIO_PHONE_NUMBER?.trim() ?? "";
  if (!messagingServiceSid && !from) {
    throw new Error("TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID is required");
  }

  const body = new URLSearchParams({
    To: input.to,
    Body: input.body,
    ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: from }),
    ...(input.statusCallbackUrl ? { StatusCallback: input.statusCallbackUrl } : {}),
  });

  const res = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(apiKey, apiSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    logger.warn(
      { status: res.status, code: /^\d{3,6}$/.test(String(payload.code)) ? String(payload.code) : null },
      "Twilio SMS send failed",
    );
    throw new TwilioSmsError(/^\d{3,6}$/.test(String(payload.code)) ? String(payload.code) : null, res.status >= 400 && res.status < 500, res.status);
  }

  return {
    sid: typeof payload.sid === "string" ? payload.sid : undefined,
    status: typeof payload.status === "string" ? payload.status : undefined,
    errorCode: payload.error_code as string | number | undefined,
  };
}
