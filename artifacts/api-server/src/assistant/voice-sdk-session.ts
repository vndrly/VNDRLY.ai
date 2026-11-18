/** The official Realtime example's server-side ephemeral-key exchange. */
export async function createVoiceSdkSecret(options: { apiKey: string; model: string; voice: string }) {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: "Bearer " + options.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: { type: "realtime", model: options.model, audio: { output: { voice: options.voice } } },
    }),
  });
  if (!response.ok) throw new Error("Realtime token exchange failed (HTTP " + response.status + ")");
  const data = await response.json() as { value?: string; expires_at?: number };
  if (!data.value?.startsWith("ek_")) throw new Error("Provider did not return an ephemeral Realtime key");
  return { value: data.value, expires_at: data.expires_at };
}
