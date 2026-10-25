// Ephemeral audio samples for display only; nothing is stored or transmitted.
const readers = new Set<() => Float32Array>();
export function observeAskVAudio(stream: MediaStream): () => void {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser(); analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const read = () => { analyser.getFloatTimeDomainData(samples); return samples; };
    readers.add(read);
    void context.resume().catch(() => {});
    return () => { readers.delete(read); source.disconnect(); analyser.disconnect(); void context!.close().catch(() => {}); };
  } catch { if (context) void context.close().catch(() => {}); return () => {}; }
}
export function observeAskVPcm() {
  let samples = new Float32Array(256), updated = 0;
  const read = () => performance.now() - updated < 150 ? samples : new Float32Array(256);
  readers.add(read);
  return { push(frame: Float32Array) { samples = frame.slice(-256); updated = performance.now(); }, stop() { readers.delete(read); samples.fill(0); } };
}
export function readAskVWaveform(): Float32Array {
  let loudest: Float32Array = new Float32Array(256); let energy = 0;
  for (const read of readers) {
    const samples = read(); const next = samples.reduce((sum, value) => sum + value * value, 0);
    if (next > energy) { loudest = samples; energy = next; }
  }
  return loudest;
}
