class VndrlyMeetingPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048);
    this.chunkLength = 0;
    this.nextSequence = 0;
    this.outstanding = new Set();
    this.failed = false;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "ack" && Number.isSafeInteger(message.sequence)) this.outstanding.delete(message.sequence);
    };
  }

  process(inputs) {
    if (this.failed) return false;
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.chunk.length - this.chunkLength);
      this.chunk.set(channel.subarray(offset, offset + count), this.chunkLength);
      this.chunkLength += count; offset += count;
      if (this.chunkLength !== this.chunk.length) continue;
      if (this.outstanding.size >= 16) {
        this.failed = true;
        this.port.postMessage({ type: "overflow" });
        return false;
      }
      const sequence = this.nextSequence++;
      const samples = this.chunk;
      this.chunk = new Float32Array(2048); this.chunkLength = 0;
      this.outstanding.add(sequence);
      this.port.postMessage({ type: "audio", sequence, samples }, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor("vndrly-meeting-pcm", VndrlyMeetingPcmProcessor);
