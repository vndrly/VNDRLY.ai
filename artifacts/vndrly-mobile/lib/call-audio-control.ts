const owners = new Map<string, () => Promise<void>>();
export function registerCallAudioShutdown(callId: string, shutdown: () => Promise<void>) {
  owners.set(callId,shutdown);
  return () => { if (owners.get(callId)===shutdown) owners.delete(callId); };
}
export async function closeInternalCallAudio(callId: string) { await owners.get(callId)?.(); }
