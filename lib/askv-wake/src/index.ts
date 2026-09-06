/** Platform-neutral primitives; microphone audio must never be persisted here. */
export function isWakeKeyword(value: string): boolean {
  return /^ask\s?v$/i.test(value.trim());
}

export class PcmRingBuffer {
  private readonly samples: Float32Array;
  private next = 0;
  private count = 0;
  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Invalid PCM capacity');
    this.samples = new Float32Array(capacity);
  }
  push(frame: Float32Array): void {
    for (const value of frame.subarray(Math.max(0, frame.length - this.samples.length))) {
      this.samples[this.next] = Number.isFinite(value) ? value : 0;
      this.next = (this.next + 1) % this.samples.length;
      this.count = Math.min(this.count + 1, this.samples.length);
    }
  }
  snapshot(): Float32Array {
    const output = new Float32Array(this.count);
    const start = (this.next - this.count + this.samples.length) % this.samples.length;
    for (let i = 0; i < this.count; i++) output[i] = this.samples[(start + i) % this.samples.length];
    return output;
  }
  clear(): void { this.samples.fill(0); this.count = 0; this.next = 0; }
}

export class MicrophoneCoordinator {
  private current: { key: symbol; name: string; stop: () => Promise<void> } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(owner: string | null) => void>();
  get owner(): string | null { return this.current?.name ?? null; }
  subscribe(listener: (owner: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish(): void { for (const listener of this.listeners) listener(this.owner); }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  acquire(name: string, stop: () => Promise<void>): Promise<() => Promise<void>> {
    return this.serial(async () => {
      if (this.current) await this.current.stop();
      const key = Symbol(name);
      this.current = { key, name, stop };
      this.publish();
      return () => this.serial(async () => {
        if (this.current?.key !== key) return;
        await stop();
        if (this.current?.key === key) { this.current = null; this.publish(); }
      });
    });
  }
}

export const askVMicrophone = new MicrophoneCoordinator();

export interface WakeAudioSource {
  /** Subscribe consumes the bounded pre-roll first, followed by live 16 kHz mono PCM. */
  subscribe(onAudio: (samples: Float32Array) => void): () => void;
  stop(): void | Promise<void>;
}

/** Stateful linear resampling retains fractional phase between microphone frames. */
export class PcmResampler {
  private pending = new Float32Array(0);
  private position = 0;
  private readonly step: number;
  constructor(inputRate: number, outputRate: number) {
    if (inputRate <= 0 || outputRate <= 0) throw new Error('Invalid sample rate');
    this.step = inputRate / outputRate;
  }
  push(frame: Float32Array): Float32Array {
    const input = new Float32Array(this.pending.length + frame.length);
    input.set(this.pending); input.set(frame, this.pending.length);
    const result: number[] = [];
    while (this.position + 1 < input.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      result.push(input[left] * (1 - fraction) + input[left + 1] * fraction);
      this.position += this.step;
    }
    const consumed = Math.min(Math.floor(this.position), input.length);
    this.pending = input.slice(consumed);
    this.position -= consumed;
    return Float32Array.from(result);
  }
  clear(): void { this.pending.fill(0); this.pending = new Float32Array(0); this.position = 0; }
}

/** No Buffer dependency: runs in browser, React Native, and Node. */
export function encodePcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => {
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    output += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=')
      + (i + 2 < bytes.length ? alphabet[value & 63] : '=');
  }
  return output;
}
