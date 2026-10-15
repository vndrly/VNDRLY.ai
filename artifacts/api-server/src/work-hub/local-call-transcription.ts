export type CallTranscriptSegment = {
  speakerUserId: number;
  startsAtMs: number;
  endsAtMs: number;
  text: string;
};
export function pcmWav(pcm: Buffer): Buffer {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}
/** Bounded, serialized local inference. Transport failures never control voice audio. */
export class LocalCallTranscription {
  private sequence = 0;
  private chunks: Buffer[] = [];
  private bytes = 0;
  private positionMs = 0;
  private closed = false;
  private pending = false;
  private processing: Promise<void> | null = null;
  private failure: unknown;
  constructor(
    private speakerUserId: number,
    private process: (wav: Buffer) => Promise<string>,
    private save: (segment: CallTranscriptSegment) => Promise<void>,
    private authorize: () => Promise<void>,
  ) {}
  async append(sequence: number, pcm: Buffer): Promise<void> {
    if (this.closed || this.failure || this.bytes >= 10 * 32000)
      throw new Error("transcription unavailable or busy");
    await this.authorize();
    if (sequence < this.sequence) return;
    if (sequence !== this.sequence) throw new Error("audio sequence gap");
    if (!pcm.length || pcm.length > 16000 || pcm.length % 2)
      throw new Error("invalid PCM frame");
    this.chunks.push(Buffer.from(pcm));
    this.bytes += pcm.length;
    this.sequence++;
    if (this.bytes >= 10 * 32000 && !this.pending) this.startFlush();
  }
  private startFlush() {
    this.processing = this.flush()
      .catch((error) => {
        this.failure = error;
      })
      .finally(() => {
        this.processing = null;
        if (!this.closed && !this.failure && this.bytes >= 10 * 32000)
          this.startFlush();
      });
  }
  private async flush() {
    if (!this.bytes) return;
    this.pending = true;
    const pcm = Buffer.concat(this.chunks),
      startsAtMs = this.positionMs,
      endsAtMs = startsAtMs + pcm.length / 32;
    this.chunks = [];
    this.bytes = 0;
    this.positionMs = endsAtMs;
    try {
      await this.authorize();
      const text = await this.process(pcmWav(pcm));
      await this.authorize();
      if (text.trim())
        await this.save({
          speakerUserId: this.speakerUserId,
          startsAtMs,
          endsAtMs,
          text: text.trim(),
        });
    } finally {
      this.pending = false;
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.processing) await this.processing;
    if (this.failure) throw this.failure;
    await this.flush();
  }
}
