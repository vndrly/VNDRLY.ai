const TARGET_RATE = 16_000;
const MIN_TAIL_SAMPLES = TARGET_RATE * 0.05;
const FILTER_TAPS = 63;

function lowPassCoefficients(inputSampleRate: number) {
  if (inputSampleRate === TARGET_RATE) return Float64Array.of(1);
  const normalizedCutoff = 7_000 / inputSampleRate;
  const coefficients = new Float64Array(FILTER_TAPS);
  const center = (FILTER_TAPS - 1) / 2;
  let total = 0;
  for (let index = 0; index < FILTER_TAPS; index += 1) {
    const offset = index - center;
    const sinc = offset === 0 ? 2 * normalizedCutoff : Math.sin(2 * Math.PI * normalizedCutoff * offset) / (Math.PI * offset);
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * index / (FILTER_TAPS - 1)) + 0.08 * Math.cos(4 * Math.PI * index / (FILTER_TAPS - 1));
    coefficients[index] = sinc * window; total += coefficients[index];
  }
  for (let index = 0; index < coefficients.length; index += 1) coefficients[index] /= total;
  return coefficients;
}

function pcm16(sample: number) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

export class MeetingPcmBatcher {
  private readonly ratio: number;
  private readonly frameSamples: number;
  private readonly filter: Float64Array;
  private filterHistory: Float32Array;
  private source = new Float32Array(0);
  private sourcePosition = 0;
  private output: number[] = [];

  constructor(inputSampleRate: number, frameDurationMs = 500) {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate < TARGET_RATE) throw new Error("Microphone sample rate is not supported.");
    if (!Number.isInteger(frameDurationMs) || frameDurationMs < 50 || frameDurationMs > 1_000) throw new Error("Meeting PCM frame duration is invalid.");
    this.ratio = inputSampleRate / TARGET_RATE;
    this.frameSamples = TARGET_RATE * frameDurationMs / 1_000;
    this.filter = lowPassCoefficients(inputSampleRate);
    this.filterHistory = new Float32Array(this.filter.length - 1);
  }

  push(input: Float32Array) {
    if (input.length) {
      const filtered = this.filtered(input);
      const combined = new Float32Array(this.source.length + filtered.length);
      combined.set(this.source); combined.set(filtered, this.source.length); this.source = combined;
    }
    while (this.sourcePosition < this.source.length) {
      const left = Math.floor(this.sourcePosition);
      const fraction = this.sourcePosition - left;
      if (fraction > 0 && left + 1 >= this.source.length) break;
      const sample = fraction === 0 ? this.source[left] : this.source[left] + (this.source[left + 1] - this.source[left]) * fraction;
      this.output.push(pcm16(sample)); this.sourcePosition += this.ratio;
    }
    const consumed = Math.min(this.source.length, Math.floor(this.sourcePosition));
    if (consumed > 0) { this.source = this.source.slice(consumed); this.sourcePosition -= consumed; }
    const frames: Uint8Array[] = [];
    while (this.output.length >= this.frameSamples) frames.push(this.take(this.frameSamples));
    return frames;
  }

  private filtered(input: Float32Array) {
    if (this.filter.length === 1) return input;
    const historyLength = this.filterHistory.length;
    const combined = new Float32Array(historyLength + input.length);
    combined.set(this.filterHistory); combined.set(input, historyLength);
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const cursor = historyLength + index;
      let value = 0;
      for (let tap = 0; tap < this.filter.length; tap += 1) value += this.filter[tap] * combined[cursor - tap];
      output[index] = value;
    }
    this.filterHistory = combined.slice(combined.length - historyLength);
    return output;
  }

  flush() {
    if (this.output.length < MIN_TAIL_SAMPLES) { this.output = []; return null; }
    return this.take(this.output.length);
  }

  private take(count: number) {
    const values = this.output.splice(0, count);
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setInt16(index * 2, value, true));
    return bytes;
  }
}
