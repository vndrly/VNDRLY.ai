export type MeetingStreamingTurn = {
  id: string;
  turnOrder: number;
  text: string;
  startsAtMs: number;
  endsAtMs: number;
};

type StreamHandle = {
  sessionId: string;
  sampleRate: 16000;
  frameDurationMs: 500;
};

export type MeetingStreamingTransport = <T>(
  path: string,
  body: string,
  signal: AbortSignal,
) => Promise<T>;

export type ClientOptions = {
  fetcher?: typeof fetch;
  transport?: MeetingStreamingTransport;
  retryDelay?: (signal: AbortSignal) => Promise<void>;
};

const CLOSE_TIMEOUT_MS = 1_000;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function abortReason(signal: AbortSignal): unknown {
  if ("reason" in signal && signal.reason !== undefined) return signal.reason;
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortReason(signal);
}

function base64(bytes: Uint8Array) {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(value >>> 18) & 63];
    encoded += BASE64_ALPHABET[(value >>> 12) & 63];
    encoded += hasSecond ? BASE64_ALPHABET[(value >>> 6) & 63] : "=";
    encoded += hasThird ? BASE64_ALPHABET[value & 63] : "=";
  }
  return encoded;
}

async function defaultRetryDelay(signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const removeListener = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      removeListener();
      reject(abortReason(signal));
    };
    timer = setTimeout(() => {
      removeListener();
      resolve();
    }, 250);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function isNetworkUnreachable(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "network.unreachable",
  );
}

export class MeetingStreamingClient {
  private readonly fetcher?: typeof fetch;
  private readonly transport?: MeetingStreamingTransport;
  private readonly retryDelay: (signal: AbortSignal) => Promise<void>;
  private handle?: StreamHandle;
  private acknowledged = -1;
  private readonly persisted = new Set<number>();

  constructor(
    private readonly occurrenceId: string,
    options: ClientOptions = {},
  ) {
    if (options.fetcher && options.transport) {
      throw new Error("Meeting streaming fetcher and transport options are mutually exclusive.");
    }
    this.fetcher = options.transport ? undefined : (options.fetcher ?? fetch);
    this.transport = options.transport;
    this.retryDelay = options.retryDelay ?? defaultRetryDelay;
  }

  private path(suffix = "") {
    return `/api/work-hub/meetings/${encodeURIComponent(this.occurrenceId)}/transcription-stream${suffix}`;
  }

  private async send<T>(path: string, body: string, signal: AbortSignal): Promise<T> {
    if (this.transport) return this.transport<T>(path, body, signal);
    const response = await this.fetcher!(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      throw new Error(value?.error?.message ?? value?.message ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  private async request<T>(
    path: string,
    body: string,
    signal: AbortSignal,
    retryTransport = false,
    accept?: (value: T) => void,
  ): Promise<T> {
    throwIfAborted(signal);
    try {
      const value = await this.send<T>(path, body, signal);
      // Ownership must be recorded synchronously with a successful response,
      // before cancellation can make the returned provider handle unreachable.
      accept?.(value);
      throwIfAborted(signal);
      return value;
    } catch (error) {
      const retryable = this.transport ? isNetworkUnreachable(error) : error instanceof TypeError;
      if (!retryTransport || !retryable || signal.aborted) throw error;
      await this.retryDelay(signal);
      throwIfAborted(signal);
      return this.request<T>(path, body, signal, false, accept);
    }
  }

  async open(signal: AbortSignal) {
    try {
      return await this.request<StreamHandle>(
        this.path(),
        "{}",
        signal,
        false,
        (handle) => {
          this.acknowledged = -1;
          this.persisted.clear();
          this.handle = handle;
        },
      );
    } catch (error) {
      // A successful start may race with local cancellation after the response
      // is delivered. Explicitly release that late handle before propagating.
      if (this.handle) await this.close();
      throw error;
    }
  }

  private async upload(
    sequence: number,
    pcmBase64: string,
    signal: AbortSignal,
    ackTurnOrder?: number,
  ) {
    if (!this.handle) throw new Error("Meeting transcription stream is not open.");
    const body = JSON.stringify({
      sequence,
      pcmBase64,
      ...(ackTurnOrder === undefined ? {} : { ackTurnOrder }),
    });
    return this.request<{ turns: MeetingStreamingTurn[] }>(
      this.path(`/${this.handle.sessionId}/frame`),
      body,
      signal,
      true,
    );
  }

  async sendAndPersist(
    sequence: number,
    pcm: Uint8Array,
    persist: (turn: MeetingStreamingTurn, signal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
  ) {
    return this.sendBase64AndPersist(sequence, base64(pcm), persist, signal);
  }

  async sendBase64AndPersist(
    sequence: number,
    pcmBase64: string,
    persist: (turn: MeetingStreamingTurn, signal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
  ) {
    throwIfAborted(signal);
    let result = await this.upload(
      sequence,
      pcmBase64,
      signal,
      this.acknowledged >= 0 ? this.acknowledged : undefined,
    );
    for (let pass = 0; pass < 4; pass += 1) {
      let advanced = false;
      for (const turn of [...result.turns].sort((a, b) => a.turnOrder - b.turnOrder)) {
        if (this.persisted.has(turn.turnOrder)) continue;
        throwIfAborted(signal);
        await persist(turn, signal);
        throwIfAborted(signal);
        this.persisted.add(turn.turnOrder);
        this.acknowledged = Math.max(this.acknowledged, turn.turnOrder);
        advanced = true;
      }
      if (!advanced) break;
      // Exact duplicate frame plus an acknowledgement is idempotent server-side.
      result = await this.upload(sequence, pcmBase64, signal, this.acknowledged);
    }
  }

  async persistTurn(turn: MeetingStreamingTurn, signal: AbortSignal) {
    return this.request(
      `/api/work-hub/meetings/${encodeURIComponent(this.occurrenceId)}/transcript`,
      JSON.stringify({
        id: turn.id,
        text: turn.text,
        startsAtMs: turn.startsAtMs,
        endsAtMs: turn.endsAtMs,
      }),
      signal,
      true,
    );
  }

  async close() {
    const handle = this.handle;
    this.handle = undefined;
    if (!handle) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, CLOSE_TIMEOUT_MS);
    });
    const request = this.request(
      this.path(`/${handle.sessionId}/close`),
      "{}",
      controller.signal,
    ).then(() => undefined).catch(() => undefined);
    await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
  }
}
