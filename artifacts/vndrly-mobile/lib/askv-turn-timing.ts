type ReplySignal = "Expo AV isPlaying" | "iOS speech onStart" | "provider output buffer started";

interface Turn {
  path: string;
  detectedAt?: number;
  lastLoudFrameAt?: number;
  replyAt?: number;
  replySignal?: ReplySignal;
}

let armed = false;
let latest: Turn | undefined;

export function armAskVTiming() {
  latest = undefined;
  armed = true;
}

export function beginAskVTiming(path: string): Turn | undefined {
  if (!armed) return;
  armed = false;
  return latest = { path };
}

export function finishAskVTiming(turn: Turn | undefined, signal: ReplySignal) {
  if (!turn || turn !== latest || turn.detectedAt === undefined || turn.replyAt !== undefined) return;
  turn.replyAt = performance.now();
  turn.replySignal = signal;
}

export function askVTimingReport() {
  if (!latest) return armed ? "Waiting for the next spoken turn." : "No timing sample. Arm diagnostics first.";
  const { path, detectedAt, lastLoudFrameAt, replyAt, replySignal } = latest;
  const interval = (start?: number, end?: number) =>
    start === undefined || end === undefined ? "unavailable" : Math.round(end - start) + " ms";
  return [
    "Ask V voice timings",
    path,
    "Actual end of speech → detected end: unavailable",
    "Last loud mic frame → detected end (estimate): " + interval(lastLoudFrameAt, detectedAt),
    "Detected end → first reply signal: " + interval(detectedAt, replyAt),
    "Reply signal: " + (replySignal ?? "unavailable"),
    "Actual audible playback: unavailable",
  ].join("\n");
}
