const DEVICE_KEY = 'askv:microphone-device';
let inMemoryChoice: string | undefined;

export interface AskVMicrophoneState {
  selectedDeviceId: string;
  devices: Array<{ deviceId: string; label: string }>;
  active: boolean;
  activeLabel: string;
  activeSelection: string;
  fallback: boolean;
  level: number | null;
}

export function readAskVMicrophoneDevice(): string {
  if (inMemoryChoice !== undefined) return inMemoryChoice;
  try { return window.localStorage.getItem(DEVICE_KEY) ?? ''; } catch { return snapshot.selectedDeviceId; }
}

let snapshot: AskVMicrophoneState = {
  selectedDeviceId: '', devices: [], active: false, activeLabel: '', activeSelection: '', fallback: false, level: 0,
};
const listeners = new Set<() => void>();
const publish = (change: Partial<AskVMicrophoneState>) => {
  snapshot = { ...snapshot, ...change };
  listeners.forEach(listener => listener());
};
export const getAskVMicrophoneState = () => snapshot;
export function subscribeAskVMicrophone(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

/** Hardware preferences stay on this browser. No microphone permission is requested here. */
export function selectAskVMicrophone(deviceId: string): void {
  try { window.localStorage.setItem(DEVICE_KEY, deviceId); inMemoryChoice = undefined; } catch { inMemoryChoice = deviceId; }
  publish({ selectedDeviceId: deviceId });
}

/** A UI observer owns its devicechange listener and ignores late enumeration after unmount. */
export function observeAskVMicrophones(): () => void {
  let stopped = false, revision = 0;
  const devices = navigator.mediaDevices;
  const refresh = async () => {
    const attempt = ++revision;
    const selectedDeviceId = readAskVMicrophoneDevice();
    if (selectedDeviceId !== snapshot.selectedDeviceId) publish({ selectedDeviceId });
    if (!devices?.enumerateDevices) return;
    try {
      const found = await devices.enumerateDevices();
      if (!stopped && attempt === revision) publish({ devices: found
        .filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
        .map(device => ({ deviceId: device.deviceId, label: device.label })) });
    } catch { /* Keep the last known list when device enumeration is restricted. */ }
  };
  const onChange = () => { void refresh(); };
  devices?.addEventListener?.('devicechange', onChange);
  window.addEventListener('storage', onChange);
  window.addEventListener('askv:microphone-opened', onChange);
  void refresh();
  return () => {
    stopped = true; revision++;
    devices?.removeEventListener?.('devicechange', onChange);
    window.removeEventListener('storage', onChange);
    window.removeEventListener('askv:microphone-opened', onChange);
  };
}

export interface AskVMicrophoneCapture { stream: MediaStream; selectedDeviceId: string; fallback: boolean }

/** Only explicit missing-device errors allow a default retry; permission denials do not. */
export async function captureAskVMicrophone(signal: AbortSignal): Promise<AskVMicrophoneCapture> {
  const selectedDeviceId = readAskVMicrophoneDevice();
  const ensureActive = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  let stream: MediaStream, fallback = false;
  ensureActive();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...audio, ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
    }, video: false });
  } catch (error) {
    ensureActive();
    const name = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : '';
    if (!selectedDeviceId || !['NotFoundError', 'OverconstrainedError'].includes(name)) throw error;
    fallback = true;
    stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  }
  if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); ensureActive(); }
  return { stream, selectedDeviceId, fallback };
}

let currentMeter: symbol | undefined;

/** The meter retains only a scalar level. Wake uses its existing worklet frames;
 * plain realtime adds an analyser to its existing stream, never a second capture. */
export function meterAskVMicrophone(capture: AskVMicrophoneCapture, analyzeStream = false) {
  const token = Symbol('microphone-meter'); currentMeter = token;
  const track = capture.stream.getAudioTracks?.()[0] ?? capture.stream.getTracks()[0];
  let stopped = false, lastUpdate = -Infinity;
  let context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, analyser: AnalyserNode | undefined;
  let frame: number | undefined;
  publish({ active: true, activeLabel: track?.label ?? '', activeSelection: capture.selectedDeviceId,
    selectedDeviceId: readAskVMicrophoneDevice(), fallback: capture.fallback, level: analyzeStream ? null : 0 });
  window.dispatchEvent(new Event('askv:microphone-opened'));
  const push = (samples: Float32Array) => {
    if (stopped || currentMeter !== token || performance.now() - lastUpdate < 100) return;
    lastUpdate = performance.now();
    let sum = 0;
    if (track?.enabled !== false && track?.readyState !== 'ended') {
      for (const sample of samples) sum += sample * sample;
    }
    const level = samples.length ? Math.min(1, Math.sqrt(sum / samples.length) * 4) : 0;
    publish({ level: Number.isFinite(level) ? level : 0 });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    source?.disconnect(); analyser?.disconnect();
    track?.removeEventListener?.('ended', stop);
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    if (currentMeter === token) { currentMeter = undefined; publish({ active: false, activeLabel: '', activeSelection: '', fallback: false, level: 0 }); }
  };
  track?.addEventListener?.('ended', stop, { once: true });
  if (analyzeStream && typeof AudioContext !== 'undefined') {
    try {
      context = new AudioContext(); source = context.createMediaStreamSource(capture.stream); analyser = context.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const sample = () => {
        if (stopped) return;
        analyser!.getFloatTimeDomainData(samples); push(samples); samples.fill(0);
        frame = requestAnimationFrame(sample);
      };
      void context.resume().then(() => { if (!stopped) sample(); }).catch(() => {
        if (!stopped && currentMeter === token) publish({ level: null });
      });
    } catch {
      // Audio visualization support must never prevent a voice conversation.
      source?.disconnect(); analyser?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    }
  }
  return { push, stop };
}
