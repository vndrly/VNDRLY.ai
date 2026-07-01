const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",", 2);
      if (!base64) {
        reject(new Error("assistant.invalid_audio"));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("assistant.invalid_audio"));
    reader.readAsDataURL(blob);
  });
}

export async function transcribeAskVRecording(audio: Blob): Promise<string> {
  const audioBase64 = await blobToBase64(audio);
  const res = await fetch(`${BASE}/api/assistant/transcribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      mimeType: audio.type || undefined,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new Error(data.code || "assistant.transcribe_failed");
  }

  return (data.text ?? "").trim();
}
