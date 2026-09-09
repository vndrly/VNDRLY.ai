class ProviderUnavailableError extends Error { status = 503; code = "work_hub.provider_unavailable"; constructor() { super("Work Hub audio is not configured"); } }
const unavailable = async (): Promise<never> => { throw new ProviderUnavailableError(); };
export const disabledAudioProvider = { kind: "disabled" as const, createJoinLease: unavailable, startRecording: unavailable, stopRecording: unavailable, requestTranscript: unavailable };

export type VndrlyIceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

export function resolveVndrlyIceServers(
  env: Record<string, string | undefined> = process.env,
): VndrlyIceServer[] {
  const servers: VndrlyIceServer[] = [];
  const stun = env.VNDRLY_STUN_URL?.trim();
  if (stun) servers.push({ urls: [stun] });
  const turn = env.VNDRLY_TURN_URL?.trim();
  const username = env.VNDRLY_TURN_USERNAME?.trim();
  const credential = env.VNDRLY_TURN_CREDENTIAL?.trim();
  if (turn && username && credential) {
    servers.push({ urls: [turn], username, credential });
  }
  return servers;
}
