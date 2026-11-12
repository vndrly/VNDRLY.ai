/** One bounded retry for transient failures; no provider payloads or images in logs. */
export async function recognitionRequest(
  fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = 12_000,
): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, { ...init, signal });
      if (response.ok) return await response.json();
      if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      throw new Error("Recognition service unavailable. Try again or enter the plate manually.");
    } catch (error) {
      if (signal.aborted) throw new Error("Recognition timed out. Try again or enter the plate manually.");
      // Do not retry malformed payloads, authentication, or other permanent failures.
      throw error;
    }
  }
  throw new Error("Recognition service unavailable.");
}
