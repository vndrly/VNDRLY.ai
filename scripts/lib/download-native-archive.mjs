import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Retry transient upstream failures without changing the pinned source or hash.
export async function downloadNativeArchive(url, destination, request = fetch, fallbackUrl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = new URL(attempt === 2 && fallbackUrl ? fallbackUrl : url);
    if (attempt) source.searchParams.set('retry', `${Date.now()}-${attempt}`);
    try {
      const response = await request(source, { signal: AbortSignal.timeout(180_000), headers: { Accept: 'application/octet-stream' } });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        if (attempt < 2 && [408, 429, 500, 502, 503, 504].includes(response.status)) continue;
        throw new Error('Native engine download failed: HTTP ' + response.status);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'w' }));
      return;
    } catch (error) {
      if (attempt === 2 || !['TypeError', 'TimeoutError'].includes(error.name)) throw error;
    }
  }
}
